import assert from 'node:assert/strict';
import { createInteractionEconomyState } from '../src/3d/gameplay/interactionEconomy.js';

const economy = createInteractionEconomyState(40);
const reward = economy.credit(12, {
  sourceId: 'expedition-contract:dragonstone-harbor-tavern-run',
  label: 'Liman Taverna Seferi',
});
assert.equal(reward.ok, true);

for (let index = 1; index <= 4; index += 1) {
  const purchase = economy.purchase(
    { id: 'dragonstone-field-ration', itemId: 'dragonstone-field-ration' },
    () => true,
  );
  assert.equal(purchase.ok, true, `quartermaster purchase ${index} should succeed`);
  const snapshot = economy.snapshot();
  assert.equal(snapshot.copper, 52 - index * 6);
  assert.deepEqual(snapshot.ledger.recentCredits, [reward.receipt], 'trade must not mutate expedition provenance');
  assert.equal(snapshot.ledger.recentTransactions.at(-1)?.sequence, index);
}

const exhausted = economy.snapshot();
assert.equal(exhausted.copper, 28);
assert.equal(exhausted.stockByOffer['dragonstone-field-ration'], 0);
assert.equal(exhausted.ledger.transactionCount, 4);
assert.equal(exhausted.ledger.lifetimeSpentCopper, 24);
assert.equal(exhausted.ledger.recentCredits[0].balanceCopper, 52);

const transactionsBeforeLaterReward = structuredClone(exhausted.ledger.recentTransactions);
const laterReward = economy.credit(9, {
  sourceId: 'expedition-contract:dragonstone-gate-patrol',
  label: 'Kapı Devriyesi Seferi',
});
assert.equal(laterReward.ok, true);
const afterLaterReward = economy.snapshot();
assert.equal(afterLaterReward.copper, 37);
assert.deepEqual(afterLaterReward.ledger.recentTransactions, transactionsBeforeLaterReward);
assert.deepEqual(
  afterLaterReward.ledger.recentCredits.map(({ sourceId, creditedCopper, balanceCopper }) => ({ sourceId, creditedCopper, balanceCopper })),
  [
    { sourceId: 'expedition-contract:dragonstone-harbor-tavern-run', creditedCopper: 12, balanceCopper: 52 },
    { sourceId: 'expedition-contract:dragonstone-gate-patrol', creditedCopper: 9, balanceCopper: 37 },
  ],
);

let grantCalls = 0;
const blocked = economy.purchase(
  { id: 'dragonstone-field-ration', itemId: 'dragonstone-field-ration' },
  () => { grantCalls += 1; return true; },
);
assert.equal(blocked.ok, false);
assert.equal(blocked.reason, 'out-of-stock');
assert.equal(grantCalls, 0);
assert.deepEqual(economy.snapshot(), afterLaterReward, 'out-of-stock rejection must be atomic');

const beforeInventoryReject = structuredClone(afterLaterReward);
const inventoryReject = economy.purchase(
  { id: 'dragonstone-whetstone', itemId: 'dragonstone-whetstone' },
  () => ({ ok: false, reason: 'inventory-full' }),
);
assert.equal(inventoryReject.ok, false);
assert.equal(inventoryReject.reason, 'inventory-full');
assert.deepEqual(economy.snapshot(), beforeInventoryReject, 'inventory rejection must preserve wallet, stock and both ledgers');

const restored = createInteractionEconomyState();
restored.restore(afterLaterReward);
assert.deepEqual(restored.snapshot(), afterLaterReward, 'save/load must preserve independent reward and trade histories');

console.log('Interaction expedition reward multi-trade continuity acceptance PASS');
