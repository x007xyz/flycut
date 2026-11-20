/* eslint-disable */

import type { VideoSource } from "@/class/VideoTrack";
import { baseFps } from "@/data/trackConfig";
import { MP4Clip, ImgClip, AudioClip } from "@webav/av-cliper";
import { file, write } from "opfs-tools";
import { UnitFrame2μs } from '@/data/trackConfig';

async function writeFile(id: string, stream?: ReadableStream<Uint8Array>) {
  if (!stream) {
    // 没有数据流，尝试从opfs中获取
    stream = await file(id).stream();

    if (!stream) {
      throw new Error("stream is not ready");
    }
  }

  const start = performance.now()

  // 如果opfs中没有数据则存储
  if (!(await file(id).exists())) {
    await write(id, stream);
    console.log('opfs存储文件耗时', performance.now() - start, 'ms');

    stream = await file(id).stream();

    console.log('opfs读取文件耗时', performance.now() - start, 'ms');
  }

  return stream;
}

class VideoDecoder {
  #decoderMap = new Map<string, MP4Clip>();

  #thumbnailsMap = new Map<string, {
      img: Blob;
      ts: number;
  }[]>();

  async thumbnails(source: VideoSource) {
    if (this.#thumbnailsMap.has(source.id)) {
      return this.#thumbnailsMap.get(source.id);
    }
    const clip = await this.decode({ id: source.id });

    if (!clip) {
      throw new Error("clip is not ready");
    }
    const thumbnails = await clip.thumbnails(50, { step: 1e6 });

    this.#thumbnailsMap.set(source.id, thumbnails);

    return thumbnails;
  }

  async decode({ id, stream, type }: { id: string, stream?: ReadableStream<Uint8Array>, type?: string }) {
    if (this.#decoderMap.has(id)) {
      return this.#decoderMap.get(id);
    }

    stream = await writeFile(id, stream);

    const videoClip = new MP4Clip(stream);

    await videoClip.ready;

    this.#decoderMap.set(id, videoClip);

    return videoClip;
  }
  async getFrame(url: string, frameIndex: number) {
    let clip = this.#decoderMap.get(url);
    if (!clip) {
      clip = await this.decode({ id: url })
    }

    // tick根据时间获取帧，可能存在这一时间帧为空的情况，修改为在范围内寻找帧
    // 前几帧可能为空，所以限定最小时间为5/30秒
    let time = Math.max(((frameIndex - 1) / baseFps * 1e6), 5 / 30 * 1e6) ;
    let video : VideoFrame | undefined;
    const frame = (await (clip as MP4Clip).tick(time));

    return frame.video;
  }
}

class ImageDecoder {
  #decoderMap = new Map<string, ImgClip>();
  async decode({ id, stream, type }: { id: string, stream?: ReadableStream<Uint8Array>, type?: string }) {
    const cached = this.#decoderMap.get(id);
    if (cached) return cached;

    stream = await writeFile(id, stream);

    const clip = type === 'image/gif' || type === 'image/webp' || type === 'image/png' || type === 'image/avif'
      ? new ImgClip({ type, stream })
      : new ImgClip(stream);
    await clip.ready;
    this.#decoderMap.set(id, clip);
    return clip;
  }
  async getFrame(type: string, id: string, frameIndex: number) {
    const clip = await this.decode({ id, type });
    return (await clip.tick(frameIndex * UnitFrame2μs)).video;
  }
}

class AudioDecoder {
  #decoderMap = new Map<string, AudioClip>();
  async decode({ id, stream, type }: { id: string, stream?: ReadableStream<Uint8Array>, type?: string }) {

    if (this.#decoderMap.has(id)) {
      return this.#decoderMap.get(id);
    }

    stream = await writeFile(id, stream);

    if (!type) {
      throw new Error("type is not ready");
    }

    const clip = new AudioClip(stream);

    if (!clip) {
      // 提示解析视频失败
      throw new Error("解析视频失败");
    }

    await clip.ready;

    this.#decoderMap.set(id, clip)

    return clip;
  }
}

export const splitClip = async (source: AudioClip | MP4Clip, { offsetL, offsetR, frameCount } : { offsetL: number, offsetR: number, frameCount: number }) => {
  if (offsetL === 0 && offsetR === 0) return source.clone();

  let clip = source;
  if (offsetL > 0) {
    const [before, after] = await source.split(offsetL * UnitFrame2μs);
    before.destroy();
    clip = after;
  }
  if (offsetR === 0) return clip;

  try {
    const [before, after] = await clip.split((frameCount - offsetR - offsetL) * UnitFrame2μs);
    after.destroy();
    return before;
  } finally {
    if (clip !== source) clip.destroy();
  }
}

export const videoDecoder = new VideoDecoder();

export const imageDecoder = new ImageDecoder();

export const audioDecoder = new AudioDecoder();