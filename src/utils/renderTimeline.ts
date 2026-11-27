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
import { VideoTrack } from '@/class/VideoTrack';
import { baseFps } from '@/data/trackConfig';
import { buildScene, type Size, type Track } from '@/render/scene';
import { drawFrame, loadFrameSources, type FrameLoader } from '@/render/drawFrame';
import { audioDecoder, imageDecoder, videoDecoder, type MediaAsset } from './webcodecs';

export type { Track };

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

  const clips = new Map(tracks.map(track => [track.id, track]));
  const samples = new Map<string, AsyncGenerator<VideoSample | null>>();
  // 导出逐帧顺序推进，每个视频片段使用一个顺序解码器
  const load: FrameLoader = async layer => {
    if (layer.kind === 'image') return imageDecoder.getFrame(layer.sourceId, layer.time, layer.format);
    let iterator = samples.get(layer.clipId);
    if (!iterator) {
      const asset = await videoDecoder.decode({ id: layer.sourceId });
      iterator = asset.videoSink.samplesAtTimestamps(videoTimes(clips.get(layer.clipId) as VideoTrack, asset));
      samples.set(layer.clipId, iterator);
    }
    return (await iterator.next()).value ?? null;
  };
  try {
    const audioSources = await audioClips(tracks);
    await output.start();

    const ratio = width / playerSize.width;
    const framesPerWindow = audioWindow * fps;
    for (let frame = 0; frame < frameCount; frame++) {
      if (frame % framesPerWindow === 0) {
        await audioSource.add(await mixAudio(audioSources, frame / fps, Math.min(frame + framesPerWindow, frameCount) / fps));
      }
      const scene = buildScene(tracks, frame, playerSize);
      const sources = await loadFrameSources(scene, load);
      try {
        drawFrame(ctx, scene, sources, { scale: ratio });
      } finally {
        sources.release();
      }
      await videoSource.add(frame / fps, 1 / fps);
      for (const [clipId, iterator] of samples) {
        if (clips.get(clipId)?.end === frame + 1) {
          samples.delete(clipId);
          await iterator.return(undefined);
        }
      }
    }
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  } finally {
    await Promise.all([...samples.values()].map(iterator => iterator.return(undefined).catch(() => {})));
  }
}
