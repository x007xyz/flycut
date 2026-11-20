import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, reactive, toRaw } from 'vue';
import { set } from 'lodash-es';
import { TextTrack } from '@/class/TextTrack';
import { Options } from '@/data/options/text';
import { CanvasPlayer } from '@/components/item/player/canvasDraw';

vi.mock('@webav/av-cliper', () => ({ ImgClip: vi.fn(), OffscreenSprite: vi.fn() }));
vi.mock('@/utils/formItemUtils', () => ({
  mappingFormItem: (dataType: string, options: Record<string, any>) => ({ dataType, ...options })
}));

function findContentKey(items: Record<string, any>[]): string {
  for (const item of items) {
    if (item.name === '内容') return item.mappingKey;
    const key = findContentKey(item.children || []);
    if (key) return key;
  }
  return '';
}

const canvasDescriptor = Object.getOwnPropertyDescriptor(window, 'OffscreenCanvas');
afterEach(() => {
  if (canvasDescriptor) Object.defineProperty(window, 'OffscreenCanvas', canvasDescriptor);
  else Reflect.deleteProperty(window, 'OffscreenCanvas');
});

describe('text attribute preview', () => {
  it.each(['new', '', 'new\nline'])('redraws content edits (%j) even when the width is unchanged', async content => {
    const ctx = {
      measureText: (text: string) => ({ width: text.length * 10 }),
      fillText: vi.fn()
    };
    vi.stubGlobal('OffscreenCanvas', class {
      getContext() { return ctx; }
    });
    const track = new TextTrack({ content: 'old', fill: '#fff', fontSize: 24, fontFamily: 'Arial', name: 'Text' }, 0);
    const scope = effectScope();
    const player = Object.create(CanvasPlayer.prototype) as CanvasPlayer;
    player.trackState = reactive({ trackList: [{ type: 'text', list: [track] }] });
    player.playerStore = reactive({ playStartFrame: 0 });
    const draw = vi.spyOn(player, 'drawCanvas').mockImplementation(async() => {
      const current = toRaw(player.trackState.trackList[0].list[0]) as TextTrack;
      await current.draw(ctx as unknown as OffscreenCanvasRenderingContext2D, { width: 320, height: 180 }, 0);
    });
    scope.run(() => player.initWatch());
    try {
      const key = findContentKey(Options.attributes);
      expect(key).toBe('content');
      // Use the same reactive assignment as the attribute form.
      set(player.trackState.trackList[0].list[0], key, content);
      await nextTick();
      expect(draw).toHaveBeenCalledOnce();
      expect(ctx.fillText.mock.calls.map(call => call[0])).toEqual(content.split('\n'));
      expect(track.width).toBe(Math.max(...content.split('\n').map(line => line.length * 10)) + 8);
      expect(track.height).toBe(content.split('\n').length * 24 * 1.2 + 8);
    } finally {
      scope.stop();
    }
  });

  it('reports an unavailable drawing context', () => {
    vi.stubGlobal('OffscreenCanvas', class {
      getContext() { return null; }
    });
    expect(() => new TextTrack({ content: 'text', fill: '#fff', fontSize: 24, fontFamily: 'Arial', name: 'Text' }, 0))
      .toThrow('Canvas 2D context is not supported');
  });
});
