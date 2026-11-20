<template>
  <div class="p-4 flex-1 overflow-hidden flex flex-col">
    <div class="bg-zinc-200 h-10 flex items-center justify-center rounded text-sm text-gray-900 cursor-pointer" @click="onUpload">
      <i class="iconfont icon-shangchuan_line mr-2" />
      本地视频
    </div>
  </div>
</template>

<script setup lang="ts">
  import { selectFile } from '@/utils/file';
  import { importVideo } from '@/utils/importVideo';

  async function onUpload() {
    const [file] = await selectFile({ accept: '.mp4', multiple: false }).catch(() => []);
    if (file) await importVideo(file);
  }
</script>

<style scoped>

</style>