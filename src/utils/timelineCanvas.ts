import { toRaw } from 'vue';
import { ImageTrack } from '@/class/ImageTrack';
import { TextTrack } from '@/class/TextTrack';
import { VideoTrack } from '@/class/VideoTrack';
import type { Track, TrackLineItem } from '@/class/Track';
import { getTimelineLayers, isActiveAt } from './timelineGeometry';
import type { CanvasSize } from './timelineGeometry';

export type ReadVideoFrame = (track: VideoTrack, frame: number) => Promise<HTMLCanvasElement | null>;

export function isVisual(track: unknown): track is VideoTrack | ImageTrack | TextTrack {
  return track instanceof VideoTrack || track instanceof ImageTrack || track instanceof TextTrack;
}

/* eslint-disable no-await-in-loop -- draw layers in compositing order */
export async function drawTimelineFrame(
  ctx: CanvasRenderingContext2D,
  lines: TrackLineItem[],
  size: CanvasSize,
  frame: number,
  readVideo: ReadVideoFrame
) {
  ctx.setTransform(ctx.canvas.width / size.width, 0, 0, ctx.canvas.height / size.height, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size.width, size.height);

  for (const layer of getTimelineLayers(lines, frame, (track, at) => isVisual(track) && isActiveAt(track, at))) {
    const track = toRaw(layer);
    ctx.save();
    try {
      if (track instanceof VideoTrack) {
        const image = await readVideo(track, frame);
        if (image) {
          ctx.drawImage(image, track.getDrawX(size.width), track.getDrawY(size.height), track.drawWidth, track.drawHeight);
        }
      } else if (isVisual(track)) {
        await track.draw(ctx, size, frame);
      }
    } finally {
      ctx.restore();
    }
  }
}
