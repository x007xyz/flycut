import { toRaw } from 'vue';
import { ElLoading } from 'element-plus';
import tools from './tools.json';
import { baseFps } from '@/data/trackConfig';
import { TextTrack } from '@/class/TextTrack';
import type { Track } from '@/class/Track';
import { usePlayerState } from '@/stores/playerState';
import { useProjectState } from '@/stores/projectState';
import { useResourceState } from '@/stores/resourceStore';
import { useTrackState } from '@/stores/trackState';
import { importMedia, insertAsset } from '@/utils/importMedia';
import { isExportSupported, renderTimeline } from '@/utils/renderTimeline';
import { saveRenderedVideo } from '@/utils/videoExport';

/**
 * 编辑命令层：界面之外的调用方（本地 MCP 服务、WebMCP）都通过这里修改工程。
 * 命令只调用 store 已有的方法或修改片段属性，撤销/重做和自动保存照常生效。
 */

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  exclusiveMinimum?: number;
  description?: string;
}

export interface CommandTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export const commandTools = tools as CommandTool[];

type Args = Record<string, unknown>;

let markReady: () => void;
const ready = new Promise<void>(resolve => {
  markReady = resolve;
});

/** 工程恢复完成后才执行命令，避免被恢复的草稿覆盖 */
export function markEditorReady() {
  markReady();
}

function check(schema: JsonSchema, value: unknown, at: string): string | null {
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${at} must be an object`;
    const record = value as Args;
    const missing = schema.required?.find(key => record[key] === undefined);
    if (missing) return `${at}.${missing} is required`;
    for (const [key, item] of Object.entries(record)) {
      const child = schema.properties?.[key];
      if (!child) {
        if (schema.additionalProperties === false) return `${at}.${key} is not allowed`;
      } else if (item !== undefined) {
        const error = check(child, item, `${at}.${key}`);
        if (error) return error;
      }
    }
    return null;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${at} must be an array`;
    if (value.length < (schema.minItems ?? 0)) return `${at} needs at least ${schema.minItems} items`;
    const errors = schema.items ? value.map((item, index) => check(schema.items as JsonSchema, item, `${at}[${index}]`)) : [];
    return errors.find(Boolean) ?? null;
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${at} must be a number`;
    if (schema.minimum !== undefined && value < schema.minimum) return `${at} must be >= ${schema.minimum}`;
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return `${at} must be > ${schema.exclusiveMinimum}`;
    return null;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return `${at} must be a string`;
    return value.length < (schema.minLength ?? 0) ? `${at} must not be empty` : null;
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') return `${at} must be a boolean`;
  return null;
}

const seconds = (frames: number) => Math.round(frames / baseFps * 1000) / 1000;
const frames = (time: number) => Math.round(time * baseFps);

function describeClip(track: Track, line: number) {
  const clip: Record<string, unknown> = {
    id: track.id, type: track.type, line, name: track.name, start: seconds(track.start), end: seconds(track.end)
  };
  if ('source' in track && 'id' in track.source) clip.assetId = track.source.id;
  if (track.type === 'video' || track.type === 'audio') {
    Object.assign(clip, { trimStart: seconds(track.offsetL), trimEnd: seconds(track.offsetR), muted: Boolean(track.silent) });
  }
  if (track.type !== 'audio') Object.assign(clip, { x: track.centerX, y: track.centerY, scale: track.scale });
  if (track instanceof TextTrack) {
    Object.assign(clip, { content: track.content, fontSize: track.fontSize, fill: track.fill, stroke: track.stroke ?? null });
  }
  return clip;
}

function findClip(id: unknown) {
  const { trackList } = useTrackState();
  for (let line = 0; line < trackList.length; line++) {
    const index = trackList[line].list.findIndex(track => track.id === id);
    if (index !== -1) return { track: trackList[line].list[index], line, index };
  }
  throw new Error(`Clip ${String(id)} not found`);
}

function describeById(id: string) {
  const { track, line } = findClip(id);
  return describeClip(track, line);
}

/** 移动片段后检查同一轨道不重叠，并按开始时间排序 */
function placeOnLine(track: Track, line: number) {
  const { trackList } = useTrackState();
  const { list } = trackList[line];
  const overlap = list.find(other => other !== track && other.start < track.end && track.start < other.end);
  if (overlap) throw new Error(`Clip would overlap clip ${overlap.id} on the same track`);
  list.sort((a, b) => a.start - b.start);
}

function base64ToBlob(data: string, type: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/* eslint-disable camelcase -- 命令名与 MCP 工具名一致 */
const handlers: Record<string, (args: Args) => unknown> = {
  get_timeline() {
    const timeline = useTrackState();
    const player = usePlayerState();
    return {
      project: useProjectState().current?.name ?? null,
      fps: baseFps,
      canvas: { width: player.playerWidth, height: player.playerHeight },
      duration: seconds(timeline.frameCount),
      playhead: seconds(player.playStartFrame),
      clips: timeline.trackList.flatMap(({ list }, line) => list.map(track => describeClip(track, line)))
    };
  },
  list_assets() {
    return useResourceState().assets.map(({ id, kind, name, format, duration, width, height, size }) => ({
      id, kind, name, format, duration, width, height, size
    }));
  },
  async import_asset({ url, data, name, mimeType }) {
    let blob: Blob;
    if (typeof url === 'string') {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
      blob = await response.blob();
    } else if (typeof data === 'string') blob = base64ToBlob(data, String(mimeType ?? ''));
    else throw new Error('Either url or data is required');
    const fileName = typeof name === 'string' && name ? name : (typeof url === 'string' && new URL(url, location.href).pathname.split('/').pop()) || 'media';
    const file = new File([blob], fileName, { type: typeof mimeType === 'string' && mimeType ? mimeType : blob.type });
    const [record] = await importMedia([file]);
    if (!record) throw new Error('Unsupported or unreadable media file');
    return record;
  },
  async add_clip({ assetId, start }) {
    const record = useResourceState().assets.find(({ id }) => id === assetId);
    if (!record) throw new Error(`Asset ${String(assetId)} not found, call list_assets first`);
    const track = await insertAsset(record, typeof start === 'number' ? frames(start) : undefined);
    return describeById(track.id);
  },
  add_text({ content, start, duration, fontSize, fill, stroke, x, y }) {
    const track = new TextTrack({
      content: String(content),
      fontSize: typeof fontSize === 'number' ? fontSize : 24,
      fontFamily: 'Arial',
      name: '文本',
      fill: typeof fill === 'string' ? fill : '#FFFFFF',
      stroke: typeof stroke === 'string' ? stroke : undefined
    }, typeof start === 'number' ? frames(start) : usePlayerState().playStartFrame);
    if (typeof duration === 'number') {
      track.frameCount = Math.max(1, frames(duration));
      track.end = track.start + track.frameCount;
    }
    if (typeof x === 'number') track.centerX = x;
    if (typeof y === 'number') track.centerY = y;
    useTrackState().addTrack(track);
    return describeById(track.id);
  },
  update_clip({ clipId, start, duration, x, y, scale, muted, content, fontSize, fill, stroke }) {
    const { track, line } = findClip(clipId);
    // 先提交上一步的修改，每个命令单独一条撤销记录
    useTrackState().flushHistory();
    const isText = track instanceof TextTrack;
    if ((content ?? fontSize ?? fill ?? stroke) !== undefined && !isText) throw new Error('content, fontSize, fill and stroke apply to text clips');
    if (muted !== undefined && track.type !== 'video' && track.type !== 'audio') throw new Error('muted applies to video and audio clips');
    if (duration !== undefined && track.type !== 'text' && track.type !== 'image') throw new Error('duration applies to text and image clips; use trim_clip for video and audio');
    if ((x ?? y ?? scale) !== undefined && track.type === 'audio') throw new Error('Audio clips have no position');
    const previous = { start: track.start, end: track.end, frameCount: track.frameCount };
    if (typeof start === 'number') {
      const length = track.end - track.start;
      track.start = frames(start);
      track.end = track.start + length;
    }
    if (typeof duration === 'number') {
      track.frameCount = Math.max(1, frames(duration));
      track.end = track.start + track.frameCount;
    }
    try {
      placeOnLine(track, line);
    } catch (error) {
      Object.assign(track, previous);
      throw error;
    }
    if (track.type !== 'audio') {
      if (typeof x === 'number') track.centerX = x;
      if (typeof y === 'number') track.centerY = y;
      if (typeof scale === 'number') track.scale = scale;
    }
    if (typeof muted === 'boolean' && (track.type === 'video' || track.type === 'audio')) track.silent = muted;
    if (isText) {
      if (typeof content === 'string') track.content = content;
      if (typeof fontSize === 'number') track.fontSize = fontSize;
      if (typeof fill === 'string') track.fill = fill;
      if (typeof stroke === 'string') track.stroke = stroke;
    }
    return describeById(track.id);
  },
  trim_clip({ clipId, trimStart, trimEnd }) {
    const { track } = findClip(clipId);
    if (track.type !== 'video' && track.type !== 'audio') throw new Error('Only video and audio clips can be trimmed');
    const left = typeof trimStart === 'number' ? frames(trimStart) : track.offsetL;
    const right = typeof trimEnd === 'number' ? frames(trimEnd) : track.offsetR;
    if (left + right >= track.frameCount) throw new Error(`Trim leaves nothing of the ${seconds(track.frameCount)}s source`);
    useTrackState().flushHistory();
    const previous = { offsetL: track.offsetL, offsetR: track.offsetR, end: track.end };
    Object.assign(track, { offsetL: left, offsetR: right, end: track.start + track.frameCount - left - right });
    try {
      placeOnLine(track, findClip(clipId).line);
    } catch (error) {
      Object.assign(track, previous);
      throw error;
    }
    return describeById(track.id);
  },
  split_clip({ clipId, time }) {
    const timeline = useTrackState();
    const player = usePlayerState();
    const { track } = findClip(clipId);
    const frame = frames(Number(time));
    if (track.type !== 'video') throw new Error('Only video clips can be split');
    if (frame <= track.start || frame >= track.end) throw new Error('time must be inside the clip');
    timeline.selectTrackById(track.id);
    const before = new Set(timeline.trackList.flatMap(({ list }) => list.map(({ id }) => id)));
    timeline.splitSelected(frame, { width: player.playerWidth, height: player.playerHeight });
    const tail = timeline.trackList.flatMap(({ list }) => list).find(({ id }) => !before.has(id));
    if (!tail) throw new Error('Split failed');
    return [describeById(track.id), describeById(tail.id)];
  },
  delete_clips({ clipIds }) {
    const ids = clipIds as string[];
    ids.forEach(id => findClip(id));
    useTrackState().removeTracks(ids);
    return { deleted: ids };
  },
  set_playhead({ time }) {
    const timeline = useTrackState();
    const player = usePlayerState();
    player.playStartFrame = Math.min(frames(Number(time)), timeline.frameCount);
    return { playhead: seconds(player.playStartFrame) };
  },
  undo() {
    useTrackState().undo();
    return handlers.get_timeline({});
  },
  redo() {
    useTrackState().redo();
    return handlers.get_timeline({});
  },
  async export_video({ fileName }) {
    const timeline = useTrackState();
    const player = usePlayerState();
    if (!timeline.frameCount) throw new Error('The timeline is empty');
    if (!await isExportSupported()) throw new Error('This browser cannot encode H.264/Opus MP4');
    const tracks = toRaw(timeline.trackList).flatMap(({ list }) => list.map(track => toRaw(track) as Track));
    const name = typeof fileName === 'string' && fileName ? fileName : `${useProjectState().current?.name ?? 'flycut'}.mp4`;
    const chunks: Blob[] = [];
    let size = 0;
    // 与界面导出一样遮住编辑器，合成期间片段不能被修改
    const loading = ElLoading.service({ text: '正在合成视频' });
    // 没有用户手势时无法弹出保存对话框，合成后直接下载
    try {
      await saveRenderedVideo(target => renderTimeline(tracks, { width: player.playerWidth, height: player.playerHeight }, target), async() => new WritableStream<Uint8Array>({
        write(chunk) {
          chunks.push(new Blob([chunk]));
          size += chunk.byteLength;
        }
      }));
    } finally {
      loading.close();
    }
    const url = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name.endsWith('.mp4') ? name : `${name}.mp4`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60e3);
    return { fileName: link.download, size, duration: seconds(timeline.frameCount) };
  }
};
/* eslint-enable camelcase */

let queue: Promise<unknown> = Promise.resolve();

/** 校验参数后依次执行命令，返回可 JSON 序列化的结果 */
export function runCommand(name: string, args: Args = {}) {
  const tool = commandTools.find(item => item.name === name);
  if (!tool) return Promise.reject(new Error(`Unknown command: ${name}`));
  const error = check(tool.inputSchema, args, 'arguments');
  if (error) return Promise.reject(new Error(error));
  const run = queue.then(() => ready).then(() => handlers[name](args));
  queue = run.catch(() => {});
  return run;
}
