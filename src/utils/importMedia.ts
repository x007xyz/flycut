import { ElMessage } from 'element-plus';
import { getMD5 } from '@/class/Base';
import { AudioTrack } from '@/class/AudioTrack';
import { ImageTrack } from '@/class/ImageTrack';
import { usePlayerState } from '@/stores/playerState';
import { useTrackState } from '@/stores/trackState';
import { audioDecoder, imageDecoder } from '@/utils/webcodecs';
import { importVideo } from '@/utils/importVideo';

export type MediaKind = 'video' | 'image' | 'audio';

export const mediaAccept = '.mp4,video/mp4,image/*,audio/*';

export function mediaKind(file: File): MediaKind | null {
  if (file.type === 'video/mp4' || /\.mp4$/i.test(file.name)) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

async function importImage(file: File) {
  const player = usePlayerState();
  const tracks = useTrackState();
  const startFrame = player.playStartFrame;
  try {
    const id = await getMD5(await file.arrayBuffer());
    const clip = await imageDecoder.decode({ id, stream: file.stream(), type: file.type });
    const track = new ImageTrack({
      id,
      url: id,
      name: file.name,
      format: file.type,
      width: clip.meta.width,
      height: clip.meta.height
    }, startFrame);
    track.resize({ width: player.playerWidth, height: player.playerHeight });
    tracks.addTrack(track);
  } catch (error) {
    console.error(error);
    ElMessage.error('解析图片失败');
  }
}

async function importAudio(file: File) {
  const player = usePlayerState();
  const tracks = useTrackState();
  const startFrame = player.playStartFrame;
  try {
    const id = await getMD5(await file.arrayBuffer());
    const clip = await audioDecoder.decode({ id, stream: file.stream(), type: file.type });
    if (!clip || !(clip.meta.duration > 0)) throw new Error('The file has no usable audio track');
    tracks.addTrack(new AudioTrack({
      id,
      url: URL.createObjectURL(file),
      name: file.name,
      format: file.type,
      duration: clip.meta.duration
    }, startFrame));
  } catch (error) {
    console.error(error);
    ElMessage.error('解析音频失败');
  }
}

const importers: Record<MediaKind, (file: File) => Promise<void>> = {
  video: importVideo,
  image: importImage,
  audio: importAudio
};

/** 按文件类型导入视频、图片或音频，返回实际导入的文件数 */
export async function importMedia(files: Iterable<File>) {
  const supported = Array.from(files).flatMap(file => {
    const kind = mediaKind(file);
    return kind ? [{ file, kind }] : [];
  });
  if (!supported.length) ElMessage.warning('请导入视频、图片或音频文件');
  // 依次导入，保持选择顺序
  await supported.reduce((done, { file, kind }) => done.then(() => importers[kind](file)), Promise.resolve());
  return supported.length;
}
