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

  async function read(frame: number) {
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
  }

  return { read, close: async() => { await current.frames?.return(); } };
}

export function createVideoReader() {
  const readers = new Map<string, { input: Input; decoder: ReturnType<typeof createReader> }>();
  return {
    async read(track: VideoTrack, frame: number) {
      let reader = readers.get(track.id);
      if (!reader) {
        const input = openMedia(track.source.file);
        reader = { input, decoder: createReader(track, input) };
        readers.set(track.id, reader);
      }
      return (await reader.decoder).read(frame);
    },
    async dispose() {
      const closing = [...readers.values()].map(async({ input, decoder }) => {
        try {
          await (await decoder).close();
        } finally {
          input.dispose();
        }
      });
      readers.clear();
      await Promise.allSettled(closing);
    }
  };
}

async function decodeThumbnails(file: File) {
  const input = openMedia(file);
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) return [];
    const [start, end] = await Promise.all([video.getFirstTimestamp(), video.computeDuration()]);
    const duration = Math.max(0, end - start);
    const count = Math.min(60, Math.max(1, Math.ceil(duration)));
    const times = Array.from({ length: count }, (_, index) => start + duration * index / count);
    const sink = new CanvasSink(video, { width: 50, height: 50, fit: 'contain', poolSize: 1 });
    const result: Blob[] = [];
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (frame?.canvas instanceof HTMLCanvasElement) {
        const { canvas } = frame;
        // eslint-disable-next-line no-await-in-loop -- the next thumbnail reuses the same canvas
        const blob = await new Promise<Blob | null>(resolve => { canvas.toBlob(resolve); });
        if (blob) result.push(blob);
      }
    }
    return result;
  } finally {
    input.dispose();
  }
}

const thumbnailsByFile = new WeakMap<File, Promise<Blob[]>>();

export function readVideoThumbnails(file: File) {
  const cached = thumbnailsByFile.get(file);
  if (cached) return cached;
  const result = decodeThumbnails(file).catch(error => {
    thumbnailsByFile.delete(file);
    throw error;
  });
  thumbnailsByFile.set(file, result);
  return result;
}
