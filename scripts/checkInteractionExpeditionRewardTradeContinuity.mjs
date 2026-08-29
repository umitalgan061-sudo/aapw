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

const transactionsBeforeLaterReward = structuredClone(exhausted.ledger.recentTransactions);
const laterReward = restored.credit(9, {
  sourceId: 'expedition-contract:dragonstone-gate-patrol',
  label: 'Kapı Devriyesi Seferi',
});
assert.equal(laterReward.ok, true);
const afterLaterReward = restored.snapshot();
assert.equal(afterLaterReward.copper, 37, 'later expedition income should credit the post-trade wallet');
assert.deepEqual(
  afterLaterReward.ledger.recentTransactions,
  transactionsBeforeLaterReward,
  'later expedition income must not rewrite the finite-stock trade history',
);
assert.deepEqual(
  afterLaterReward.ledger.recentCredits.map(({ sequence, sourceId, creditedCopper, balanceCopper }) => ({ sequence, sourceId, creditedCopper, balanceCopper })),
  [
    { sequence: 1, sourceId: 'expedition-contract:dragonstone-harbor-tavern-run', creditedCopper: 12, balanceCopper: 52 },
    { sequence: 2, sourceId: 'expedition-contract:dragonstone-gate-patrol', creditedCopper: 9, balanceCopper: 37 },
  ],
  'credit sequencing must remain independent from four prior trade transactions',
);
const laterRewardText = buildQuartermasterText(afterLaterReward);
assert.match(laterRewardText, /Kese: 37 bakır/);
assert.match(laterRewardText, /Son gelir: Kapı Devriyesi Seferi · \+9 bakır · bakiye 37/);
assert.match(laterRewardText, /Son işlem: #4 Dragonstone saha azığı · 6 bakır · bakiye 28/);

const blockedAfterLaterReward = restored.purchase(
  { id: 'dragonstone-field-ration', itemId: 'dragonstone-field-ration' },
  () => true,
);
assert.equal(blockedAfterLaterReward.ok, false, 'later expedition income must not replenish exhausted quartermaster stock');
assert.deepEqual(
  restored.snapshot(),
  afterLaterReward,
  'blocked post-income purchase must preserve the new expedition receipt, historical trade receipt and wallet atomically',
);
const blockedAfterLaterRewardText = buildQuartermasterText(restored.snapshot());
assert.match(blockedAfterLaterRewardText, /Kese: 37 bakır/);
assert.match(blockedAfterLaterRewardText, /Son gelir: Kapı Devriyesi Seferi · \+9 bakır · bakiye 37/);
assert.match(blockedAfterLaterRewardText, /Son işlem: #4 Dragonstone saha azığı · 6 bakır · bakiye 28/);

const beforeInvalidCredits = structuredClone(restored.snapshot());
for (const invalidAmount of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY]) {
  const rejectedCredit = restored.credit(invalidAmount, {
    sourceId: 'expedition-contract:forged-invalid-reward',
    label: 'Geçersiz Sefer Ödülü',
  });
  assert.equal(rejectedCredit.ok, false, `invalid expedition credit ${String(invalidAmount)} must be rejected`);
  assert.equal(rejectedCredit.reason, 'invalid-credit');
  assert.equal(rejectedCredit.balanceCopper, 37);
  assert.deepEqual(
    restored.snapshot(),
    beforeInvalidCredits,
    'rejected expedition income must not advance credit sequence, alter trade history, replenish stock or change the wallet',
  );
}
assert.match(buildQuartermasterText(restored.snapshot()), /Son gelir: Kapı Devriyesi Seferi · \+9 bakır · bakiye 37/);
assert.match(buildQuartermasterText(restored.snapshot()), /Son işlem: #4 Dragonstone saha azığı · 6 bakır · bakiye 28/);

const roundTrip = createInteractionEconomyState();
roundTrip.restore(afterLaterReward);
assert.deepEqual(
  roundTrip.snapshot(),
  afterLaterReward,
  'save/load must preserve independent latest-income and latest-trade receipts after both ledger directions have advanced',
);

console.log('Interaction expedition reward multi-trade continuity acceptance PASS');
