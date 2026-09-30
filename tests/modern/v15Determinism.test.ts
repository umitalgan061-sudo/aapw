import { describe, expect, it } from "vitest";
import {
  DeterministicHarnessV15,
  WorldSnapshotCodecV15,
  WorkerBudgetSchedulerV15,
  chunkIdV15,
  tickV15,
  compareDeterministicTracesV15,
  deterministicChoiceV15,
  deterministicSeededValueV15,
} from "../../src/3d/modern/v15/index.ts";

describe("v15 deterministic harness", () => {
  it("replays the same state from the same initial state", () => {
    const evolve = (state: { value: number }, input: number) => ({ value: state.value + input });
    const left = new DeterministicHarnessV15({ value: 0 }, { seed: 12 });
    const right = new DeterministicHarnessV15({ value: 0 }, { seed: 12 });
    for (const input of [1, 2, 4, 8, 16]) {
      left.advance(input, evolve);
      right.advance(input, evolve);
    }
    expect(compareDeterministicTracesV15(left.traceFromInitial({ value: 0 }), right.traceFromInitial({ value: 0 })).equal).toBe(true);
  });

  it("detects a trace mismatch", () => {
    const harness = new DeterministicHarnessV15({ value: 0 }, { seed: 1 });
    harness.advance(1, (state, input) => ({ value: state.value + input }));
    harness.advance(2, (state, input) => ({ value: state.value + input }));
    const trace = harness.traceFromInitial({ value: 0 });
    trace.steps[1] && Object.defineProperty(trace.steps[1], "checksum", { value: 7 });
    const result = harness.verifyTrace(trace, (state, input) => ({ value: state.value + input }));
    expect(result.ok).toBe(false);
    expect(result.mismatchStep).toBe(2);
  });

  it("generates deterministic values without Math.random", () => {
    expect(deterministicSeededValueV15(10, 20)).toBe(deterministicSeededValueV15(10, 20));
    expect(deterministicChoiceV15(["a", "b", "c"], 10, 20)).toBe(deterministicChoiceV15(["a", "b", "c"], 10, 20));
  });
});

describe("v15 worker budget scheduler", () => {
  it("prioritizes critical work", async () => {
    const scheduler = new WorkerBudgetSchedulerV15({ maxConcurrent: 1, maxTasksPerFrame: 2, maxMsPerFrame: 100 });
    const order: string[] = [];
    scheduler.enqueue({ id: "low", priority: "low", estimatedMs: 1, bytes: 1, run: () => { order.push("low"); } });
    scheduler.enqueue({ id: "critical", priority: "critical", estimatedMs: 1, bytes: 1, run: () => { order.push("critical"); } });
    await scheduler.runFrame(1);
    expect(order[0]).toBe("critical");
  });

  it("bounds queue size", () => {
    const scheduler = new WorkerBudgetSchedulerV15({ maxQueue: 1 });
    expect(scheduler.enqueue({ id: "a", priority: "normal", estimatedMs: 1, bytes: 1, run: () => 1 })).toBe(true);
    expect(scheduler.enqueue({ id: "b", priority: "normal", estimatedMs: 1, bytes: 1, run: () => 2 })).toBe(false);
  });

  it("contains task errors instead of rejecting the frame", async () => {
    const scheduler = new WorkerBudgetSchedulerV15({ maxMsPerFrame: 100 });
    scheduler.enqueue({ id: "bad", priority: "high", estimatedMs: 1, bytes: 1, run: () => { throw new Error("boom"); } });
    const result = await scheduler.runFrame(1);
    expect(result).toHaveLength(1);
    expect(result[0]?.completed).toBe(false);
    expect(scheduler.stats().failed).toBe(1);
  });
});

describe("v15 world snapshot", () => {
  it("round-trips deterministic chunk state", () => {
    const codec = new WorldSnapshotCodecV15<{ hp: number }>({ now: () => 10 });
    const snapshot = codec.encode(tickV15(7), { hp: 100 }, [{
      id: chunkIdV15("0:0"), x: 0, z: 0, radiusMeters: 100, estimatedBytes: 10,
      generationMs: 1, critical: true, biome: "core", state: "resident", score: 1,
      lastDesiredTick: tickV15(7), lastResidentTick: tickV15(7),
    }]);
    expect(codec.decode(codec.encodeText(tickV15(7), { hp: 100 }, snapshot.chunks)).checksum).toBe(snapshot.checksum);
  });

  it("rejects tampered snapshots", () => {
    const codec = new WorldSnapshotCodecV15<{ hp: number }>({ now: () => 10 });
    const snapshot = codec.encode(tickV15(1), { hp: 1 }, []);
    expect(() => codec.decode({ ...snapshot, state: { hp: 2 } })).toThrow("checksum");
  });

  it("reports chunk and state differences", () => {
    const codec = new WorldSnapshotCodecV15<{ hp: number }>({ now: () => 10 });
    const left = codec.encode(tickV15(1), { hp: 1 }, []);
    const right = codec.encode(tickV15(2), { hp: 2 }, []);
    const diff = codec.diff(left, right);
    expect(diff.tickChanged).toBe(true);
    expect(diff.stateChanged).toBe(true);
  });
});
