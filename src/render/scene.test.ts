import { describe, expect, it, vi } from 'vitest';
import { TextTrack } from '@/class/TextTrack';
import { VideoTrack } from '@/class/VideoTrack';
import { buildScene, frameKey } from './scene';

vi.mock('@/utils/common', () => ({ getTextRect: () => ({ width: 40, height: 20 }) }));

const size = { width: 180, height: 320 };
const video = () => new VideoTrack({ id: 'v', url: '', name: 'v.mp4', format: 'video/mp4', duration: 2, width: 180, height: 320 }, 0);
const text = () => new TextTrack({ content: 'hi', fill: '#fff', fontSize: 24, fontFamily: 'Arial', name: 'Text' }, 0);

describe('buildScene', () => {
  it('stacks earlier timeline lines on top', () => {
    const scene = buildScene([text(), video()], 10, size);
    expect(scene.layers.map(layer => layer.kind)).toEqual(['video', 'text']);
  });

  it('maps the frame to trimmed source time', () => {
    const track = video();
    track.start = 30;
    track.offsetL = 15;
    track.end = 60;
    const [layer] = buildScene([track], 45, size).layers;
    expect(layer).toMatchObject({ kind: 'video', time: 1 });
  });

  it('only keeps the end frame for preview', () => {
    const track = video();
    expect(buildScene([track], track.end, size).layers).toHaveLength(0);
    expect(buildScene([track], track.end, size, { includeEnd: true }).layers).toHaveLength(1);
  });

  it('changes the frame key only when the picture changes', () => {
    const track = text();
    expect(frameKey(buildScene([track], 1, size))).toBe(frameKey(buildScene([track], 2, size)));
    expect(frameKey(buildScene([video()], 1, size))).not.toBe(frameKey(buildScene([video()], 2, size)));
  });
});
