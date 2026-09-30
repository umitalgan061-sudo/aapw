import { describe, expect, it } from 'vitest';
import { R16PersistenceJournal } from '../../../src/3d/modern/r16/persistence.js';
import { R16SnapshotCodec } from '../../../src/3d/modern/r16/snapshotCodec.js';

describe('R16 persistence and codec', () => {
  it('serializes and restores a bounded snapshot', () => {
    const codec=new R16SnapshotCodec();
    const snapshot={version:16 as const,revision:2,tick:8,state:Object.freeze({player:{hp:100}}),digest:'unused',createdAtTick:8};
    const encoded=codec.encode(snapshot);
    expect(encoded.ok).toBe(true);
    if(!encoded.ok)return;
    const decoded=codec.decode(encoded.value);
    expect(decoded.ok).toBe(true);
    if(decoded.ok)expect(decoded.value.state.player).toEqual({hp:100});
  });

  it('appends checkpoints into a bounded journal', () => {
    const journal=new R16PersistenceJournal({maxJournalEntries:2});
    const snapshot={version:16 as const,revision:1,tick:3,state:Object.freeze({score:5}),digest:'d',createdAtTick:3};
    expect(journal.checkpoint(snapshot).ok).toBe(true);
    expect(journal.replayMarker(4,'after-score').ok).toBe(true);
    expect(journal.digest().entryCount).toBe(2);
    expect(journal.restoreLatestCheckpoint()).toEqual({score:5});
  });
});
