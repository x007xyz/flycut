/* eslint-disable no-await-in-loop -- audio buffers are decoded in order */
import type { ClipRenderContext, MediaProvider } from '@flycut/timeline-kit/core';
import { audioDecoder, videoDecoder } from '@/utils/webcodecs';

type Thumbnail = { image: ImageBitmap, ts: number };

const thumbnailCache = new Map<string, Promise<Thumbnail[]>>();
const peakCache = new Map<string, Promise<Float32Array>>();
const peakRate = 100; // peaks per second

function thumbnailsOf(id: string) {
  let thumbnails = thumbnailCache.get(id);
  if (!thumbnails) {
    thumbnails = videoDecoder.thumbnails({ id } as Parameters<typeof videoDecoder.thumbnails>[0])
      .then(list => Promise.all(list.map(async({ img, ts }) => ({ image: await createImageBitmap(img), ts: ts / 1e6 }))));
    thumbnails.catch(() => thumbnailCache.delete(id));
    thumbnailCache.set(id, thumbnails);
  }
  return thumbnails;
}

async function decodePeaks(id: string, type: string) {
  const asset = type === 'video' ? await videoDecoder.decode({ id }) : await audioDecoder.decode({ id });
  const peaks = new Float32Array(Math.max(1, Math.ceil(asset.meta.duration * peakRate)));
  if (!asset.audioSink) return peaks;
  for await (const { buffer, timestamp } of asset.audioSink.buffers(0, asset.meta.duration)) {
    const data = buffer.getChannelData(0);
    const step = buffer.sampleRate / peakRate;
    for (let i = 0; i < data.length; i += step) {
      const index = Math.floor((timestamp + i / buffer.sampleRate) * peakRate);
      let peak = 0;
      for (let j = Math.floor(i); j < Math.min(data.length, i + step); j++) peak = Math.max(peak, Math.abs(data[j]));
      if (index < peaks.length) peaks[index] = Math.max(peaks[index], peak);
    }
  }
  return peaks;
}

function peaksOf(id: string, type: string) {
  let peaks = peakCache.get(id);
  if (!peaks) {
    peaks = decodePeaks(id, type);
    peaks.catch(() => peakCache.delete(id));
    peakCache.set(id, peaks);
  }
  return peaks;
}

function visibleRange({ clip }: ClipRenderContext) {
  const from = (clip.trim?.startMs ?? 0) / 1000;
  const to = (clip.trim?.endMs ?? clip.durationMs ?? clip.endMs - clip.startMs) / 1000;
  return { from, to: Math.max(from + 0.01, to) };
}

// 时间轴缩略图与波形由 MediaBunny 解码
export const mediaProvider: MediaProvider = {
  renderFilmstrip(canvas, ctx) {
    const id = ctx.clip.resource;
    const context = canvas.getContext('2d');
    if (!id || !context || canvas.width <= 0 || canvas.height <= 0) return undefined;
    let cancelled = false;
    thumbnailsOf(id).then(thumbnails => {
      if (cancelled || !thumbnails.length) return;
      const { width, height } = canvas;
      const { from, to } = visibleRange(ctx);
      const { image } = thumbnails[0];
      const slot = Math.max(1, height * image.width / image.height);
      for (let x = 0; x < width; x += slot) {
        const time = from + (x + slot / 2) / width * (to - from);
        const thumb = thumbnails.reduce((best, item) => (Math.abs(item.ts - time) < Math.abs(best.ts - time) ? item : best));
        context.drawImage(thumb.image, x, 0, slot, height);
      }
      canvas.dataset.decoded = 'true';
    }, () => {});
    return () => {
      cancelled = true;
    };
  },
  renderWaveform(canvas, ctx) {
    const id = ctx.clip.resource;
    const context = canvas.getContext('2d');
    if (!id || !context || canvas.width <= 0 || canvas.height <= 0) return undefined;
    let cancelled = false;
    peaksOf(id, ctx.clip.type).then(peaks => {
      if (cancelled) return;
      const { width, height } = canvas;
      const { from, to } = visibleRange(ctx);
      context.clearRect(0, 0, width, height);
      context.fillStyle = 'rgba(255, 255, 255, 0.7)';
      for (let x = 0; x < width; x++) {
        const index = Math.floor((from + x / width * (to - from)) * peakRate);
        const peak = Math.min(1, peaks[index] ?? 0);
        const bar = Math.max(1, peak * height);
        context.fillRect(x, (height - bar) / 2, 1, bar);
      }
      canvas.dataset.decoded = 'true';
    }, () => {});
    return () => {
      cancelled = true;
    };
  }
};
