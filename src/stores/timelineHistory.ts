import { computed, onScopeDispose, ref, shallowReactive, watch } from 'vue';
import type { TrackLineItem } from '@/class/Track';
import { cloneDeepWith, isEqual } from 'lodash-es';

export function cloneTimeline(lines: TrackLineItem[]): TrackLineItem[] {
  return cloneDeepWith(lines, (value, key) => {
    if (key === 'source') return value;
    if (key === 'audio') return null;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && !('type' in value && 'start' in value)) return value;
    }
    return undefined;
  });
}

export function useTimelineHistory(
  lines: TrackLineItem[],
  selection: { line: number, index: number },
  isDragging: () => boolean,
  beforeApply: () => void = () => {},
  limit = 50
) {
  const capture = () => ({ lines: cloneTimeline(lines), selection: { ...selection }});
  type Snapshot = ReturnType<typeof capture>;
  const undoStack = shallowReactive<Snapshot[]>([]);
  const redoStack = shallowReactive<Snapshot[]>([]);
  const pending = ref(false);
  let current = capture();
  let applying = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  function flush() {
    cancel();
    if (!pending.value || isDragging()) return;
    const next = capture();
    if (!isEqual(current.lines, next.lines)) {
      undoStack.push(current);
      if (undoStack.length > limit) undoStack.shift();
      current = next;
      redoStack.length = 0;
    }
    pending.value = false;
  }
  watch(() => cloneTimeline(lines), () => {
    if (applying) return;
    pending.value = true;
    cancel();
    if (!isDragging()) timer = setTimeout(flush, 300);
  }, { flush: 'sync' });
  watch(isDragging, dragging => {
    if (dragging) flush();
    else if (pending.value) flush();
  }, { flush: 'sync' });
  watch(selection, () => {
    if (!pending.value && !applying && !isDragging()) current.selection = { ...selection };
  }, { flush: 'sync' });
  function apply(snapshot: Snapshot) {
    beforeApply();
    applying = true;
    lines.splice(0, lines.length, ...cloneTimeline(snapshot.lines));
    const line = Math.min(snapshot.selection.line, lines.length - 1);
    const index = Math.min(snapshot.selection.index, (lines[line]?.list.length ?? 0) - 1);
    Object.assign(selection, line < 0 || index < 0 ? { line: -1, index: -1 } : { line, index });
    current = capture();
    pending.value = false;
    applying = false;
  }
  function undo() {
    if (isDragging()) return;
    flush();
    const snapshot = undoStack.pop();
    if (!snapshot) return;
    redoStack.push(current);
    apply(snapshot);
  }
  function redo() {
    if (isDragging()) return;
    flush();
    const snapshot = redoStack.pop();
    if (!snapshot) return;
    undoStack.push(current);
    apply(snapshot);
  }
  function resetHistory() {
    cancel();
    undoStack.length = 0;
    redoStack.length = 0;
    current = capture();
    pending.value = false;
  }
  // 撤销/重做记录中的时间轴，清理素材时这些片段引用的素材也要保留
  function historyLines() {
    return [...undoStack, ...redoStack].map(snapshot => snapshot.lines);
  }
  onScopeDispose(cancel);
  return {
    undo, redo, flushHistory: flush, resetHistory, historyLines,
    canUndo: computed(() => pending.value || undoStack.length > 0),
    canRedo: computed(() => !pending.value && redoStack.length > 0)
  };
}
