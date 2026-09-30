import { describe, expect, it } from 'vitest';
import {
  FixedStepClock,
  SimulationAccumulator,
  frameBudgetExceeded,
  interpolationAlpha,
  runDeterministicTicks,
  tickValue,
} from '../../../src/3d/modern/nextgen/index.ts';

describe('modern nextgen fixed-step simulation', () => {
  it('runs an exact number of deterministic ticks', () => {
    const seen: number[] = [];
    const result = runDeterministicTicks(120, { tickRate: 60, maxCatchUpTicks: 8 }, tick => {
      seen.push(tick);
    });
    expect(result.ticks).toBe(120);
    expect(result.seconds).toBeCloseTo(2, 10);
    expect(seen[0]).toBe(1);
    expect(seen.at(-1)).toBe(120);
  });

  it('keeps tick sequence independent from frame batching', () => {
    const batched: number[] = [];
    const spread: number[] = [];
    const left = new FixedStepClock({ tickRate: 60, maxCatchUpTicks: 8, maxFrameDeltaSeconds: 0.5 });
    const right = new FixedStepClock({ tickRate: 60, maxCatchUpTicks: 8, maxFrameDeltaSeconds: 0.5 });
    left.pushFrameDelta(0.5, { onTick: tick => batched.push(tick) });
    for (let i = 0; i < 30; i += 1) right.pushFrameDelta(1 / 60, { onTick: tick => spread.push(tick) });
    expect(batched).toEqual(spread.slice(0, batched.length));
    expect(left.tick).toBe(8);
    expect(right.tick).toBe(30);
    expect(left.droppedSeconds).toBeGreaterThan(0);
  });

  it('clamps hostile frame deltas and reports dropped simulation time', () => {
    const clock = new FixedStepClock({
      tickRate: 20,
      maxCatchUpTicks: 3,
      maxFrameDeltaSeconds: 0.2,
    });
    const frame = clock.pushFrameDelta(10, { onTick: () => undefined });
    expect(frame.deltaSeconds).toBe(0.2);
    expect(frame.simulatedTicks).toBe(3);
    expect(frame.droppedSeconds).toBeGreaterThanOrEqual(0);
    expect(clock.accumulator).toBeLessThan(clock.stepSeconds);
  });

  it('never creates negative time from invalid frame deltas', () => {
    const clock = new FixedStepClock();
    const negative = clock.pushFrameDelta(-3, { onTick: () => undefined });
    expect(negative.deltaSeconds).toBe(0);
    expect(negative.tick).toBe(tickValue(0));
    expect(clock.accumulator).toBe(0);
    expect(clock.droppedSeconds).toBe(0);
  });

  it('supports timestamp driven browser clocks without first-frame jumps', () => {
    const clock = new FixedStepClock({ tickRate: 60 });
    const first = clock.advanceToTimestamp(10_000, { onTick: () => undefined });
    const second = clock.advanceToTimestamp(10_016.6666667, { onTick: () => undefined });
    expect(first.deltaSeconds).toBe(0);
    expect(second.deltaSeconds).toBeCloseTo(0.0166666667, 8);
    expect(second.tick).toBe(1);
  });

  it('resets all timing state to a caller supplied tick', () => {
    const clock = new FixedStepClock();
    clock.pushFrameDelta(0.1, { onTick: () => undefined });
    expect(clock.tick).toBeGreaterThan(0);
    clock.reset(tickValue(500));
    expect(clock.tick).toBe(500);
    expect(clock.accumulator).toBe(0);
    expect(clock.droppedSeconds).toBe(0);
  });

  it('accumulates fractional simulation steps without drift', () => {
    const accumulator = new SimulationAccumulator(0.1);
    expect(accumulator.add(0.05)).toBe(0);
    expect(accumulator.remainder).toBeCloseTo(0.05, 12);
    expect(accumulator.add(0.05)).toBe(1);
    expect(accumulator.remainder).toBeCloseTo(0, 12);
    accumulator.add(0.35);
    expect(accumulator.totalSteps).toBe(4);
    expect(accumulator.remainder).toBeCloseTo(0, 12);
  });

  it('supports bounded accumulator consumption', () => {
    const accumulator = new SimulationAccumulator(0.05);
    accumulator.add(1);
    expect(accumulator.consumeAll(3)).toBe(3);
    expect(accumulator.totalSteps).toBe(23);
    expect(accumulator.remainder).toBeGreaterThanOrEqual(0);
  });

  it('rejects invalid accumulator configuration and inputs', () => {
    expect(() => new SimulationAccumulator(0)).toThrow();
    expect(() => new SimulationAccumulator(-1)).toThrow();
    const accumulator = new SimulationAccumulator(0.1);
    expect(() => accumulator.add(-1)).toThrow();
    expect(() => accumulator.add(Number.NaN)).toThrow();
  });

  it('calculates a bounded interpolation alpha', () => {
    expect(interpolationAlpha(0, 0.016)).toBe(0);
    expect(interpolationAlpha(-1, 0.016)).toBe(0);
    expect(interpolationAlpha(0.008, 0.016)).toBeCloseTo(0.5);
    expect(interpolationAlpha(1, 0.016)).toBe(1);
  });

  it('classifies frame budget pressure deterministically', () => {
    expect(frameBudgetExceeded(15.9, 16)).toBe(false);
    expect(frameBudgetExceeded(16, 16)).toBe(false);
    expect(frameBudgetExceeded(16.01, 16)).toBe(true);
    expect(frameBudgetExceeded(Number.NaN, 16)).toBe(false);
  });

  it('produces the same tick ledger for repeated simulation playback', () => {
    const run = () => {
      const clock = new FixedStepClock({ tickRate: 30, maxCatchUpTicks: 6 });
      const ledger: Array<[number, number]> = [];
      for (const delta of [0.01, 0.02, 0.08, 0.04, 0.10, 0.03, 0.16, 0.01]) {
        clock.pushFrameDelta(delta, {
          onTick: (tick, step) => ledger.push([tick, step]),
          onDrop: seconds => ledger.push([-1, seconds]),
        });
      }
      return ledger;
    };
    expect(run()).toEqual(run());
  });
});
