import { AudioTrack, type AudioSource } from '@/class/AudioTrack';
import { activeAnimations, packAnimations, unpackAnimations, validAnimations, withDefaults, type ClipAnimations } from '@/render/animation';
import { ImageTrack, type ImageSource } from '@/class/ImageTrack';
import { TextTrack, type TextSource } from '@/class/TextTrack';
import { VideoTrack, type VideoSource } from '@/class/VideoTrack';
import type { Track, TrackLineItem } from '@/class/Track';
import { audioDecoder, imageDecoder, videoDecoder } from '@/utils/webcodecs';
import { assetStore, assetUrl, type AssetRecord } from '@/storage/assets';
import { useResourceState } from '@/stores/resourceStore';
import { baseFps } from '@/data/trackConfig';

export const draftKey = 'flycut.editorDraft';

type Timing = { start: number; end: number; frameCount: number };
type Placement = { centerX: number; centerY: number; scale: number };
type Size = { width: number; height: number };
type Animations = { animations?: Partial<ClipAnimations> };
type Trim = { offsetL: number; offsetR: number; silent?: boolean };
type MediaSource = AudioSource | ImageSource | VideoSource;

type DraftTrack = Timing & (
    { type: 'audio'; source: Omit<AudioSource, 'url'>; trim: Trim }
  | ({ type: 'video'; source: Omit<VideoSource, 'url'>; trim: Trim; placement: Placement & Size } & Animations)
  | ({ type: 'image'; source: Omit<ImageSource, 'url'>; placement: Placement & Size } & Animations)
  | ({ type: 'text'; source: TextSource; placement: Placement } & Animations)
);

interface Draft {
  version: 1;
  trackScale: number;
  playhead: number;
  lines: { type: DraftTrack['type']; main?: boolean; tracks: DraftTrack[] }[];
}

function mediaReference<T extends MediaSource>({ url, ...source }: T) {
  return source;
}

function placementOf({ centerX, centerY, scale }: Placement): Placement {
  return { centerX, centerY, scale };
}

function geometryOf(placement: Placement & Size): Placement & Size {
  return { ...placementOf(placement), width: placement.width, height: placement.height };
}

function captureBase(track: Track): DraftTrack {
  const { start, end, frameCount } = track;
  const timing = { start, end, frameCount };
  if (track instanceof AudioTrack || track instanceof VideoTrack) {
    const { offsetL, offsetR, silent } = track as typeof track & { silent?: boolean };
    const trim = { offsetL, offsetR, silent };
    if (track instanceof AudioTrack) {
      return { ...timing, type: 'audio', source: mediaReference(track.source), trim };
    }
    return { ...timing, type: 'video', source: mediaReference(track.source), trim, placement: geometryOf(track) };
  }
  if (track instanceof ImageTrack) {
    return { ...timing, type: 'image', source: mediaReference(track.source), placement: geometryOf(track) };
  }
  const { name, content, fontSize, fontFamily, fill, stroke, textBackgroundColor } = track;
  return {
    ...timing, type: 'text', source: { name, content, fontSize, fontFamily, fill, stroke, textBackgroundColor },
    placement: placementOf(track)
  };
}

function captureTrack(track: Track): DraftTrack {
  const captured = captureBase(track);
  if (track instanceof AudioTrack) return captured;
  const animations = activeAnimations(track.animations);
  return animations ? { ...captured, animations } as DraftTrack : captured;
}

export function captureTimeline(lines: TrackLineItem[]): Draft['lines'] {
  return lines.map(({ type, main, list }) => ({ type: type as DraftTrack['type'], main, tracks: list.map(captureTrack) }));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numbers(value: unknown, ...keys: string[]) {
  return record(value) && keys.every(key => Number.isFinite(value[key]));
}

type Style = Pick<TextSource, 'fontSize' | 'fontFamily' | 'fill' | 'stroke' | 'textBackgroundColor'>;
interface PackedAsset { id: string; n: string; f: string; d?: number; w?: number; h?: number }
interface PackedClip {
  // 素材序号（媒体片段）或文字内容与样式序号（文字片段）
  a?: number; t?: string; n?: string; st?: number;
  s: number; e: number; fc?: number;
  l?: number; r?: number; m?: 1;
  x?: number; y?: number; z?: number; w?: number; h?: number;
  // 动画：{ i: 入场, o: 出场, l: 循环 }，见 packAnimations
  an?: ReturnType<typeof packAnimations>;
}
/**
 * v2 工程格式：素材和文字样式各存一份，片段只存序号；默认值（居中、100% 缩放、无裁剪、未静音、
 * 由素材时长推出的帧数）不写入，坐标保留两位小数。
 */
interface PackedDraft {
  v: 2;
  scale: number;
  at: number;
  assets: PackedAsset[];
  styles: Style[];
  lines: { t: DraftTrack['type']; m?: 1; c: PackedClip[] }[];
}

const round = (value: number) => Math.round(value * 100) / 100;

function defaultFrameCount(item: DraftTrack) {
  if (item.type === 'video') return Math.max(1, Math.round(item.source.duration * baseFps));
  if (item.type === 'audio') return item.source.duration * baseFps;
  return baseFps * 60;
}

function compact<T extends object>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function pack({ trackScale, playhead, lines }: Omit<Draft, 'version'>): PackedDraft {
  const assets: PackedAsset[] = [];
  const styles: Style[] = [];
  const indexes = new Map<string, number>();
  function indexOf<T>(list: T[], value: T, prefix: string) {
    const key = prefix + JSON.stringify(value);
    let index = indexes.get(key);
    if (index === undefined) {
      index = list.push(value) - 1;
      indexes.set(key, index);
    }
    return index;
  }

  function packTrack(item: DraftTrack): PackedClip {
    const clip: PackedClip = { s: item.start, e: item.end };
    if (item.frameCount !== defaultFrameCount(item)) clip.fc = item.frameCount;
    if (item.type === 'text') {
      const { name, content, fontSize, fontFamily, fill, stroke, textBackgroundColor } = item.source;
      clip.t = content;
      if (name !== content) clip.n = name;
      clip.st = indexOf(styles, compact({ fontSize, fontFamily, fill, stroke, textBackgroundColor }), 's');
    } else {
      const { id, name, format } = item.source;
      const source = item.source as Partial<VideoSource>;
      clip.a = indexOf(assets, compact({ id, n: name, f: format, d: source.duration, w: source.width, h: source.height }), 'a');
    }
    if ('trim' in item) {
      if (item.trim.offsetL) clip.l = item.trim.offsetL;
      if (item.trim.offsetR) clip.r = item.trim.offsetR;
      if (item.trim.silent) clip.m = 1;
    }
    if ('placement' in item) {
      const placement = item.placement as Placement & Partial<Size>;
      if (placement.centerX) clip.x = round(placement.centerX);
      if (placement.centerY) clip.y = round(placement.centerY);
      if (placement.scale !== 100) clip.z = round(placement.scale);
      if (placement.width !== undefined && placement.height !== undefined) {
        clip.w = round(placement.width);
        clip.h = round(placement.height);
      }
    }
    const animations = 'animations' in item ? packAnimations(item.animations) : undefined;
    if (animations) clip.an = animations;
    return clip;
  }

  return {
    v: 2,
    scale: trackScale,
    at: playhead,
    assets,
    styles,
    lines: lines.map(({ type, main, tracks }) => ({ t: type, ...(main ? { m: 1 as const } : {}), c: tracks.map(packTrack) }))
  };
}

function unpack(packed: Record<string, unknown>): Draft {
  const { assets, styles, lines } = packed;
  if (!numbers(packed, 'scale', 'at') || !Array.isArray(assets) || !Array.isArray(styles) || !Array.isArray(lines)) {
    throw new Error('Invalid FlyCut project');
  }
  function unpackClip(type: unknown, clip: unknown) {
    if (!record(clip)) throw new Error('Invalid clip');
    const timing = { start: clip.s, end: clip.e };
    const placement = { centerX: clip.x ?? 0, centerY: clip.y ?? 0, scale: clip.z ?? 100 };
    if (type === 'text') {
      const style = styles[clip.st as number];
      if (!record(style)) throw new Error('Invalid text style');
      return compact({
        ...timing, frameCount: clip.fc ?? baseFps * 60, type, source: { ...style, name: clip.n ?? clip.t, content: clip.t }, placement,
        animations: unpackAnimations(clip.an)
      });
    }
    const asset = assets[clip.a as number];
    if (!record(asset)) throw new Error('Invalid asset reference');
    const source = compact({ id: asset.id, name: asset.n, format: asset.f, duration: asset.d, width: asset.w, height: asset.h });
    const item: Record<string, unknown> = { ...timing, type, source };
    if (type !== 'image') item.trim = { offsetL: clip.l ?? 0, offsetR: clip.r ?? 0, silent: clip.m === 1 };
    if (type !== 'audio') {
      item.placement = { ...placement, width: clip.w, height: clip.h };
      if (clip.an !== undefined) item.animations = unpackAnimations(clip.an);
    }
    item.frameCount = clip.fc ?? defaultFrameCount(item as unknown as DraftTrack);
    return item;
  }
  return {
    version: 1,
    trackScale: packed.scale as number,
    playhead: packed.at as number,
    lines: lines.map(line => {
      if (!record(line) || !Array.isArray(line.c)) throw new Error('Invalid line');
      return { type: line.t, main: line.m === 1 ? true : undefined, tracks: line.c.map(clip => unpackClip(line.t, clip)) };
    })
  } as Draft;
}

export function encodeDraft(lines: Draft['lines'], trackScale: number, playhead: number) {
  return JSON.stringify(pack({ trackScale, playhead, lines }));
}

/** 工程引用的素材 id */
export function assetIdsOf(lines: Draft['lines']) {
  return [...new Set(lines.flatMap(({ tracks }) => tracks.flatMap(item => (item.type === 'text' ? [] : [item.source.id]))))];
}

function strings(value: Record<string, unknown>, ...keys: string[]) {
  return keys.every(key => typeof value[key] === 'string');
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function validTrack(track: unknown, type: string) {
  if (!record(track) || track.type !== type || !numbers(track, 'start', 'end', 'frameCount')) return false;
  const { source, placement, trim, animations } = track;
  if (!record(source) || !strings(source, 'name')) return false;
  if (animations !== undefined && (type === 'audio' || !validAnimations(animations))) return false;
  if (type === 'text') {
    return numbers(placement, 'centerX', 'centerY', 'scale') && numbers(source, 'fontSize')
      && strings(source, 'content', 'fill', 'fontFamily')
      && optionalString(source.stroke) && optionalString(source.textBackgroundColor);
  }
  // Media references are content hashes from the importers, not filesystem paths.
  if (typeof source.id !== 'string' || !/^[a-f0-9]{64}$/.test(source.id) || !strings(source, 'format')) return false;
  if (type !== 'image' && (!numbers(source, 'duration') || !record(trim) || !numbers(trim, 'offsetL', 'offsetR')
    || (trim.silent !== undefined && typeof trim.silent !== 'boolean'))) return false;
  return type === 'audio' || (numbers(source, 'width', 'height') && numbers(placement, 'centerX', 'centerY', 'scale', 'width', 'height'));
}

function parseDraft(json: string): Draft {
  const parsed = JSON.parse(json) as unknown;
  const draft = record(parsed) && parsed.v === 2 ? unpack(parsed) : parsed;
  if (!record(draft) || draft.version !== 1 || !numbers(draft, 'trackScale', 'playhead') || !Array.isArray(draft.lines)
    || !draft.lines.every(line => record(line) && typeof line.type === 'string' && ['video', 'audio', 'image', 'text'].includes(line.type)
      && (line.main === undefined || typeof line.main === 'boolean')
      && Array.isArray(line.tracks) && line.tracks.every(track => validTrack(track, line.type as string)))) {
    throw new Error('Invalid or unsupported FlyCut draft');
  }
  return draft as unknown as Draft;
}

/** 校验工程数据（v1 草稿或 v2 工程），失败时抛错 */
export function validateDraft(json: string) {
  parseDraft(json);
}

export async function restoreDraft(json: string) {
  const draft = parseDraft(json);
  const media = new Map<string, Promise<string>>();
  let missingMedia = false;

  async function restoreMedia(type: 'audio' | 'image' | 'video', source: Record<string, unknown> & { id: string, name: string, format: string }) {
    const { id, format } = source;
    const file = await assetStore.file(id);
    // 旧版本缓存的素材没有元信息，按草稿里的信息补上，使其出现在素材库中
    if (!await assetStore.meta(id)) {
      const num = (key: string) => (Number.isFinite(source[key]) ? source[key] as number : 0);
      const asset: AssetRecord = {
        id, kind: type, name: source.name, format, size: file.size,
        duration: num('duration'), width: num('width'), height: num('height'), createdAt: Date.now()
      };
      await assetStore.putMeta(asset);
      useResourceState().add(asset);
    }
    const decoder = { audio: audioDecoder, image: imageDecoder, video: videoDecoder }[type];
    await decoder.decode({ id, type: format });
    return type === 'image' ? id : assetUrl(id, format);
  }

  async function restoreTrack(item: DraftTrack): Promise<Track | null> {
    const { start, end, frameCount, type } = item;
    const timing = { start, end, frameCount };
    if (type === 'text') {
      return Object.assign(new TextTrack(item.source, start), timing, placementOf(item.placement), { animations: withDefaults(item.animations) });
    }

    const { id, format } = item.source;
    const key = `${type}:${id}`;
    let url: string;
    try {
      let asset = media.get(key);
      if (!asset) {
        asset = restoreMedia(type, item.source);
        media.set(key, asset);
      }
      url = await asset;
    } catch {
      missingMedia = true;
      return null;
    }

    // Constructors allocate fresh IDs, avoiding collisions with newly inserted clips.
    if (type === 'audio') {
      const { offsetL, offsetR, silent } = item.trim;
      return Object.assign(new AudioTrack({ ...item.source, url }, start), timing, { offsetL, offsetR, silent });
    }
    if (type === 'image') {
      return Object.assign(new ImageTrack({ ...item.source, url }, start), timing, geometryOf(item.placement), { animations: withDefaults(item.animations) });
    }
    const { offsetL, offsetR, silent } = item.trim;
    return Object.assign(new VideoTrack({ ...item.source, url }, start), timing, geometryOf(item.placement), {
      offsetL, offsetR, silent, animations: withDefaults(item.animations)
    });
  }

  const lines: TrackLineItem[] = await Promise.all(draft.lines.map(async({ type, main, tracks }) => ({
    type,
    main,
    list: (await Promise.all(tracks.map(restoreTrack))).filter((track): track is Track => track !== null)
  })));

  return { trackScale: draft.trackScale, playhead: draft.playhead, lines: lines.filter(({ list, main }) => list.length || main), missingMedia };
}
