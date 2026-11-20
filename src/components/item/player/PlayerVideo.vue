<template>
  <video
    ref="element"
    class="absolute block object-fill"
    :src="track.source.url"
    :muted="track.silent"
    :style="style"
    preload="auto"
    playsinline
    @loadedmetadata="syncPosition"
    @error="showError"
  />
</template>

<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { ElMessage } from 'element-plus';
  import type { VideoTrack } from '@/class/VideoTrack';
  import { baseFps } from '@/data/trackConfig';
  import { getTrackRect } from '@/utils/timelineGeometry';
  import type { CanvasSize } from '@/utils/timelineGeometry';
  import { observeVideoFrames, sourceTimeAt } from '@/utils/previewVideo';

  const props = defineProps<{ track: VideoTrack; frame: number; size: CanvasSize; paused: boolean }>();
  const emit = defineEmits<{ (event: 'presented', id: string, time: number | null): void }>();
  const element = ref<HTMLVideoElement>();
  const style = computed(() => {
    const { x, y, width, height } = getTrackRect(props.track, props.size);
    return { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` };
  });
  let cleanup: (() => void) | undefined;
  let hadError = false;

  function showError() {
    if (hadError) return;
    hadError = true;
    ElMessage.error(`无法播放预览：${props.track.name}`);
  }

  function syncPosition() {
    const video = element.value;
    if (!video || video.error) return;
    const time = Math.min(video.duration || Infinity, Math.max(0, sourceTimeAt(props.track, props.frame)));
    if (props.paused) video.pause();
    // Let the element advance on its own; only correct drift during continuous playback.
    const tolerance = props.paused ? 1e-4 : video.paused ? 0.5 / baseFps : 0.18;
    if (Math.abs(video.currentTime - time) > tolerance && (props.paused || !video.seeking)) {
      video.currentTime = time;
    }
    if (!props.paused && video.paused && !video.ended && !hadError) {
      video.play().catch(error => {
        if (element.value === video && !props.paused && error.name !== 'AbortError') showError();
      });
    }
  }

  watch(() => [props.frame, props.paused, props.track.start, props.track.offsetL], syncPosition, { flush: 'post' });
  onMounted(() => {
    if (!element.value) return;
    cleanup = observeVideoFrames(element.value, time => {
      emit('presented', props.track.id, time);
    });
    syncPosition();
  });
  onBeforeUnmount(() => {
    cleanup?.();
    element.value?.pause();
    emit('presented', props.track.id, null);
  });
</script>
