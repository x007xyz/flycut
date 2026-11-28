import { describe, expect, it } from 'vitest';
import { serialTask } from '@/utils/serialTask';

describe('serialTask', () => {
  it('finishes slow runs and repaints once with the latest state', async() => {
    let frame = 0;
    const painted: number[] = [];
    let active = 0;
    let maxActive = 0;
    const paint = serialTask(async() => {
      const target = frame;
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => {
        setTimeout(resolve, 20);
      });
      active--;
      painted.push(target);
    });
    // 播放比绘制快：绘制进行中帧号一直前进
    const first = paint();
    for (frame = 1; frame <= 5; frame++) paint();
    frame = 5;
    await first;
    expect(maxActive).toBe(1);
    // 第一帧画完（不会被丢弃），之后只按最新的帧再画一次
    expect(painted).toEqual([0, 5]);
  });

  it('keeps working after a run throws', async() => {
    let fail = true;
    let runs = 0;
    const task = serialTask(async() => {
      runs++;
      if (fail) throw new Error('decode failed');
    });
    await expect(task()).rejects.toThrow('decode failed');
    fail = false;
    await task();
    expect(runs).toBe(2);
  });
});
