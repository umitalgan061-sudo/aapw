import assert from 'node:assert/strict';
import { createInteractionEconomyState } from '../src/3d/gameplay/interactionEconomy.js';

const economy = createInteractionEconomyState(40);
const firstReward = economy.credit(12, {
  sourceId: 'expedition-contract:dragonstone-harbor-tavern-run',
  label: 'Liman Taverna Seferi',
});
assert.equal(firstReward.ok, true);

const purchase = economy.purchase(
  { id: 'dragonstone-field-ration', itemId: 'dragonstone-field-ration' },
  () => true,
);
assert.equal(purchase.ok, true);

const secondReward = economy.credit(9, {
  sourceId: 'expedition-contract:dragonstone-gate-patrol',
  label: 'Kapı Devriyesi Seferi',
});
assert.equal(secondReward.ok, true);

const stableState = structuredClone(economy.snapshot());
assert.equal(stableState.copper, 55);
assert.equal(stableState.stockByOffer['dragonstone-field-ration'], 3);
assert.equal(stableState.ledger.transactionCount, 1);
assert.equal(stableState.ledger.recentCredits.length, 2);

for (const forgedOffer of [
  null,
  {},
  { id: 'unknown-quartermaster-offer', itemId: 'dragonstone-field-ration' },
  { id: 'dragonstone-field-ration', itemId: 'forged-item-id' },
]) {
  let grantCalls = 0;
  const rejected = economy.purchase(forgedOffer, () => {
    grantCalls += 1;
    return true;
  });
  assert.equal(rejected.ok, false, 'unknown or mismatched offers must be rejected');
  assert.equal(rejected.reason, 'invalid-offer');
  assert.equal(grantCalls, 0, 'invalid offers must be rejected before inventory fulfillment');
  assert.deepEqual(
    economy.snapshot(),
    stableState,
    'invalid offer rejection must preserve wallet, finite stock, trade history and expedition provenance atomically',
  );
}

let missingGrantMutationCalls = 0;
const missingGrant = economy.purchase(
  { id: 'dragonstone-field-ration', itemId: 'dragonstone-field-ration' },
  null,
);
assert.equal(missingGrant.ok, false);
assert.equal(missingGrant.reason, 'invalid-offer');
assert.equal(missingGrantMutationCalls, 0);
assert.deepEqual(
  economy.snapshot(),
  stableState,
  'missing inventory fulfillment must not mutate settlement economy or expedition receipts',
);

console.log('Interaction expedition trade quote atomicity acceptance PASS');
