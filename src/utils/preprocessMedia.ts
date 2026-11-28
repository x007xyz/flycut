import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, QUALITY_HIGH, canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type { AssetKind } from '@/storage/assets';

/** 超过这个大小的文件导入时给出提示，并且不做可选的压缩（转码结果要整体放在内存里） */
export const largeFileBytes = 2 * 1024 ** 3;
const maxImageSide = 3840;
const maxVideoSide = 1920;
const browserImage = /^image\/(png|apng|jpeg|webp|gif|avif|svg\+xml)$/;
const losslessAudio = /^audio\/(wav|x-wav|wave|vnd\.wave|flac|x-flac|aiff|x-aiff)$/;

/** 优先 AAC；浏览器没有 AAC 编码器时（如 Chromium）用 Opus，和合成视频一致 */
async function audioCodec() {
  if (await canEncodeAudio('aac')) return 'aac' as const;
  return await canEncodeAudio('opus') ? 'opus' as const : null;
}

const rename = (name: string, ext: string) => name.replace(/\.[^./\\]*$/, '') + ext;
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

type FrameCounter = new(init: { data: ReadableStream<Uint8Array>, type: string }) => {
  tracks: { ready: Promise<void>, selectedTrack: { frameCount: number } | null },
  completed: Promise<void>,
  close(): void
};

/** 动图（GIF、APNG、动画 WebP）保持原样，重新编码会只剩第一帧 */
async function isAnimated(file: File) {
  if (/gif/.test(file.type)) return true;
  const Decoder = (self as unknown as { ImageDecoder?: FrameCounter }).ImageDecoder;
  if (!Decoder) return /png|webp|avif/.test(file.type);
  const decoder = new Decoder({ data: file.stream(), type: file.type });
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    return (decoder.tracks.selectedTrack?.frameCount ?? 1) > 1;
  } catch {
    return true;
  } finally {
    decoder.close();
  }
}

/** 静态图片：长边缩到 3840 以内并转成 WebP（保留透明），按 EXIF 方向摆正；不需要缩小且结果不比原图小 10% 时保留原图 */
// createImageBitmap 和 ImageDecoder 都解不了 SVG，用 <img> 栅格化成 WebP，没有固有尺寸时按 1080 px 长边输出
async function rasterizeSvg(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    // 极细的 SVG 短边会被取整为 0，按 1 px 处理以保持比例
    const width = image.naturalWidth || (image.naturalHeight ? 1 : 1080);
    const height = image.naturalHeight || (image.naturalWidth ? 1 : 1080);
    const scale = Math.min(maxImageSide, Math.max(1080, width, height)) / Math.max(width, height);
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
    return new File([blob], rename(file.name, blob.type === 'image/webp' ? '.webp' : '.png'), { type: blob.type });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function prepareImage(file: File) {
  if (file.type === 'image/svg+xml') return rasterizeSvg(file);
  const unsupported = !browserImage.test(file.type);
  if (!unsupported && await isAnimated(file)) return file;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxImageSide / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  if (!unsupported && scale === 1 && blob.size > file.size * 0.9) return file;
  return new File([blob], rename(file.name, blob.type === 'image/webp' ? '.webp' : '.png'), { type: blob.type });
}

async function convert(file: File, options: (input: Input) => Promise<Parameters<typeof Conversion.init>[0] | null>, onProgress: (progress: number) => void) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const init = await options(input);
    if (!init) return null;
    const conversion = await Conversion.init(init);
    if (!conversion.isValid) return null;
    conversion.onProgress = onProgress;
    await conversion.execute();
    return (init.output.target as BufferTarget).buffer;
  } finally {
    input.dispose();
  }
}

/**
 * 视频：非 MP4（H.264 + AAC）的转成 MP4，长边超过 1920 的缩到 1920；已经兼容且不超尺寸的保持原样。
 * 兼容的视频转码后不比原文件小时保留原文件
 */
async function prepareVideo(file: File, onProgress: (progress: number) => void) {
  let compatible = false;
  const buffer = await convert(file, async input => {
    const video = await input.getPrimaryVideoTrack();
    if (!video) return null;
    // H.264 没有透明通道，带透明的 WebM 保持原样
    if (await video.canBeTransparent()) return null;
    const audio = await input.getPrimaryAudioTrack();
    const mime = await input.getMimeType();
    compatible = mime.startsWith('video/mp4') && video.codec === 'avc' && (!audio || audio.codec === 'aac' || audio.codec === 'opus');
    const long = Math.max(video.displayWidth, video.displayHeight);
    if (compatible && (long <= maxVideoSide || file.size > largeFileBytes)) return null;
    const codec = audio ? await audioCodec() : 'aac';
    if (!await canEncodeVideo('avc') || !codec) return null;
    const scale = Math.min(1, maxVideoSide / long);
    return {
      input,
      output: new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() }),
      tracks: 'primary',
      video: { codec: 'avc', bitrate: QUALITY_HIGH, ...(scale < 1 ? { width: even(video.displayWidth * scale), height: even(video.displayHeight * scale), fit: 'contain' } : {}) },
      audio: { codec, bitrate: 192e3 }
    };
  }, onProgress);
  if (!buffer || (compatible && buffer.byteLength >= file.size)) return file;
  return new File([buffer], rename(file.name, '.mp4'), { type: 'video/mp4' });
}

/** 音频：WAV、FLAC、AIFF 等无损格式转成 AAC 或 Opus（.m4a），其余保持原样 */
async function prepareAudio(file: File, onProgress: (progress: number) => void) {
  const codec = losslessAudio.test(file.type) ? await audioCodec() : null;
  if (!codec) return file;
  const buffer = await convert(file, async input => ({
    input,
    output: new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() }),
    tracks: 'primary',
    audio: { codec, bitrate: 192e3 }
  }), onProgress);
  if (!buffer || buffer.byteLength >= file.size) return file;
  return new File([buffer], rename(file.name, '.m4a'), { type: 'audio/mp4' });
}

/** 导入前压缩并转成编辑器和导出都支持的格式；失败或没有收益时返回原文件 */
export async function prepareMedia(file: File, kind: AssetKind, onProgress: (progress: number) => void = () => {}) {
  try {
    if (kind === 'image') return await prepareImage(file);
    if (kind === 'video') return await prepareVideo(file, onProgress);
    return await prepareAudio(file, onProgress);
  } catch (error) {
    console.warn('Keeping the original file, preprocessing failed:', error);
    return file;
  }
}
