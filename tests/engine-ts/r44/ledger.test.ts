import { describe, expect, it } from "vitest";
import { R44BoundaryError } from "../../../src/engine-ts/r44/contracts.js";
import { R44EventLedger } from "../../../src/engine-ts/r44/eventLedger.js";

describe("R44EventLedger", () => {
  it("keeps a bounded monotonic chain and reports overwritten history", () => {
    const ledger = new R44EventLedger({ capacity: 3 });
    for (let index = 1; index <= 5; index += 1) {
      ledger.append({
        kind: "simulation.tick",
        source: "world",
        tick: index,
        payload: { index, stable: true },
      });
    }
    expect(ledger.size).toBe(3);
    expect(ledger.lastSequence).toBe(5);
    expect(ledger.droppedEntries).toBe(2);
    expect(ledger.get(2)).toBeUndefined();
    expect(ledger.get(3)?.payload).toEqual({ index: 3, stable: true });
    expect(ledger.read({ afterSequence: 3, limit: 2 }).map((entry) => entry.sequence)).toEqual([4, 5]);
    expect(ledger.verify().valid).toBe(true);
  });

  it("freezes a copy of input payload so caller mutation cannot corrupt the chain", () => {
    const ledger = new R44EventLedger();
    const payload = { nested: { value: 1 }, list: [1, 2] };
    ledger.append({ kind: "test", source: "unit", tick: 0, payload });
    payload.nested.value = 90;
    payload.list.push(3);
    const entry = ledger.get(1);
    expect(entry?.payload).toEqual({ nested: { value: 1 }, list: [1, 2] });
    expect(ledger.verify().valid).toBe(true);
  });

  it("rejects cyclic or unsupported payloads at the boundary", () => {
    const ledger = new R44EventLedger();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => ledger.append({
      kind: "bad",
      source: "unit",
      tick: 0,
      payload: cyclic as never,
    })).toThrow(R44BoundaryError);
  });

  it("restores a snapshot atomically and continues its sequence", () => {
    const source = new R44EventLedger({ capacity: 8 });
    source.append({ kind: "a", source: "test", tick: 1, payload: { n: 1 } });
    source.append({ kind: "b", source: "test", tick: 2, payload: { n: 2 } });
    const target = new R44EventLedger({ capacity: 8 });
    target.importSnapshot(source.snapshot());
    expect(target.verify().valid).toBe(true);
    expect(target.append({ kind: "c", source: "test", tick: 3, payload: null }).sequence).toBe(3);
    expect(target.verify().valid).toBe(true);
  });

  it("does not partially mutate when a snapshot has the wrong tip", () => {
    const ledger = new R44EventLedger();
    ledger.append({ kind: "safe", source: "test", tick: 1, payload: true });
    const before = ledger.snapshot();
    const bad = { ...before, tipFingerprint: "not-a-real-tip" as never };
    expect(() => ledger.importSnapshot(bad)).toThrow(R44BoundaryError);
    expect(ledger.snapshot().lastSequence).toBe(1);
    expect(ledger.verify().valid).toBe(true);
  });

  it("bounds reads and allows deterministic kind/source filtering", () => {
    const ledger = new R44EventLedger({ capacity: 16 });
    for (let index = 0; index < 10; index += 1) {
      ledger.append({
        kind: index % 2 === 0 ? "even" : "odd",
        source: index < 5 ? "alpha" : "beta",
        tick: index,
        payload: index,
      });
    }
    expect(ledger.read({ kind: "even", source: "beta", limit: 8 }).map((entry) => entry.sequence)).toEqual([7, 9]);
    expect(ledger.read({ limit: 2 }).length).toBe(2);
  });
});
