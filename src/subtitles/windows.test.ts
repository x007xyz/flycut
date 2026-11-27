import { describe, expect, it } from 'vitest';
import { speechWindows } from './windows';

const rate = 1000;

function audioOf(seconds: number, speech: [number, number][]) {
  const audio = new Float32Array(seconds * rate);
  for (const [start, end] of speech) {
    for (let index = start * rate; index < end * rate; index++) audio[index] = Math.sin(index) * 0.5;
  }
  return audio;
}

describe('speechWindows', () => {
  it('splits at silence and keeps windows under 30 seconds', () => {
    const windows = speechWindows(audioOf(45, [[0, 11], [31, 42]]), rate);
    expect(windows).toHaveLength(2);
    expect(windows[0].start).toBe(0);
    expect(windows[0].end).toBeCloseTo(11.2, 1);
    expect(windows[1].start).toBeCloseTo(30.8, 1);
    expect(windows[1].end).toBeCloseTo(42.2, 1);
  });

  it('groups nearby phrases into one window', () => {
    const windows = speechWindows(audioOf(20, [[1, 4], [6, 9], [12, 15]]), rate);
    expect(windows).toHaveLength(1);
    expect(windows[0].start).toBeCloseTo(0.8, 1);
    expect(windows[0].end).toBeCloseTo(15.2, 1);
  });

  it('cuts continuous speech longer than the window', () => {
    const windows = speechWindows(audioOf(70, [[0, 70]]), rate);
    expect(windows.length).toBeGreaterThan(2);
    windows.forEach(({ start, end }) => expect(end - start).toBeLessThanOrEqual(28));
    expect(windows[windows.length - 1].end).toBe(70);
  });

  it('returns nothing for silence', () => {
    expect(speechWindows(new Float32Array(5 * rate), rate)).toEqual([]);
  });
});
