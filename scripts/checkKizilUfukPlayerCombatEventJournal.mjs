import assert from 'node:assert/strict';
import {
  JOURNAL_VERSION,
  createPlayerCombatEventJournal,
  validatePlayerCombatEventJournalSnapshot,
} from '../src/3d/gameplay/playerCombatEventJournal.js';

function build() {
  const journal = createPlayerCombatEventJournal({ limit: 3 });
  journal.appendAttackWindow({ phase: 'start', serial: 1, position: { x: 1.23456789, z: 2.5 } }, { sequence: 1, timestampMs: 10 });
  journal.appendCombatFeedback({ outcome: 'parry', appliedAmount: 0, nested: { intensity: 1.5 } }, { sequence: 3, timestampMs: 30 });
  journal.appendDefense({ outcome: 'guard-break', stamina: 4.3333333 }, { sequence: 2, timestampMs: 20 });
  journal.appendEquipmentCondition({ slot: 'weapon', band: 'worn' }, { sequence: 4, timestampMs: 40 });
  return journal;
}

const first = build();
const second = build();
assert.equal(first.replayDigest(), second.replayDigest(), 'replay digest must be deterministic');
const snapshot = first.snapshot();
assert.equal(snapshot.version, JOURNAL_VERSION);
assert.equal(snapshot.size, 3, 'journal should keep the bounded tail');
assert.deepEqual(snapshot.entries.map((entry) => entry.sequence), [2, 3, 4]);
assert.equal(validatePlayerCombatEventJournalSnapshot(snapshot), true);
assert.deepEqual(first.since(2).map((entry) => entry.kind), ['combat-feedback', 'equipment-condition']);
assert.equal(Object.isFrozen(snapshot), true);
assert.equal(Object.isFrozen(snapshot.entries), true);
assert.equal(Object.isFrozen(snapshot.entries[0].payload), true);
assert.throws(() => { snapshot.entries[0].payload.band = 'broken'; }, TypeError);

first.dispose();
assert.equal(first.appendDefense({ outcome: 'hit' }), null, 'disposed journal must fail closed');
assert.equal(first.snapshot().disposed, true);
first.reset();
assert.equal(first.snapshot().size, 0, 'reset should clear bounded state');

console.log('player combat event journal checks passed');
