<template>
  <div class="trackList flex flex-1 w-full overflow-hidden relative" @dragover="onFileDragOver" @drop="onFileDrop">
    <div
      v-if="store.trackList.length === 0"
      class="flex justify-center items-center h-24 m-auto w-2/3 dark:bg-gray-500 bg-gray-200 rounded-md text-sm border-dashed border-2 dark:border-gray-500 border-gray-200"
    >
      <VideoIcon class="text-xl mr-4" />
      将 MP4 视频拖拽到这里，开始编辑你的大作吧~
    </div>
    <TimelineEditor
      v-else
      class="flex-1 h-full"
      :document="document"
      :fps="baseFps"
      :currentFrame="playerStore.playStartFrame"
      :trackScale="store.trackScale"
      :theme="page.isDark ? 'dark' : 'light'"
      :ui="ui"
      :policies="policies"
      :mediaProvider="mediaProvider"
      :onBeforeCommand="onBeforeCommand"
      history="external"
      :shortcuts="false"
      @documentchange="onDocumentChange"
      @update:currentFrame="onFrameChange"
      @update:trackScale="(scale: number) => store.trackScale = scale"
      @ready="(instance: NativeTimelineEditor) => editor = instance"
    />
  </div>
</template>

<script setup lang="ts">
  import { TimelineEditor } from '@flycut/timeline-kit/vue';
  import type { BeforeCommandHook, NativeTimelineEditor, TimelineCommand, TimelineEditorSnapshot } from '@flycut/timeline-kit';
  import VideoIcon from '@/components/icons/VideoIcon.vue';
  import { useTrackState } from '@/stores/trackState';
  import { usePlayerState } from '@/stores/playerState';
  import { usePageState } from '@/stores/pageState';
  import { baseFps } from '@/data/trackConfig';
  import { importVideo } from '@/utils/importVideo';
  import { ElMessage } from 'element-plus';
  import { computed, shallowRef, watch } from 'vue';
  import type { TrackLineItem } from '@/class/Track';
  import { applyDocument, toDocument } from './document';
  import { mediaProvider } from './mediaProvider';

  const store = useTrackState();
  const playerStore = usePlayerState();
  const page = usePageState();
  const ui = { toolbar: false, ruler: true, sidebar: { showTrackActions: false }};
  const policies = { allowCrossTrackType: false, removeEmptyTracks: true, orderAudioToBottom: true };
  const document = computed(() => toDocument(store.trackList as TrackLineItem[]));
  const editor = shallowRef<NativeTimelineEditor>();

  watch([editor, () => store.selectResource?.id], ([instance, id]) => {
    if (!instance || (instance.getSnapshot().selection.clipId ?? undefined) === id) return;
    instance.setSelection(id ?? null);
  }, { flush: 'post' });

  // 分割、删除、撤销由 flycut 的 trackState 处理，时间轴只负责移动和裁剪
  const delegated: Record<string, (command: TimelineCommand<{ clipIds?: string[] }>) => void> = {
    'clip:split': () => store.splitSelected(playerStore.playStartFrame, { width: playerStore.playerWidth, height: playerStore.playerHeight }),
    'clip:delete': ({ payload }) => store.removeTracks(payload?.clipIds ?? editor.value?.getSnapshot().selection.clipIds ?? []),
    'history:undo': () => store.undo(),
    'history:redo': () => store.redo()
  };
  // 只同步用户在时间轴上的选择；文档更新时 timeline-kit 保留的旧选择不回写
  function syncSelection({ type, payload }: TimelineCommand<{ clipId?: string, clipIds?: string[] }>) {
    const id = type === 'selection:set' ? payload?.clipId ?? payload?.clipIds?.[0] : undefined;
    if (id) store.selectTrackById(id);
    else Object.assign(store.selectTrackItem, { line: -1, index: -1 });
  }
  const onBeforeCommand: BeforeCommandHook = command => {
    if (command.type === 'selection:set' || command.type === 'selection:clear') {
      syncSelection(command as TimelineCommand<{ clipId?: string, clipIds?: string[] }>);
      return undefined;
    }
    const run = delegated[command.type];
    if (!run) return undefined;
    run(command as TimelineCommand<{ clipIds?: string[] }>);
    return false;
  };

  function onDocumentChange({ document: next }: TimelineEditorSnapshot) {
    if (JSON.stringify(next) === JSON.stringify(document.value)) return;
    store.flushHistory();
    applyDocument(store.trackList as TrackLineItem[], next);
  }
  function onFrameChange(frame: number) {
    if (frame === playerStore.playStartFrame) return;
    playerStore.isPause = true;
    playerStore.playStartFrame = Math.min(Math.max(frame, 0), store.frameCount);
  }

  function onFileDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }
  async function onFileDrop(event: DragEvent) {
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    event.preventDefault();
    event.stopPropagation();
    const video = Array.from(files).find(file => file.type === 'video/mp4' || /\.mp4$/i.test(file.name));
    if (!video) {
      ElMessage.warning('请拖入 MP4 视频');
      return;
    }
    await importVideo(video);
  }
</script>
