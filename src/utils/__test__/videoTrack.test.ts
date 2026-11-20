import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import { VideoTrack } from '@/class/VideoTrack';
import { useTrackState } from '@/stores/trackState';

vi.mock('@webav/av-cliper', () => ({}));
vi.mock('@/utils/webcodecs', () => ({}));

const source = {
  id: 'video',
  name: 'video.mp4',
  url: '',
  format: 'mp4',
  duration: 8,
  width: 640,
  height: 360
};

describe('VideoTrack.split', () => {
  it.each([
    { start: 0, offsetL: 0, offsetR: 0 },
    { start: 30, offsetL: 30, offsetR: 60 }
  ])('preserves timeline duration and source trims ($offsetL, $offsetR)', ({ start, offsetL, offsetR }) => {
    setActivePinia(createPinia());
    const store = useTrackState();
    const left = new VideoTrack(source, start);
    left.offsetL = offsetL;
    left.offsetR = offsetR;
    left.end -= offsetL + offsetR;
    store.addTrack(left);
    store.flushHistory();

    const originalEnd = store.frameCount;
    const cutFrame = start + 120;
    const right = left.split(cutFrame);
    store.addTrack(right, false);

    expect(store.frameCount).toBe(originalEnd);
    expect(left).toMatchObject({ start, end: cutFrame, offsetL, offsetR: offsetR + originalEnd - cutFrame });
    expect(right).toMatchObject({ start: cutFrame, end: originalEnd, offsetL: offsetL + cutFrame - start, offsetR });
    store.undo();
    expect(store.trackList[0].list).toHaveLength(1);
    expect(store.trackList[0].list[0]).toMatchObject({ start, end: originalEnd, offsetL, offsetR });
    expect(store.frameCount).toBe(originalEnd);
    store.redo();
    expect(store.trackList[0].list).toHaveLength(2);
    expect(store.frameCount).toBe(originalEnd);
  });
});
