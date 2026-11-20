import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { usePlayerState } from '@/stores/playerState';
import { useTrackState } from '@/stores/trackState';
import { captureTimeline, draftKey, encodeDraft, restoreDraft } from '@/utils/editorDraft';

export function useEditorDraft() {
  const timeline = useTrackState();
  const player = usePlayerState();
  const restoring = ref(true);
  const restoreWarning = ref('');
  const saveWarning = ref('');
  const lines = computed(() => captureTimeline(timeline.trackList));
  let saved = '';
  let unrecoveredTimeline: string | undefined;
  let timer: number | undefined;
  let disposed = false;

  function snapshot() {
    return encodeDraft(lines.value, timeline.trackScale, player.playStartFrame);
  }

  function flush() {
    window.clearTimeout(timer);
    if (restoring.value) return;
    if (unrecoveredTimeline === JSON.stringify(lines.value)) return;
    const next = snapshot();
    if (next === saved) return;
    try {
      localStorage.setItem(draftKey, next);
      saved = next;
      unrecoveredTimeline = undefined;
      saveWarning.value = '';
    } catch {
      saveWarning.value = '无法自动保存草稿，请检查浏览器的本地存储空间。';
    }
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

  onMounted(async() => {
    window.addEventListener('pagehide', flush);
    try {
      const json = localStorage.getItem(draftKey);
      if (json) {
        const draft = await restoreDraft(json);
        if (disposed) return;
        timeline.trackList.splice(0, timeline.trackList.length, ...draft.lines);
        timeline.trackScale = Math.max(0, Math.min(100, draft.trackScale));
        player.playStartFrame = Math.max(0, Math.min(timeline.frameCount, draft.playhead));
        if (draft.missingMedia) {
          restoreWarning.value = '草稿中有素材丢失或无法读取，已恢复其余内容。';
        }
      }
    } catch {
      restoreWarning.value = '无法读取本地草稿，编辑器仍可使用。';
    } finally {
      if (!disposed) {
        saved = snapshot();
        if (restoreWarning.value) unrecoveredTimeline = JSON.stringify(lines.value);
        restoring.value = false;
      }
    }
  });

  onBeforeUnmount(() => {
    disposed = true;
    window.removeEventListener('pagehide', flush);
    flush();
  });

  return { restoring, restoreWarning, saveWarning };
}
