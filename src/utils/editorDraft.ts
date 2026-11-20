import { AudioTrack, type AudioSource } from '@/class/AudioTrack';
import { ImageTrack, type ImageSource } from '@/class/ImageTrack';
import { TextTrack, type TextSource } from '@/class/TextTrack';
import { VideoTrack, type VideoSource } from '@/class/VideoTrack';
import type { Track, TrackLineItem } from '@/class/Track';
import { audioDecoder, imageDecoder, videoDecoder } from '@/utils/webcodecs';

export const draftKey = 'flycut.editorDraft';

type Timing = { start: number; end: number; frameCount: number };
type Placement = { centerX: number; centerY: number; scale: number };
type Size = { width: number; height: number };
type Trim = { offsetL: number; offsetR: number; silent?: boolean };
type MediaSource = AudioSource | ImageSource | VideoSource;

type DraftTrack = Timing & (
    { type: 'audio'; source: Omit<AudioSource, 'url'>; trim: Trim }
  | { type: 'video'; source: Omit<VideoSource, 'url'>; trim: Trim; placement: Placement & Size }
  | { type: 'image'; source: Omit<ImageSource, 'url'>; placement: Placement & Size }
  | { type: 'text'; source: TextSource; placement: Placement }
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

function captureTrack(track: Track): DraftTrack {
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

export function captureTimeline(lines: TrackLineItem[]): Draft['lines'] {
  return lines.map(({ type, main, list }) => ({ type: type as DraftTrack['type'], main, tracks: list.map(captureTrack) }));
}

export function encodeDraft(lines: Draft['lines'], trackScale: number, playhead: number) {
  return JSON.stringify({ version: 1, trackScale, playhead, lines });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numbers(value: unknown, ...keys: string[]) {
  return record(value) && keys.every(key => Number.isFinite(value[key]));
}

function strings(value: Record<string, unknown>, ...keys: string[]) {
  return keys.every(key => typeof value[key] === 'string');
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function validTrack(track: unknown, type: string) {
  if (!record(track) || track.type !== type || !numbers(track, 'start', 'end', 'frameCount')) return false;
  const { source, placement, trim } = track;
  if (!record(source) || !strings(source, 'name')) return false;
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
  const draft = JSON.parse(json) as unknown;
  if (!record(draft) || draft.version !== 1 || !numbers(draft, 'trackScale', 'playhead') || !Array.isArray(draft.lines)
    || !draft.lines.every(line => record(line) && typeof line.type === 'string' && ['video', 'audio', 'image', 'text'].includes(line.type)
      && (line.main === undefined || typeof line.main === 'boolean')
      && Array.isArray(line.tracks) && line.tracks.every(track => validTrack(track, line.type as string)))) {
    throw new Error('Invalid or unsupported FlyCut draft');
  }
  return draft as unknown as Draft;
}

export async function restoreDraft(json: string) {
  const draft = parseDraft(json);
  const media = new Map<string, Promise<string>>();
  let root: ReturnType<typeof navigator.storage.getDirectory> | undefined;
  let missingMedia = false;

  async function restoreMedia(type: 'audio' | 'image' | 'video', id: string, format: string) {
    root ??= navigator.storage.getDirectory();
    const handle = await (await root).getFileHandle(id);
    const file = await handle.getFile();
    if (!file.size) throw new Error('Empty cached media file');
    const decoder = { audio: audioDecoder, image: imageDecoder, video: videoDecoder }[type];
    await decoder.decode({ id, type: format });
    return type === 'image' ? id : URL.createObjectURL(file.slice(0, file.size, format));
  }

  async function restoreTrack(item: DraftTrack): Promise<Track | null> {
    const { start, end, frameCount, type } = item;
    const timing = { start, end, frameCount };
    if (type === 'text') {
      return Object.assign(new TextTrack(item.source, start), timing, placementOf(item.placement));
    }

    const { id, format } = item.source;
    const key = `${type}:${id}`;
    let url: string;
    try {
      let asset = media.get(key);
      if (!asset) {
        asset = restoreMedia(type, id, format);
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
      return Object.assign(new ImageTrack({ ...item.source, url }, start), timing, geometryOf(item.placement));
    }
    const { offsetL, offsetR, silent } = item.trim;
    return Object.assign(new VideoTrack({ ...item.source, url }, start), timing, geometryOf(item.placement), { offsetL, offsetR, silent });
  }

  const lines: TrackLineItem[] = await Promise.all(draft.lines.map(async({ type, main, tracks }) => ({
    type,
    main,
    list: (await Promise.all(tracks.map(restoreTrack))).filter((track): track is Track => track !== null)
  })));

  return { trackScale: draft.trackScale, playhead: draft.playhead, lines: lines.filter(({ list, main }) => list.length || main), missingMedia };
}
