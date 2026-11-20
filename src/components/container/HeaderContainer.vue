<template>
  <header class="h-14 w-full flex flex-nowrap flex-row items-center justify-between border-b dark:border-b-2 dark:border-darker border-gray-200">
    <div class="flex w-1/3 pl-2 items-center">
      <svg
      height="32" aria-hidden="true" viewBox="0 0 16 16" version="1.1" width="32"
      data-view-component="true" class="github-icon mx-4 cursor-pointer" :class="store.isDark ? 'text-white' : 'text-black'" @click="openGithub"
      >
          <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
      </svg>
      <div class="ml-2">
        <img class="h-8" src="@/assets/text_logo.png" alt="">
      </div>
      <!-- <span class="text-xs select-none ml-4">自动保存：2023-02-10 00:51</span> -->
    </div>
    <div class="flex w-1/3 flex-row-reverse pr-10 items-center">
      <ElButton color="#683CFD" size="default" :disabled="!trackState.frameCount || dialogVisible" @click="onGenerate">
        <ElIcon :size="size" color="#fff" class="mr-1">
          <Download />
        </ElIcon>
        合成视频
      </ElButton>
      <el-switch
        class="mr-10"
        size="large"
        :active-icon="Moon"
        :inactive-icon="Sunny"
        :inline-prompt="inner"
        v-model="store.isDark"
        :style="switchClass"
      /> 
</div>
    <ElDialog
      v-model="dialogVisible" title="合成视频" width="min(440px, 90vw)"
      :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false"
    >
      <template v-if="result">
        <p>视频已生成：{{ result.extension.toUpperCase() }}</p>
        <p v-if="result.extension === 'webm'">当前浏览器不支持此项目的 MP4 编码，已改用 WebM。</p>
      </template>
      <template v-else>
        <p>{{ progress === 0 ? '正在检查编码支持并准备素材…' : '正在合成视频…' }}</p>
        <ElProgress :percentage="progress" />
      </template>
      <template #footer>
        <ElButton :disabled="saving || cancelling" @click="closeExport">{{ result ? '关闭' : '取消合成' }}</ElButton>
        <ElButton v-if="result" type="primary" :loading="saving" @click="saveExport">保存视频</ElButton>
      </template>
    </ElDialog>
  </header>
</template>

<script setup lang="ts">
  /* eslint-disable camelcase */
  import { ref, shallowRef, computed, onBeforeUnmount, toRaw } from 'vue';
  import { Download, Sunny, Moon } from '@element-plus/icons-vue';
  import { usePageState } from '@/stores/pageState';
  import { useTrackState } from '@/stores/trackState';
  import { usePlayerState } from '@/stores/playerState';
  import { ElMessage } from 'element-plus';
  import type { exportTimeline } from '@/utils/timelineExport';
  import type { TrackLineItem } from '@/class/Track';

  const trackState = useTrackState();

  const playerState = usePlayerState();

  const store = usePageState();
  const size = ref(14);
  const inner = ref(true);
  const dialogVisible = ref(false);
  const progress = ref(0);
  const saving = ref(false);
  const cancelling = ref(false);
  const result = shallowRef<Awaited<ReturnType<typeof exportTimeline>>>();
  let controller: AbortController | undefined;
  const switchClass = computed(() => ({
    '--el-switch-border-color': store.isDark ? '#4B5563' : '#D1D5DB',
    '--el-color-white': store.isDark ? '#F3F4F6' : '#374151'
  }));

  function finishGeneration() {
    controller = undefined;
    cancelling.value = false;
    playerState.isExporting = false;
  }

  function hideDialog() {
    dialogVisible.value = false;
    result.value = undefined;
  }

  function finishSave() {
    saving.value = false;
  }

  async function onGenerate() {
    if (dialogVisible.value || !trackState.frameCount) return;
    playerState.isPause = true;
    playerState.isExporting = true;
    dialogVisible.value = true;
    progress.value = 0;
    result.value = undefined;
    const abort = new AbortController();
    controller = abort;
    const canvasSize = { width: playerState.playerWidth, height: playerState.playerHeight };
    const lines = (toRaw(trackState.trackList) as TrackLineItem[]).map(line => ({ ...line, list: line.list.slice() }));
    const frameCount = Math.ceil(trackState.frameCount);

    try {
      const { exportTimeline } = await import('@/utils/timelineExport');
      result.value = await exportTimeline(lines, canvasSize, frameCount, abort.signal, percent => { progress.value = percent; });
    } catch (error) {
      hideDialog();
      if (!abort.signal.aborted) ElMessage.error(error instanceof Error ? error.message : '合成失败，请重试');
    } finally {
      finishGeneration();
    }
  }

  function closeExport() {
    if (controller) {
      cancelling.value = true;
      controller.abort();
    } else {
      hideDialog();
    }
  }

  async function saveExport() {
    if (!result.value || saving.value) return;
    const { blob, extension } = result.value;
    const filename = `FlyCut-${Date.now()}.${extension}`;
    saving.value = true;
    try {
      if (typeof window.showSaveFilePicker === 'function') {
        const file = await window.showSaveFilePicker({
          suggestedName: filename, types: [{ accept: { [blob.type]: [`.${extension}`] }}]
        });
        const writer = await file.createWritable();
        try {
          await writer.write(blob);
          await writer.close();
        } catch (error) {
          await writer.abort().catch(() => {});
          throw error;
        }
        ElMessage.success('视频已保存');
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        ElMessage.success('已开始下载视频');
      }
      closeExport();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        ElMessage.error(error instanceof Error ? error.message : '保存失败，请重试');
      }
    } finally {
      finishSave();
    }
  }

  onBeforeUnmount(() => controller?.abort());

  function openGithub() {
    window.open('https://github.com/x007xyz/fly-cut.git');
  }
</script>

<style>
.github-icon {
  fill: currentColor;
}
</style>
