/* eslint-disable camelcase -- transformers.js 的参数名 */
import { env, pipeline } from '@huggingface/transformers';

// 模型从 Hugging Face 下载，缓存在浏览器 Cache API 中
env.allowLocalModels = false;

export type AsrDevice = 'webgpu' | 'wasm';

export interface AsrRequest {
  audio: Float32Array;
  model: string;
  device: AsrDevice;
  language: string;
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
    const output = await asr(data.audio, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      task: 'transcribe',
      language: data.language
    });
    post({ type: 'result', chunks: output.chunks ?? [] });
  } catch (error) {
    loaded = null;
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
