/* eslint-disable no-await-in-loop, no-continue -- frames are rendered and encoded in order */
import {
  AudioBufferSource,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
  type VideoSample
} from 'mediabunny';
import { AudioTrack } from '@/class/AudioTrack';
import type { ImageTrack } from '@/class/ImageTrack';
import type { TextTrack } from '@/class/TextTrack';
import { VideoTrack } from '@/class/VideoTrack';
import { baseFps } from '@/data/trackConfig';
import { audioDecoder, videoDecoder, type MediaAsset } from './webcodecs';

export type Track = AudioTrack | ImageTrack | TextTrack | VideoTrack;
type Size = { width: number, height: number };

export const exportOptions = {
  width: 1080,
  height: 1920,
  fps: baseFps,
  videoCodec: 'avc1.42E032',
  bitrate: 5e6,
  audioBitrate: 128e3,
  sampleRate: 48000,
  numberOfChannels: 2
};

export async function isExportSupported() {
  const { VideoEncoder, AudioEncoder } = window;
  if (!VideoEncoder || !AudioEncoder) return false;
  const { width, height, videoCodec, bitrate, audioBitrate, sampleRate, numberOfChannels } = exportOptions;
  const video = await VideoEncoder.isConfigSupported({ codec: videoCodec, width, height, bitrate });
  if (!video.supported) return false;
  const audio = await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate, numberOfChannels, bitrate: audioBitrate });
  return Boolean(audio.supported);
}

// 片段在素材中的可见区间与在时间轴上的起点，单位为秒
export function sourceWindow({ start, end, offsetL }: { start: number, end: number, offsetL: number }) {
  const from = offsetL / baseFps;
  return { from, to: from + (end - start) / baseFps, offset: start / baseFps };
}

type AudioBuffers = { buffers(from: number, to: number): AsyncIterable<{ buffer: AudioBuffer, timestamp: number }> };
type AudioClip = ReturnType<typeof sourceWindow> & { sink: AudioBuffers };

async function audioClips(tracks: Track[]) {
  const clips: AudioClip[] = [];
  for (const track of tracks) {
    if (!(track instanceof AudioTrack || track instanceof VideoTrack) || (track as { silent?: boolean }).silent) continue;
    const asset = track instanceof AudioTrack
      ? await audioDecoder.decode({ id: track.source.id })
      : await videoDecoder.decode({ id: track.source.id });
    if (asset.audioSink) clips.push({ ...sourceWindow(track), sink: asset.audioSink });
  }
  return clips;
}

// 按时间窗口混音，避免长时间轴一次性分配整段未压缩音频
const audioWindow = 10;

async function mixAudio(clips: AudioClip[], start: number, end: number) {
  const { numberOfChannels, sampleRate } = exportOptions;
  const context = new OfflineAudioContext(numberOfChannels, Math.max(1, Math.round((end - start) * sampleRate)), sampleRate);
  for (const { sink, from, to, offset } of clips) {
    const clipStart = Math.max(start, offset);
    const clipEnd = Math.min(end, offset + to - from);
    if (clipEnd <= clipStart) continue;
    const sourceFrom = from + clipStart - offset;
    const sourceTo = from + clipEnd - offset;
    for await (const { buffer, timestamp } of sink.buffers(sourceFrom, sourceTo)) {
      const skip = Math.max(0, sourceFrom - timestamp);
      const length = Math.min(buffer.duration - skip, sourceTo - Math.max(timestamp, sourceFrom));
      if (length <= 0) continue;
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(context.destination);
      node.start(clipStart - start + Math.max(0, timestamp - sourceFrom), skip, length);
    }
  }
  return context.startRendering();
}

function paintBackground(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width, height);
}

async function *videoTimes(track: VideoTrack, asset: MediaAsset) {
  for (let frame = track.start; frame < track.end; frame++) yield asset.sampleTime(track.sourceTime(frame));
}

export async function renderTimeline(tracks: Track[], playerSize: Size, writable: WritableStream<StreamTargetChunk>) {
  const { width, height, fps, videoCodec, bitrate, audioBitrate } = exportOptions;
  const frameCount = Math.max(0, ...tracks.map(track => track.end));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('ctx is null');

  const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(writable) });
  const videoSource = new CanvasSource(canvas, { codec: 'avc', fullCodecString: videoCodec, bitrate });
  const audioSource = new AudioBufferSource({ codec: 'opus', bitrate: audioBitrate });
  output.addVideoTrack(videoSource, { frameRate: fps });
  output.addAudioTrack(audioSource);

  const samples = new Map<VideoTrack, AsyncGenerator<VideoSample | null>>();
  try {
    const clips = await audioClips(tracks);
    await output.start();

    // 越靠前的轨道层级越高，因此从后往前绘制
    const visual = tracks.filter((track): track is Exclude<Track, AudioTrack> => !(track instanceof AudioTrack)).reverse();
    const ratio = width / playerSize.width;
    const drawTrack = async(track: Exclude<Track, AudioTrack>, frame: number) => {
      if (!(track instanceof VideoTrack)) {
        await track.draw(ctx as OffscreenCanvasRenderingContext2D & CanvasRenderingContext2D, playerSize, frame);
        return;
      }
      let iterator = samples.get(track);
      if (!iterator) {
        const asset = await videoDecoder.decode({ id: track.source.id });
        iterator = asset.videoSink.samplesAtTimestamps(videoTimes(track, asset));
        samples.set(track, iterator);
      }
      const { value: sample } = await iterator.next();
      if (sample) {
        sample.draw(ctx, track.getDrawX(playerSize.width), track.getDrawY(playerSize.height), track.drawWidth, track.drawHeight);
        sample.close();
      }
      if (frame === track.end - 1) await iterator.return(undefined);
    };
    const framesPerWindow = audioWindow * fps;
    for (let frame = 0; frame < frameCount; frame++) {
      if (frame % framesPerWindow === 0) {
        await audioSource.add(await mixAudio(clips, frame / fps, Math.min(frame + framesPerWindow, frameCount) / fps));
      }
      ctx.save();
      paintBackground(ctx, width, height);
      ctx.scale(ratio, ratio);
      for (const track of visual) {
        if (frame >= track.start && frame < track.end) await drawTrack(track, frame);
      }
      ctx.restore();
      await videoSource.add(frame / fps, 1 / fps);
    }
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  } finally {
    await Promise.all([...samples.values()].map(iterator => iterator.return(undefined).catch(() => {})));
  }
}
