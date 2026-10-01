import assert from 'node:assert/strict';
import { createPlayerCombatOutcomeLedger } from '../src/3d/gameplay/playerCombatOutcomeLedger.js';

const run = () => {
  const ledger = createPlayerCombatOutcomeLedger({ maxEntries: 3, maxTargets: 2 });
  assert.equal(ledger.record({ outcome: 'hit', targetId: 'wolf', damage: 12.5, poiseDamage: 3, remainingHealth: 40, timestamp: 10 }).sequence, 0);
  assert.equal(ledger.record({ outcome: 'blocked', targetId: 'wolf', damage: 0, timestamp: 20 }).sequence, 1);
  assert.equal(ledger.record({ outcome: 'defeated', targetId: 'bear', remainingHealth: 0, timestamp: 30 }).sequence, 2);
  ledger.record({ outcome: 'miss', targetId: 'stag', timestamp: 40 });

  const summary = ledger.summarize();
  assert.equal(summary.entryCount, 3);
  assert.equal(summary.targetCount, 2);
  assert.equal(summary.counts.hit, 0);
  assert.equal(summary.counts.blocked, 1);
  assert.equal(summary.counts.defeated, 1);
  assert.equal(summary.latest.outcome, 'miss');
  assert.equal(ledger.latestForTarget('wolf').outcome, 'blocked');
  assert.equal(ledger.latestForTarget('bear').outcome, 'defeated');
  assert.equal(ledger.latestForTarget('stag'), null);

  const first = ledger.snapshot();
  const second = ledger.snapshot();
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  ledger.dispose();
  assert.equal(ledger.record({ outcome: 'hit', targetId: 'wolf' }), null);
  assert.equal(ledger.latestForTarget('wolf'), null);
  assert.equal(ledger.summarize().disposed, true);
};

run();
console.log('Kızıl Ufuk player combat outcome ledger: PASS');
