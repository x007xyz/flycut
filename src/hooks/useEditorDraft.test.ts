import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useEditorDraft } from './useEditorDraft';
import { useTrackState } from '@/stores/trackState';
import { restoreDraft, draftKey } from '@/utils/editorDraft';

vi.mock('@/utils/editorDraft', () => ({
  draftKey: 'flycut.editorDraft',
  captureTimeline: (lines: unknown) => lines,
  encodeDraft: (lines: unknown) => JSON.stringify(lines),
  restoreDraft: vi.fn()
}));

describe('draft history baseline', () => {
  it.each([false, true])('starts restored drafts without undo entries (missing media: %s)', async missingMedia => {
    const pinia = createPinia();
    setActivePinia(pinia);
    localStorage.setItem(draftKey, 'draft');
    vi.mocked(restoreDraft).mockResolvedValue({
      lines: [{ type: 'text', list: [{ id: 'text', type: 'text', start: 0, end: 90, content: 'restored' } as any] }],
      trackScale: 60, playhead: 0, missingMedia
    });
    const store = useTrackState();
    const wrapper = mount({ setup: useEditorDraft, template: '<div />' }, { global: { plugins: [pinia] }});
    await flushPromises();
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    store.selectTrackById('text');
    store.selectResource.content = 'edited';
    store.undo();
    expect(store.selectResource.content).toBe('restored');
    expect(store.canUndo).toBe(false);
    wrapper.unmount();
    pinia._s.forEach(item => item.$dispose());
    localStorage.removeItem(draftKey);
  });
});
