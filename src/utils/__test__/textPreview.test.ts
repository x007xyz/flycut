import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, reactive, toRaw } from 'vue';
import { set } from 'lodash-es';
import { TextTrack } from '@/class/TextTrack';
import { Options } from '@/data/options/text';
import { CanvasPlayer } from '@/components/item/player/canvasDraw';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useTrackState } from '@/stores/trackState';
import FormItem from '@/components/item/formItem/FormItem.vue';

vi.mock('@webav/av-cliper', () => ({ ImgClip: vi.fn(), OffscreenSprite: vi.fn() }));
vi.mock('element-plus/es/components/switch/style/css', () => ({}));
vi.mock('element-plus/es/components/input/style/css', () => ({}));
vi.mock('element-plus/es/components/input-number/style/css', () => ({}));
vi.mock('element-plus/es/components/slider/style/css', () => ({}));
vi.mock('element-plus/es/components/tabs/style/css', () => ({}));
vi.mock('element-plus/es/components/tab-pane/style/css', () => ({}));
vi.mock('element-plus/es/components/collapse/style/css', () => ({}));
vi.mock('element-plus/es/components/collapse-item/style/css', () => ({}));
vi.mock('element-plus/es/components/radio/style/css', () => ({}));
vi.mock('element-plus/es/components/radio-button/style/css', () => ({}));
vi.mock('element-plus/es/components/radio-group/style/css', () => ({}));
vi.mock('@/components/item/formItem/color/ColorPicker.vue', () => ({ default: { template: '<div />' }}));
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
  it.each([
    ['TextArea', 'content', 'old', 'Hello FlyCut fix'],
    ['TextArea', 'content', 'old', ''],
    ['Number', 'fontSize', 24, 25],
    ['Number', 'centerX', 0, 1],
    ['Number', 'centerY', 0, -1],
    ['Slider', 'scale', 100, 101],
    ['Color', 'style.fill', '#ffffff', '#ff0000']
  ])('keeps %s field %s reactive through the form', async(dataType, mappingKey, initial, edited) => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useTrackState();
    const item: Record<string, any> = { id: 'text', type: 'text' };
    set(item, mappingKey, initial);
    store.trackList.push({ type: 'text', list: [item as TextTrack] });
    store.selectTrackItem.line = 0;
    store.selectTrackItem.index = 0;
    const stub = {
      props: ['modelValue'],
      emits: ['update:modelValue', 'input'],
      template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
    };
    const wrapper = mount(FormItem, {
      props: { componentData: { dataType, mappingKey, attr: { max: 200 }}},
      global: { plugins: [pinia], stubs: { ElInput: stub, ElInputNumber: stub, ElSlider: stub, ColorPicker: stub }}
    });
    try {
      const input = wrapper.find('input');
      expect(input.element.value).toBe(String(initial));
      if (dataType === 'TextArea') {
        await input.setValue('');
        await [...String(edited)].reduce(async(previous, letter) => {
          await previous;
          await input.setValue(input.element.value + letter);
        }, Promise.resolve());
      } else {
        wrapper.findComponent(stub).vm.$emit(dataType === 'Slider' ? 'input' : 'update:modelValue', edited);
        await nextTick();
      }
      expect(input.element.value).toBe(String(edited));
      expect(mappingKey.split('.').reduce((value, key) => value[key], store.selectResource as any)).toBe(edited);
    } finally {
      wrapper.unmount();
    }
  });

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
