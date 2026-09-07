import assert from 'node:assert/strict';
import { buildSettlementTradeReceipt } from '../src/3d/gameplay/settlementTradeReceipt.js';

const intent = Object.freeze({ action: 'buy', offerId: 'iron-sword', quantity: 2, expectedCopper: 140, snapshotFingerprint: 'abcd1234' });
const success = buildSettlementTradeReceipt({ intent, result: { ok: true } });
assert.deepEqual(success, {
  ok: true,
  action: 'buy',
  subject: 'iron-sword',
  quantity: 2,
  expectedCopper: 140,
  currency: 'copper',
  reason: 'completed',
  message: 'Purchased 2 × iron-sword for 140 copper.',
  snapshotFingerprint: 'abcd1234',
});

const failed = buildSettlementTradeReceipt({
  intent: { action: 'sell', itemId: 'wolf-pelt', quantity: 1, expectedCopper: 18 },
  result: { ok: false, reason: 'stale-trade-snapshot' },
});
assert.equal(failed.ok, false);
assert.equal(failed.reason, 'stale-trade-snapshot');
assert.match(failed.message, /Trade failed/);

const malformed = buildSettlementTradeReceipt({ intent: null, result: null });
assert.equal(malformed.action, null);
assert.equal(malformed.quantity, 0);
assert.equal(malformed.expectedCopper, 0);
assert.equal(malformed.reason, 'invalid-trade-intent');

const invalidSuccess = buildSettlementTradeReceipt({
  intent: { action: 'buy', quantity: 0, expectedCopper: 20 },
  result: { ok: true },
});
assert.equal(invalidSuccess.ok, false);
assert.equal(invalidSuccess.reason, 'invalid-trade-intent');

const customCurrency = buildSettlementTradeReceipt({
  intent: { action: 'sell', itemId: 'ore', quantity: 3, expectedCopper: 9 },
  result: { ok: true },
  currency: 'silver-pennies',
});
assert.equal(customCurrency.currency, 'silver-pennies');
assert.equal(customCurrency.message, 'Sold 3 × ore for 9 silver-pennies.');

console.log('Settlement trade receipt contract passed.');
