import { uniqueId } from 'lodash-es';
import { defaultAnimations, type ClipAnimations } from '@/render/animation';
import type { BaseTractItem, TrackType } from './Base';
import { getTextRect } from '@/utils/common';
import { drawText } from '@/render/text';

export interface TextSource {
  content: string,
  fill: string,
  stroke?: string,
  fontSize: number,
  fontFamily: string,
  textBackgroundColor?: string
  name: string
}

export class TextTrack implements BaseTractItem {
  source: TextSource;
  animations: ClipAnimations = defaultAnimations();
  // 文本内容
  fill: string;
  stroke?: string;
  textBackgroundColor?: string;
  // 影响文本绘制的属性都使用getter/setter，在设置时，需要重新计算文本宽高
  private _fontSize = 24;
  get fontSize() {
    return this._fontSize;
  }
  set fontSize(value: number) {
    this._fontSize = value;
    // 绘制文本时，需要重新计算文本宽高
    this.calcSize();
  }
  private _fontFamily = 'Arial';
  get fontFamily() {
    return this._fontFamily;
  }
  set fontFamily(value: string) {
    this._fontFamily = value;
    // 绘制文本时，需要重新计算文本宽高
    this.calcSize();
  }
  private _content = '';
  get content() {
    return this._content;
  }
  set content(value: string) {
    this._content = value;
    // 绘制文本时，需要重新计算文本宽高
    this.calcSize();
  }
  constructor(source: TextSource, curFrame: number) {
    // 设置ID
    this.id = uniqueId();

    this.source = source;
    // 设置文字信息
    this._content = source.content;
    this.fill = source.fill;
    this.stroke = source.stroke;
    this.textBackgroundColor = source.textBackgroundColor;
    this._fontSize = source.fontSize;
    this._fontFamily = source.fontFamily;
    this.name = source.name;
    // 对于文本意义不大
    this.format = 'text';
    // 设置轨道信息
    this.frameCount = 30 * 60;
    this.start = curFrame;
    this.end = this.start + this.frameCount;
    // 设置绘制信息
    this.centerX = 0;
    this.centerY = 0;
    this.scale = 100;

    this.calcSize();
  }
  calcSize() {
    const { width, height } = getTextRect({ text: this._content, fontSize: this._fontSize, fontFamily: this._fontFamily });
    // 计算文本宽高
    this.height = height;
    this.width = width;
  }
  get drawWidth() {
    return this.width * this.scale / 100;
  }
  get drawHeight() {
    return this.height * this.scale / 100;
  }
  type: TrackType = 'text';
  centerX = 0;
  centerY = 0;
  scale = 100;
  width = 0;
  height = 0;
  getDrawX(width: number) {
    return width / 2 - this.drawWidth / 2 + this.centerX;
  }
  getDrawY(height: number) {
    return height / 2 - this.drawHeight / 2 + this.centerY;
  }
  // 渲染方法保持一致
  draw(ctx: OffscreenCanvasRenderingContext2D, { width, height }: { width: number, height: number }, _frameIndex?: number) {
    drawText(ctx, this.getDrawX(width), this.getDrawY(height), {
      content: this.content,
      fontSize: this.fontSize * this.scale / 100,
      fontFamily: this.fontFamily,
      fill: this.fill,
      stroke: this.stroke,
      background: this.textBackgroundColor
    });
    return Promise.resolve();
  }
  id: string;
  name: string;
  frameCount: number;
  start: number;
  end: number;
  format: string;
}