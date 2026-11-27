<template>
  <div class="p-4 flex-1 overflow-hidden flex flex-col">
    <div class="bg-zinc-200 h-10 flex items-center justify-center rounded text-sm text-gray-900 cursor-pointer" @click="onUpload">
      <i class="iconfont icon-shangchuan_line mr-2" />
      导入资源
    </div>
    <p class="mt-3 text-xs text-gray-500 select-none">支持 MP4 视频、图片和音频，也可以直接拖到时间轴</p>
  </div>
</template>

<script setup lang="ts">
  import { selectFile } from '@/utils/file';
  import { importMedia, mediaAccept } from '@/utils/importMedia';

  async function onUpload() {
    const files = await selectFile({ accept: mediaAccept, multiple: true }).catch(() => []);
    if (files.length) await importMedia(files);
  }
</script>
