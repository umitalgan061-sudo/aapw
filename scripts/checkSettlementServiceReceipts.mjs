import assert from 'node:assert/strict';
import {
  buildSettlementServiceReceipt,
  buildSettlementServiceReceiptLedger,
  listSettlementServiceReceiptRoles,
  serializeSettlementServiceReceiptLedger,
  validateSettlementServiceReceiptLedger,
} from '../src/3d/gameplay/settlementServiceReceipts.js';

const first = buildSettlementServiceReceipt({ role: 'market', action: 'buy', status: 'completed', copperDelta: -12.8, xpDelta: 2.9, itemIds: ['apple', 'apple', ''], atSequence: 2 });
assert.equal(first.role, 'market');
assert.equal(first.copperDelta, -12);
assert.deepEqual(first.itemIds, ['apple', 'apple']);
assert.equal(buildSettlementServiceReceipt({ role: 'unknown' }), null);
assert.equal(buildSettlementServiceReceipt({ role: 'tavern', status: 'invalid' }).status, 'blocked');

const entries = [
  first,
  { role: 'blacksmith', action: 'craft', status: 'executed', copperDelta: 5, xpDelta: 9, atSequence: 3 },
  { role: 'tavern', action: 'rest', status: 'blocked', reason: 'fatigue', atSequence: 4 },
];
const ledgerA = buildSettlementServiceReceiptLedger(entries, { settlementId: 'northwatch', limit: 8 });
const ledgerB = buildSettlementServiceReceiptLedger(entries, { settlementId: 'northwatch', limit: 8 });
assert.deepEqual(ledgerA, ledgerB);
assert.equal(ledgerA.receiptCount, 3);
assert.equal(ledgerA.totals.completed, 2);
assert.equal(ledgerA.totals.blocked, 1);
assert.equal(ledgerA.totals.itemCount, 2);
assert.equal(validateSettlementServiceReceiptLedger(ledgerA).ok, true);
assert.equal(serializeSettlementServiceReceiptLedger(ledgerA), serializeSettlementServiceReceiptLedger(ledgerB));
assert.equal(Object.isFrozen(ledgerA), true);
assert.equal(Object.isFrozen(ledgerA.receipts), true);
assert.deepEqual(listSettlementServiceReceiptRoles(), ['gate', 'market', 'tavern', 'blacksmith', 'farm', 'barracks', 'stable', 'house']);

const invalid = validateSettlementServiceReceiptLedger({ version: 0, settlementId: '', receipts: [{ role: 'oops' }] });
assert.equal(invalid.ok, false);
assert.ok(invalid.errors.includes('unsupported-version'));
assert.ok(invalid.errors.includes('missing-settlement-id'));

console.log('settlement service receipts: ok');
