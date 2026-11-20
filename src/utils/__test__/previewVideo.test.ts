import { describe, expect, it, vi } from 'vitest';
import { observeVideoFrames, sourceTimeAt, timelineFrameAt } from '../previewVideo';
import { baseFps } from '../../data/trackConfig';

function makeVideo() {
  const video = document.createElement('video');
  const state = { paused: true, readyState: 2, seeking: false, ended: false };
  for (const key of Object.keys(state) as (keyof typeof state)[]) {
    Object.defineProperty(video, key, { get: () => state[key] });
  }
  return { video, state };
}

describe('native video preview timing', () => {
  it('maps trimmed clips between media time and half-open timeline frames', () => {
    const clip = { start: 40, end: 80, offsetL: 12 };
    expect(sourceTimeAt(clip, 40)).toBe(12 / baseFps);
    expect(timelineFrameAt(clip, 23 / baseFps)).toBe(51);
    expect(timelineFrameAt(clip, 0)).toBe(40);
    expect(timelineFrameAt(clip, 52 / baseFps)).toBe(79);
  });

  it('uses presented media time instead of currentTime during playback', () => {
    const { video, state } = makeVideo();
    let callback: Parameters<HTMLVideoElement['requestVideoFrameCallback']>[0] | undefined;
    const request = vi.fn(handler => { callback = handler; return 17; });
    const cancel = vi.fn();
    video.requestVideoFrameCallback = request;
    video.cancelVideoFrameCallback = cancel;
    const draw = vi.fn();
    const dispose = observeVideoFrames(video, draw);
    state.paused = false;
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('play'));
    expect(request).toHaveBeenCalledTimes(1);

    video.currentTime = 2;
    draw.mockClear();
    video.dispatchEvent(new Event('timeupdate'));
    expect(draw).not.toHaveBeenCalled();
    callback?.(10, { mediaTime: 1.75 } as Parameters<NonNullable<typeof callback>>[1]);
    expect(draw).toHaveBeenCalledWith(1.75);
    expect(request).toHaveBeenCalledTimes(2);

    dispose();
    expect(cancel).toHaveBeenCalledWith(17);
    draw.mockClear();
    video.dispatchEvent(new Event('seeked'));
    expect(draw).not.toHaveBeenCalled();
  });

  it('redraws on seeked, uses timeupdate as fallback and drops the video clock at end', () => {
    const { video, state } = makeVideo();
    Object.defineProperty(video, 'requestVideoFrameCallback', { value: undefined });
    const draw = vi.fn();
    const dispose = observeVideoFrames(video, draw);
    state.seeking = true;
    video.currentTime = 1.5;
    video.dispatchEvent(new Event('timeupdate'));
    expect(draw).toHaveBeenLastCalledWith(0);

    state.seeking = false;
    video.dispatchEvent(new Event('seeked'));
    expect(draw).toHaveBeenLastCalledWith(1.5);
    video.currentTime = 2;
    video.dispatchEvent(new Event('timeupdate'));
    expect(draw).toHaveBeenLastCalledWith(2);
    video.dispatchEvent(new Event('ended'));
    expect(draw).toHaveBeenLastCalledWith(null);
    dispose();
  });
});
