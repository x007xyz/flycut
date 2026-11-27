import { defineStore } from 'pinia';
import { ref } from 'vue';
import { projectStore, type ProjectMeta } from '@/storage/projects';

export const currentProjectKey = 'flycut.currentProject';
export const journalKey = (id: string) => `flycut.projectJournal.${id}`;
export const defaultProjectName = '未命名工程';

export const useProjectState = defineStore('projectState', () => {
  const current = ref<ProjectMeta | null>(null);
  const projects = ref<ProjectMeta[]>([]);
  // 由自动保存注册，切换工程前先把当前工程写入 OPFS
  let flush: () => Promise<void> = async() => {};

  function setFlush(handler: () => Promise<void>) {
    flush = handler;
  }

  async function refresh() {
    projects.value = await projectStore.list();
  }

  /** 打开上次使用的工程，没有时打开最近修改的工程或新建一个 */
  async function openLast() {
    const last = localStorage.getItem(currentProjectKey);
    let meta = last ? await projectStore.meta(last) : null;
    let created = false;
    if (!meta) {
      [meta] = await projectStore.list();
      if (!meta) {
        meta = await projectStore.create(defaultProjectName);
        created = true;
      }
    }
    localStorage.setItem(currentProjectKey, meta.id);
    current.value = meta;
    await refresh();
    return { meta, created };
  }

  async function switchTo(id: string) {
    await flush();
    localStorage.setItem(currentProjectKey, id);
    window.location.reload();
  }

  async function create(name = defaultProjectName) {
    const meta = await projectStore.create(name);
    await switchTo(meta.id);
  }

  async function rename(name: string) {
    if (!current.value) return;
    // eslint-disable-next-line require-atomic-updates -- 重命名基于最新的工程信息
    current.value = await projectStore.rename(current.value, name);
    await refresh();
  }

  async function removeCurrent() {
    const meta = current.value;
    if (!meta) return;
    flush = async() => {};
    await projectStore.remove(meta.id);
    localStorage.removeItem(journalKey(meta.id));
    localStorage.removeItem(currentProjectKey);
    window.location.reload();
  }

  return { current, projects, setFlush, refresh, openLast, switchTo, create, rename, removeCurrent };
});
