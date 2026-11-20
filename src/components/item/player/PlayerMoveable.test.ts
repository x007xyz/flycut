import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import PlayerMoveable from './PlayerMoveable.vue';
import { useTrackState } from '@/stores/trackState';
import { usePlayerState } from '@/stores/playerState';

vi.mock('vue3-moveable', () => ({ default: {
  name: 'Moveable',
  template: '<div />',
  methods: { updateRect: vi.fn() }
}}));

describe('preview transform history', () => {
  it('ends gestures when targets disappear, on release, cancellation and unmount', async() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const tracks = useTrackState();
    const player = usePlayerState();
    tracks.addTrack({ id: 'text', type: 'text', start: 0, end: 90, width: 100, height: 50, scale: 100, centerX: 0, centerY: 0, draw() {}, source: {}} as any);
    tracks.flushHistory();
    const wrapper = mount(PlayerMoveable, { global: { plugins: [pinia] }});
    await nextTick();
    const moveable = wrapper.findComponent({ name: 'Moveable' });
    moveable.vm.$emit('dragStart');
    tracks.selectResource.centerX = 30;
    expect(tracks.historyDragging).toBe(true);
    player.playStartFrame = 100;
    await nextTick();
    expect(tracks.historyDragging).toBe(false);
    tracks.undo();
    expect(tracks.selectResource.centerX).toBe(0);
    player.playStartFrame = 0;
    await nextTick();
    for (const event of ['mouseup', 'pointerup', 'pointercancel', 'touchend']) {
      moveable.vm.$emit('scaleStart');
      expect(tracks.historyDragging).toBe(true);
      document.dispatchEvent(new Event(event));
      expect(tracks.historyDragging).toBe(false);
    }
    moveable.vm.$emit('dragStart');
    wrapper.unmount();
    expect(tracks.historyDragging).toBe(false);
    pinia._s.forEach(item => item.$dispose());
  });

  it('updates the outline after the restored target styles are patched', async() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const tracks = useTrackState();
    tracks.addTrack({ id: 'text', type: 'text', start: 0, end: 90, width: 100, height: 50, scale: 100, centerX: 0, centerY: 0, draw() {}, source: {}} as any);
    tracks.flushHistory();
    const wrapper = mount(PlayerMoveable, { global: { plugins: [pinia] }});
    await nextTick();
    tracks.selectResource.centerX = 30;
    tracks.flushHistory();
    await nextTick();
    await nextTick();
    const moveable = wrapper.findComponent({ name: 'Moveable' });
    const update = vi.spyOn(moveable.vm as any, 'updateRect').mockImplementation(() => {
      expect(wrapper.get('.move-target').attributes('style')).toContain('translate(0px, 0px)');
    });
    tracks.undo();
    await nextTick();
    await nextTick();
    expect(update).toHaveBeenCalled();
    update.mockRestore();
    wrapper.unmount();
    pinia._s.forEach(item => item.$dispose());
  });
});
