export type CanvasSize = { width: number; height: number };

export const defaultCanvasSize: CanvasSize = { width: 1080, height: 1920 };
export const editorScale = 6;

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

export function getTimelineLayers<T>(lines: { list: T[] }[], frame: number, isActive: (track: T, frame: number) => boolean): T[] {
  return lines.slice().reverse()
    .flatMap(({ list }) => {
      const track = list.find(item => isActive(item, frame));
      return track ? [track] : [];
    });
}
