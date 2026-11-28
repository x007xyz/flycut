<template>
  <div class="trackList flex flex-1 w-full overflow-hidden relative" @dragover="onFileDragOver" @drop="onFileDrop">
    <div
      v-if="store.trackList.length === 0"
      class="flex justify-center items-center h-24 m-auto w-2/3 dark:bg-gray-500 bg-gray-200 rounded-md text-sm border-dashed border-2 dark:border-gray-500 border-gray-200"
    >
      <VideoIcon class="text-xl mr-4" />
      从资源列表把视频、图片或音频拖到这里，开始编辑你的大作吧~
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
      :trackConfigs="trackConfigs"
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
  import { ElMessage } from 'element-plus';
  import { assetDragType, insertAsset } from '@/utils/importMedia';
  import { useResourceState } from '@/stores/resourceStore';
  const resources = useResourceState();
  import { computed, shallowRef, watch } from 'vue';
  import type { TrackLineItem } from '@/class/Track';
  import { applyDocument, toDocument } from './document';
  import { mediaProvider } from './mediaProvider';

  const store = useTrackState();
  const playerStore = usePlayerState();
  const page = usePageState();
  const ui = { toolbar: false, ruler: true, sidebar: { showTrackActions: false }};
  const trackConfigs = { text: { type: 'text', height: 24 }};
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
    const selected = store.selectResource?.id;
    store.flushHistory();
    applyDocument(store.trackList as TrackLineItem[], next);
    if (selected) store.selectTrackById(selected);
  }
  function onFrameChange(frame: number) {
    if (frame === playerStore.playStartFrame) return;
    playerStore.isPause = true;
    playerStore.playStartFrame = Math.min(Math.max(frame, 0), store.frameCount);
  }

  // 时间轴只接受资源列表中的素材；文件要先导入资源列表
  function onFileDragOver(event: DragEvent) {
    const types = event.dataTransfer?.types ?? [];
    if (!types.includes('Files') && !types.includes(assetDragType)) return;
    event.preventDefault();
    // 文件也要接收 drop，才能提示先导入资源列表
    event.dataTransfer!.dropEffect = 'copy';
  }
  async function onFileDrop(event: DragEvent) {
    const assetId = event.dataTransfer?.getData(assetDragType);
    if (!assetId && !event.dataTransfer?.files.length) return;
    event.preventDefault();
    event.stopPropagation();
    const record = assetId && resources.assets.find(({ id }) => id === assetId);
    if (record) await insertAsset(record);
    else if (!assetId) ElMessage.warning('请先在左侧“资源”中导入文件，再把资源拖到时间轴');
  }
</script>

<style>
  .tk-track-clip[data-type="text"] .tk-default-clip {
    background: linear-gradient(135deg, #653a34, #8f4a40);
    display: flex;
    flex-direction: row;
    justify-content: flex-start;
    align-items: center;
    padding: 0 6px;
  }
  .tk-track-clip[data-type="text"] .tk-default-clip-title {
    overflow: hidden;
    color: #f5f2eb;
    font-size: 12px;
    line-height: 18px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .tk-track-clip[data-type="text"] .tk-default-clip-meta {
    display: none;
  }
  .tk-timeline-editor .tk-default-clip[data-type="image"] {
    background: linear-gradient(135deg, #3a3a42, #77717a);
    color: #f5f2eb;
  }
  .tk-timeline-editor .tk-track-icon .tk-lucide {
    stroke: var(--tk-muted);
  }
  .tk-timeline-editor .tk-media-clip {
    background: linear-gradient(180deg, #212227, #2a2b31);
    color: #f5f2eb;
  }
  .tk-timeline-editor .tk-media-clip.is-audio {
    background: linear-gradient(180deg, #3c2a27, #51322d);
  }
  .tk-timeline-editor .tk-media-clip-filmstrip-host, .tk-timeline-editor .tk-media-clip-filmstrip {
    background: #111215;
  }
  .tk-timeline-editor .tk-media-clip-waveform {
    background: rgba(255, 115, 92, .12);
    color: #ffb9ae;
  }
  .tk-timeline-editor .tk-media-clip-waveform.is-audio-body {
    background: rgba(255, 115, 92, .08);
    color: #ff9d8d;
  }
  .tk-timeline-editor[data-theme="light"] {
    --tk-accent: #ff735c;
    --tk-border-strong: #ff735c;
    --tk-bg: #f5f2eb;
    --tk-surface: #f5f2eb;
    --tk-panel: #f5f2eb;
    --tk-ruler-bg: #ece8df;
    --tk-ruler-text: #595653;
    --tk-ruler-long: #c9c4ba;
    --tk-ruler-short: #b8b6be;
    --tk-ruler-sub: #77717a;
    --tk-ruler-focus: #ffd5ce;
    --tk-track: #ece8df;
    --tk-border: #dcd7cc;
    --tk-text: #111215;
    --tk-muted: #595653;
  }
  .dark .tk-timeline-editor[data-theme="dark"] {
    --tk-accent: #ff735c;
    --tk-border-strong: #ff735c;
    --tk-bg: #1b1c20;
    --tk-surface: #1b1c20;
    --tk-panel: #1b1c20;
    --tk-ruler-bg: #1b1c20;
    --tk-ruler-text: #b8b6be;
    --tk-ruler-long: #33343b;
    --tk-ruler-short: #77717a;
    --tk-ruler-sub: #77717a;
    --tk-ruler-focus: #653a34;
    --tk-track: #212227;
    --tk-border: #111215;
    --tk-text: #f5f2eb;
    --tk-muted: #b8b6be;
  }
</style>
