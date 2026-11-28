import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { usePlayerState } from '@/stores/playerState';
import { useTrackState } from '@/stores/trackState';
import { journalKey, useProjectState } from '@/stores/projectState';
import { useResourceState } from '@/stores/resourceStore';
import { projectStore } from '@/storage/projects';
import { assetIdsOf, captureTimeline, draftKey, encodeDraft, restoreDraft } from '@/utils/editorDraft';

/**
 * 工程自动保存：工程数据压缩后写入 OPFS；同时在 localStorage 保留一份当前工程的快照，
 * 页面关闭时同步写入，防止异步的 OPFS 写入未完成导致最后一次修改丢失。
 */
export function useEditorDraft() {
  const timeline = useTrackState();
  const player = usePlayerState();
  const project = useProjectState();
  const resources = useResourceState();
  const restoring = ref(true);
  const restoreWarning = ref('');
  const saveWarning = ref('');
  const lines = computed(() => captureTimeline(timeline.trackList));
  let saved = '';
  let unrecoveredTimeline: string | undefined;
  let timer: number | undefined;
  let disposed = false;
  let writing: Promise<void> = Promise.resolve();

  function snapshot() {
    return encodeDraft(lines.value, timeline.trackScale, player.playStartFrame);
  }

  function persist(json: string, assets: string[]) {
    const meta = project.current;
    if (!meta) return writing;
    const key = journalKey(meta.id);
    writing = writing.then(async() => {
      try {
        // eslint-disable-next-line require-atomic-updates -- 写入按顺序排队执行
        project.current = await projectStore.save(project.current ?? meta, json, assets);
        if (localStorage.getItem(key) === json) localStorage.removeItem(key);
        saveWarning.value = '';
      } catch (error) {
        console.error(error);
        saveWarning.value = '无法自动保存工程，请检查浏览器的存储空间。';
      }
    });
    return writing;
  }

  function flush() {
    window.clearTimeout(timer);
    if (restoring.value || !project.current) return writing;
    if (unrecoveredTimeline === JSON.stringify(lines.value)) return writing;
    const next = snapshot();
    if (next === saved) return writing;
    saved = next;
    unrecoveredTimeline = undefined;
    try {
      localStorage.setItem(journalKey(project.current.id), next);
    } catch {
      // 快照只是兜底，OPFS 写入成功即可
    }
    return persist(next, assetIdsOf(lines.value));
  }

  function queueSave() {
    if (restoring.value) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, 300);
  }

  watch([lines, () => timeline.trackScale], queueSave);
  watch([() => player.playStartFrame, () => player.isPause], () => {
    if (player.isPause) queueSave();
  });

  const onPageHide = () => {
    flush();
  };

  onMounted(async() => {
    window.addEventListener('pagehide', onPageHide);
    project.setFlush(() => flush());
    navigator.storage?.persist?.().catch(() => false);
    resources.load();
    let migrated: string | null = null;
    let journal: string | null = null;
    try {
      const { meta } = await project.openLast();
      journal = localStorage.getItem(journalKey(meta.id));
      const stored = journal ? null : await projectStore.load(meta.id);
      // 旧版本的草稿存在 localStorage，当前工程还没有内容时迁入，迁移成功后才删除
      migrated = journal || stored ? null : localStorage.getItem(draftKey);
      const json = journal ?? stored ?? migrated;
      if (json) {
        const draft = await restoreDraft(json);
        if (disposed) return;
        timeline.trackList.splice(0, timeline.trackList.length, ...draft.lines);
        timeline.resetHistory();
        timeline.trackScale = Math.max(0, Math.min(100, draft.trackScale));
        player.playStartFrame = Math.max(0, Math.min(timeline.frameCount, draft.playhead));
        if (draft.missingMedia) {
          restoreWarning.value = '草稿中有素材丢失或无法读取，已恢复其余内容。';
        }
      }
    } catch (error) {
      console.error(error);
      restoreWarning.value = '无法读取本地草稿，编辑器仍可使用。';
    } finally {
      if (!disposed) {
        saved = snapshot();
        if (restoreWarning.value) unrecoveredTimeline = JSON.stringify(lines.value);
        restoring.value = false;
        // 快照比 OPFS 中的工程新（上次关闭时异步写入可能未完成），补写一次
        if ((journal || migrated) && !restoreWarning.value) {
          await persist(saved, assetIdsOf(lines.value));
          const key = project.current && journalKey(project.current.id);
          // 写入失败时保留快照和旧草稿
          if (!saveWarning.value && migrated) localStorage.removeItem(draftKey);
          else if (!saveWarning.value && key && localStorage.getItem(key) === journal) localStorage.removeItem(key);
        }
      }
    }
  });

  onBeforeUnmount(() => {
    disposed = true;
    window.removeEventListener('pagehide', onPageHide);
    flush();
  });

  return { restoring, restoreWarning, saveWarning };
}
