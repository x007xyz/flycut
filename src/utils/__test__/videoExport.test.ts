import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveRenderedVideo } from '../videoExport';

function readable(bytes: number[] = []) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.length) controller.enqueue(Uint8Array.from(bytes));
      controller.close();
    }
  });
}

describe('saveRenderedVideo', () => {
  let stagedBytes: number[];
  const removeEntry = vi.fn(async(_name: string) => {});
  const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');

  beforeEach(() => {
    stagedBytes = [];
    removeEntry.mockClear();
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: async() => ({
          getFileHandle: async() => ({
            createWritable: async() => new WritableStream<Uint8Array>({
              write(chunk) {
                stagedBytes.push(...chunk);
              }
            }),
            getFile: async() => ({
              size: stagedBytes.length,
              stream: () => readable(stagedBytes)
            })
          }),
          removeEntry
        })
      }
    });
  });

  afterEach(() => {
    if (storageDescriptor) Object.defineProperty(navigator, 'storage', storageDescriptor);
    else Reflect.deleteProperty(navigator, 'storage');
  });

  it('never opens a destination when the encoder fails after emitting bytes', async() => {
    const chooseDestination = vi.fn();
    const render = () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1));
      },
      pull(controller) {
        controller.error(new Error('Encoder failed'));
      }
    }, { highWaterMark: 0 });

    await expect(saveRenderedVideo(render, chooseDestination)).rejects.toThrow('Encoder failed');
    expect(chooseDestination).not.toHaveBeenCalled();
    expect(removeEntry).toHaveBeenCalledOnce();
  });

  it('rejects an empty render without creating a destination', async() => {
    const chooseDestination = vi.fn();
    await expect(saveRenderedVideo(() => readable(), chooseDestination)).rejects.toThrow('no data');
    expect(chooseDestination).not.toHaveBeenCalled();
    expect(removeEntry).toHaveBeenCalledOnce();
  });

  it('cleans up after a canceled save and can retry', async() => {
    const render = () => readable([1, 2, 3]);
    await expect(saveRenderedVideo(render, async() => undefined)).resolves.toBe(false);
    expect(removeEntry).toHaveBeenCalledOnce();

    stagedBytes = [];
    const savedBytes: number[] = [];
    await expect(saveRenderedVideo(render, async() => new WritableStream<Uint8Array>({
      write(chunk) {
        savedBytes.push(...chunk);
      }
    }))).resolves.toBe(true);
    expect(savedBytes).toEqual([1, 2, 3]);
    expect(removeEntry).toHaveBeenCalledTimes(2);
  });
});
