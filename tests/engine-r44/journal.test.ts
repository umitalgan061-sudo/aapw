import { describe, expect, it } from "vitest";
import { HashChainJournal, SequenceCursor } from "../../src/engine-ts/r44/journal.ts";

describe("HashChainJournal", () => {
  it("appends a stable hash chain and replays in sequence", () => {
    const journal = new HashChainJournal<{ delta: number }, { total: number }>({ capacity: 16 });
    journal.append({ type: "add", tick: 1, payload: { delta: 2 }, id: "event-0001" });
    journal.append({ type: "add", tick: 2, payload: { delta: 3 }, id: "event-0002" });
    journal.append({ type: "add", tick: 3, payload: { delta: 5 }, id: "event-0003" });
    expect(journal.verify().valid).toBe(true);
    const replay = journal.replay((state, record) => ({ total: state.total + record.payload.delta }), { total: 0 });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.value.total).toBe(10);
  });

  it("rejects unserializable payloads and recently duplicated event ids", () => {
    const journal = new HashChainJournal({ capacity: 16 });
    expect(journal.append({ type: "invalid", tick: 0, payload: BigInt(3) }).ok).toBe(false);
    journal.append({ type: "event", tick: 1, payload: { value: 1 }, id: "duplicate-event" });
    expect(journal.append({ type: "event", tick: 1, payload: { value: 2 }, id: "duplicate-event" }).ok).toBe(false);
    expect(journal.size).toBe(1);
  });

  it("exports and imports a verifiable journal", () => {
    const journal = new HashChainJournal({ capacity: 16 });
    journal.append({ type: "set", tick: 1, payload: { x: 4 } });
    journal.append({ type: "set", tick: 2, payload: { x: 7 } });
    journal.checkpoint(2, { x: 7 });
    const exported = journal.export();
    const restored = new HashChainJournal({ capacity: 16 });
    expect(restored.import(exported).ok).toBe(true);
    expect(restored.verify().valid).toBe(true);
    expect(restored.headDigest).toBe(journal.headDigest);
    expect(restored.nextSequence).toBe(journal.nextSequence);
  });

  it("rejects tampered exports", () => {
    const journal = new HashChainJournal({ capacity: 16 });
    journal.append({ type: "event", tick: 1, payload: { safe: true } });
    const snapshot = journal.export();
    const tampered = { ...snapshot, records: snapshot.records.map((record) => ({ ...record, type: "tampered" })) };
    const restored = new HashChainJournal({ capacity: 16 });
    expect(restored.import(tampered as typeof snapshot).ok).toBe(false);
  });

  it("requires a checkpoint before explicit compaction", () => {
    const journal = new HashChainJournal({ capacity: 16 });
    for (let tick = 1; tick <= 4; tick += 1) journal.append({ type: "tick", tick, payload: { tick } });
    expect(journal.compactThrough(2).ok).toBe(false);
    journal.checkpoint(4, { current: 4 });
    expect(journal.compactThrough(2).ok).toBe(true);
    expect(journal.records()[0]?.sequence).toBe(3);
    expect(journal.verify().valid).toBe(true);
  });

  it("bounds storage and maintains a rolling anchor digest", () => {
    const journal = new HashChainJournal({ capacity: 8 });
    for (let tick = 1; tick <= 12; tick += 1) journal.append({ type: "tick", tick, payload: { tick } });
    expect(journal.size).toBe(8);
    expect(journal.records()[0]?.sequence).toBe(5);
    expect(journal.verify().valid).toBe(true);
  });

  it("enforces contiguous sequence consumption", () => {
    const cursor = new SequenceCursor();
    expect(cursor.accept(1).ok).toBe(true);
    expect(cursor.accept(1).ok).toBe(false);
    expect(cursor.accept(3).ok).toBe(false);
    expect(cursor.accept(2).ok).toBe(true);
    expect(cursor.lastSequence).toBe(2);
  });
});
