<template>
  <div class="flex items-center justify-center absolute bottom-0 left-0 right-0 pl-4 pr-4 h-8 border-t dark:border-darker border-gray-300">
    <div class="absolute left-4 h-full text-xs leading-8">
      <span class="text-blue-400 mr-1 w-20 inline-block">{{ playTime }}</span>/<span class="ml-2 w-20">{{ allTime }}</span>
    </div>
    <div class="m-auto flex items-center">
      <ElIcon :size="24" class="cursor-pointer box-content" :class="[disable ? 'cursor-not-allowed' : 'cursor-pointer']">
        <VideoPause v-show="!store.isPause" @click="pauseVideo" />
        <VideoPlay v-show="store.isPause" @click="startPlay" />
      </ElIcon>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { VideoPlay, VideoPause } from '@element-plus/icons-vue';
  import { computed, onBeforeUnmount, watch } from 'vue';
  import { formatPlayerTime } from '@/utils/common';
  import { usePlayerState } from '@/stores/playerState';
  import { useTrackState } from '@/stores/trackState';
  import { getCurrentTrackItemList } from '@/utils/trackUtils';
  import { baseFps } from '@/data/trackConfig';
  import { AudioTrack } from '@/class/AudioTrack';
  const props = defineProps({
    disable: {
      type: Boolean,
      default: false
    }
  });
  const store = usePlayerState();
  const trackStore = useTrackState();
  const playTime = computed(() => {
    return formatPlayerTime(store.playStartFrame);
  });
  const allTime = computed(() => {
    return formatPlayerTime(trackStore.frameCount);
  });
  let animation = 0;
  let playing = new Set<AudioTrack>();

  function syncAudio() {
    const active = store.isPause ? [] : getCurrentTrackItemList(
      trackStore.trackList, store.playStartFrame, (track): track is AudioTrack => track instanceof AudioTrack
    );
    const next = new Set(active);
    playing.forEach(clip => { if (!next.has(clip)) clip.pause(); });
    next.forEach(clip => clip.play(store.playStartFrame));
    playing = next;
  }

  const pauseVideo = () => {
    store.isPause = true;
    cancelAnimationFrame(animation);
    syncAudio();
  };
  function startPlay() {
    if (props.disable || store.isExporting || !trackStore.frameCount) return;
    if (store.playStartFrame >= trackStore.frameCount) {
      store.playStartFrame = 0;
    }
    store.isPause = false;
    syncAudio();
    cancelAnimationFrame(animation);
    const startFrame = store.playStartFrame;
    const startTime = performance.now();
    function tick(now: number) {
      if (store.isPause) return;
      const frame = startFrame + Math.floor((now - startTime) * baseFps / 1000);
      store.playStartFrame = Math.min(trackStore.frameCount, Math.max(startFrame, frame));
      if (store.playStartFrame >= trackStore.frameCount) pauseVideo();
      else animation = requestAnimationFrame(tick);
    }
    animation = requestAnimationFrame(tick);
  }
  // 在一些操作时，需要暂停播放
  watch(() => store.isPause, () => {
    if (store.isPause) {
      pauseVideo();
    }
  });
  watch(() => store.playStartFrame, syncAudio);
  onBeforeUnmount(pauseVideo);
</script>

<style scoped>

</style>