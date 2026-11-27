import { uniqueId } from 'lodash-es';
import type { BaseTractItem, TrackType } from './Base';
import { videoDecoder } from '@/utils/webcodecs';
import { baseFps } from '@/data/trackConfig';

export interface VideoSource {
  id: string,
  url: string,
  name: string,
  format: string,
  duration: number,
  width: number,
  height: number
}

export class VideoTrack implements BaseTractItem {
  id: string;
  type: TrackType = 'video';
  source: VideoSource;
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
  offsetL: number;
  offsetR: number;
  get drawHeight() {
    return this.height * this.scale / 100;
  }
  get drawWidth() {
    return this.width * this.scale / 100;
  }
  constructor(source: VideoSource, curFrame: number) {
    // 设置ID
    this.id = uniqueId();
    // 设置视频信息
    this.source = source;
    // 获取文件名称
    this.name = source.name;
    // 获取文件类型
    this.format = source.format;
    // 设置轨道信息
    this.frameCount = Math.max(1, Math.round(source.duration * baseFps));
    this.start = curFrame;
    this.end = this.start + this.frameCount;

    // 设置绘制信息
    this.centerX = 0;
    this.centerY = 0;
    this.scale = 100;
    this.height = source.height;
    this.width = source.width;

    // 设置裁剪信息
    this.offsetL = 0;
    this.offsetR = 0;
  }
  getDrawX(width: number) {
    return width / 2 - this.drawWidth / 2 + this.centerX;
  }
  getDrawY(height: number) {
    return height / 2 - this.drawHeight / 2 + this.centerY;
  }
  // 片段内某一帧对应的素材时间，单位为秒
  sourceTime(frameIndex: number) {
    return Math.max(frameIndex - this.start + this.offsetL, 0) / baseFps;
  }
  draw(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, { width, height }: { width: number, height: number }, frameIndex: number) {
    return videoDecoder.getFrame(this.source.id, this.sourceTime(frameIndex)).then(sample => {
      if (!sample) return;
      try {
        sample.draw(ctx, this.getDrawX(width), this.getDrawY(height), this.drawWidth, this.drawHeight);
      } finally {
        sample.close();
      }
    });
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
  audio: HTMLAudioElement | null = null;
  play(currentFrame: number) {
    if (!this.audio) {
      this.audio = new Audio(this.source.url);
    }
    if (this.audio?.paused) {
      this.audio.currentTime = (currentFrame - this.start + this.offsetL) / baseFps;
      console.log('🚀 ~ VideoTrack ~ play ~ this.audio.currentTime:', this.audio.currentTime);
      this.audio.play();
    }
  }
  pause() {
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
  }
  split(cutFrame: number) {
    const copy = new VideoTrack(this.source, cutFrame);
    copy.end = this.end;
    copy.offsetL = this.offsetL + cutFrame - this.start;
    copy.offsetR = this.offsetR;

    this.offsetR += this.end - cutFrame;
    this.end = cutFrame;
    return copy;
  }
}