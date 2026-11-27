/* eslint-disable camelcase -- transformers.js 的参数名 */
import { env, pipeline } from '@huggingface/transformers';
import { speechWindows } from './windows';

// 模型从 Hugging Face 下载，缓存在浏览器 Cache API 中
env.allowLocalModels = false;

export type AsrDevice = 'webgpu' | 'wasm';

export interface AsrRequest {
  audio: Float32Array;
  model: string;
  device: AsrDevice;
  language: string;
  rate: number;
}

export interface AsrChunk {
  timestamp: [number, number | null];
  text: string;
}

export type AsrMessage =
  | { type: 'progress', stage: 'download' | 'transcribe', progress: number }
  | { type: 'result', chunks: AsrChunk[] }
  | { type: 'error', message: string };

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string, chunks?: AsrChunk[] }>;

let loaded: { key: string, asr: Promise<Transcriber> } | null = null;

const post = (message: AsrMessage) => self.postMessage(message);

function load(model: string, device: AsrDevice) {
  const key = `${model}:${device}`;
  if (loaded?.key === key) return loaded.asr;
  const files = new Map<string, { loaded: number, total: number }>();
  const asr = pipeline('automatic-speech-recognition', model, {
    device,
    // WebGPU 下 encoder 用 fp32、decoder 用 q4；WASM 用 q8，体积最小
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback(info: { status: string, file?: string, loaded?: number, total?: number }) {
      if (info.status !== 'progress' || !info.file) return;
      files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
      let done = 0;
      let total = 0;
      files.forEach(file => {
        done += file.loaded;
        total += file.total;
      });
      post({ type: 'progress', stage: 'download', progress: total ? Math.round(done / total * 100) : 0 });
    }
  }) as unknown as Promise<Transcriber>;
  loaded = { key, asr };
  return asr;
}

self.onmessage = async({ data }: MessageEvent<AsrRequest>) => {
  try {
    const asr = await load(data.model, data.device);
    post({ type: 'progress', stage: 'transcribe', progress: 0 });
    const { audio, rate } = data;
    const windows = speechWindows(audio, rate);
    const chunks: AsrChunk[] = [];
    for (const [index, { start, end }] of windows.entries()) {
      // 逐个窗口识别，worker 内的模型一次只跑一个推理
      // eslint-disable-next-line no-await-in-loop
      const output = await asr(audio.subarray(Math.round(start * rate), Math.round(end * rate)), {
        return_timestamps: true,
        task: 'transcribe',
        language: data.language
      });
      for (const { timestamp: [from, to], text } of output.chunks ?? []) {
        chunks.push({ timestamp: [Math.min(start + from, end), Math.min(start + (to ?? end - start), end)], text });
      }
      post({ type: 'progress', stage: 'transcribe', progress: Math.round((index + 1) / windows.length * 100) });
    }
    post({ type: 'result', chunks });
  } catch (error) {
    loaded = null;
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
