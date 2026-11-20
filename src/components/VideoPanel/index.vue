<template>
  <div class="p-4 flex-1 overflow-hidden flex flex-col">
    <div class="bg-zinc-200 h-10 flex items-center justify-center rounded text-sm text-gray-900 cursor-pointer" @click="onUpload">
      <i class="iconfont icon-shangchuan_line mr-2" />
      本地视频
    </div>
  </div>
</template>

<script setup lang="ts">
  import { usePlayerState } from '@/stores/playerState';
  import { useTrackState } from '@/stores/trackState';
  import { ElMessage } from 'element-plus';
  import { selectFile } from '@/utils/file';
  import { getMD5 } from '@/class/Base';
  import { VideoTrack } from '@/class/VideoTrack';
  import { baseFps } from '@/data/trackConfig';
  import { editorScale, fitOutputSize } from '@/utils/timelineGeometry';
  import { openMedia } from '@/utils/timelineVideo';

  const trackStore = useTrackState();
  const playStore = usePlayerState();

  async function onUpload() {
    const [file] = await selectFile({ accept: '.mp4', multiple: false }).catch(() => []);
    if (!file) return;
    const input = openMedia(file);
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video || !await video.canDecode()) throw new Error('不支持该视频的编码格式');
      const [width, height, end, start] = await Promise.all([
        video.getDisplayWidth(), video.getDisplayHeight(), input.computeDuration(), input.getFirstTimestamp()
      ]);
      const frameCount = Math.max(1, Math.round((end - Math.max(0, start)) * baseFps));
      const id = await getMD5(await file.arrayBuffer());
      const videoTrack = new VideoTrack({
        id, file, url: URL.createObjectURL(file),
        name: file.name, format: file.type, width, height, duration: frameCount / baseFps
      }, playStore.playStartFrame);

      if (!trackStore.frameCount) {
        const size = fitOutputSize({ width, height });
        playStore.playerWidth = size.width / editorScale;
        playStore.playerHeight = size.height / editorScale;
      }
      videoTrack.resize({ width: playStore.playerWidth, height: playStore.playerHeight });
      trackStore.addTrack(videoTrack);
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '解析视频失败');
    } finally {
      input.dispose();
    }
  }
</script>

<style scoped>

</style>