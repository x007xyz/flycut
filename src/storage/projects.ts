import { childDirectories, directory, gunzip, gzip, readFile, readJson, removeEntry, writeFile } from './opfs';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // 工程引用的素材 id，清理素材时不必解压工程文件
  assets: string[];
}

const projectFile = 'project.json.gz';
const metaFile = 'meta.json';

function projectDir(id: string, create = true) {
  return directory(['projects', id], create);
}

/** 工程存储：projects/<id>/project.json.gz 为 gzip 压缩的工程数据，meta.json 为名称等元信息 */
export const projectStore = {
  async create(name: string): Promise<ProjectMeta> {
    const now = Date.now();
    const meta = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now, assets: [] };
    await writeFile(await projectDir(meta.id), metaFile, JSON.stringify(meta));
    return meta;
  },

  async meta(id: string) {
    try {
      return await readJson<ProjectMeta>(await projectDir(id, false), metaFile);
    } catch {
      return null;
    }
  },

  async list() {
    const dir = await directory(['projects']);
    const metas = await Promise.all((await childDirectories(dir)).map(id => this.meta(id)));
    return metas.filter((meta): meta is ProjectMeta => meta !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async load(id: string) {
    const file = await readFile(await projectDir(id), projectFile);
    return file ? gunzip(file) : null;
  },

  async save(meta: ProjectMeta, json: string, assets: string[]) {
    const dir = await projectDir(meta.id);
    await writeFile(dir, projectFile, await gzip(json));
    const next = { ...meta, assets, updatedAt: Date.now() };
    await writeFile(dir, metaFile, JSON.stringify(next));
    return next;
  },

  async rename(meta: ProjectMeta, name: string) {
    const next = { ...meta, name };
    await writeFile(await projectDir(meta.id), metaFile, JSON.stringify(next));
    return next;
  },

  async remove(id: string) {
    await removeEntry(await directory(['projects']), id);
  }
};
