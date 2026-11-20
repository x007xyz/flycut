import { toRaw } from 'vue';
import { ImageTrack } from '@/class/ImageTrack';
import { TextTrack } from '@/class/TextTrack';
import { VideoTrack } from '@/class/VideoTrack';
import type { TrackLineItem } from '@/class/Track';
import { getTimelineLayers, getTrackRect, isActiveAt } from './timelineGeometry';
import type { CanvasSize } from './timelineGeometry';

export type ReadVideoFrame = (track: VideoTrack, frame: number) => Promise<HTMLCanvasElement | null>;

export function isVisual(track: unknown): track is VideoTrack | ImageTrack | TextTrack {
  return track instanceof VideoTrack || track instanceof ImageTrack || track instanceof TextTrack;
}

function isGraphic(track: unknown): track is ImageTrack | TextTrack {
  return track instanceof ImageTrack || track instanceof TextTrack;
}

function setScale(ctx: CanvasRenderingContext2D, size: CanvasSize) {
  ctx.setTransform(ctx.canvas.width / size.width, 0, 0, ctx.canvas.height / size.height, 0, 0);
}

function resolveGraphic(track: ImageTrack | TextTrack, frame: number) {
  return { track, image: track instanceof ImageTrack ? track.getFrame(frame) : undefined };
}

type Graphic = ReturnType<typeof resolveGraphic>;

export function getGraphicsFrame(lines: TrackLineItem[], frame: number) {
  return getTimelineLayers(lines, frame, (track, at) => isGraphic(track) && isActiveAt(track, at))
    .filter(isGraphic)
    .map(track => resolveGraphic(toRaw(track), frame));
}

function drawGraphic(ctx: CanvasRenderingContext2D, size: CanvasSize, { track, image }: Graphic) {
  ctx.save();
  try {
    if (track instanceof TextTrack) track.draw(ctx, size);
    else if (image) track.draw(ctx, size, image);
  } finally {
    ctx.restore();
  }
}

export function drawGraphicsFrame(ctx: CanvasRenderingContext2D, size: CanvasSize, graphics: Graphic[]) {
  setScale(ctx, size);
  ctx.clearRect(0, 0, size.width, size.height);
  for (const graphic of graphics) drawGraphic(ctx, size, graphic);
}

/* eslint-disable no-await-in-loop -- draw layers in compositing order */
export async function drawTimelineFrame(
  ctx: CanvasRenderingContext2D,
  lines: TrackLineItem[],
  size: CanvasSize,
  frame: number,
  readVideo: ReadVideoFrame
) {
  setScale(ctx, size);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size.width, size.height);

  for (const layer of getTimelineLayers(lines, frame, (track, at) => isVisual(track) && isActiveAt(track, at))) {
    const track = toRaw(layer);
    if (track instanceof VideoTrack) {
      const image = await readVideo(track, frame);
      if (image) {
        const { x, y, width, height } = getTrackRect(track, size);
        ctx.drawImage(image, x, y, width, height);
      }
    } else if (isGraphic(track)) {
      drawGraphic(ctx, size, resolveGraphic(track, frame));
    }
  }
}
