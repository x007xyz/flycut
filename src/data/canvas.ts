// 画布比例对应的导出分辨率；预览画布按 1/outputScale 缩小
export const canvasRatios = {
  '9:16': { width: 1080, height: 1920, label: '9:16 竖屏' },
  '16:9': { width: 1920, height: 1080, label: '16:9 横屏' },
  '1:1': { width: 1080, height: 1080, label: '1:1 方形' },
  '3:4': { width: 1080, height: 1440, label: '3:4 竖屏' },
  '4:3': { width: 1440, height: 1080, label: '4:3 横屏' }
} as const;

export type CanvasRatio = keyof typeof canvasRatios;

export const defaultCanvasRatio: CanvasRatio = '9:16';

export const outputScale = 6;

export function isCanvasRatio(value: unknown): value is CanvasRatio {
  return typeof value === 'string' && Object.hasOwn(canvasRatios, value);
}

export function outputSize({ width, height }: { width: number, height: number }) {
  return { width: Math.round(width * outputScale), height: Math.round(height * outputScale) };
}
