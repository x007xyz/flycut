<template>
  <div class="p-4 flex-1 overflow-hidden flex flex-col">
    <div class="bg-zinc-200 h-10 flex items-center justify-center rounded text-sm text-gray-900 cursor-pointer" @click="onUpload">
      <i class="iconfont icon-shangchuan_line mr-2" />
      本地图片
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useTrackState } from '@/stores/trackState';
  import { usePlayerState } from '@/stores/playerState';
  import { ElMessage } from 'element-plus';
  import { imageDecoder } from '@/utils/webcodecs';
  import { selectFile } from '@/utils/file';
  import { getMD5 } from '@/class/Base';
  import type { ImageSource } from '@/class/ImageTrack';
  import { ImageTrack } from '@/class/ImageTrack';

  const trackStore = useTrackState();
  const playStore = usePlayerState();

  async function onUpload() {
    // 需要将获取图片文件转换为ImageTractItem
    // 必须：图片的format、height、width、sourceFrame
    // 非必须：cover信息（如果是gif图片）
    const [file] = await selectFile({ accept: 'image/*', multiple: false }).catch(() => []);
    if (!file) return;

    try {
      const id = await getMD5(await file.arrayBuffer());
      const clip = await imageDecoder.decode({ id, stream: file.stream(), type: file.type });
      const imageSource: ImageSource = {
        id,
        url: id,
        name: file.name,
        format: file.type,
        width: clip.meta.width,
        height: clip.meta.height
      };
      const imageTrack = new ImageTrack(imageSource, playStore.playStartFrame);
      imageTrack.resize({ width: playStore.playerWidth, height: playStore.playerHeight });
      trackStore.addTrack(imageTrack);
    } catch (error) {
      console.error(error);
      ElMessage.error('解析图片失败');
    }
  }
</script>

<style scoped>

</style>