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
      <ElButton color="#683CFD" size="default" :disabled="exporting" @click="onGenerate">
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
  </header>
</template>

<script setup lang="ts">
  /* eslint-disable camelcase */
  import { ref, computed, toRaw } from 'vue';
  import { Download, Sunny, Moon } from '@element-plus/icons-vue';
  import { usePageState } from '@/stores/pageState';
  import { useTrackState } from '@/stores/trackState';
  import { usePlayerState } from '@/stores/playerState';
  import { AudioTrack } from '@/class/AudioTrack';
  import { UnitFrame2μs } from '@/data/trackConfig';
  import { Combinator } from '@webav/av-cliper';
  import { createFileWriter } from '@/utils/common';
  import { saveRenderedVideo } from '@/utils/videoExport';
  import { ElLoading, ElMessage, ElMessageBox } from 'element-plus';
  import 'element-plus/es/components/message-box/style/css';

  const trackState = useTrackState();

  const playerState = usePlayerState();

  const store = usePageState();
  const size = ref(14);
  const inner = ref(true);
  const exporting = ref(false);
  const silentExportNotice = '当前浏览器不支持 AAC 编码，导出的视频将没有声音。';
  const switchClass = computed(() => ({
    '--el-switch-border-color': store.isDark ? '#4B5563' : '#D1D5DB',
    '--el-color-white': store.isDark ? '#F3F4F6' : '#374151'
  }));

  async function chooseDestination(includeAudio: boolean) {
    try {
      // The save picker needs a fresh user gesture after rendering.
      const message = includeAudio ? '视频已合成，是否保存 MP4？' : `${silentExportNotice}是否保存 MP4？`;
      await ElMessageBox.confirm(message, '合成完成', {
        confirmButtonText: '保存 MP4',
        cancelButtonText: '取消',
        closeOnClickModal: false
      });
      return await createFileWriter();
    } catch (error) {
      if (error === 'cancel' || error === 'close' || (error instanceof DOMException && error.name === 'AbortError')) {
        return undefined;
      }
      throw error;
    }
  }

  async function generateVideo() {
    if (!trackState.frameCount) {
      ElMessage.warning('请先添加素材');
      return;
    }
    if (typeof window.showSaveFilePicker !== 'function') {
      ElMessage.error('当前浏览器不支持保存视频，请使用 Chrome 或 Edge');
      return;
    }

    const loading = ElLoading.service({ text: '正在合成视频' });
    const videoConfig = { codec: 'avc1.42E032', width: 1080, height: 1920, bitrate: 5e6 };
    let com: Combinator | undefined;
    try {
      const supportsVideo = typeof OffscreenCanvas !== 'undefined' && typeof VideoFrame !== 'undefined'
        && typeof window.VideoEncoder !== 'undefined' && (await window.VideoEncoder.isConfigSupported(videoConfig)).supported;
      if (!supportsVideo) {
        ElMessage.error('当前浏览器不支持 MP4 所需的 H.264 编码，请更换浏览器后重试');
        return;
      }

      // WebAV's combined support check requires AAC even with audio disabled.
      const includeAudio = typeof window.AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined'
        && await window.AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 })
          .then(result => result.supported === true, () => false);

      const maxTime = includeAudio ? undefined : trackState.frameCount * UnitFrame2μs;
      const tracks = toRaw(trackState.trackList).flatMap(({ list }) => list)
        .filter(track => includeAudio || track.type !== 'audio');
      if (!tracks.length) {
        ElMessage.error('当前浏览器不支持 AAC 编码，此项目没有可导出的画面');
        return;
      }
      if (!includeAudio) ElMessage.warning(silentExportNotice);
      const playerSize = { width: playerState.playerWidth, height: playerState.playerHeight };
      const { codec: videoCodec, ...videoOptions } = videoConfig;
      const options = { ...videoOptions, videoCodec, bgColor: 'black' };
      com = new Combinator(includeAudio ? options : { ...options, audio: false });
      const compositor = com;
      const prepared = await Promise.allSettled(tracks.map(async(track, index) => {
        const rawTrack = toRaw(track);
        const sprite = await (rawTrack instanceof AudioTrack ? rawTrack.combine() : rawTrack.combine(playerSize, 6));
        try {
          sprite.zIndex = 999 - index;
          await compositor.addSprite(sprite);
        } finally {
          sprite.destroy();
        }
      }));
      const failed = prepared.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;

      const saved = await saveRenderedVideo(() => compositor.output({ maxTime }), () => {
        loading.close();
        return chooseDestination(includeAudio);
      });
      if (saved) ElMessage.success('合成视频成功');
    } catch (error) {
      console.error(error);
      ElMessage.error('导出视频失败，请重试');
    } finally {
      com?.destroy();
      loading.close();
    }
  }

  async function onGenerate() {
    if (exporting.value) return;
    exporting.value = true;
    await generateVideo().finally(() => {
      exporting.value = false;
    });
  }

  function openGithub() {
    window.open('https://github.com/x007xyz/fly-cut.git');
  }
</script>

<style>
.github-icon {
  fill: currentColor;
}
</style>
