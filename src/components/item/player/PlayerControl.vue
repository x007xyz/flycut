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
  import { ref, computed, watch } from 'vue';
  import { formatPlayerTime, preciseInterval } from '@/utils/common';
  import { usePlayerState } from '@/stores/playerState';
  import { useTrackState } from '@/stores/trackState';
  import { getCurrentTrackItemList, isOfCanPlayType } from '@/utils/trackUtils';
  import { shouldSkipShortcut } from '@/utils/initHotKey';
  import { useEventListener } from '@vueuse/core';
  import type { AudioTrack } from '@/class/AudioTrack';
  import type { VideoTrack } from '@/class/VideoTrack';
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
  let playTimer = ref();
  const timeStamp = 1000 / 30;
  let playingTracks = new Set<AudioTrack | VideoTrack>();
  function syncAudio() {
    const frame = store.playStartFrame;
    const nextTracks = new Set(getCurrentTrackItemList(trackStore.trackList, frame, isOfCanPlayType)
      .filter(item => frame < item.end && !item.silent));
    playingTracks.forEach(item => {
      if (!nextTracks.has(item)) item.pause();
    });
    nextTracks.forEach(item => item.play(frame));
    playingTracks = nextTracks;
  }
  // 视频暂停
  const pauseVideo = () => {
    store.isPause = true;
    playTimer.value?.cancel();

    playingTracks.forEach(item => item.pause());
    playingTracks.clear();
  };
  function startPlay() {
    if (props.disable) return;
    if (store.playStartFrame >= trackStore.frameCount) {
      store.playStartFrame = 0;
    }
    store.isPause = false;
    syncAudio();
    playTimer.value?.cancel();
    playTimer.value = preciseInterval(() => {
      store.playStartFrame++;
      if (store.playStartFrame >= trackStore.frameCount) {
        pauseVideo();
      }
    }, timeStamp);
  }
  // 空格键播放/暂停
  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if (event.key !== ' ' || event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (shouldSkipShortcut(event)) return;
    // 焦点在按钮、开关等控件上时，空格保留原生的点击行为
    if (event.target instanceof HTMLElement && event.target.closest('button, a[href], [role="button"], [role="switch"], [role="checkbox"], [role="tab"], [role="radio"]')) return;
    event.preventDefault();
    if (store.isPause) startPlay();
    else pauseVideo();
  });
  // 在一些操作时，需要暂停播放
  watch(() => store.isPause, () => {
    if (store.isPause) {
      pauseVideo();
    }
  });
  watch(() => store.playStartFrame, () => {
    if (!store.isPause) syncAudio();
  });
</script>

<style scoped>

</style>