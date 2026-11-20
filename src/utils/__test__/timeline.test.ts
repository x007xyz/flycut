import { describe, expect, it } from 'vitest';
import { VideoTrack } from '../../class/VideoTrack';
import { chooseExportFormat } from '../exportFormat';
import { animationIndex, fitOutputSize, getPreviewFrame, getTimelineLayers, getTrackRect, isActiveAt } from '../timelineGeometry';

describe('timeline canvas', () => {
  it('preserves source orientation and fits even dimensions within the export limit', () => {
    expect(fitOutputSize({ width: 640, height: 360 })).toEqual({ width: 640, height: 360 });
    expect(fitOutputSize({ width: 2160, height: 3840 })).toEqual({ width: 1080, height: 1920 });
    expect(fitOutputSize({ width: 641, height: 359 })).toEqual({ width: 642, height: 360 });
  });

  it('renders top tracks last and switches clips at the exact cut frame', () => {
    const left = { start: 0, end: 30 };
    const right = { start: 30, end: 60 };
    const overlay = { start: 20, end: 60 };
    const lines = [{ list: [overlay] }, { list: [left, right] }];
    expect(getTimelineLayers(lines, 29, isActiveAt)).toEqual([left, overlay]);
    expect(getTimelineLayers(lines, 30, isActiveAt)).toEqual([right, overlay]);
    expect(getPreviewFrame(60, 60)).toBe(59);
  });

  it('retains source offsets and canvas position when splitting an already trimmed clip', () => {
    const clip = new VideoTrack({
      id: 'fixture', file: new File([], 'clip.mp4'), format: 'video/mp4',
      name: 'clip', url: 'blob:fixture', duration: 4, width: 640, height: 360
    }, 20);
    Object.assign(clip, { offsetL: 15, offsetR: 25, end: 100, centerX: 5, scale: 80, silent: true });
    const right = clip.split(50);
    const last = right.split(75);
    expect([clip.end, clip.offsetR]).toEqual([50, 75]);
    expect([right.start, right.end, right.offsetL, right.offsetR]).toEqual([50, 75, 45, 50]);
    expect([last.start, last.end, last.offsetL, last.offsetR]).toEqual([75, 100, 70, 25]);
    expect([last.centerX, last.scale, last.silent]).toEqual([5, 80, true]);
    expect(getTrackRect(last, { width: 640, height: 360 })).toEqual({ x: 69, y: 36, width: 512, height: 288 });
  });

  it('holds animated image frames for their own durations and loops at the end', () => {
    const ends = [100_000, 350_000, 400_000];
    expect([0, 99_999, 100_000, 349_999, 350_000, 400_000, 750_000].map(time => animationIndex(ends, time)))
      .toEqual([0, 0, 1, 1, 2, 0, 2]);
  });
});

describe('browser export codec negotiation', () => {
  it('prefers H.264 + AAC for MP4 when both are supported', async() => {
    await expect(chooseExportFormat(true, async codec => codec === 'avc', async codec => codec === 'aac'))
      .resolves.toEqual({ extension: 'mp4', video: 'avc', audio: 'aac' });
  });

  it('keeps audio via Opus when AAC is unavailable', async() => {
    await expect(chooseExportFormat(true, async codec => codec !== 'vp8', async codec => codec === 'opus'))
      .resolves.toEqual({ extension: 'webm', video: 'vp9', audio: 'opus' });
  });

  it('does not require audio support for a silent MP4', async() => {
    const audioSupport = async() => { throw new Error('Unexpected audio probe'); };
    await expect(chooseExportFormat(false, async codec => codec === 'avc', audioSupport))
      .resolves.toEqual({ extension: 'mp4', video: 'avc', audio: undefined });
  });

  it('does not silently drop audio if neither codec is available', async() => {
    await expect(chooseExportFormat(true, async() => true, async() => false)).rejects.toThrow('当前浏览器无法');
  });
});
