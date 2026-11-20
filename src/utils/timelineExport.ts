import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, WebMOutputFormat, canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type { TrackLineItem } from '@/class/Track';
import { baseFps } from '@/data/trackConfig';
import { drawTimelineFrame } from './timelineCanvas';
import { editorScale, fitOutputSize } from './timelineGeometry';
import type { CanvasSize } from './timelineGeometry';
import { createVideoReader } from './timelineVideo';
import { createAudioMixer, audioSampleRate, samplesPerFrame } from './timelineAudio';
import { chooseExportFormat } from './exportFormat';

/* eslint-disable no-await-in-loop -- honor decoder and encoder backpressure for each frame */
export async function exportTimeline(
  lines: TrackLineItem[],
  size: CanvasSize,
  frameCount: number,
  signal: AbortSignal,
  onProgress: (percent: number) => void
) {
  if (frameCount <= 0) throw new Error('请先添加素材再合成视频');
  const { width, height } = fitOutputSize({ width: size.width * editorScale, height: size.height * editorScale });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('无法创建导出画布');

  const video = createVideoReader();
  const mixer = createAudioMixer();
  let output: Output | undefined;
  try {
    for (const { list } of lines) {
      for (const track of list) {
        signal.throwIfAborted();
        await mixer.add(track);
      }
    }
    const bitrate = Math.max(1_000_000, Math.round(width * height * 3));
    const audioBitrate = 128_000;
    const format = await chooseExportFormat(
      mixer.hasAudio,
      codec => canEncodeVideo(codec, { width, height, bitrate }),
      codec => canEncodeAudio(codec, { numberOfChannels: 2, sampleRate: audioSampleRate, bitrate: audioBitrate })
    );
    signal.throwIfAborted();
    const target = new BufferTarget();
    const container = format.extension === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat();
    output = new Output({ format: container, target });
    const frames = new CanvasSource(canvas, { codec: format.video, bitrate });
    output.addVideoTrack(frames, { frameRate: baseFps });
    const audio = format.audio ? new AudioBufferSource({ codec: format.audio, bitrate: audioBitrate }) : undefined;
    if (audio) output.addAudioTrack(audio);
    await output.start();

    for (let frame = 0; frame < frameCount; frame++) {
      signal.throwIfAborted();
      await drawTimelineFrame(ctx, lines, size, frame, video.read);
      await frames.add(frame / baseFps, 1 / baseFps);
      if (audio && frame % 6 === 0) {
        const count = Math.min(6, frameCount - frame) * samplesPerFrame;
        await audio.add(await mixer.mix(frame * samplesPerFrame, count));
      }
      if (frame % 6 === 0) {
        onProgress(Math.floor(frame / frameCount * 100));
        await new Promise(resolve => { setTimeout(resolve, 0); });
      }
    }
    signal.throwIfAborted();
    await output.finalize();
    signal.throwIfAborted();
    if (!target.buffer?.byteLength) throw new Error('未生成可保存的视频文件');
    return { blob: new Blob([target.buffer], { type: container.mimeType }), extension: format.extension };
  } finally {
    await Promise.all([
      video.dispose(),
      mixer.dispose(),
      output && output.state !== 'finalized' ? output.cancel().catch(error => console.warn('释放导出资源失败', error)) : undefined
    ]);
  }
}
