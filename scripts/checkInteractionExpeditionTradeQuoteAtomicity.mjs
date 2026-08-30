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

const forgedCanonicalQuote = economy.quote({
  id: 'dragonstone-field-ration',
  itemId: 'dragonstone-field-ration',
  label: 'Bedava sahte azık',
  priceCopper: 0,
  quantity: 99,
  stockLimit: 999,
  fulfillment: {
    kind: 'settlement-service',
    serviceId: 'forged-free-service',
  },
});
assert.deepEqual(
  forgedCanonicalQuote,
  {
    ok: true,
    reason: 'available',
    offerId: 'dragonstone-field-ration',
    remainingStock: 3,
    priceCopper: 6,
    balanceCopper: 55,
    balanceAfterPurchase: 49,
  },
  'matching ids must resolve back to the canonical quartermaster catalog instead of trusting caller-authored price or stock fields',
);
assert.deepEqual(
  economy.snapshot(),
  stableState,
  'quoting a field-forged canonical offer must remain mutation-free',
);

const canonicalizationEconomy = createInteractionEconomyState(40);
let canonicalGrant = null;
const canonicalizedPurchase = canonicalizationEconomy.purchase(
  {
    id: 'dragonstone-field-ration',
    itemId: 'dragonstone-field-ration',
    priceCopper: 0,
    quantity: 99,
    fulfillment: {
      kind: 'settlement-service',
      serviceId: 'forged-free-service',
    },
  },
  (itemId, quantity, metadata) => {
    canonicalGrant = { itemId, quantity, metadata };
    return true;
  },
);
assert.equal(canonicalizedPurchase.ok, true);
assert.equal(canonicalizedPurchase.spentCopper, 6);
assert.equal(canonicalizedPurchase.balanceCopper, 34);
assert.equal(canonicalizedPurchase.remainingStock, 3);
assert.deepEqual(
  canonicalGrant,
  {
    itemId: 'dragonstone-field-ration',
    quantity: 1,
    metadata: {
      sourceType: 'vendor',
      sourceId: 'stannis-guard-1',
      craftUpgrade: null,
    },
  },
  'purchase fulfillment must use canonical quantity and vendor provenance rather than forged caller fields',
);

const smithingCanonicalizationEconomy = createInteractionEconomyState(40);
let smithingGrant = null;
const smithingPurchase = smithingCanonicalizationEconomy.purchase(
  {
    id: 'dragonstone-whetstone',
    itemId: 'dragonstone-whetstone',
    priceCopper: 0,
    quantity: 77,
    stockLimit: 900,
    fulfillment: {
      kind: 'vendor',
      serviceId: 'forged-smithing-service',
      craftUpgrade: {
        recipeId: 'forged-recipe',
        outputItemId: 'forged-output',
        outputQuantity: 99,
      },
    },
  },
  (itemId, quantity, metadata) => {
    smithingGrant = { itemId, quantity, metadata };
    return true;
  },
);
assert.equal(smithingPurchase.ok, true);
assert.equal(smithingPurchase.spentCopper, 12);
assert.equal(smithingPurchase.balanceCopper, 28);
assert.equal(smithingPurchase.remainingStock, 1);
assert.equal(smithingGrant.itemId, 'dragonstone-whetstone');
assert.equal(smithingGrant.quantity, 1);
assert.equal(smithingGrant.metadata.sourceType, 'settlement-service');
assert.equal(smithingGrant.metadata.sourceId, 'dragonstone-watch-armorer-honing');
assert.deepEqual(
  smithingGrant.metadata.craftUpgrade,
  {
    recipeId: 'dragonstone-expedition-maintenance-kit',
    inputs: [
      { itemId: 'dragonstone-travel-ration-pack', quantity: 1 },
      { itemId: 'dragonstone-whetstone', quantity: 1 },
    ],
    outputItemId: 'dragonstone-expedition-maintenance-kit',
    outputQuantity: 1,
    label: '1 yol azığı paketi + 1 bileği taşını 1 sefer bakım kitine hazırla',
  },
  'smithing fulfillment must expose only the canonical recipe contract to inventory/crafting integration',
);
assert.deepEqual(
  smithingCanonicalizationEconomy.snapshot().ledger.purchasesByOffer,
  {
    'dragonstone-field-ration': 0,
    'dragonstone-whetstone': 1,
    'dragonstone-watch-ration-allotment': 0,
  },
  'forged stock metadata must not inflate smithing purchase history',
);

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

const missingGrant = economy.purchase(
  { id: 'dragonstone-field-ration', itemId: 'dragonstone-field-ration' },
  null,
);
assert.equal(missingGrant.ok, false);
assert.equal(missingGrant.reason, 'invalid-offer');
assert.deepEqual(
  economy.snapshot(),
  stableState,
  'missing inventory fulfillment must not mutate settlement economy or expedition receipts',
);

const throwingGrantState = structuredClone(economy.snapshot());
assert.throws(
  () => economy.purchase(
    { id: 'dragonstone-field-ration', itemId: 'dragonstone-field-ration' },
    () => {
      throw new Error('inventory fulfillment failed');
    },
  ),
  /inventory fulfillment failed/,
  'inventory/service exceptions may propagate but must happen before settlement economy commit',
);
assert.deepEqual(
  economy.snapshot(),
  throwingGrantState,
  'throwing inventory fulfillment must preserve wallet, finite stock, trade ledger and expedition provenance atomically',
);

const malformedReceiptEconomy = createInteractionEconomyState(40);
const malformedReceiptPurchase = malformedReceiptEconomy.purchase(
  { id: 'dragonstone-field-ration', itemId: 'dragonstone-field-ration' },
  () => ({
    ok: true,
    crafted: true,
    outputItemId: 'dragonstone-expedition-maintenance-kit',
    consumedItems: [null, {}, [], { itemId: 'dragonstone-whetstone', quantity: 2 }],
  }),
);
assert.equal(malformedReceiptPurchase.ok, true);
assert.equal(malformedReceiptPurchase.balanceCopper, 34);
assert.equal(malformedReceiptPurchase.remainingStock, 3);
assert.deepEqual(
  malformedReceiptPurchase.consumedItems,
  [{ itemId: 'dragonstone-whetstone', quantity: 2 }],
  'malformed crafting receipt entries must be filtered before the settlement trade transaction commits',
);
assert.equal(malformedReceiptEconomy.snapshot().ledger.transactionCount, 1);
assert.equal(malformedReceiptEconomy.snapshot().stockByOffer['dragonstone-field-ration'], 3);

console.log('Interaction expedition trade quote atomicity acceptance PASS');
