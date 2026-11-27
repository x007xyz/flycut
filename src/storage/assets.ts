/* global FileSystemDirectoryHandle, FileSystemHandle, BufferSource, CompressionStream, DecompressionStream */
import { childDirectories, directory, flycutRoot, readFile, readJson, removeEntry, writeFile } from './opfs';

export type AssetKind = 'video' | 'image' | 'audio';

export interface AssetRecord {
  id: string;
  kind: AssetKind;
  name: string;
  format: string;
  size: number;
  // seconds, 0 for still images
  duration: number;
  width: number;
  height: number;
  createdAt: number;
}

const dataFile = 'data';
const metaFile = 'meta.json';

function assetDir(id: string, create = true) {
  return directory(['assets', id], create);
}

// 旧版本把素材按哈希直接放在 OPFS 根目录，读到时迁入 assets/
async function migrateLegacy(id: string) {
  const root = await navigator.storage.getDirectory();
  let legacy: File;
  try {
    legacy = await (await root.getFileHandle(id)).getFile();
  } catch {
    return null;
  }
  if (!legacy.size) return null;
  const dir = await assetDir(id);
  await writeFile(dir, dataFile, legacy);
  await root.removeEntry(id).catch(() => {});
  return readFile(dir, dataFile);
}

/** 素材以内容哈希为 id 存储：assets/<id>/data 为原文件，meta.json 为元信息，其余为可重建的缓存 */
export const assetStore = {
  async putData(id: string, data: Blob) {
    const dir = await assetDir(id);
    const existing = await readFile(dir, dataFile);
    if (existing?.size === data.size) return;
    await writeFile(dir, dataFile, data);
  },

  async putMeta(record: AssetRecord) {
    await writeFile(await assetDir(record.id), metaFile, JSON.stringify(record));
  },

  async meta(id: string) {
    try {
      return await readJson<AssetRecord>(await assetDir(id, false), metaFile);
    } catch {
      return null;
    }
  },

  async file(id: string) {
    let file: File | null = null;
    try {
      file = await readFile(await assetDir(id, false), dataFile);
    } catch {
      // 目录不存在时尝试迁移旧数据
    }
    file ??= await migrateLegacy(id);
    if (!file?.size) throw new Error(`Media ${id} is not stored`);
    return file;
  },

  async list() {
    const dir = await directory(['assets']);
    const records = await Promise.all((await childDirectories(dir)).map(id => this.meta(id)));
    return records.filter((record): record is AssetRecord => record !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  async remove(id: string) {
    await removeEntry(await directory(['assets']), id);
  },

  async readCache(id: string, name: string) {
    try {
      return await readFile(await assetDir(id, false), name);
    } catch {
      return null;
    }
  },

  async writeCache(id: string, name: string, data: Blob | BufferSource) {
    await writeFile(await assetDir(id), name, data).catch(error => console.warn('Could not cache', name, error));
  }
};

export async function storageUsage() {
  await flycutRoot();
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

const objectUrls = new Map<string, string>();

/** 同一素材只创建一个 blob URL，供 <audio> 等原生元素播放 */
export async function assetUrl(id: string, format: string) {
  let url = objectUrls.get(id);
  if (!url) {
    const file = await assetStore.file(id);
    url = URL.createObjectURL(file.slice(0, file.size, format));
    objectUrls.set(id, url);
  }
  return url;
}
