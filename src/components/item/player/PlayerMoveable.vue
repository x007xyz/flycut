<template>
  <div
      id="player"
      ref="moveContainer"
      class="absolute left-0 right-0 top-0 bottom-0 m-auto bg-black"
  >
    <!-- 只裁剪画面，Moveable 控制框在裁剪层之外，元素超出画布时仍可缩放 -->
    <div class="absolute inset-0 overflow-hidden">
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
            height: `${item.h + item.pad * 2}px`,
            ...motionStyle(item)
          }"
      />
    </div>
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
  // 文字描边、背景和超出行高的字形（如越南语声调符号）可能超出文字框
  function bleedOf(layer: Layer) {
    return layer.kind === 'text' ? textPadding + 2 + layer.style.fontSize * 0.5 : 0;
  }
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
    motion?: Layer['motion'];
  }
  // 动画只作用在画面上，Moveable 拖拽的元素保持片段的基础位置；与导出的 drawFrame 变换一致
  function motionStyle({ motion, scale, pad, w, h }: TargetItem) {
    if (!motion) return {};
    return {
      opacity: motion.opacity,
      filter: motion.blur > 0 ? `blur(${motion.blur / scale}px)` : undefined,
      transformOrigin: `${pad + w / 2}px ${pad + h / 2}px`,
      transform: `translate(${motion.x / scale}px, ${motion.y / scale}px) rotate(${motion.rotate}deg) scale(${motion.scale})`
    };
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
        pad: bleedOf(layer) / scale,
        left: store.playerWidth / 2 - track.width / 2,
        top: store.playerHeight / 2 - track.height / 2,
        motion: layer.motion
      }];
    });
  });
  const canvases = new Map<string, HTMLCanvasElement>();
  function setCanvas(id: string, el: unknown) {
    if (el) canvases.set(id, el as HTMLCanvasElement);
    else canvases.delete(id);
  }
  const painted = { key: '' };
  async function paintLatest() {
    if (store.ingLoadingCount !== 0) return;
    const current = toRaw(scene.value);
    const ratio = (window.devicePixelRatio || 1) * props.zoom;
    // 动画变换由 CSS 完成，不需要重绘画面
    const key = `${ratio}:${frameKey({ ...current, layers: current.layers.map(({ motion, ...layer }) => layer as Layer) })}`;
    if (key === painted.key) return;
    const sources = await loadFrameSources(current);
    try {
      current.layers.forEach((layer, index) => {
        const canvas = canvases.get(layer.clipId);
        const track = trackIndex.value.get(layer.clipId)?.track;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !track || !ctx) return;
        const bleed = bleedOf(layer);
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
      // eslint-disable-next-line require-atomic-updates -- 同一时间只有一次绘制
      painted.key = key;
    } finally {
      sources.release();
    }
  }
  // 同一时间只解码绘制一帧，期间的变化在完成后按最新画面再画一次。
  // 若每次新帧都丢弃未完成的绘制，解码慢于播放帧率时画面永远画不出来，新出现的字幕一直是空白
  let painting = false;
  let repaint = false;
  async function paint() {
    if (painting) {
      repaint = true;
      return;
    }
    painting = true;
    try {
      do {
        repaint = false;
        // eslint-disable-next-line no-await-in-loop
        await paintLatest();
      } while (repaint);
    } finally {
      // eslint-disable-next-line require-atomic-updates -- 只有持有 painting 的调用会走到这里
      painting = false;
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
    @apply border w-3 h-3 bg-gray-50 -ml-1.5 -mt-1.5;
    border-color: #ff735c;
  }
  body .cc-move .moveable-line{
    @apply w-px;
    background: #ff735c;
  }
</style>