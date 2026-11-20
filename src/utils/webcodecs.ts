/* eslint-disable */

import type { VideoSource } from "@/class/VideoTrack";
import { baseFps } from "@/data/trackConfig";
import { MP4Clip, decodeImg, AudioClip } from "@webav/av-cliper";
import { file, write } from "opfs-tools";

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
    const clip = await this.decode({ id: source.id, stream: source.file.stream() });

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
}

class ImageDecoder {
  #decoderMap = new Map<string, VideoFrame[]>();
  async decode({ id, stream, type }: { id: string, stream?: ReadableStream<Uint8Array>, type?: string }) {
    console.log("🚀 ~ ImageDecoder ~ decode ~ id:", id)

    if (this.#decoderMap.has(id)) {
      return this.#decoderMap.get(id);
    }

    stream = await writeFile(id, stream);

    if (!type) {
      throw new Error("type is not ready");
    }

    // 接收的数据可能是远程数据（URL），也可能是本地数据（file）
    // 如果是远程数据，可以直接使用URL作为source，
    // 如果是本地数据，可以使用FileReader读取数据，然后使用URL.createObjectURL创建URL作为source，但是这样缓存数据没法还原为File对象
    // 要解决这个问题，可以引入https://hughfenghen.github.io/posts/2024/03/14/web-storage-and-opfs/
    // 但是这样会增加复杂度，所以暂时不考虑，
    // TODO: 使用OPFS解决本地数据问题
    const frames = await decodeImg(
      stream,
      type,
    );

    // 存储解析后的帧
    this.#decoderMap.set(id, frames);

    return frames;
  }
  async getFrame(type: string, url: string, frameIndex: number) {
    let frames = this.#decoderMap.get(url);
    if (!frames) {
      await this.decode({ id: url, type });
      frames = this.#decoderMap.get(url);
    }
    return frames?.[frameIndex % frames.length];
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

export const videoDecoder = new VideoDecoder();

export const imageDecoder = new ImageDecoder();

export const audioDecoder = new AudioDecoder();