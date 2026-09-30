import { describe, expect, it } from 'vitest';
import { R29SaveLedger } from '../../src/3d/modern/r29/saveLedger.ts';
import { R29ReplayJournal } from '../../src/3d/modern/r29/replayJournal.ts';

describe('R29 persistence and replay contracts', () => {
  it('writes, validates, exports and imports bounded save slots', () => {
    const source = new R29SaveLedger<{ score: number }>({ maxSlots: 2, schema: 'test.r29' });
    source.write('Slot One', { score: 42 }, 10);
    const serialized = source.export();
    const target = new R29SaveLedger<{ score: number }>({ maxSlots: 2, schema: 'test.r29' });
    expect(target.import(serialized)).toEqual(['slot-one']);
    const record = target.read('slot-one');
    expect(record?.payload.score).toBe(42);
    expect(record ? target.validate(record).ok : false).toBe(true);
  });

  it('rejects tampered checksums', () => {
    const ledger = new R29SaveLedger<{ score: number }>();
    const record = ledger.write('main', { score: 10 }, 1);
    const tampered = { ...record, payload: { score: 999 } };
    expect(ledger.validate(tampered).ok).toBe(false);
  });

  it('records deterministic ordered replay input and checkpoints', () => {
    const journal = new R29ReplayJournal({ maxEvents: 16, checkpointEveryTicks: 5 });
    journal.recordInput({ tick: 1, sequence: 1, moveX: 1, moveY: 0, lookX: 0, lookY: 0, jump: false, sprint: true, primary: false, secondary: false, interact: false, pause: false });
    journal.marker(2, 'area-entered', { area: 'north' });
    const checkpoint = journal.checkpoint(5, { x: 10, z: 2 });
    expect(checkpoint.tick).toBe(5);
    expect(journal.snapshot({ x: 10, z: 2 }).events).toHaveLength(2);
    expect(journal.verify({ x: 10, z: 2 }).ok).toBe(true);
  });

  it('enforces monotonic replay sequences', () => {
    const journal = new R29ReplayJournal();
    const input = { tick: 1, sequence: 1, moveX: 0, moveY: 0, lookX: 0, lookY: 0, jump: false, sprint: false, primary: false, secondary: false, interact: false, pause: false };
    journal.recordInput(input);
    expect(() => journal.recordInput({ ...input, sequence: 1 })).toThrow(/SEQUENCE_REVERSED/);
  });
});
