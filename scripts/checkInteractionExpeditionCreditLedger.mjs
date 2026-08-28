import assert from 'node:assert/strict';
import {
  RECENT_CREDIT_LIMIT,
  createInteractionEconomyState,
} from '../src/3d/gameplay/interactionEconomy.js';

const economy = createInteractionEconomyState(10);
const awards = [3, 4, 5, 6, 7, 8, 9];
for (let index = 0; index < awards.length; index += 1) {
  const creditedCopper = awards[index];
  const result = economy.credit(creditedCopper, {
    sourceId: `dragonstone-contract-${index + 1}`,
    label: `Dragonstone sefer kontratı ${index + 1}`,
  });
  assert.equal(result.ok, true);
  assert.equal(result.receipt.sequence, index + 1);
}

const beforeSave = economy.snapshot();
assert.equal(beforeSave.copper, 52);
assert.equal(beforeSave.ledger.recentCredits.length, RECENT_CREDIT_LIMIT);
assert.deepEqual(beforeSave.ledger.recentCredits.map((receipt) => receipt.sequence), [3, 4, 5, 6, 7]);
assert.deepEqual(beforeSave.ledger.recentCredits.map((receipt) => receipt.creditedCopper), [5, 6, 7, 8, 9]);

const tampered = structuredClone(beforeSave);
tampered.ledger.recentCredits.unshift({
  sequence: 999,
  sourceId: 'forged-zero-credit',
  label: 'Forged zero credit',
  creditedCopper: 0,
  balanceCopper: 9999,
});
tampered.ledger.recentCredits.push({
  sequence: 7,
  sourceId: 'duplicate-sequence',
  label: 'Duplicate sequence',
  creditedCopper: 999,
  balanceCopper: 9999,
});

const restored = createInteractionEconomyState();
restored.restore(tampered);
const restoredSnapshot = restored.snapshot();
assert.equal(restoredSnapshot.copper, 52);
assert.equal(restoredSnapshot.ledger.recentCredits.length, RECENT_CREDIT_LIMIT);
assert.deepEqual(restoredSnapshot.ledger.recentCredits.map((receipt) => receipt.sequence), [3, 4, 5, 6, 7]);
assert.deepEqual(restoredSnapshot.ledger.recentCredits.map((receipt) => receipt.creditedCopper), [5, 6, 7, 8, 9]);

const invalidBefore = structuredClone(restored.snapshot());
const invalidCredit = restored.credit(0, { sourceId: 'invalid-contract', label: 'Invalid contract' });
assert.deepEqual(invalidCredit, {
  ok: false,
  reason: 'invalid-credit',
  creditedCopper: 0,
  balanceCopper: 52,
});
assert.deepEqual(restored.snapshot(), invalidBefore);

const next = restored.credit(11, {
  sourceId: 'dragonstone-contract-8',
  label: 'Dragonstone sefer kontratı 8',
});
assert.equal(next.ok, true);
assert.equal(next.receipt.sequence, 8);
assert.equal(next.balanceCopper, 63);
assert.deepEqual(next.ledger.recentCredits.map((receipt) => receipt.sequence), [4, 5, 6, 7, 8]);
assert.equal(next.ledger.recentCredits.at(-1).sourceId, 'dragonstone-contract-8');
assert.equal(next.ledger.recentCredits.at(-1).label, 'Dragonstone sefer kontratı 8');

const roundTrip = createInteractionEconomyState();
roundTrip.restore(restored.snapshot());
assert.deepEqual(roundTrip.snapshot(), restored.snapshot());

console.log('PASS checkInteractionExpeditionCreditLedger');
