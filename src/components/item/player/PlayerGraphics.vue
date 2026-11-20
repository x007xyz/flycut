<template>
  <canvas ref="canvas" class="absolute inset-0 w-full h-full" aria-hidden="true" />
</template>

<script setup lang="ts">
  import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import type { TrackLineItem } from '@/class/Track';
  import { drawGraphicsFrame, getGraphicsFrame } from '@/utils/timelineCanvas';
  import type { CanvasSize } from '@/utils/timelineGeometry';

  const props = defineProps<{ lines: TrackLineItem[]; frame: number; size: CanvasSize; scale: number }>();
  const canvas = ref<HTMLCanvasElement>();
  let previous: ReturnType<typeof getGraphicsFrame> | undefined;

  function render() {
    const target = canvas.value;
    if (!target || !props.scale) return;
    const ctx = target.getContext('2d');
    if (!ctx) return;

    const resolution = props.scale * Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(props.size.width * resolution));
    const height = Math.max(1, Math.round(props.size.height * resolution));
    if (target.width !== width || target.height !== height) {
      target.width = width;
      target.height = height;
      previous = undefined;
    }
    const graphics = getGraphicsFrame(props.lines, props.frame);
    if (graphics.length === previous?.length && graphics.every(
      ({ track, image }, index) => track === previous?.[index].track && image === previous?.[index].image
    )) return;
    drawGraphicsFrame(ctx, props.size, graphics);
    previous = graphics;
  }

  function invalidate() {
    previous = undefined;
    render();
  }
  watch(() => [props.lines, props.size], invalidate, { deep: true, flush: 'post' });
  watch(() => [props.frame, props.scale], render, { flush: 'post' });
  onMounted(() => {
    window.addEventListener('resize', render);
    document.fonts?.addEventListener('loadingdone', invalidate);
    render();
  });
  onBeforeUnmount(() => {
    window.removeEventListener('resize', render);
    document.fonts?.removeEventListener('loadingdone', invalidate);
  });
</script>
