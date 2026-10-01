import { describe, expect, it } from 'vitest';
import { R35EventJournal } from '../../src/3d/nextgen/r35/eventJournal';
import { R35_VERSION } from '../../src/3d/nextgen/r35/contracts';

const event = (sequence: number, tick: number) => ({
  type: 'runtime.mode' as const,
  from: 'booting' as const,
  to: 'running' as const,
  reason: 'test',
  tick,
  sequence,
  timestampMs: tick,
});

describe('R35 event journal', () => {
  it('maintains bounded deterministic entries and validates checksums', () => {
    const journal = new R35EventJournal(2);
    journal.append(event(1, 1));
    journal.append(event(2, 2));
    journal.append(event(3, 3));
    expect(journal.size).toBe(2);
    expect(journal.verify()).toEqual([]);
    expect(R35_VERSION).toBe(35);
  });

  it('deduplicates replay-equivalent events', () => {
    const journal = new R35EventJournal();
    const first = journal.appendUnique(event(1, 1));
    const duplicate = journal.appendUnique(event(1, 1));
    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();
    const replayed: number[] = [];
    const result = journal.replay(1, (entry) => {
      replayed.push(entry.tick);
      return true;
    });
    expect(result.applied).toBe(1);
    expect(replayed).toEqual([1]);
  });
});
