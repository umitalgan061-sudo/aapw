import assert from 'node:assert/strict';
import {
  buildQuartermasterText,
  createInteractionEconomyState,
} from '../src/3d/gameplay/interactionEconomy.js';

const economy = createInteractionEconomyState(40);
const reward = economy.credit(12, {
  sourceId: 'expedition-contract:dragonstone-harbor-tavern-run',
  label: 'Liman Taverna Seferi',
});
assert.equal(reward.ok, true);
assert.equal(reward.balanceCopper, 52);

for (let purchaseIndex = 1; purchaseIndex <= 3; purchaseIndex += 1) {
  const purchase = economy.purchase(
    { id: 'dragonstone-field-ration', itemId: 'dragonstone-field-ration' },
    () => true,
  );
  assert.equal(purchase.ok, true, `quartermaster purchase ${purchaseIndex} should succeed`);
  const snapshot = economy.snapshot();
  assert.equal(snapshot.copper, 52 - purchaseIndex * 6);
  assert.equal(snapshot.ledger.recentCredits.length, 1);
  assert.deepEqual(snapshot.ledger.recentCredits[0], reward.receipt, 'later spending must not mutate expedition income provenance');
  assert.equal(snapshot.ledger.recentTransactions.at(-1)?.sequence, purchaseIndex);
  assert.equal(snapshot.ledger.recentTransactions.at(-1)?.balanceCopper, snapshot.copper);
}

const beforeSave = economy.snapshot();
assert.equal(beforeSave.stockByOffer['dragonstone-field-ration'], 1, 'three purchases should consume three of four finite-stock rations');
assert.equal(beforeSave.ledger.transactionCount, 3);
assert.equal(beforeSave.ledger.lifetimeSpentCopper, 18);
assert.equal(beforeSave.ledger.recentCredits[0].balanceCopper, 52, 'historical expedition receipt balance must remain the post-reward balance');

const text = buildQuartermasterText(beforeSave);
assert.match(text, /Kese: 34 bakır/);
assert.match(text, /Son gelir: Liman Taverna Seferi · \+12 bakır · bakiye 52/);
assert.match(text, /Son işlem: #3 Dragonstone saha azığı · 6 bakır · bakiye 34/);

const restored = createInteractionEconomyState();
restored.restore(beforeSave);
assert.deepEqual(restored.snapshot(), beforeSave, 'save/load must preserve expedition income separately from a multi-purchase trade history');

const finalPurchase = restored.purchase(
  { id: 'dragonstone-field-ration', itemId: 'dragonstone-field-ration' },
  () => true,
);
assert.equal(finalPurchase.ok, true);
const exhausted = restored.snapshot();
assert.equal(exhausted.copper, 28);
assert.equal(exhausted.stockByOffer['dragonstone-field-ration'], 0);
assert.equal(exhausted.ledger.transactionCount, 4);
assert.equal(exhausted.ledger.recentCredits[0].sourceId, 'expedition-contract:dragonstone-harbor-tavern-run');
assert.equal(exhausted.ledger.recentCredits[0].balanceCopper, 52);
assert.match(buildQuartermasterText(exhausted), /Son işlem: #4 Dragonstone saha azığı · 6 bakır · bakiye 28/);

const blocked = restored.purchase(
  { id: 'dragonstone-field-ration', itemId: 'dragonstone-field-ration' },
  () => true,
);
assert.equal(blocked.ok, false, 'exhausted finite stock must block further purchases');
assert.deepEqual(restored.snapshot(), exhausted, 'blocked stock-exhausted purchase must be atomic across wallet, trade and expedition receipt ledgers');

console.log('Interaction expedition reward multi-trade continuity acceptance PASS');
