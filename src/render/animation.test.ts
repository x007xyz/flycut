import { describe, expect, it } from 'vitest';
import { defaultAnimations, motionAt, packAnimations, unpackAnimations, validAnimations, withDefaults } from './animation';

const animations = (patch: Partial<Record<'in' | 'out' | 'loop', Record<string, unknown>>>) => {
  const value = defaultAnimations();
  Object.entries(patch).forEach(([kind, spec]) => Object.assign(value[kind as 'in'], spec));
  return value;
};

describe('motionAt', () => {
  it('returns null without animations', () => {
    expect(motionAt(defaultAnimations(), 1, 5)).toBeNull();
  });

  it('fades and slides in, then rests, then fades out', () => {
    const value = animations({ in: { preset: 'left', duration: 1, ease: 'linear' }, out: { preset: 'fade', duration: 1, ease: 'linear' }});
    expect(motionAt(value, 0, 5)).toMatchObject({ x: -0.3, opacity: 0 });
    expect(motionAt(value, 0.5, 5)?.x).toBeCloseTo(-0.15);
    expect(motionAt(value, 0.5, 5)?.opacity).toBeCloseTo(0.5);
    expect(motionAt(value, 2, 5)).toMatchObject({ x: 0, opacity: 1, scale: 1 });
    expect(motionAt(value, 4.5, 5)?.opacity).toBeCloseTo(0.5);
    expect(motionAt(value, 5, 5)?.opacity).toBeCloseTo(0);
  });

  it('is deterministic regardless of evaluation order', () => {
    const value = animations({ in: { preset: 'pop' }, loop: { preset: 'pulse' }, out: { preset: 'blur' }});
    const times = [0.2, 3.7, 1.1, 4.8, 0.2, 1.1];
    const first = times.map(time => motionAt(value, time, 5));
    const second = [...times].reverse().map(time => motionAt(value, time, 5))
      .reverse();
    expect(second).toEqual(first);
  });

  it('loops between rest and peak', () => {
    const value = animations({ loop: { preset: 'pulse', duration: 1, ease: 'linear' }});
    expect(motionAt(value, 0, 5)?.scale).toBeCloseTo(1);
    expect(motionAt(value, 0.5, 5)?.scale).toBeCloseTo(1.08);
    expect(motionAt(value, 2.25, 5)?.scale).toBeCloseTo(1.04);
  });

  it('shortens entrance and exit that exceed the clip', () => {
    const value = animations({ in: { preset: 'fade', duration: 2, ease: 'linear' }, out: { preset: 'fade', duration: 2, ease: 'linear' }});
    expect(motionAt(value, 0.5, 2)?.opacity).toBeCloseTo(0.5);
    expect(motionAt(value, 1, 2)?.opacity).toBeCloseTo(1);
    expect(motionAt(value, 1.5, 2)?.opacity).toBeCloseTo(0.5);
  });
});

describe('packAnimations', () => {
  it('omits defaults and round-trips', () => {
    const value = animations({ in: { preset: 'fade' }, loop: { preset: 'spin', duration: 2 }, out: { preset: 'pop', ease: 'outBounce' }});
    const packed = packAnimations(value);
    expect(packed).toEqual({ i: ['fade'], l: ['spin', 2], o: ['pop', 0.5, 'outBounce'] });
    expect(withDefaults(unpackAnimations(packed))).toEqual(value);
    expect(validAnimations(unpackAnimations(packed))).toBe(true);
    expect(packAnimations(defaultAnimations())).toBeUndefined();
  });

  it('rejects unknown presets', () => {
    expect(validAnimations({ in: { preset: 'explode', duration: 1, ease: '' }})).toBe(false);
    expect(validAnimations({ in: { preset: 'fade', duration: 0, ease: '' }})).toBe(false);
  });

  it('keeps the loop pose while the exit plays', () => {
    const value = { loop: { preset: 'spin', duration: 4, ease: '' }, out: { preset: 'fade', duration: 1, ease: 'linear' }};
    const motion = motionAt(value, 3.5, 4);
    expect(motion?.rotate).toBeCloseTo(315);
    expect(motion?.opacity).toBeCloseTo(0.5);
  });
});
