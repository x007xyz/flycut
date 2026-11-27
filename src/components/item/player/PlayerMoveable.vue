<template>
  <div
      id="player"
      ref="moveContainer"
      class="absolute left-0 right-0 top-0 bottom-0 m-auto overflow-hidden bg-black"
  >
    <div
        v-for="(item, index) in targetList"
        :key="item.id"
        :data-eleId="item.id"
        :data-lineIndex="item.lineIndex"
        :data-itemIndex="item.itemIndex"
        :data-kind="item.kind"
        :style="{
          zIndex: index,
          top: `${item.top}px`,
          left: `${item.left}px`,
          width: `${item.w}px`,
          height: `${item.h}px`,
          transform: `translate(${item.x}px, ${item.y}px) scale(${item.scale})`
        }"
        class="move-target absolute"
        @click.stop="selectItem(item.id)"
        @mousedown="mousedown($event, item.id)"
    >
      <canvas
          :ref="el => setCanvas(item.id, el)"
          class="absolute pointer-events-none"
          :style="{
            left: `${-item.pad}px`,
            top: `${-item.pad}px`,
            width: `${item.w + item.pad * 2}px`,
            height: `${item.h + item.pad * 2}px`
          }"
      />
    </div>
    <Moveable
        ref="moveable"
        v-bind="draggableOptions"
        @dragStart="startTransform"
        @drag="onDrag"
        @dragEnd="endTransform"
        @scaleStart="startTransform"
        @scale="onScale"
        @scaleEnd="endTransform"
    />
  </div>
</template>

<script setup lang="ts">
  import { defaultMoveOptions } from '@/data/constant';
  import Moveable from 'vue3-moveable';
  import { ref, nextTick, reactive, computed, watch, onBeforeUnmount, toRaw } from 'vue';
  import { usePlayerState } from '@/stores/playerState';
  import { useTrackState } from '@/stores/trackState';
  import { buildScene, frameKey, type Layer, type Track } from '@/render/scene';
  import { drawLayer, loadFrameSources } from '@/render/drawFrame';
  import { textPadding } from '@/render/text';
  import type { VideoTrack } from '@/class/VideoTrack';
  import type { TextTrack } from '@/class/TextTrack';
  import type { ImageTrack } from '@/class/ImageTrack';
  const props = defineProps({
    zoom: {
      type: Number,
      default: 1
    }
  });
  const store = usePlayerState();
  const trackStore = useTrackState();
  const moveContainer = ref();
  const moveable = ref();
  const moveTarget = ref();
  // 文字描边和背景超出文字框的部分
  const textBleed = textPadding + 2;
  interface TargetItem {
    id: string;
    kind: Layer['kind'];
    lineIndex: number,
    itemIndex: number,
    y: number;
    x: number;
    w: number;
    h: number;
    pad: number;
    scale: number;
    left: number;
    top: number;
  }
  // 预览即 DOM：每个可见图层是一个元素，画面绘制在元素内的 canvas 上，Moveable 直接拖拽该元素
  const scene = computed(() => {
    const frame = store.playStartFrame;
    // 同一行的剪切点处只显示后一个片段，与导出一致
    const tracks = trackStore.trackList.flatMap(({ list }) => (list as Track[])
      .filter(track => track.end !== frame || !list.some(other => other.start === frame)));
    return buildScene(tracks, frame, { width: store.playerWidth, height: store.playerHeight }, { includeEnd: true });
  });
  const trackIndex = computed(() => {
    const index = new Map<string, { lineIndex: number, itemIndex: number, track: VideoTrack | ImageTrack | TextTrack }>();
    trackStore.trackList.forEach(({ list }, lineIndex) => list.forEach((track, itemIndex) => {
      index.set(track.id, { lineIndex, itemIndex, track: track as VideoTrack | ImageTrack | TextTrack });
    }));
    return index;
  });
  const targetList = computed(() => {
    if (store.playerHeight === 0 && store.playerWidth === 0) {
      return [];
    }
    return scene.value.layers.flatMap((layer): TargetItem[] => {
      const entry = trackIndex.value.get(layer.clipId);
      if (!entry) return [];
      const { lineIndex, itemIndex, track } = entry;
      const scale = track.scale / 100;
      return [{
        lineIndex,
        itemIndex,
        id: track.id,
        kind: layer.kind,
        scale,
        x: track.centerX,
        y: track.centerY,
        w: track.width,
        h: track.height,
        pad: layer.kind === 'text' ? textBleed / scale : 0,
        left: store.playerWidth / 2 - track.width / 2,
        top: store.playerHeight / 2 - track.height / 2
      }];
    });
  });
  const canvases = new Map<string, HTMLCanvasElement>();
  function setCanvas(id: string, el: unknown) {
    if (el) canvases.set(id, el as HTMLCanvasElement);
    else canvases.delete(id);
  }
  let renderId = 0;
  const painted = { key: '' };
  async function paint() {
    if (store.ingLoadingCount !== 0) return;
    const current = toRaw(scene.value);
    const ratio = (window.devicePixelRatio || 1) * props.zoom;
    const key = `${ratio}:${frameKey(current)}`;
    if (key === painted.key) return;
    const id = ++renderId;
    const sources = await loadFrameSources(current);
    try {
      // 较新的绘制请求已经开始，丢弃过期帧
      if (id !== renderId) return;
      current.layers.forEach((layer, index) => {
        const canvas = canvases.get(layer.clipId);
        const track = trackIndex.value.get(layer.clipId)?.track;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !track || !ctx) return;
        const bleed = layer.kind === 'text' ? textBleed : 0;
        const x = (layer.kind === 'text' ? layer.x : layer.rect.x) - bleed;
        const y = (layer.kind === 'text' ? layer.y : layer.rect.y) - bleed;
        const width = Math.max(1, Math.round((track.drawWidth + bleed * 2) * ratio));
        const height = Math.max(1, Math.round((track.drawHeight + bleed * 2) * ratio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        const scaleX = width / (track.drawWidth + bleed * 2);
        const scaleY = height / (track.drawHeight + bleed * 2);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.setTransform(scaleX, 0, 0, scaleY, -x * scaleX, -y * scaleY);
        drawLayer(ctx, layer, sources.images[index]);
      });
      // eslint-disable-next-line require-atomic-updates -- 过期请求已在上方通过 renderId 丢弃
      painted.key = key;
    } finally {
      sources.release();
    }
  }
  watch([scene, () => props.zoom, () => store.ingLoadingCount], paint, { deep: true, flush: 'post', immediate: true });
  const draggableOptions = reactive({
    target: moveTarget,
    className: 'cc-move',
    container: moveContainer.value,
    ...defaultMoveOptions
  });
  function selectItem(eleid: string) {
    console.log('🚀 ~ selectItem ~ eleid:', eleid);
    store.isPause = true;
    trackStore.selectTrackById(eleid);
  }
  function onDrag(params: Record<string, any>) {
    let { target, transform, translate } = params;
    const { lineindex, itemindex } = target.dataset;
    const [x, y] = translate;
    trackStore.trackList[lineindex].list[itemindex].centerX = x;
    trackStore.trackList[lineindex].list[itemindex].centerY = y;
    target.style.transform = transform;
  }
  let transforming = false;
  function endTransform() {
    if (!transforming) return;
    transforming = false;
    trackStore.historyDragging = false;
    document.removeEventListener('mouseup', endTransform);
    document.removeEventListener('pointerup', endTransform);
    document.removeEventListener('pointercancel', endTransform);
    document.removeEventListener('touchend', endTransform);
    window.removeEventListener('blur', endTransform);
  }
  function startTransform() {
    trackStore.flushHistory();
    transforming = true;
    trackStore.historyDragging = true;
    document.addEventListener('mouseup', endTransform);
    document.addEventListener('pointerup', endTransform);
    document.addEventListener('pointercancel', endTransform);
    document.addEventListener('touchend', endTransform);
    window.addEventListener('blur', endTransform);
  }
  onBeforeUnmount(endTransform);
  function onScale(params: Record<string, any>) {
    let { target, scale, transform } = params;
    const { lineindex, itemindex } = target.dataset;
    const newScale = Math.max(Math.round(scale[0] * 100), 1);
    trackStore.trackList[lineindex].list[itemindex].scale = newScale;
    target.style.transform = transform;
  }
  function mousedown(event: MouseEvent, eleid: string) {
    event.stopPropagation();
    store.isPause = true;
    trackStore.selectTrackById(eleid);
    moveTarget.value = event.currentTarget;
    nextTick(() => {
      moveable.value.dragStart(event);
    });
  }
  watch(moveTarget, endTransform);
  watch([trackStore.selectTrackItem, targetList], async() => {
    if (moveContainer.value && trackStore.selectTrackItem.line !== -1 && trackStore.selectTrackItem.index !== -1) {
      const targetTrack = trackStore.trackList[trackStore.selectTrackItem.line].list[trackStore.selectTrackItem.index];
      if (targetTrack && targetList.value.find(item => item.id === targetTrack.id)) {
        moveTarget.value = moveContainer.value.querySelector(`.move-target[data-eleid='${targetTrack.id}']`);
      } else {
        moveTarget.value = null;
      }
    } else {
      moveTarget.value = null;
    }
    if (!moveTarget.value) endTransform();
    await nextTick();
    moveable.value?.updateRect();
  }, { immediate: true, flush: 'post' });
</script>

<style>
  body .cc-move .moveable-control{
    @apply border w-3 h-3 border-yellow-400 bg-gray-50 -ml-1.5 -mt-1.5;
  }
  body .cc-move .moveable-line{
    @apply bg-yellow-400 w-px;
  }
</style>