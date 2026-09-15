import assert from 'node:assert/strict';
import { createSettlementTradePreview, validateSettlementTradePreview } from '../src/3d/gameplay/settlementTradePreviewProjection.js';

const input = {
  inSettlement: true,
  gold: 20,
  serviceReady: true,
  items: [
    { id: 'ore', label: 'Iron Ore', category: 'material', unitPrice: 12, stock: 3, quantity: 0 },
    { id: 'bread', label: 'Bread', category: 'food', unitPrice: 4, stock: 0, quantity: 2 }
  ]
};
const preview = createSettlementTradePreview(input);
assert.equal(validateSettlementTradePreview(preview), true);
assert.equal(preview.available.length, 2);
assert.equal(preview.available[0].id, 'bread');
assert.equal(preview.available[0].canSell, true);
assert.equal(preview.available[1].canBuy, true);
assert.equal(Object.isFrozen(preview), true);
assert.equal(createSettlementTradePreview(input).fingerprint, preview.fingerprint);
assert.equal(createSettlementTradePreview({ ...input, inSettlement: false }).available.length, 0);
assert.equal(createSettlementTradePreview({ ...input, gold: 1 }).blocked.some((row) => row.reason === 'insufficient-gold'), true);
assert.equal(createSettlementTradePreview({ ...input, defeated: true }).blocked.every((row) => row.reason === 'settlement-defeated'), true);
console.log('settlement trade preview projection: PASS');
