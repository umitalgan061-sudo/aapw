import assert from 'node:assert/strict';
import { createInteractionEconomyState } from '../src/3d/gameplay/interactionEconomy.js';

const economy = createInteractionEconomyState(40);
economy.restore({
  copper: Number.POSITIVE_INFINITY,
  stockByOffer: {
    'dragonstone-field-ration': 2.9,
    'dragonstone-whetstone': -50,
    'dragonstone-watch-ration-allotment': 999,
  },
  ledger: {
    transactionCount: 999999,
    lifetimeSpentCopper: 999999,
    purchasesByOffer: { 'dragonstone-field-ration': 999999 },
    recentTransactions: [
      { sequence: 1, offerId: 'dragonstone-field-ration', balanceCopper: Number.NaN },
      { sequence: 2, offerId: 'unknown-offer', balanceCopper: 999 },
      { sequence: Number.POSITIVE_INFINITY, offerId: 'dragonstone-field-ration', balanceCopper: 999 },
    ],
  },
});

const restored = economy.snapshot();
assert.equal(restored.copper, 40, 'non-finite wallet values must restore to the canonical starting balance');
assert.equal(restored.stockByOffer['dragonstone-field-ration'], 2, 'finite fractional stock must floor inside the authored limit');
assert.equal(restored.stockByOffer['dragonstone-whetstone'], 2, 'negative stock must fail closed to authored stock');
assert.equal(restored.stockByOffer['dragonstone-watch-ration-allotment'], 1, 'oversized stock must clamp to authored stock');
assert.equal(restored.ledger.transactionCount, 2, 'purchase totals must derive from authoritative stock, not forged aggregate ledger fields');
assert.equal(restored.ledger.lifetimeSpentCopper, 12, 'lifetime spend must derive from canonical offer price and authoritative stock');
assert.deepEqual(restored.ledger.purchasesByOffer, {
  'dragonstone-field-ration': 2,
  'dragonstone-whetstone': 0,
  'dragonstone-watch-ration-allotment': 0,
});
assert.equal(restored.ledger.recentTransactions.length, 1, 'only canonical in-window purchase receipts may survive hostile restore');
assert.equal(restored.ledger.recentTransactions[0].offerId, 'dragonstone-field-ration');
assert.equal(restored.ledger.recentTransactions[0].sequence, 1);
assert.equal(restored.ledger.recentTransactions[0].spentCopper, 6);
assert.equal(restored.ledger.recentTransactions[0].balanceCopper, 40, 'non-finite saved receipt balance must sanitize to current wallet');

const stable = structuredClone(economy.snapshot());
for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0]) {
  const rejected = economy.credit(amount, { sourceId: `hostile-credit:${String(amount)}` });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'invalid-credit');
  assert.deepEqual(economy.snapshot(), stable, 'invalid credit inputs must not mutate restored economy state');
}

console.log('Interaction economy hostile save restore acceptance PASS');
