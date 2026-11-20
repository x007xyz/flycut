import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import FormItem from './FormItem.vue';
import { useTrackState } from '@/stores/trackState';

vi.mock('./color/ColorPicker.vue', () => ({ default: { template: '<div />' }}));
vi.mock('element-plus/es/components/tabs/style/css', () => ({}));
vi.mock('element-plus/es/components/tab-pane/style/css', () => ({}));
vi.mock('element-plus/es/components/collapse/style/css', () => ({}));
vi.mock('element-plus/es/components/collapse-item/style/css', () => ({}));
vi.mock('element-plus/es/components/radio/style/css', () => ({}));
vi.mock('element-plus/es/components/radio-button/style/css', () => ({}));
vi.mock('element-plus/es/components/radio-group/style/css', () => ({}));
vi.mock('element-plus/es/components/slider/style/css', () => ({}));
vi.mock('element-plus/es/components/input/style/css', () => ({}));
vi.mock('element-plus/es/components/input-number/style/css', () => ({}));
vi.mock('element-plus/es/components/switch/style/css', () => ({}));

describe('selected track attribute values', () => {
  it('refreshes edited values after undo and redo replace a track at the same selection', async() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useTrackState();
    store.addTrack({ id: 'text', type: 'text', start: 0, end: 90, fontSize: 24, source: {}} as any);
    store.flushHistory();
    const wrapper = mount(FormItem, {
      props: { componentData: { dataType: 'Number', mappingKey: 'fontSize' }},
      global: {
        plugins: [pinia],
        stubs: {
          ElInputNumber: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />'
          }
        }
      }
    });
    expect(wrapper.get('input').element.value).toBe('24');
    await wrapper.get('input').setValue('48');
    expect((store.selectResource as any).fontSize).toBe(48);
    store.flushHistory();
    const edited = store.selectResource;
    store.undo();
    await nextTick();
    expect(store.selectResource).not.toBe(edited);
    expect(store.selectTrackItem).toEqual({ line: 0, index: 0 });
    expect(wrapper.get('input').element.value).toBe('24');
    store.redo();
    await nextTick();
    expect(wrapper.get('input').element.value).toBe('48');
    store.removeTrack(0, 0);
    await nextTick();
    expect(wrapper.get('input').element.value).toBe('');
    wrapper.unmount();
    pinia._s.forEach(item => item.$dispose());
  });
});
