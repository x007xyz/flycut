import { uniqueId } from 'lodash-es';
import type { BaseTractItem, TrackType } from './Base';
import { imageDecoder } from '@/utils/webcodecs';
import { baseFps } from '@/data/trackConfig';
import { getTrackRect } from '@/utils/timelineGeometry';
import type { CanvasSize } from '@/utils/timelineGeometry';

export interface ImageSource {
  id: string,
  url: string,
  name: string,
  format: string,
  width: number,
  height: number
}
/**
 * 解析文件不能放在片段中：
 * 1. 文件解析是一个耗时操作，需要提前解析好，然后传递给片段
 * 2. 文件可能是网络资源，也可能是本地资源，在片段对象中要收束
 * 3. 不同片段可能共享同一个文件，解析一次即可
 * 4. 片段信息需要转换为文本进行存储（草稿）
 */
export class ImageTrack implements BaseTractItem {
  id: string;
  type: TrackType = 'image';
  source: ImageSource;
  name: string;
  format: string;
  frameCount: number;
  start: number;
  end: any;
  centerX: number;
  centerY: number;
  scale: number;
  height: number;
  width: number;
  get drawHeight() {
    return this.height * this.scale / 100;
  }
  get drawWidth() {
    return this.width * this.scale / 100;
  }
  constructor(source: ImageSource, curFrame: number) {
    // 设置ID
    this.id = uniqueId();
    // 设置图片信息
    this.source = source;
    // 获取文件名称
    this.name = source.name;
    // 获取文件类型
    this.format = source.format;
    // 设置轨道信息
    this.frameCount = 30 * 60;
    this.start = curFrame;
    this.end = this.start + this.frameCount;

    // 设置绘制信息
    this.centerX = 0;
    this.centerY = 0;
    this.scale = 100;
    this.height = source.height;
    this.width = source.width;
  }
  getDrawX(width: number) {
    return width / 2 - this.drawWidth / 2 + this.centerX;
  }
  getDrawY(height: number) {
    return height / 2 - this.drawHeight / 2 + this.centerY;
  }
  getFrame(frame: number) {
    return imageDecoder.getFrame(this.source.id, Math.round(Math.max(frame - this.start, 0) * 1e6 / baseFps));
  }
  draw(ctx: CanvasRenderingContext2D, size: CanvasSize, frame: NonNullable<ReturnType<typeof imageDecoder.getFrame>>) {
    const { x, y, width, height } = getTrackRect(this, size);
    ctx.drawImage(frame, x, y, width, height);
  }
  resize({ width, height }: { width: number, height: number }) {
    // 视频、图片元素，在添加到画布中时，需要缩放为合适的尺寸，目标是能在画布中完整显示内容
    let scale = 1;
    if (this.source.width > width) {
      scale = width / this.source.width;
    }
    if (this.source.height > height) {
      scale = Math.min(scale, height / this.source.height);
    }
    this.width = this.source.width * scale;
    this.height = this.source.height * scale;
  }
}