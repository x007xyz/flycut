import { MP4Clip } from '@webav/av-cliper';
import { expect, it, vi } from 'vitest';
import { VideoTrack } from '@/class/VideoTrack';
import { UnitFrame2μs } from '@/data/trackConfig';
import { videoDecoder } from '@/utils/webcodecs';

vi.mock('@webav/av-cliper', () => ({
  MP4Clip: class {},
  OffscreenSprite: class {
    readonly clip: unknown;
    rect = { x: 0, y: 0, w: 0, h: 0 };
    constructor(clip: unknown) {
      this.clip = clip;
    }
  }
}));
vi.mock('opfs-tools', () => ({}));

it('prepares a tail-trimmed split for export when its end is within the last video frame', async() => {
  const track = new VideoTrack({
    id: 'video', name: 'video.mp4', url: '', format: 'mp4', duration: 6, width: 320, height: 180
  }, 0);
  track.end--;
  track.offsetR++;
  const right = track.split(90);

  const discardedHead = { destroy: vi.fn() };
  const remainder = Object.assign(new MP4Clip(new ReadableStream()), {
    split: vi.fn().mockRejectedValue(new Error('Not found video sample by time')),
    destroy: vi.fn()
  });
  const source = Object.assign(new MP4Clip(new ReadableStream()), {
    split: vi.fn().mockResolvedValue([discardedHead, remainder])
  });
  const decode = vi.spyOn(videoDecoder, 'decode').mockResolvedValue(source);

  try {
    const sprite = await right.combine({ width: 320, height: 180 }, 1);

    expect(source.split).toHaveBeenCalledWith(90 * UnitFrame2μs);
    expect(remainder.split).toHaveBeenCalledWith(89 * UnitFrame2μs);
    expect(discardedHead.destroy).toHaveBeenCalledOnce();
    expect(remainder.destroy).not.toHaveBeenCalled();
    expect(sprite).toHaveProperty('clip', remainder);
    expect(sprite.time).toEqual({ offset: 90 * UnitFrame2μs, duration: 89 * UnitFrame2μs });
  } finally {
    decode.mockRestore();
  }
});
