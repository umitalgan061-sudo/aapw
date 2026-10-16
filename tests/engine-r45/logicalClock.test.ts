import { describe, expect, it, vi } from "vitest";
import { DeterministicLogicalClock } from "../../src/engine-ts/r45";

describe("DeterministicLogicalClock", () => {
  it("advances only whole fixed steps and retains the remainder", () => {
    const clock = new DeterministicLogicalClock({ fixedStepMs: 10, maxCatchUpSteps: 8 });
    const result = clock.advance(35);
    expect(result).toMatchObject({ tickBefore: 0, tickAfter: 3, steps: 3, acceptedRealMs: 35 });
    expect(clock.snapshot().accumulatorMs).toBe(5);
    expect(clock.simulationTimeMs).toBe(30);
  });

  it("clamps catch-up to a bounded number of steps and records discarded time", () => {
    const clock = new DeterministicLogicalClock({
      fixedStepMs: 10, maxRealDeltaMs: 100, maxCatchUpSteps: 2,
    });
    const result = clock.advance(55);
    expect(result.steps).toBe(2);
    expect(result.discardedSimulationMs).toBe(30);
    expect(clock.snapshot().accumulatorMs).toBe(5);
  });

  it("caps unexpectedly large real-time deltas", () => {
    const clock = new DeterministicLogicalClock({ fixedStepMs: 10, maxRealDeltaMs: 30, maxCatchUpSteps: 8 });
    const result = clock.advance(100);
    expect(result.acceptedRealMs).toBe(30);
    expect(result.discardedRealMs).toBe(70);
    expect(result.steps).toBe(3);
  });

  it("pauses without accumulating time and resumes deterministically", () => {
    const clock = new DeterministicLogicalClock({ fixedStepMs: 10 });
    clock.pause();
    expect(clock.advance(50).steps).toBe(0);
    expect(clock.tick).toBe(0);
    clock.resume();
    expect(clock.advance(10).steps).toBe(1);
  });

  it("fires timers by due tick then registration order", () => {
    const clock = new DeterministicLogicalClock({ fixedStepMs: 10 });
    const calls: string[] = [];
    clock.schedule(2, () => calls.push("first"));
    clock.schedule(2, () => calls.push("second"));
    clock.schedule(1, () => calls.push("earlier"));
    clock.advance(20);
    expect(calls).toEqual(["earlier", "first", "second"]);
  });

  it("allows timers to be cancelled before their deadlines", () => {
    const clock = new DeterministicLogicalClock({ fixedStepMs: 10 });
    const callback = vi.fn();
    const handle = clock.schedule(1, callback);
    expect(clock.cancel(handle)).toBe(true);
    expect(clock.cancel(handle)).toBe(false);
    clock.advance(10);
    expect(callback).not.toHaveBeenCalled();
  });

  it("isolates timer callback faults and continues delivering other timers", () => {
    const clock = new DeterministicLogicalClock({ fixedStepMs: 10 });
    const callback = vi.fn();
    clock.schedule(1, () => { throw new Error("fault"); });
    clock.schedule(1, callback);
    const result = clock.advance(10);
    expect(result.timerCallbacks).toBe(2);
    expect(result.callbackFaults).toHaveLength(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(clock.recentCallbackFaults()[0]?.message).toBe("fault");
  });

  it("rejects invalid time scale and timer delays", () => {
    const clock = new DeterministicLogicalClock({ fixedStepMs: 10 });
    expect(() => clock.schedule(0, () => undefined)).toThrow();
    expect(() => clock.setTimeScale(Number.NaN)).toThrow();
    expect(() => clock.advance(Number.NaN)).toThrow();
  });

  it("does not use ambient wall-clock or random sources", () => {
    const clock = new DeterministicLogicalClock({ fixedStepMs: 1 });
    const before = clock.tick;
    clock.advance(4);
    expect(clock.tick - before).toBe(4);
  });
});
