<template>
  <div class="flex flex-col rounded overflow-hidden h-full" ref="el">
      <div class="flex items-center text-xs pl-2 overflow-hidden h-5 leading-5 bg-gray-500 bg-opacity-40 text-gray-200">
        <VideoIcon class="inline-block mr-2 shrink-0" />
        <span class="mr-4 shrink-0">{{ trackItem.name }}</span>
      </div>
      <div ref="container" class="overflow-hidden bg-gray-400 bg-opacity-70 flex-1 relative whitespace-nowrap" :style="waveStyle">
        <img
v-for="(item, index) in thumbnails" :key="index" :src="item" alt="" class="image-item"
draggable="false"
>
      </div>
      <div class="leading-3 pl-2 overflow-hidden h-3 bg-gray-700 relative">
        <!-- <img :src="waveFileUrl" v-show="waveFileUrl" class="absolute left-0 right-0 top-0 bottom-0 h-full min-w-full" :style="waveStyle" alt=""> -->
      </div>
      <Loading v-show="loading" class="pl-12 bg-opacity-70" />
  </div>
</template>

<script setup lang="ts">
  import Loading from '@/components/Loading.vue';
  import type { PropType } from 'vue';
  import type { VideoTrack } from '@/class/VideoTrack';
  import { usePlayerState } from '@/stores/playerState';
  import trackCheckPlaying from './trackCheckPlaying';
  import { computed, ref, watch } from 'vue';
  import { readVideoThumbnails } from '@/utils/timelineVideo';
  import { useResizeObserver } from '@vueuse/core';
  const props = defineProps({
    trackItem: {
      type: Object as PropType<VideoTrack>,
      required: true
    }
  });
  const store = usePlayerState();
  const container = ref();
  const loading = ref(true);
  // const waveFileUrl = ref('');
  const waveStyle = computed(() => {
    const { start, end, offsetL, offsetR, frameCount } = props.trackItem;
    const showFrameCount = end - start;

    return {
      // transform: `scaleX(${(frameCount / showFrameCount).toFixed(2)})`,
      transformOrigin: 'left top',
      left: `-${offsetL / frameCount * 100}%`,
      right: `-${offsetR / frameCount * 100}%`,
      width: `${frameCount / showFrameCount * 100}%`
    };
  });
  const imgs = ref<string[]>([]);

  const el = ref();

  const containerWidth = ref<number>(100);

  useResizeObserver(el, entries => {
    const entry = entries[0];
    const { width } = entry.contentRect;
    containerWidth.value = width;
  });

  function getUniformSubarray(array: string[], m: number) {
    // 计算采样间隔
    const interval = array.length / m;

    // 使用顺序采样的方法选取元素
    const subarray = [];
    for (let i = 0; i < array.length && subarray.length < m; i += interval) {
      // 只有当元素数量还没有达到m时，才添加元素
      subarray.push(array[Math.min(Math.round(i), array.length - 1)]);
    }

    return subarray;
  }

  const thumbnails = computed(() => {
    if (imgs.value.length === 0) return [];
    const { start, end, frameCount } = props.trackItem;
    const showFrameCount = end - start;
    return getUniformSubarray(imgs.value, Math.ceil(containerWidth.value * frameCount / showFrameCount / 50));
  });

  watch(() => props.trackItem.source.file, async(file, _previous, onCleanup) => {
    let active = true;
    loading.value = true;
    store.ingLoadingCount++;
    onCleanup(() => {
      if (loading.value) store.ingLoadingCount--;
      active = false;
      imgs.value.forEach(url => URL.revokeObjectURL(url));
      imgs.value = [];
    });
    try {
      const blobs = await readVideoThumbnails(file);
      if (active) imgs.value = blobs.map(blob => URL.createObjectURL(blob));
    } catch (error) {
      if (active) console.warn('无法生成缩略图', error);
    } finally {
      if (active) {
        loading.value = false;
        store.ingLoadingCount--;
      }
    }
  }, { immediate: true });
  trackCheckPlaying(props);
</script>

<style scope>
.image-item {
display: inline-block;
width: 50px;
object-fit: cover;
height: 100%;
}
</style>