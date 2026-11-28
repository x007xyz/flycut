import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { getMD5 } from '@/class/Base';
import { assetStore, type AssetRecord } from './assets';
import { projectStore, type ProjectMeta } from './projects';
import { validateDraft } from '@/utils/editorDraft';

const manifestName = 'flycut.json';
const assetMeta = /^assets\/([a-f0-9]{64})\/meta\.json$/;

/** .flycut 工程包：工程数据加上引用的素材，素材不再压缩 */
export async function packProject(name: string, json: string, assetIds: string[]) {
  const files: Zippable = {
    [manifestName]: strToU8(JSON.stringify({ format: 'flycut-project', version: 1, name })),
    'project.json': strToU8(json)
  };
  for (const id of assetIds) {
    // eslint-disable-next-line no-await-in-loop -- 逐个读取，避免同时占用大量内存
    const [record, file] = await Promise.all([assetStore.meta(id), assetStore.file(id)]);
    if (record) {
      // eslint-disable-next-line no-await-in-loop
      const data = new Uint8Array(await file.arrayBuffer());
      files[`assets/${id}/meta.json`] = strToU8(JSON.stringify(record));
      files[`assets/${id}/data`] = [data, { level: 0 }];
    }
  }
  return new Blob([zipSync(files)], { type: 'application/zip' });
}

export async function unpackProject(file: Blob): Promise<{ meta: ProjectMeta, assets: AssetRecord[] }> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const manifest = entries[manifestName] && JSON.parse(strFromU8(entries[manifestName]));
  if (manifest?.format !== 'flycut-project' || !entries['project.json']) throw new Error('Not a FlyCut project package');
  const json = strFromU8(entries['project.json']);
  validateDraft(json);

  const assets: AssetRecord[] = [];
  for (const [path, bytes] of Object.entries(entries)) {
    const id = assetMeta.exec(path)?.[1];
    const data = id && entries[`assets/${id}/data`];
    if (id && data) {
    const record = JSON.parse(strFromU8(bytes)) as AssetRecord;
    // eslint-disable-next-line no-await-in-loop -- 素材逐个校验写入
    if (record.id !== id || await getMD5(data.slice().buffer) !== id) throw new Error(`Asset ${id} is corrupted`);
    // 素材库已有的素材以库中的元信息为准，不让工程包覆盖
    // eslint-disable-next-line no-await-in-loop
    const existing = await assetStore.meta(id);
    if (existing) assets.push(existing);
    else {
      // eslint-disable-next-line no-await-in-loop
      await assetStore.putData(id, new Blob([data]));
      // 工程包无法证明素材与原文件的对应关系，不保留 sourceHash，免得之后导入本地文件时被替换成包里的素材
      const { sourceHash: _, ...trusted } = record;
      // eslint-disable-next-line no-await-in-loop
      await assetStore.putMeta(trusted);
      assets.push(trusted);
    }
    }
  }

  const created = await projectStore.create(typeof manifest.name === 'string' ? manifest.name : '导入的工程');
  const meta = await projectStore.save(created, json, assets.map(({ id }) => id));
  return { meta, assets };
}
