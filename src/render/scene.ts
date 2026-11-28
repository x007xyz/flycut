import type { AudioTrack } from '@/class/AudioTrack';
import { ImageTrack } from '@/class/ImageTrack';
import { TextTrack } from '@/class/TextTrack';
import { VideoTrack } from '@/class/VideoTrack';
import { baseFps } from '@/data/trackConfig';
import { motionAt, type Motion } from './animation';

export type Track = AudioTrack | ImageTrack | TextTrack | VideoTrack;
export type Size = { width: number, height: number };
export type Rect = { x: number, y: number, width: number, height: number };

export interface TextStyle {
  content: string,
  fontSize: number,
  fontFamily: string,
  fill: string,
  stroke?: string,
  background?: string
}

// motion 为动画叠加在基础位置上的变换：x、y 为像素偏移，围绕图层中心缩放和旋转
export type Layer = (
  | { kind: 'video', clipId: string, sourceId: string, time: number, rect: Rect }
  | { kind: 'image', clipId: string, sourceId: string, format: string, time: number, rect: Rect }
  | { kind: 'text', clipId: string, x: number, y: number, style: TextStyle }
) & { motion?: Omit<Motion, 'reveal'> };

// 一帧画面的纯数据描述：坐标为播放器尺寸下的逻辑像素，图层自下而上排列
export interface Scene {
  width: number,
  height: number,
  background: string,
  layers: Layer[]
}

function rectOf(track: ImageTrack | VideoTrack, { width, height }: Size): Rect {
  return { x: track.getDrawX(width), y: track.getDrawY(height), width: track.drawWidth, height: track.drawHeight };
}

function withMotion(layer: Layer, track: Exclude<Track, AudioTrack>, frame: number, size: Size): Layer {
  const motion = motionAt(track.animations, (frame - track.start) / baseFps, (track.end - track.start) / baseFps);
  if (!motion) return layer;
  const { reveal, ...rest } = motion;
  if (layer.kind === 'text' && reveal < 1) {
    const chars = Array.from(layer.style.content);
    layer.style.content = chars.slice(0, Math.round(chars.length * reveal)).join('');
  }
  layer.motion = { ...rest, x: rest.x * size.width, y: rest.y * size.height };
  return layer;
}

function layerOf(track: Exclude<Track, AudioTrack>, frame: number, size: Size): Layer {
  if (track instanceof VideoTrack) {
    return { kind: 'video', clipId: track.id, sourceId: track.source.id, time: track.sourceTime(frame), rect: rectOf(track, size) };
  }
  if (track instanceof ImageTrack) {
    const time = Math.max(frame - track.start, 0) / baseFps;
    return { kind: 'image', clipId: track.id, sourceId: track.source.id, format: track.source.format, time, rect: rectOf(track, size) };
  }
  return {
    kind: 'text',
    clipId: track.id,
    x: track.getDrawX(size.width),
    y: track.getDrawY(size.height),
    style: {
      content: track.content,
      fontSize: track.fontSize * track.scale / 100,
      fontFamily: track.fontFamily,
      fill: track.fill,
      stroke: track.stroke,
      background: track.textBackgroundColor
    }
  };
}

/**
 * tracks 按时间轴顺序传入，越靠前的轨道层级越高。
 * includeEnd 用于预览：播放头停在片段结束帧时仍显示最后一帧。
 */
export function buildScene(tracks: Track[], frame: number, size: Size, { includeEnd = false } = {}): Scene {
  const layers: Layer[] = [];
  for (const track of tracks) {
    const active = frame >= track.start && (frame < track.end || (includeEnd && frame === track.end));
    if (active && track.type !== 'audio') {
      const visual = track as Exclude<Track, AudioTrack>;
      layers.unshift(withMotion(layerOf(visual, frame, size), visual, frame, size));
    }
  }
  return { ...size, background: 'black', layers };
}

// 相同 key 的场景绘制结果相同，可跳过重绘
export function frameKey(scene: Scene) {
  return JSON.stringify(scene);
}
