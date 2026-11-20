import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { WrappedCanvas } from 'mediabunny';
import type { VideoTrack } from '@/class/VideoTrack';
import { baseFps } from '@/data/trackConfig';

export function openMedia(file: File) {
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

async function createReader(track: VideoTrack, input: Input) {
  const video = await input.getPrimaryVideoTrack();
  if (!video || !await video.canDecode()) {
    throw new Error(`无法解码视频：${track.name}`);
  }
  const sink = new CanvasSink(video, { poolSize: 2 });
  const zero = Math.max(0, await input.getFirstTimestamp());
  let current = { frames: undefined as AsyncGenerator<WrappedCanvas | null, void, unknown> | undefined, nextFrame: Infinity, image: null as HTMLCanvasElement | null, timing: '' };

  function *timestamps(from: number, end: number, start: number, offset: number) {
    for (let frame = from; frame < end; frame++) {
      yield zero + (frame - start + offset) / baseFps;
    }
  }

  return async(frame: number) => {
    const timing = `${track.start}:${track.end}:${track.offsetL}`;
    if (timing === current.timing && frame === current.nextFrame - 1) return current.image;
    let { frames } = current;
    if (!frames || timing !== current.timing || frame < current.nextFrame || frame > current.nextFrame + 6) {
      const previous = frames;
      frames = sink.canvasesAtTimestamps(timestamps(frame, track.end, track.start, track.offsetL));
      current = { frames, nextFrame: frame, image: null, timing };
      await previous?.return();
    }
    while (current.nextFrame <= frame) {
      // eslint-disable-next-line no-await-in-loop -- consume decoded frames in timestamp order
      const { value } = await frames.next();
      // eslint-disable-next-line require-atomic-updates -- each renderer reads sequentially
      current.image = value?.canvas instanceof HTMLCanvasElement ? value.canvas : null;
      current.nextFrame++;
    }
    return current.image;
  };
}

export function createVideoReader() {
  const readers = new Map<string, { input: Input; read: ReturnType<typeof createReader> }>();
  return {
    async read(track: VideoTrack, frame: number) {
      let reader = readers.get(track.id);
      if (!reader) {
        const input = openMedia(track.source.file);
        reader = { input, read: createReader(track, input) };
        readers.set(track.id, reader);
      }
      return (await reader.read)(frame);
    },
    retain(trackIds: Set<string>) {
      for (const [id, reader] of readers) {
        if (!trackIds.has(id)) {
          reader.input.dispose();
          readers.delete(id);
        }
      }
    },
    dispose() {
      for (const { input } of readers.values()) input.dispose();
      readers.clear();
    }
  };
}
