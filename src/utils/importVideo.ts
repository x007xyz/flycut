import { ElMessage } from 'element-plus';
import { getMD5 } from '@/class/Base';
import { VideoTrack } from '@/class/VideoTrack';
import { usePlayerState } from '@/stores/playerState';
import { useTrackState } from '@/stores/trackState';
import { videoDecoder } from '@/utils/webcodecs';

export async function importVideo(file: File) {
  const player = usePlayerState();
  const tracks = useTrackState();
  const startFrame = player.playStartFrame;
  try {
    const id = await getMD5(await file.arrayBuffer());
    const clip = await videoDecoder.decode({ id, stream: file.stream(), type: file.type });
    if (!clip || !clip.meta.width || !clip.meta.height || !(clip.meta.duration > 0)) {
      throw new Error('The file has no usable video track');
    }

    const track = new VideoTrack({
      id,
      url: URL.createObjectURL(file),
      name: file.name,
      format: file.type || 'video/mp4',
      width: clip.meta.width,
      height: clip.meta.height,
      duration: clip.meta.duration
    }, startFrame);
    track.resize({ width: player.playerWidth, height: player.playerHeight });
    tracks.addTrack(track);
  } catch (error) {
    console.error(error);
    ElMessage.error('解析视频失败，请选择可播放的 MP4 视频');
  }
}
