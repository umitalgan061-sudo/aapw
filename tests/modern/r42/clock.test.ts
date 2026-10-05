import { describe, expect, it } from 'vitest';
import { DeterministicClockR42 } from '../../../src/3d/strict/r42/clock.ts';

describe('R42 clock', () => {
  it('accumulates partial frames and advances fixed ticks', () => {
    const clock = new DeterministicClockR42({ fixedStepSeconds: 0.1, maxCatchUpSteps: 4 });
    const ticks: number[] = [];
    const first = clock.advance(0.05, tick => ticks.push(tick));
    expect(first.steps).toBe(0);
    expect(clock.alpha).toBeCloseTo(0.5);
    const second = clock.advance(0.25, tick => ticks.push(tick));
    expect(second.steps).toBe(3);
    expect(ticks).toEqual([1, 2, 3]);
    expect(clock.tick).toBe(3);
  });

  it('bounds catch-up work and records dropped steps', () => {
    const clock = new DeterministicClockR42({ fixedStepSeconds: 0.1, maxCatchUpSteps: 2 });
    const result = clock.advance(1, () => undefined);
    expect(result.steps).toBe(2);
    expect(result.droppedSteps).toBeGreaterThan(0);
    expect(clock.snapshot().droppedSteps).toBe(result.droppedSteps);
  });

  it('supports pause, scale and restore', () => {
    const clock = new DeterministicClockR42({ fixedStepSeconds: 0.1 });
    clock.setTimeScale(2);
    clock.setPaused(true);
    expect(clock.advance(1, () => undefined).steps).toBe(0);
    clock.setPaused(false);
    clock.advance(0.1, () => undefined);
    const snapshot = clock.snapshot();
    const restored = new DeterministicClockR42({ fixedStepSeconds: 0.1 });
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
  });
});
