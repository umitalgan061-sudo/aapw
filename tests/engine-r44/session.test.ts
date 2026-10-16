import { describe, expect, it } from "vitest";
import { createInputEnvelope, createSnapshotPacket, SessionTimeline, SnapshotSequenceGate } from "../../src/engine-ts/r44/session.ts";

describe("SessionTimeline and snapshot sequence gate", () => {
  it("accepts contiguous authoritative inputs and exposes deterministic tick order", () => {
    const timeline = new SessionTimeline<{ move: number }>("session-A");
    const first = createInputEnvelope("session-A", 0, 1, 10, 100, { move: 1 });
    const second = createInputEnvelope("session-A", 0, 2, 9, 110, { move: 2 });
    expect(timeline.accept(first, 10).accepted).toBe(true);
    expect(timeline.accept(second, 10).accepted).toBe(true);
    expect(timeline.inputs().map((input) => input.tick)).toEqual([9, 10]);
    expect(timeline.summary().inputCount).toBe(2);
  });

  it("rejects sequence gaps, stale ticks, wrong sessions, and forged digests", () => {
    const timeline = new SessionTimeline<{ action: string }>("session-A", { maxGap: 4, maxTickLag: 3 });
    const gap = createInputEnvelope("session-A", 0, 2, 10, 100, { action: "jump" });
    expect(timeline.accept(gap, 10).reason).toBe("sequence-gap");
    const wrong = createInputEnvelope("session-B", 0, 1, 10, 100, { action: "jump" });
    expect(timeline.accept(wrong, 10).reason).toBe("wrong-session");
    const stale = createInputEnvelope("session-A", 0, 1, 1, 100, { action: "jump" });
    expect(timeline.accept(stale, 10).reason).toBe("stale-tick");
    const forged = { ...createInputEnvelope("session-A", 0, 1, 10, 100, { action: "jump" }), digest: "bad" };
    expect(timeline.accept(forged, 10).reason).toBe("digest-mismatch");
  });

  it("rotates epochs and clears old input history", () => {
    const timeline = new SessionTimeline<{ value: number }>("session-B");
    timeline.accept(createInputEnvelope("session-B", 0, 1, 1, 5, { value: 1 }), 1);
    expect(timeline.rotateEpoch(1).ok).toBe(true);
    expect(timeline.inputs()).toHaveLength(0);
    const newEpochInput = createInputEnvelope("session-B", 1, 1, 2, 6, { value: 2 });
    expect(timeline.accept(newEpochInput, 2).accepted).toBe(true);
    expect(timeline.rotateEpoch(1).ok).toBe(false);
  });

  it("rejects snapshot sequence gaps and accepts contiguous snapshots", () => {
    const gate = new SnapshotSequenceGate<{ world: number }>("net-A");
    const first = createSnapshotPacket("net-A", 0, 1, 10, 100, { world: 1 });
    const gap = createSnapshotPacket("net-A", 0, 3, 12, 101, { world: 3 });
    const second = createSnapshotPacket("net-A", 0, 2, 11, 102, { world: 2 });
    if (!first.ok || !gap.ok || !second.ok) throw new Error("test envelope construction failed");
    expect(gate.apply(first.value, 101, 10).accepted).toBe(true);
    expect(gate.apply(gap.value, 102, 11).reason).toBe("gap");
    expect(gate.apply(second.value, 103, 11).accepted).toBe(true);
    expect(gate.payload).toEqual({ world: 2 });
  });

  it("validates packet age and payload digest", () => {
    const gate = new SnapshotSequenceGate<{ v: number }>("net-B", { maxAgeMs: 50 });
    const tooOld = createSnapshotPacket("net-B", 0, 1, 1, 10, { v: 1 });
    const fresh = createSnapshotPacket("net-B", 0, 1, 1, 95, { v: 1 });
    if (!tooOld.ok || !fresh.ok) throw new Error("test envelope construction failed");
    expect(gate.apply(tooOld.value, 100, 1).reason).toBe("too-old");
    expect(gate.apply({ ...fresh.value, digest: "tampered" }, 100, 1).reason).toBe("invalid-digest");
  });

  it("preserves a bounded rewind input window", () => {
    const timeline = new SessionTimeline<{ value: number }>("session-C", { maxInputHistory: 32, maxTickLag: 6 });
    for (let seq = 1; seq <= 20; seq += 1) {
      const input = createInputEnvelope("session-C", 0, seq, seq, seq, { value: seq });
      timeline.accept(input, seq);
    }
    expect(timeline.inputs().length).toBeLessThanOrEqual(32);
    expect(timeline.rewindWindow(20).every((input) => input.tick >= 14 && input.tick <= 20)).toBe(true);
  });
});
