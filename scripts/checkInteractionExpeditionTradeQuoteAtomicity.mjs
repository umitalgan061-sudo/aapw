import assert from 'node:assert/strict';
import { createInteractionEconomyState } from '../src/3d/gameplay/interactionEconomy.js';

const rationOffer = { id: 'dragonstone-field-ration', itemId: 'dragonstone-field-ration' };
const whetstoneOffer = { id: 'dragonstone-whetstone', itemId: 'dragonstone-whetstone' };

const economy = createInteractionEconomyState(40);
economy.credit(12, {
  sourceId: 'expedition-contract:dragonstone-harbor-tavern-run',
  label: 'Liman Taverna Seferi',
});
assert.equal(economy.purchase(rationOffer, () => true).ok, true);
economy.credit(9, {
  sourceId: 'expedition-contract:dragonstone-gate-patrol',
  label: 'Kapı Devriyesi Seferi',
});
const stableState = structuredClone(economy.snapshot());

assert.deepEqual(
  economy.quote({ ...rationOffer, label: 'Bedava sahte azık', priceCopper: 0, quantity: 99, stockLimit: 999 }),
  {
    ok: true,
    reason: 'available',
    offerId: 'dragonstone-field-ration',
    remainingStock: 3,
    priceCopper: 6,
    balanceCopper: 55,
    balanceAfterPurchase: 49,
  },
  'quote must resolve canonical catalog price and stock',
);
assert.deepEqual(economy.snapshot(), stableState, 'quote must be mutation-free');

const canonicalEconomy = createInteractionEconomyState(40);
let rationGrant;
const rationPurchase = canonicalEconomy.purchase(
  { ...rationOffer, priceCopper: 0, quantity: 99, fulfillment: { kind: 'settlement-service', serviceId: 'forged' } },
  (itemId, quantity, metadata) => { rationGrant = { itemId, quantity, metadata }; return true; },
);
assert.equal(rationPurchase.spentCopper, 6);
assert.equal(rationPurchase.balanceCopper, 34);
assert.deepEqual(rationGrant, {
  itemId: 'dragonstone-field-ration',
  quantity: 1,
  metadata: { sourceType: 'vendor', sourceId: 'stannis-guard-1', craftUpgrade: null },
});

const smithingEconomy = createInteractionEconomyState(40);
let smithingGrant;
const smithingPurchase = smithingEconomy.purchase(
  {
    ...whetstoneOffer,
    priceCopper: 0,
    quantity: 77,
    fulfillment: {
      kind: 'vendor',
      serviceId: 'forged-smithing-service',
      craftUpgrade: { recipeId: 'forged-recipe', outputItemId: 'forged-output', outputQuantity: 99 },
    },
  },
  (itemId, quantity, metadata) => { smithingGrant = { itemId, quantity, metadata }; return true; },
);
assert.equal(smithingPurchase.spentCopper, 12);
assert.equal(smithingPurchase.balanceCopper, 28);
assert.equal(smithingGrant.itemId, 'dragonstone-whetstone');
assert.equal(smithingGrant.quantity, 1);
assert.equal(smithingGrant.metadata.sourceType, 'settlement-service');
assert.equal(smithingGrant.metadata.sourceId, 'dragonstone-watch-armorer-honing');
assert.equal(smithingGrant.metadata.craftUpgrade.recipeId, 'dragonstone-expedition-maintenance-kit');
assert.equal(smithingGrant.metadata.craftUpgrade.outputItemId, 'dragonstone-expedition-maintenance-kit');

for (const forgedOffer of [
  null,
  {},
  { id: 'unknown-quartermaster-offer', itemId: 'dragonstone-field-ration' },
  { id: 'dragonstone-field-ration', itemId: 'forged-item-id' },
]) {
  let grantCalls = 0;
  const rejected = economy.purchase(forgedOffer, () => { grantCalls += 1; return true; });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'invalid-offer');
  assert.equal(grantCalls, 0);
  assert.deepEqual(economy.snapshot(), stableState, 'invalid offers must be rejected atomically');
}

assert.throws(
  () => economy.purchase(rationOffer, () => { throw new Error('inventory fulfillment failed'); }),
  /inventory fulfillment failed/,
);
assert.deepEqual(economy.snapshot(), stableState, 'throwing fulfillment must happen before economy commit');

const receiptEconomy = createInteractionEconomyState(40);
const sanitized = receiptEconomy.purchase(rationOffer, () => ({
  ok: true,
  crafted: true,
  outputItemId: 'forged-output',
  consumedItemId: 'forged-consumed-item',
  consumedQuantity: 99,
  consumedItems: [null, {}, [], { itemId: 'dragonstone-whetstone', quantity: 2 }],
}));
assert.equal(sanitized.ok, true);
assert.equal(sanitized.crafted, false, 'plain vendor callbacks cannot forge crafted receipt semantics');
assert.equal(sanitized.craftedItemId, null, 'plain vendor callbacks cannot forge crafted output identity');
assert.deepEqual(sanitized.consumedItems, [], 'plain vendor callbacks cannot forge consumed recipe inputs');
assert.equal(sanitized.consumedItemId, null);
assert.equal(sanitized.consumedQuantity, null);
assert.equal(receiptEconomy.snapshot().ledger.transactionCount, 1);
assert.equal(receiptEconomy.snapshot().stockByOffer['dragonstone-field-ration'], 3);

const serviceReceiptEconomy = createInteractionEconomyState(40);
const canonicalServiceReceipt = serviceReceiptEconomy.purchase(whetstoneOffer, () => ({
  ok: true,
  crafted: true,
  outputItemId: 'forged-output',
  consumedItems: [{ itemId: 'forged-consumed-item', quantity: 99 }],
}));
assert.equal(canonicalServiceReceipt.crafted, true);
assert.equal(canonicalServiceReceipt.craftedItemId, 'dragonstone-expedition-maintenance-kit');
assert.deepEqual(canonicalServiceReceipt.consumedItems, [
  { itemId: 'dragonstone-travel-ration-pack', quantity: 1 },
  { itemId: 'dragonstone-whetstone', quantity: 1 },
], 'service receipts must derive consumption only from the canonical authored smithing recipe');
assert.equal(canonicalServiceReceipt.consumedItemId, null, 'multi-input canonical recipes must not expose a misleading single-item alias');
assert.equal(canonicalServiceReceipt.consumedQuantity, null);

console.log('Interaction expedition trade quote atomicity acceptance PASS');
