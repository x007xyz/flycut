<template>
  <div ref="viewport" class="absolute top-12 bottom-10 left-2 right-2 overflow-hidden">
    <canvas ref="playerCanvas" class="absolute left-0 right-0 top-0 bottom-0 m-auto bg-gray-900" id="player" :style="{ zoom: scale, width: `${playerWidth}px`, height: `${playerHeight}px` }" />
    <PlayerMoveable :style="{ zoom: scale, width: `${playerWidth}px`, height: `${playerHeight}px` }" />
  </div>
  <PlayerControl />
</template>

<script setup lang="ts">
  import PlayerMoveable from '@/components/item/player/PlayerMoveable.vue';
  import PlayerControl from '@/components/item/player/PlayerControl.vue';
  import { ref, computed, onMounted, onBeforeUnmount, toRaw, watch } from 'vue';
  import { ElMessage } from 'element-plus';
  import { usePlayerState } from '@/stores/playerState';
  import { useTrackState } from '@/stores/trackState';
  import { drawTimelineFrame } from '@/utils/timelineCanvas';
  import { getPreviewFrame } from '@/utils/timelineGeometry';
  import { createVideoReader } from '@/utils/timelineVideo';
  import type { TrackLineItem } from '@/class/Track';
  import { storeToRefs } from 'pinia';

  const store = usePlayerState();
  const tracks = useTrackState();
  const playerCanvas = ref<HTMLCanvasElement>();
  const viewport = ref<HTMLDivElement>();
  const viewportSize = ref({ width: 0, height: 0 });
  const { playerWidth, playerHeight } = storeToRefs(store);
  const scale = computed(() => Math.min(
    viewportSize.value.width / playerWidth.value, viewportSize.value.height / playerHeight.value
  ));
  const video = createVideoReader();

  const observer = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    viewportSize.value = { width, height };
  });
  let buffer: HTMLCanvasElement;
  let scheduled = 0;
  let pending = false;
  let drawing = false;
  let disposed = false;
  let hasPreviewError = false;

  async function draw() {
    scheduled = 0;
    const canvas = playerCanvas.value;
    const ctx = buffer?.getContext('2d', { alpha: false });
    const target = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !ctx || !target || !scale.value) return;

    drawing = true;
    pending = false;
    const size = { width: playerWidth.value, height: playerHeight.value };
    const resolution = scale.value * (window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(size.width * resolution));
    const height = Math.max(1, Math.round(size.height * resolution));
    if (buffer.width !== width) buffer.width = width;
    if (buffer.height !== height) buffer.height = height;
    try {
      video.retain(new Set(tracks.trackList.flatMap(line => line.list.map(track => track.id))));
      const frame = getPreviewFrame(store.playStartFrame, tracks.frameCount);
      await drawTimelineFrame(ctx, toRaw(tracks.trackList) as TrackLineItem[], size, frame, video.read);
      if (!disposed) {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        target.drawImage(buffer, 0, 0);
        hasPreviewError = false;
      }
    } catch (error) {
      if (!disposed && !hasPreviewError) {
        hasPreviewError = true;
        ElMessage.error(error instanceof Error ? error.message : '无法渲染预览');
      }
    } finally {
      drawing = false;
      if (pending && !disposed) scheduled = requestAnimationFrame(draw);
    }
  }

  function scheduleDraw() {
    pending = true;
    if (!disposed && !drawing && !scheduled) scheduled = requestAnimationFrame(draw);
  }

  watch([() => tracks.trackList, () => store.playStartFrame, playerWidth, playerHeight, scale],
        scheduleDraw, { deep: true, flush: 'post' });
  onMounted(() => {
    buffer = document.createElement('canvas');
    if (viewport.value) observer.observe(viewport.value);
    window.addEventListener('resize', scheduleDraw);
    scheduleDraw();
  });
  onBeforeUnmount(() => {
    disposed = true;
    observer.disconnect();
    cancelAnimationFrame(scheduled);
    window.removeEventListener('resize', scheduleDraw);
    video.dispose();
  });
</script>