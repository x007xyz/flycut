import { ElMessage } from 'element-plus';
import { getMD5 } from '@/class/Base';
import { AudioTrack } from '@/class/AudioTrack';
import { ImageTrack } from '@/class/ImageTrack';
import { VideoTrack } from '@/class/VideoTrack';
import { usePlayerState } from '@/stores/playerState';
import { useTrackState } from '@/stores/trackState';
import { useResourceState, type PendingAsset } from '@/stores/resourceStore';
import { peaksOf } from '@/timeline/mediaProvider';
import { assetStore, assetUrl, type AssetKind, type AssetRecord } from '@/storage/assets';
import { audioDecoder, imageDecoder, videoDecoder } from '@/utils/webcodecs';

export type MediaKind = AssetKind;

export const assetDragType = 'application/x-flycut-asset';

export const mediaAccept = '.mp4,video/mp4,image/*,audio/*';

const posterWidth = 160;

const failures: Record<MediaKind, string> = {
  video: '解析视频失败，请选择可播放的 MP4 视频',
  image: '解析图片失败',
  audio: '解析音频失败'
};

export function mediaKind(file: File): MediaKind | null {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type === 'video/mp4' || /\.mp4$/i.test(file.name)) return 'video';
  return null;
}

async function imagePoster(id: string, format: string) {
  const image = await imageDecoder.getFrame(id, 0, format);
  const height = Math.max(1, Math.round(posterWidth * image.height / Math.max(image.width, 1)));
  const canvas = new OffscreenCanvas(posterWidth, height);
  canvas.getContext('2d')?.drawImage(image, 0, 0, posterWidth, height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
}

async function describe(id: string, kind: MediaKind, format: string) {
  if (kind === 'video') {
    const asset = await videoDecoder.decode({ id, type: format });
    const { width, height, duration } = asset.meta;
    if (!width || !height || !(duration > 0)) throw new Error('The file has no usable video track');
    return { meta: { width, height, duration }, poster: () => asset.poster(posterWidth) };
  }
  if (kind === 'image') {
    const asset = await imageDecoder.decode({ id, type: format });
    const { width, height, duration } = asset.meta;
    return { meta: { width, height, duration }, poster: () => imagePoster(id, format) };
  }
  const asset = await audioDecoder.decode({ id, type: format });
  if (!asset || !(asset.meta.duration > 0)) throw new Error('The file has no usable audio track');
  return { meta: { width: 0, height: 0, duration: asset.meta.duration }, poster: async() => null };
}

/** 补生成缺失的封面（如旧版本导入、没有封面缓存的素材） */
export async function ensurePoster(record: AssetRecord) {
  if (record.kind === 'audio' || await assetStore.readCache(record.id, 'poster.jpg')) return;
  const { poster } = await describe(record.id, record.kind, record.format);
  const image = await poster();
  if (!image) return;
  await assetStore.writeCache(record.id, 'poster.jpg', image);
  await useResourceState().loadPoster(record.id);
}

let pendingKey = 0;

/** 把文件存入素材库（按内容哈希去重）：保存原文件、解析元信息、生成封面和波形，返回素材记录 */
async function importAsset(file: File, kind: MediaKind, task: PendingAsset): Promise<AssetRecord | null> {
  const resources = useResourceState();
  const stage = (text: string) => {
    const item = resources.pending.find(({ key }) => key === task.key);
    if (item) item.stage = text;
  };
  stage('读取文件');
  const id = await getMD5(await file.arrayBuffer());
  const existing = await assetStore.meta(id);
  if (existing?.kind === kind) {
    resources.add(existing);
    return existing;
  }
  const format = file.type || (kind === 'video' ? 'video/mp4' : '');
  try {
    stage('保存到本地');
    await assetStore.putData(id, file);
    stage('解析素材');
    const { meta, poster } = await describe(id, kind, format);
    const record: AssetRecord = { id, kind, name: file.name, format, size: file.size, createdAt: Date.now(), ...meta };
    stage('生成封面');
    const image = await poster().catch(() => null);
    if (image) await assetStore.writeCache(id, 'poster.jpg', image);
    if (kind !== 'image') {
      stage('生成波形');
      await peaksOf(id, kind).catch(error => console.warn(error));
    }
    await assetStore.putMeta(record);
    resources.add(record);
    return record;
  } catch (error) {
    console.error(error);
    if (!existing) await assetStore.remove(id).catch(() => {});
    ElMessage.error(`${failures[kind]}：${file.name}`);
    return null;
  }
}

/** 把素材库中的素材放到时间轴的播放头位置 */
export async function insertAsset(record: AssetRecord, start = usePlayerState().playStartFrame) {
  const player = usePlayerState();
  const tracks = useTrackState();
  const { id, name, format, width, height, duration } = record;
  const size = { width: player.playerWidth, height: player.playerHeight };
  if (record.kind === 'image') {
    const track = new ImageTrack({ id, url: id, name, format, width, height }, start);
    track.resize(size);
    tracks.addTrack(track);
    return track;
  }
  const url = await assetUrl(id, format);
  if (record.kind === 'audio') {
    const track = new AudioTrack({ id, url, name, format, duration }, start);
    tracks.addTrack(track);
    return track;
  }
  const track = new VideoTrack({ id, url, name, format, width, height, duration }, start);
  track.resize(size);
  tracks.addTrack(track);
  return track;
}

/**
 * 导入视频、图片或音频到素材列表，处理过程在列表中显示为加载卡片。
 * 返回导入成功的素材，添加到时间轴由 insertAsset 完成。
 */
export async function importMedia(files: Iterable<File>) {
  const resources = useResourceState();
  const list = Array.from(files);
  const supported = list.flatMap(file => {
    const kind = mediaKind(file);
    return kind ? [{ file, kind, task: { key: ++pendingKey, name: file.name, kind, stage: '等待处理' }}] : [];
  });
  const skipped = list.filter(file => !mediaKind(file)).map(file => file.name);
  if (!supported.length) ElMessage.warning('请导入视频、图片或音频文件');
  else if (skipped.length) ElMessage.warning(`已跳过不支持的文件：${skipped.join('、')}`);
  resources.pending.push(...supported.map(({ task }) => task));
  const records: AssetRecord[] = [];
  // 依次处理，保持选择顺序
  await supported.reduce((done, { file, kind, task }) => done.then(async() => {
    try {
      const record = await importAsset(file, kind, task);
      if (record) records.push(record);
    } finally {
      resources.pending = resources.pending.filter(({ key }) => key !== task.key);
    }
  }), Promise.resolve());
  return records;
}
