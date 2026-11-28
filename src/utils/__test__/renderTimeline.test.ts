import { describe, expect, it, vi } from 'vitest';
import { sourceWindow } from '../renderTimeline';

vi.mock('@/utils/webcodecs', () => ({}));

describe('sourceWindow', () => {
  it('maps a trimmed clip to its visible source range and timeline offset', () => {
    expect(sourceWindow({ start: 60, end: 150, offsetL: 30 })).toEqual({ from: 1, to: 4, offset: 2 });
  });

  it('starts at the beginning of an untrimmed clip', () => {
    expect(sourceWindow({ start: 0, end: 45, offsetL: 0 })).toEqual({ from: 0, to: 1.5, offset: 0 });
  });
});
