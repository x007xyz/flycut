import { toRaw } from 'vue';
import { baseFps } from '@/data/trackConfig';
import { TextTrack } from '@/class/TextTrack';
import type { Track } from '@/class/Track';
import { usePlayerState } from '@/stores/playerState';
import { useTrackState } from '@/stores/trackState';
import { audioClips, mixAudio } from '@/utils/renderTimeline';
import type { AsrChunk, AsrDevice, AsrMessage, AsrRequest } from './asrWorker';
import type { SubtitleSegment } from './srt';

export const asrModels = [
  { id: 'onnx-community/whisper-tiny', label: 'Whisper Tiny（约 75MB，最快）' },
  { id: 'onnx-community/whisper-base', label: 'Whisper Base（约 145MB）' },
  { id: 'onnx-community/whisper-small', label: 'Whisper Small（较大，最准确）' }
];

export const asrLanguages = [
  { id: '', label: '自动检测' },
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' }
];

export interface TranscribeOptions {
  model?: string;
  language?: string;
  onProgress?: (stage: 'audio' | 'download' | 'transcribe', progress: number) => void;
}

const asrRate = 16000;
const audioWindow = 30;

function timelineTracks() {
  return toRaw(useTrackState().trackList).flatMap(({ list }) => list.map(track => toRaw(track) as Track));
}

/** 把时间轴上未静音的音频混成 16kHz 单声道，时间与时间轴对齐 */
export async function timelineSpeech(tracks = timelineTracks()) {
  const clips = await audioClips(tracks);
  if (!clips.length) return null;
  const duration = Math.max(...clips.map(({ offset, from, to }) => offset + to - from));
  const audio = new Float32Array(Math.ceil(duration * asrRate));
  for (let start = 0; start < duration; start += audioWindow) {
    // eslint-disable-next-line no-await-in-loop -- 分段混音，控制内存
    const buffer = await mixAudio(clips, start, Math.min(duration, start + audioWindow), { numberOfChannels: 1, sampleRate: asrRate });
    audio.set(buffer.getChannelData(0).subarray(0, audio.length - Math.round(start * asrRate)), Math.round(start * asrRate));
  }
  return audio;
}

async function preferredDevice(): Promise<AsrDevice> {
  const { gpu } = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> }};
  try {
    return gpu && await gpu.requestAdapter() ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

let worker: Worker | null = null;

function recognize(request: AsrRequest, onProgress?: TranscribeOptions['onProgress']) {
  worker ??= new Worker(new URL('./asrWorker.ts', import.meta.url), { type: 'module' });
  const current = worker;
  return new Promise<AsrChunk[]>((resolve, reject) => {
    current.onmessage = ({ data }: MessageEvent<AsrMessage>) => {
      if (data.type === 'progress') onProgress?.(data.stage, data.progress);
      else if (data.type === 'result') resolve(data.chunks);
      else reject(new Error(data.message));
    };
    current.onerror = event => reject(new Error(event.message || 'Speech recognition worker failed'));
    current.postMessage(request, [request.audio.buffer]);
  });
}

/** 识别时间轴音频，返回按时间轴计时的字幕段 */
export async function transcribeTimeline({ model = asrModels[0].id, language = '', onProgress }: TranscribeOptions = {}) {
  onProgress?.('audio', 0);
  const audio = await timelineSpeech();
  if (!audio) throw new Error('时间轴上没有可识别的音频');
  const duration = audio.length / asrRate;
  const device = await preferredDevice();
  let chunks: AsrChunk[];
  try {
    chunks = await recognize({ audio: audio.slice(), model, device, language }, onProgress);
  } catch (error) {
    if (device !== 'webgpu') throw error;
    // WebGPU 不可用或模型加载失败时回退 WASM
    worker?.terminate();
    worker = null;
    chunks = await recognize({ audio, model, device: 'wasm', language }, onProgress);
  }
  return chunks.flatMap(({ timestamp: [start, end], text }) => {
    const content = text.trim();
    const stop = Math.min(end ?? duration, duration);
    return content && stop > start ? [{ start, end: stop, text: content }] : [];
  });
}

/** 每段字幕生成一个文字片段，放在画面下方 */
export function addSubtitles(segments: SubtitleSegment[]) {
  const timeline = useTrackState();
  const player = usePlayerState();
  return segments.map(({ start, end, text }, index) => {
    const track = new TextTrack({
      content: text,
      fontSize: 24,
      fontFamily: 'Arial',
      name: '字幕',
      fill: '#FFFFFF',
      stroke: '#000000'
    }, Math.round(start * baseFps));
    track.frameCount = Math.max(1, Math.round(end * baseFps) - track.start);
    track.end = track.start + track.frameCount;
    track.centerY = Math.round(player.playerHeight * 0.35);
    timeline.addTrack(track, index === 0);
    return track;
  });
}

/** 时间轴上的全部文字片段，按开始时间排序 */
export function textSegments(): SubtitleSegment[] {
  return useTrackState().trackList
    .flatMap(({ list }) => list)
    .filter((track): track is TextTrack => track instanceof TextTrack)
    .sort((a, b) => a.start - b.start)
    .map(track => ({ start: track.start / baseFps, end: track.end / baseFps, text: track.content }));
}
