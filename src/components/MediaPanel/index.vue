<template>
  <div class="p-4 flex-1 overflow-hidden flex flex-col">
    <div class="bg-zinc-200 h-10 flex items-center justify-center rounded text-sm text-gray-900 cursor-pointer" @click="onUpload">
      <i class="iconfont icon-shangchuan_line mr-2" />
      导入资源
    </div>
    <p class="mt-3 text-xs text-gray-500 select-none">支持 MP4 视频、图片和音频。导入后在列表中点 + 、双击或拖到时间轴使用</p>
    <div class="mt-3 flex-1 overflow-y-auto grid grid-cols-2 gap-2 content-start">
      <div
        v-for="item in resources.pending"
        :key="`pending-${item.key}`"
        class="media-loading relative rounded overflow-hidden dark:bg-zinc-700 bg-zinc-100"
        :title="item.name"
      >
        <div class="h-20 flex flex-col items-center justify-center bg-black/40 text-xs text-gray-300">
          <ElIcon class="is-loading text-xl mb-1"><Loading /></ElIcon>
          <span class="media-stage">{{ item.stage }}</span>
        </div>
        <div class="px-2 py-1 text-xs truncate">{{ item.name }}</div>
      </div>
      <div
        v-for="asset in resources.assets"
        :key="asset.id"
        class="media-card group relative rounded overflow-hidden cursor-pointer dark:bg-zinc-700 bg-zinc-100"
        :data-kind="asset.kind"
        :title="asset.name"
        draggable="true"
        @dragstart="onDragStart($event, asset.id)"
        @dblclick="insertAsset(asset)"
      >
        <div class="h-20 flex items-center justify-center bg-black/40">
          <img v-if="resources.posters[asset.id]" :src="resources.posters[asset.id]" class="h-full w-full object-cover" alt="">
          <i v-else class="iconfont text-2xl text-gray-400" :class="icons[asset.kind]" />
        </div>
        <span v-if="asset.duration" class="absolute right-1 top-14 text-xs px-1 rounded bg-black/60 text-white">{{ formatDuration(asset.duration) }}</span>
        <div class="px-2 py-1 text-xs truncate">{{ asset.name }}</div>
        <div class="absolute top-1 right-1 hidden group-hover:flex gap-1">
          <button class="media-add w-6 h-6 rounded bg-black/60 text-white" title="添加到时间轴" @click.stop="insertAsset(asset)">+</button>
          <button class="media-remove w-6 h-6 rounded bg-black/60 text-white" title="删除素材" @click.stop="onRemove(asset)">×</button>
        </div>
      </div>
    </div>
    <div class="pt-3 flex items-center justify-between text-xs text-gray-500">
      <span class="storage-usage">已用 {{ formatSize(resources.usage.usage) }}</span>
      <span class="cursor-pointer hover:text-gray-300" @click="onCleanup">清理未使用素材</span>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ElIcon, ElMessage, ElMessageBox } from 'element-plus';
  import { Loading } from '@element-plus/icons-vue';
  import { selectFile } from '@/utils/file';
  import { assetDragType, importMedia, insertAsset, mediaAccept } from '@/utils/importMedia';
  import { useResourceState } from '@/stores/resourceStore';
  import { useProjectState } from '@/stores/projectState';
  import { useTrackState } from '@/stores/trackState';
  import type { AssetKind, AssetRecord } from '@/storage/assets';

  const resources = useResourceState();
  const project = useProjectState();
  const tracks = useTrackState();
  const icons: Record<AssetKind, string> = { video: 'icon-shipin_line', image: 'icon-tupian_line', audio: 'icon-yinle_line' };

  function formatDuration(seconds: number) {
    const total = Math.round(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function formatSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async function onUpload() {
    const files = await selectFile({ accept: mediaAccept, multiple: true }).catch(() => []);
    if (files.length) await importMedia(files);
  }

  function onDragStart(event: DragEvent, id: string) {
    event.dataTransfer?.setData(assetDragType, id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }

  // 当前工程以时间轴为准，其他工程读 meta.json 里记录的素材
  async function usedAssets() {
    await project.refresh();
    const used = new Set(project.projects.filter(({ id }) => id !== project.current?.id).flatMap(({ assets }) => assets));
    tracks.trackList.forEach(({ list }) => list.forEach(track => {
      if (track.type !== 'text') used.add((track as { source: { id: string }}).source.id);
    }));
    return used;
  }

  async function confirm(message: string) {
    return ElMessageBox.confirm(message, '提示', { confirmButtonText: '删除', cancelButtonText: '取消' }).then(() => true, () => false);
  }

  async function onRemove(asset: AssetRecord) {
    if ((await usedAssets()).has(asset.id)) {
      ElMessage.warning('素材正在被工程使用，无法删除');
      return;
    }
    if (await confirm(`删除素材“${asset.name}”？`)) await resources.remove([asset.id]);
  }

  async function onCleanup() {
    const used = await usedAssets();
    const unused = resources.assets.filter(({ id }) => !used.has(id)).map(({ id }) => id);
    if (!unused.length) {
      ElMessage.info('没有未使用的素材');
      return;
    }
    if (await confirm(`删除 ${unused.length} 个没有被任何工程使用的素材？`)) {
      await resources.remove(unused);
      ElMessage.success('已清理未使用素材');
    }
  }
</script>
