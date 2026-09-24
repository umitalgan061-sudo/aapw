import assert from 'node:assert/strict';
import { createSettlementSmithingPlan, isSettlementSmithingPlan } from '../src/3d/gameplay/settlementSmithingPlan.ts';

const offers = [
  { id: 'whetstone-kit', itemId: 'maintenance-kit', label: 'Bakım kiti', priceCopper: 4, quantity: 1, fulfillment: { craftUpgrade: { inputs: [{ itemId: 'iron-ingot', quantity: 2 }, { itemId: 'leather-strip', quantity: 1 }], outputItemId: 'maintenance-kit', outputQuantity: 1, label: 'Bakım kiti üret' } } },
  { id: 'ration-kit', itemId: 'ration-kit', priceCopper: 0, quantity: 1, fulfillment: { craftUpgrade: { inputItemId: 'field-ration', inputQuantity: 2, outputItemId: 'ration-kit', outputQuantity: 1, label: 'Azık paketi üret' } } },
];

const ready = createSettlementSmithingPlan({ offers, inventory: { 'iron-ingot': 2, 'leather-strip': 1, 'field-ration': 2 }, copper: 12, selectedOfferId: 'whetstone-kit' });
assert.equal(ready.status, 'ready');
assert.equal(ready.selectedOfferId, 'whetstone-kit');
assert.equal(ready.rows[0].offerId, 'ration-kit');
assert.equal(ready.rows[1].offerId, 'whetstone-kit');
assert.equal(ready.rows[1].missing.length, 0);
assert.equal(isSettlementSmithingPlan(ready), true);
assert.equal(Object.isFrozen(ready.rows[1]), true);

const missing = createSettlementSmithingPlan({ offers, inventory: { 'iron-ingot': 1 }, copper: 12 });
assert.equal(missing.rows.find((row) => row.offerId === 'whetstone-kit').status, 'missing-materials');
assert.equal(missing.rows.find((row) => row.offerId === 'whetstone-kit').missing[0].missing, 1);

const poor = createSettlementSmithingPlan({ offers, inventory: { 'iron-ingot': 2, 'leather-strip': 1 }, copper: 1 });
assert.equal(poor.rows.find((row) => row.offerId === 'whetstone-kit').status, 'insufficient-copper');

const blocked = createSettlementSmithingPlan({ offers, inventory: {}, copper: 99, available: false });
assert.equal(blocked.reason, 'service-unavailable');
assert.equal(blocked.rows.length, 0);

const unsupported = createSettlementSmithingPlan({ serviceId: 'market', offers, inventory: {}, copper: 99 });
assert.equal(unsupported.reason, 'unsupported-service');

const first = createSettlementSmithingPlan({ offers: [...offers].reverse(), inventory: { 'iron-ingot': 2, 'leather-strip': 1, 'field-ration': 2 }, copper: 12 });
const second = createSettlementSmithingPlan({ offers, inventory: { 'field-ration': 2, 'leather-strip': 1, 'iron-ingot': 2 }, copper: 12 });
assert.equal(first.signature, second.signature);
assert.throws(() => { ready.rows.push({}); }, TypeError);
console.log('Settlement smithing plan proof: PASS');
