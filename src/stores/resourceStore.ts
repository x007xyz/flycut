import { defineStore } from 'pinia';
import { ref } from 'vue';
import { assetStore, storageUsage, type AssetKind, type AssetRecord } from '@/storage/assets';

export interface PendingAsset {
  key: number;
  name: string;
  kind: AssetKind;
  stage: string;
}

/** 素材库：所有工程共用，素材按内容哈希去重 */
export const useResourceState = defineStore('resourceState', () => {
  const assets = ref<AssetRecord[]>([]);
  const posters = ref<Record<string, string>>({});
  const usage = ref({ usage: 0, quota: 0 });
  // 正在导入处理的素材，处理完成后才进入素材列表
  const pending = ref<PendingAsset[]>([]);
  let loading: Promise<void> | undefined;

  async function loadPoster(id: string) {
    if (posters.value[id]) return;
    const poster = await assetStore.readCache(id, 'poster.jpg');
    // eslint-disable-next-line require-atomic-updates -- 同一素材的封面重复写入无害
    if (poster) posters.value[id] = URL.createObjectURL(poster);
  }

  async function refreshUsage() {
    usage.value = await storageUsage().catch(() => usage.value);
  }

  function load() {
    loading ??= (async() => {
      assets.value = await assetStore.list();
      await Promise.all(assets.value.map(({ id }) => loadPoster(id)));
      await refreshUsage();
    })().catch(error => {
      loading = undefined;
      console.error(error);
    });
    return loading;
  }

  function add(record: AssetRecord) {
    assets.value = [record, ...assets.value.filter(({ id }) => id !== record.id)];
    loadPoster(record.id);
    refreshUsage();
  }

  async function remove(ids: string[]) {
    await Promise.all(ids.map(id => assetStore.remove(id)));
    ids.forEach(id => {
      if (posters.value[id]) URL.revokeObjectURL(posters.value[id]);
      delete posters.value[id];
    });
    assets.value = assets.value.filter(({ id }) => !ids.includes(id));
    await refreshUsage();
  }

  return { assets, posters, usage, pending, load, add, remove, refreshUsage, loadPoster };
});
