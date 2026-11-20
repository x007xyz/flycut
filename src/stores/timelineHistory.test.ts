import { describe, it, expect, vi, afterEach } from 'vitest';
import { effectScope, reactive, ref } from 'vue';
import { cloneTimeline, useTimelineHistory } from './timelineHistory';
import type { TrackLineItem } from '@/class/Track';

class Clip {
  id = 'clip';
  type = 'video';
  start = 0;
  end = 90;
  source = { id: 'source' };
  audio = null;
  options = { scale: 100 };
  split() { return this.end; }
}
function setup(limit = 50) {
  vi.useFakeTimers();
  const scope = effectScope();
  const lines = reactive<TrackLineItem[]>([]);
  const selection = reactive({ line: -1, index: -1 });
  const dragging = ref(false);
  const apply = vi.fn();
  const history = scope.run(() => useTimelineHistory(lines, selection, () => dragging.value, apply, limit))!;
  const add = () => lines.push({ type: 'video', main: true, list: [new Clip() as any] });
  return { scope, lines, selection, dragging, apply, history, add };
}
afterEach(() => vi.useRealTimers());

describe('timeline history', () => {
  it('uses a restored timeline as the baseline and cancels pending commits', () => {
    const s = setup();
    s.add();
    s.history.resetHistory();
    vi.advanceTimersByTime(1000);
    expect(s.history.canUndo.value).toBe(false);
    s.lines[0].list[0].end = 45;
    s.history.undo();
    expect(s.lines[0].list[0].end).toBe(90);
    expect(s.history.canRedo.value).toBe(true);
    s.lines.splice(0);
    s.history.resetHistory();
    s.history.undo(); s.history.redo();
    expect(s.lines).toHaveLength(0);
    expect(s.history.canUndo.value).toBe(false);
    expect(s.history.canRedo.value).toBe(false);
    s.scope.stop();
  });
  it('keeps prototypes, source identity and independent plain fields', () => {
    const clip = new Clip();
    const original = [{ type: 'video', main: true, list: [clip] }] as any;
    const copy = cloneTimeline(original);
    expect(copy[0].main).toBe(true);
    expect(copy[0].list[0]).toBeInstanceOf(Clip);
    expect((copy[0].list[0] as any).split()).toBe(90);
    expect(copy[0].list[0].source).toBe(clip.source);
    (copy[0].list[0] as any).options.scale = 20;
    expect(clip.options.scale).toBe(100);
  });
  it('handles empty history, immediate undo and redo without sharing snapshots', () => {
    const s = setup();
    s.history.undo(); s.history.redo();
    expect(s.history.canUndo.value).toBe(false);
    s.add();
    s.history.undo();
    expect(s.lines).toHaveLength(0);
    s.history.redo();
    expect(s.lines).toHaveLength(1);
    s.lines[0].list[0].end = 45;
    s.history.undo();
    expect(s.lines[0].list[0].end).toBe(90);
    expect(s.apply).toHaveBeenCalledTimes(3);
    s.scope.stop();
  });
  it('groups settled attribute edits and clears redo on a new edit', () => {
    const s = setup(); s.add(); s.history.flushHistory();
    s.lines[0].list[0].end = 60;
    vi.advanceTimersByTime(200);
    s.lines[0].list[0].end = 30;
    vi.advanceTimersByTime(300);
    s.history.undo();
    expect(s.lines[0].list[0].end).toBe(90);
    s.lines[0].list[0].end = 70;
    expect(s.history.canRedo.value).toBe(false);
    s.history.redo();
    expect(s.lines[0].list[0].end).toBe(70);
    s.scope.stop();
  });
  it('records a long drag as one step and restores selection after deletion', () => {
    const s = setup(); s.add();
    Object.assign(s.selection, { line: 0, index: 0 });
    s.history.flushHistory();
    s.dragging.value = true;
    Object.assign(s.selection, { line: -1, index: 0 });
    s.lines[0].list[0].start = 10;
    vi.advanceTimersByTime(1000);
    s.lines[0].list[0].start = 20;
    s.dragging.value = false;
    s.history.undo();
    expect(s.lines[0].list[0].start).toBe(0);
    expect(s.selection).toEqual({ line: 0, index: 0 });
    s.lines.splice(0);
    Object.assign(s.selection, { line: -1, index: -1 });
    s.history.undo();
    expect(s.selection).toEqual({ line: 0, index: 0 });
    s.scope.stop();
  });
  it('caps history and ignores no-op edits', () => {
    const s = setup(2); s.add(); s.history.flushHistory();
    for (const end of [80, 70, 60]) {
      s.lines[0].list[0].end = end; s.history.flushHistory();
    }
    s.history.undo(); s.history.undo(); s.history.undo();
    expect(s.lines[0].list[0].end).toBe(80);
    s.scope.stop();
  });
  it('clamps invalid selection and excludes runtime audio from edits', () => {
    const s = setup(); s.add();
    Object.assign(s.selection, { line: 99, index: 99 });
    s.history.flushHistory();
    (s.lines[0].list[0] as any).audio = { pause: vi.fn() };
    s.history.flushHistory();
    s.lines.splice(0);
    s.history.undo();
    expect(s.selection).toEqual({ line: 0, index: 0 });
    expect((s.lines[0].list[0] as any).audio).toBeNull();
    s.history.undo();
    expect(s.lines).toHaveLength(0);
    s.scope.stop();
  });
  it('runs playback cleanup against the old tracks before undo and redo replace them', () => {
    const s = setup(); s.add(); s.history.flushHistory();
    const original = s.lines[0].list[0];
    const pause = vi.fn();
    (original as any).audio = { pause };
    s.apply.mockImplementation(() => {
      s.lines.forEach(({ list }) => list.forEach(track => (track as any).audio?.pause()));
    });
    s.history.undo();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(s.lines).toHaveLength(0);
    s.history.redo();
    const restored = s.lines[0].list[0];
    expect(restored).not.toBe(original);
    (restored as any).audio = { pause };
    s.lines[0].list[0].end = 45;
    s.history.flushHistory();
    s.history.undo();
    expect(pause).toHaveBeenCalledTimes(2);
    (s.lines[0].list[0] as any).audio = { pause };
    s.history.redo();
    expect(pause).toHaveBeenCalledTimes(3);
    s.scope.stop();
  });
});
