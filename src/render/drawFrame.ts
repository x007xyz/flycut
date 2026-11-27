import type { VideoSample } from 'mediabunny';
import { imageDecoder, videoDecoder } from '@/utils/webcodecs';
import type { Layer, Rect, Scene } from './scene';
import { drawText, layoutText } from './text';

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type MediaLayer = Exclude<Layer, { kind: 'text' }>;
export type Drawable = ImageBitmap | HTMLCanvasElement | OffscreenCanvas | VideoSample;
export type FrameLoader = (layer: MediaLayer) => Promise<Drawable | null>;

export interface FrameSources {
  images: (Drawable | null)[],
  release(): void
}

function isSample(source: Drawable): source is VideoSample {
  return typeof (source as VideoSample).draw === 'function' && typeof (source as VideoSample).close === 'function';
}

export const loadPreviewFrame: FrameLoader = layer => (layer.kind === 'video'
  ? videoDecoder.getFrame(layer.sourceId, layer.time)
  : imageDecoder.getFrame(layer.sourceId, layer.time, layer.format));

// 先异步取齐每个图层的素材帧，再同步绘制，避免绘制过程中出现半帧
export async function loadFrameSources(scene: Scene, load: FrameLoader = loadPreviewFrame): Promise<FrameSources> {
  const images = await Promise.all(scene.layers.map(layer => (layer.kind === 'text' ? null : load(layer))));
  return {
    images,
    release() {
      images.forEach(image => {
        if (image && isSample(image)) image.close();
      });
    }
  };
}

function drawMedia(ctx: Context, source: Drawable, { x, y, width, height }: Rect) {
  if (isSample(source)) source.draw(ctx, x, y, width, height);
  else ctx.drawImage(source, x, y, width, height);
}

export function drawLayer(ctx: Context, layer: Layer, image: Drawable | null) {
  if (layer.kind === 'text') drawText(ctx, layer.x, layer.y, layer.style);
  else if (image) drawMedia(ctx, image, layer.rect);
}

function boxOf(ctx: Context, layer: Layer): Rect {
  if (layer.kind !== 'text') return layer.rect;
  const { width, height } = layoutText(ctx, layer.style);
  return { x: layer.x, y: layer.y, width, height };
}

// 动画变换围绕图层中心：先平移，再旋转、缩放
function drawAnimated(ctx: Context, layer: Layer, image: Drawable | null, scale: number) {
  const { motion } = layer;
  if (!motion) {
    drawLayer(ctx, layer, image);
    return;
  }
  if (motion.opacity <= 0 || motion.scale <= 0) return;
  const box = boxOf(ctx, layer);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  ctx.save();
  ctx.globalAlpha *= motion.opacity;
  if (motion.blur > 0) ctx.filter = `blur(${motion.blur * scale}px)`;
  ctx.translate(cx + motion.x, cy + motion.y);
  ctx.rotate(motion.rotate * Math.PI / 180);
  ctx.scale(motion.scale, motion.scale);
  ctx.translate(-cx, -cy);
  drawLayer(ctx, layer, image);
  ctx.restore();
}

export function drawFrame(ctx: Context, scene: Scene, { images }: Pick<FrameSources, 'images'>, { scale = 1 } = {}) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, scene.width, scene.height);
  scene.layers.forEach((layer, index) => drawAnimated(ctx, layer, images[index], scale));
  ctx.restore();
}
