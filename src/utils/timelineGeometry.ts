export type CanvasSize = { width: number; height: number };

export const defaultCanvasSize: CanvasSize = { width: 1080, height: 1920 };
export const editorScale = 6;

export function getTrackRect(track: {
  getDrawX(width: number): number; getDrawY(height: number): number; drawWidth: number; drawHeight: number;
}, size: CanvasSize) {
  return { x: track.getDrawX(size.width), y: track.getDrawY(size.height), width: track.drawWidth, height: track.drawHeight };
}

export function fitOutputSize({ width, height }: CanvasSize): CanvasSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return defaultCanvasSize;
  const scale = Math.min(1, 1920 / Math.max(width, height));
  const even = (value: number) => Math.max(2, Math.round(value * scale / 2) * 2);
  return { width: even(width), height: even(height) };
}

export function isActiveAt({ start, end }: { start: number; end: number }, frame: number) {
  return start <= frame && frame < end;
}

export function getPreviewFrame(frame: number, frameCount: number) {
  return Math.max(0, Math.min(frame, Math.ceil(frameCount) - 1));
}

export function animationIndex(frameEnds: number[], time: number) {
  const duration = frameEnds[frameEnds.length - 1];
  if (!duration) return 0;
  const position = time % duration;
  let from = 0;
  let to = frameEnds.length - 1;
  while (from < to) {
    const middle = (from + to) >>> 1;
    if (position < frameEnds[middle]) to = middle;
    else from = middle + 1;
  }
  return from;
}

export function getTimelineLayers<T>(lines: { list: T[] }[], frame: number, isActive: (track: T, frame: number) => boolean): T[] {
  return lines.slice().reverse()
    .flatMap(({ list }) => {
      const track = list.find(item => isActive(item, frame));
      return track ? [track] : [];
    });
}
