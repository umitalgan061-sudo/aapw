import assert from 'node:assert/strict';
import {
  createPlayerCombatComboWindowDirector,
  validatePlayerCombatComboWindowReceipt,
} from '../src/3d/gameplay/playerCombatComboWindowDirector.js';

const run = () => {
  const director = createPlayerCombatComboWindowDirector({ maxHistory: 4 });
  const first = director.advance({ kind: 'light', timestampMs: 100 });
  assert.equal(first.accepted, true);
  assert.equal(first.receipt.step.index, 1);
  assert.equal(first.receipt.chain.continues, false);
  assert.equal(validatePlayerCombatComboWindowReceipt(first.receipt), true);

  const second = director.advance({ kind: 'light', timestampMs: 430, bufferedAtMs: 420 });
  assert.equal(second.accepted, true);
  assert.equal(second.receipt.step.index, 2);
  assert.equal(second.receipt.chain.continues, true);
  assert.equal(second.receipt.chain.withinBuffer, true);

  const heavy = director.advance({ kind: 'heavy', timestampMs: 500 });
  assert.equal(heavy.receipt.step.index, 1);
  assert.equal(heavy.receipt.kind, 'heavy');

  const rejected = director.advance({ kind: 'charge', timestampMs: 510 });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'unsupported-kind');

  const interrupted = director.advance({ kind: 'light', timestampMs: 520, interrupted: true });
  assert.equal(interrupted.accepted, false);
  assert.equal(interrupted.reason, 'interrupted');

  const snapshot = director.snapshot();
  assert.equal(snapshot.history.length <= 4, true);
  assert.throws(() => { snapshot.history.push('mutate'); }, TypeError);

  const replay = createPlayerCombatComboWindowDirector({ maxHistory: 4 });
  const replayA = replay.advance({ kind: 'light', timestampMs: 100 });
  const replayB = replay.advance({ kind: 'light', timestampMs: 430, bufferedAtMs: 420 });
  assert.deepEqual(
    [replayA.receipt, replayB.receipt],
    [first.receipt, second.receipt],
    'replay must remain deterministic',
  );

  const disposed = director.dispose();
  assert.equal(disposed.disposed, true);
  assert.equal(director.advance({ kind: 'light', timestampMs: 700 }).accepted, false);
};

run();
console.log('[checkPlayerCombatComboWindowDirector] PASS');
