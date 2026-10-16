import { describe, expect, it } from "vitest";
import {
  BoundedRing,
  MonotonicSequence,
  RuntimeFault,
  cloneCanonical,
  commandName,
  deepFreeze,
  integer,
  stableFingerprint,
  stableSerialize,
} from "../../src/engine-ts/r45";

describe("R45 core contracts", () => {
  it("serializes object keys canonically and fingerprints insertion-order variants equally", () => {
    const first = { z: 4, nested: { b: true, a: "value" }, a: 1 };
    const second = { a: 1, nested: { a: "value", b: true }, z: 4 };
    expect(stableSerialize(first)).toBe(stableSerialize(second));
    expect(stableFingerprint(first)).toBe(stableFingerprint(second));
  });

  it("normalizes negative zero without changing finite values", () => {
    expect(stableSerialize({ negativeZero: -0, one: 1 })).toBe('{"negativeZero":0,"one":1}');
  });

  it("rejects circular references and non-finite numbers before crossing the boundary", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => stableSerialize(cycle)).toThrow(RuntimeFault);
    expect(() => stableSerialize({ notNumber: Number.NaN })).toThrow(/Non-finite/u);
    expect(() => stableSerialize({ omitted: undefined })).toThrow(/Undefined/u);
  });

  it("rejects class instances from canonical payloads", () => {
    expect(() => stableSerialize({ date: new Date(0) })).toThrow(/plain records/u);
  });

  it("clones JSON-safe payloads as detached values", () => {
    const value = { items: [{ id: "a" }, { id: "b" }] };
    const cloned = cloneCanonical(value);
    cloned.items[0]!.id = "changed";
    expect(value.items[0]!.id).toBe("a");
  });

  it("deep freezes nested object graphs", () => {
    const value = deepFreeze({ root: { child: 3 } });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.root)).toBe(true);
    expect(() => { (value.root as { child: number }).child = 4; }).toThrow();
  });

  it("enforces safe identifiers and integer boundaries", () => {
    expect(commandName(" player.move ")).toBe("player.move");
    expect(() => commandName("../unsafe")).toThrow(RuntimeFault);
    expect(integer(5, "test.integer", 0, 8)).toBe(5);
    expect(() => integer(2.5, "test.integer")).toThrow(/integer/u);
  });

  it("keeps monotonic counters within safe integer space", () => {
    const sequence = new MonotonicSequence(10);
    expect(sequence.next()).toBe(11);
    expect(sequence.current()).toBe(11);
    expect(() => new MonotonicSequence(-1)).toThrow(RuntimeFault);
  });

  it("bounds ring storage and accounts for evictions", () => {
    const ring = new BoundedRing<number>(3);
    ring.push(1);
    ring.push(2);
    ring.push(3);
    ring.push(4);
    expect(ring.snapshot()).toMatchObject({ capacity: 3, size: 3, dropped: 1, values: [2, 3, 4] });
    expect(ring.drain(2)).toEqual([2, 3]);
    expect(ring.size).toBe(1);
  });
});
