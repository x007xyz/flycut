/* eslint-disable no-await-in-loop, no-continue -- frames are decoded sequentially */
import {
  ALL_FORMATS,
  AudioBufferSink,
  BlobSource,
  CanvasSink,
  Input,
  VideoSampleSink,
  type InputAudioTrack,
  type InputVideoTrack,
  type VideoSample
} from 'mediabunny';
import { assetStore } from '@/storage/assets';
import type { VideoSource } from '@/class/VideoTrack';

interface DecodeOptions {
  id: string,
  type?: string
}

export interface MediaMeta {
  width: number,
  height: number,
  // seconds
  duration: number
}

class AssetCache<T> {
  #cache = new Map<string, Promise<T>>();
  #load: (blob: Blob, type?: string) => Promise<T>;
  constructor(load: (blob: Blob, type?: string) => Promise<T>) {
    this.#load = load;
  }
  get({ id, type }: DecodeOptions) {
    let asset = this.#cache.get(id);
    if (!asset) {
      asset = assetStore.file(id).then(blob => this.#load(blob, type));
      asset.catch(() => this.#cache.delete(id));
      this.#cache.set(id, asset);
    }
    return asset;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas) {
  if ('convertToBlob' in canvas) return (canvas as OffscreenCanvas & { convertToBlob(options: { type: string, quality: number }): Promise<Blob> }).convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((blob: Blob | null) => {
      if (blob) resolve(blob);
      else reject(new Error('toBlob failed'));
    }, 'image/jpeg', 0.8);
  });
}

const playbackLookahead = 1;

export class MediaAsset {
  #videoSink?: VideoSampleSink;
  #audioSink?: AudioBufferSink;
  #playback: { iterator: AsyncGenerator<VideoSample, void>, current: VideoSample | null, next: VideoSample | null } | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  readonly input: Input;
  readonly videoTrack: InputVideoTrack | null;
  readonly audioTrack: InputAudioTrack | null;
  readonly meta: MediaMeta;
  readonly firstTimestamp: number;
  constructor(input: Input, videoTrack: InputVideoTrack | null, audioTrack: InputAudioTrack | null, meta: MediaMeta, firstTimestamp: number) {
    this.input = input;
    this.videoTrack = videoTrack;
    this.audioTrack = audioTrack;
    this.meta = meta;
    this.firstTimestamp = firstTimestamp;
  }

  static async open(blob: Blob) {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const [videoTrack, audioTrack] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    const decodableVideo = videoTrack && await videoTrack.canDecode() ? videoTrack : null;
    const decodableAudio = audioTrack && await audioTrack.canDecode() ? audioTrack : null;
    if (!decodableVideo && !decodableAudio) throw new Error('Unsupported media');
    const duration = await input.computeDuration();
    return new MediaAsset(input, decodableVideo, decodableAudio, {
      width: decodableVideo?.displayWidth ?? 0,
      height: decodableVideo?.displayHeight ?? 0,
      duration
    }, decodableVideo ? await decodableVideo.getFirstTimestamp() : 0);
  }

  get videoSink() {
    if (!this.videoTrack) throw new Error('Media has no video track');
    this.#videoSink ??= new VideoSampleSink(this.videoTrack);
    return this.#videoSink;
  }

  get audioSink() {
    if (!this.audioTrack) return null;
    this.#audioSink ??= new AudioBufferSink(this.audioTrack);
    return this.#audioSink;
  }

  // Leading frames can start after 0, so clamp to the first decodable sample.
  sampleTime(time: number) {
    return Math.min(Math.max(time, this.firstTimestamp), Math.max(this.meta.duration - 1e-3, this.firstTimestamp));
  }

  // Preview mostly moves forward, so keep one decoder running instead of decoding from a keyframe per frame.
  getSample(time: number): Promise<VideoSample | null> {
    const sample = this.#queue.then(() => this.#sampleAt(this.sampleTime(time)));
    this.#queue = sample.catch(() => {});
    return sample;
  }

  async #sampleAt(time: number) {
    const current = this.#playback?.current;
    const playback = this.#playback && current && time >= current.timestamp && time - current.timestamp <= playbackLookahead
      ? this.#playback
      : await this.#seek(time);
    while (playback.next && playback.next.timestamp <= time) {
      playback.current?.close();
      playback.current = playback.next;
      playback.next = (await playback.iterator.next()).value ?? null;
    }
    return playback.current?.clone() ?? null;
  }

  async #seek(time: number) {
    if (this.#playback) {
      this.#playback.current?.close();
      this.#playback.next?.close();
      await this.#playback.iterator.return();
    }
    const iterator = this.videoSink.samples(time);
    const current = (await iterator.next()).value ?? null;
    const next = (await iterator.next()).value ?? null;
    this.#playback = { iterator, current, next };
    return this.#playback;
  }

  async poster(width: number) {
    if (!this.videoTrack) return null;
    const height = Math.max(1, Math.round(width * this.meta.height / Math.max(this.meta.width, 1)));
    const sink = new CanvasSink(this.videoTrack, { width, height, fit: 'cover' });
    const wrapped = await sink.getCanvas(this.sampleTime(0));
    return wrapped ? canvasToBlob(wrapped.canvas) : null;
  }

  async thumbnails(width: number, step = 1) {
    if (!this.videoTrack) return [];
    const height = Math.max(1, Math.round(width * this.meta.height / Math.max(this.meta.width, 1)));
    const sink = new CanvasSink(this.videoTrack, { width, height, fit: 'cover' });
    const times = Array.from({ length: Math.max(1, Math.ceil(this.meta.duration / step)) }, (_, i) => this.sampleTime(i * step));
    const thumbnails: { img: Blob, ts: number }[] = [];
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (!wrapped) continue;
      const img = await canvasToBlob(wrapped.canvas);
      thumbnails.push({ img, ts: wrapped.timestamp * 1e6 });
    }
    return thumbnails;
  }
}

interface ImageFrame {
  image: ImageBitmap,
  // seconds
  start: number
}

type DecodedImage = ImageBitmap & { duration: number | null };

type NativeImageDecoder = {
  isTypeSupported(type: string): Promise<boolean>,
  new(init: { data: ReadableStream<Uint8Array>, type: string }): {
    tracks: { ready: Promise<void>, selectedTrack: { frameCount: number } | null },
    completed: Promise<void>,
    decode(options: { frameIndex: number }): Promise<{ image: DecodedImage }>,
    close(): void
  }
};

export class ImageAsset {
  readonly frames: ImageFrame[];
  readonly meta: MediaMeta;
  constructor(frames: ImageFrame[], meta: MediaMeta) {
    this.frames = frames;
    this.meta = meta;
  }

  static async open(blob: Blob, type?: string) {
    const mime = type || blob.type;
    const Decoder = (self as unknown as { ImageDecoder?: NativeImageDecoder }).ImageDecoder;
    if (Decoder && mime && await Decoder.isTypeSupported(mime).catch(() => false)) {
      const decoder = new Decoder({ data: blob.stream(), type: mime });
      try {
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack;
        await decoder.completed;
        const count = track?.frameCount ?? 1;
        const frames: ImageFrame[] = [];
        let start = 0;
        for (let frameIndex = 0; frameIndex < count; frameIndex++) {
          const { image } = await decoder.decode({ frameIndex });
          frames.push({ image: await createImageBitmap(image), start });
          start += (image.duration ?? 0) / 1e6;
          image.close();
        }
        const [{ image: first }] = frames;
        return new ImageAsset(frames, { width: first.width, height: first.height, duration: start });
      } finally {
        decoder.close();
      }
    }
    const image = await createImageBitmap(blob);
    return new ImageAsset([{ image, start: 0 }], { width: image.width, height: image.height, duration: 0 });
  }

  getFrame(time: number) {
    const { frames, meta } = this;
    if (frames.length === 1 || meta.duration <= 0) return frames[0].image;
    const t = time % meta.duration;
    let frame = frames[0];
    for (const candidate of frames) {
      if (candidate.start > t) break;
      frame = candidate;
    }
    return frame.image;
  }
}

const mediaCache = new AssetCache(blob => MediaAsset.open(blob));
const imageCache = new AssetCache((blob, type) => ImageAsset.open(blob, type));

class VideoDecoder {
  #thumbnails = new Map<string, Promise<{ img: Blob, ts: number }[]>>();

  decode(options: DecodeOptions) {
    return mediaCache.get(options).then(asset => {
      if (!asset.videoTrack) throw new Error('Media has no video track');
      return asset;
    });
  }

  thumbnails(source: VideoSource) {
    let thumbnails = this.#thumbnails.get(source.id);
    if (!thumbnails) {
      thumbnails = this.decode({ id: source.id }).then(asset => asset.thumbnails(50));
      thumbnails.catch(() => this.#thumbnails.delete(source.id));
      this.#thumbnails.set(source.id, thumbnails);
    }
    return thumbnails;
  }

  async getFrame(id: string, time: number) {
    return (await this.decode({ id })).getSample(time);
  }
}

class ImageDecoder {
  decode(options: DecodeOptions) {
    return imageCache.get(options);
  }

  async getFrame(id: string, time: number, type?: string) {
    return (await this.decode({ id, type })).getFrame(time);
  }
}

// 浏览器能解码但 MediaBunny 不支持的音频（如 MP3 编码的 WAV）整段解码后使用
class DecodedAudio {
  readonly buffer: AudioBuffer;
  readonly meta: MediaMeta;
  constructor(buffer: AudioBuffer) {
    this.buffer = buffer;
    this.meta = { width: 0, height: 0, duration: buffer.duration };
  }

  static async open(blob: Blob) {
    const context = new OfflineAudioContext(1, 1, 48000);
    return new DecodedAudio(await context.decodeAudioData(await blob.arrayBuffer()));
  }

  get audioSink() {
    const { buffer } = this;
    return {
      async *buffers(_from?: number, _to?: number) {
        yield { buffer, timestamp: 0 };
      }
    };
  }
}

const audioCache = new AssetCache(async blob => {
  const asset = await MediaAsset.open(blob).catch(() => null);
  if (asset?.audioTrack) return asset;
  return DecodedAudio.open(blob).catch(() => {
    throw new Error('Media has no audio track');
  });
});

class AudioDecoder {
  decode(options: DecodeOptions) {
    return audioCache.get(options);
  }
}

export const videoDecoder = new VideoDecoder();

export const imageDecoder = new ImageDecoder();

export const audioDecoder = new AudioDecoder();
