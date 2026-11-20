<template>
  <div class="flex-1 overflow-hidden relative" @click="cancelSelect">
    <span class="pl-2 inline-block w-full h-10 mb-2 leading-10 border-b dark:border-darker border-gray-300">播放器</span>
    <Player />
  </div>
</template>

<script setup lang="ts">
  import Player from '@/components/item/player/Player.vue';
  import { useTrackState } from '@/stores/trackState';
  const trackStore = useTrackState();
  function cancelSelect(event: MouseEvent) {
    event.stopPropagation();
    trackStore.selectTrackItem.line = -1;
    trackStore.selectTrackItem.index = -1;
  }
</script>
