import { uniqueId } from 'lodash-es';
import type { BaseTractItem, TrackType } from './Base';
import { baseFps } from '@/data/trackConfig';

export interface AudioSource {
  id: string,
  file: File,
  url: string,
  name: string,
  format: string,
  duration: number
}

export class AudioTrack implements BaseTractItem {
  id: string;
  type: TrackType = 'audio';
  source: AudioSource;
  name: string;
  format: string;
  frameCount: number;
  start: number;
  end: number;
  offsetL: number;
  offsetR: number;
  silent = false;
  constructor(source: AudioSource, curFrame: number) {
    // 设置ID
    this.id = uniqueId();
    // 设置音频信息
    this.source = source;
    // 获取文件名称
    this.name = source.name;
    // 获取文件类型
    this.format = source.format;

    // 获取音频时长，转换为frameCount
    this.frameCount = Math.max(1, Math.round(source.duration * baseFps));
    this.start = curFrame;
    this.end = this.start + this.frameCount;

    // 设置裁剪信息
    this.offsetL = 0;
    this.offsetR = 0;
  }
  audio: HTMLAudioElement | null = null;
  play(currentFrame: number) {
    if (!this.audio) {
      this.audio = new Audio(this.source.url);
    }
    this.audio.muted = this.silent;
    if (this.audio.paused) {
      this.audio.currentTime = (currentFrame - this.start + this.offsetL) / baseFps;
      this.audio.play().catch(() => {});
    }
  }
  pause() {
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
  }
}