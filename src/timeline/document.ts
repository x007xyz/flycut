import type { TimelineClip, TimelineDocument } from '@flycut/timeline-kit/core';
import type { Track, TrackLineItem } from '@/class/Track';
import { baseFps } from '@/data/trackConfig';

const frameMs = (frame: number) => Math.round(frame * 1000 / baseFps);
const msFrame = (ms: number) => Math.round(ms * baseFps / 1000);

function trimmable(track: Track): track is Extract<Track, { offsetL: number }> {
  return 'offsetL' in track && 'offsetR' in track;
}

function clipOf(track: Track): TimelineClip {
  const clip: TimelineClip = { id: track.id, type: track.type, name: track.name, startMs: frameMs(track.start), endMs: frameMs(track.end) };
  if (trimmable(track)) {
    clip.durationMs = frameMs(track.frameCount);
    clip.trim = { startMs: frameMs(track.offsetL), endMs: frameMs(track.frameCount - track.offsetR) };
  }
  if ('source' in track && 'id' in track.source) clip.resource = track.source.id;
  return clip;
}

// flycut 的轨道行（Pinia）是唯一数据源，时间轴文档由它派生
export function toDocument(lines: TrackLineItem[]): TimelineDocument {
  return {
    id: 'flycut',
    name: 'flycut',
    fps: baseFps,
    tracks: lines.map((line, index) => ({
      id: line.list.reduce((key, track) => `${key}-${track.id}`, `line${index}`),
      type: line.type,
      name: line.type,
      main: line.main,
      clips: line.list.map(clipOf)
    }))
  };
}

// 把时间轴上的移动/裁剪/换行结果写回 Track 实例
export function applyDocument(lines: TrackLineItem[], document: TimelineDocument) {
  const tracks = new Map(lines.flatMap(line => line.list).map(track => [track.id, track]));
  const next: TrackLineItem[] = document.tracks.map(({ type, main, clips }) => ({
    type: type as Track['type'],
    ...(main ? { main } : {}),
    list: clips.flatMap(clip => {
      const track = tracks.get(clip.id);
      if (!track) return [];
      const length = track.end - track.start;
      const moved = Math.abs(clip.endMs - clip.startMs - frameMs(length)) < 1;
      track.start = msFrame(clip.startMs);
      track.end = moved ? track.start + length : Math.max(track.start + 1, msFrame(clip.endMs));
      if (trimmable(track) && clip.trim) {
        track.offsetL = msFrame(clip.trim.startMs);
        track.offsetR = Math.max(0, track.frameCount - track.offsetL - (track.end - track.start));
      }
      return [track];
    })
  })).filter(line => line.list.length || line.main);
  lines.splice(0, lines.length, ...next);
}
