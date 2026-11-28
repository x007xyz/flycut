import type { TextStyle } from './scene';

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const textPadding = 4;
export const textLineHeight = 1.2;
const radius = 4;
const strokeWidth = 4;

export function fontOf({ fontSize, fontFamily }: Pick<TextStyle, 'fontSize' | 'fontFamily'>) {
  return `${fontSize}px ${fontFamily}`;
}

// 只依赖 measureText，预览与导出排版一致
export function layoutText(ctx: Context, style: TextStyle) {
  ctx.font = fontOf(style);
  const lines = style.content.split('\n');
  const lineHeight = style.fontSize * textLineHeight;
  return {
    lines,
    lineHeight,
    width: Math.max(...lines.map(line => ctx.measureText(line).width)),
    height: lines.length * lineHeight
  };
}

function roundRect(ctx: Context, x: number, y: number, width: number, height: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

export function drawText(ctx: Context, x: number, y: number, style: TextStyle) {
  const { lines, lineHeight, width, height } = layoutText(ctx, style);
  if (style.background) {
    ctx.fillStyle = style.background;
    roundRect(ctx, x - textPadding, y - textPadding, width + textPadding * 2, height + textPadding * 2);
    ctx.fill();
  }
  ctx.textBaseline = 'top';
  const top = y + (height - lines.length * style.fontSize) / 2;
  lines.forEach((line, index) => {
    const lineY = top + index * lineHeight;
    if (style.stroke) {
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = strokeWidth;
      ctx.strokeText(line, x, lineY);
    }
    ctx.fillStyle = style.fill;
    ctx.fillText(line, x, lineY);
  });
}
