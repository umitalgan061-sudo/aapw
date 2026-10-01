import assert from 'node:assert/strict';
import { buildSettlementTradeActionIntent, buildSettlementTradePanel } from './settlementTradeUx.js';
import { executeSettlementTradeIntent } from './settlementTradeExecution.js';

const panel = buildSettlementTradePanel({
  economySnapshot: { copper: 10, stockByOffer: { ration: 2 } },
  inventorySnapshot: { items: [{ itemId: 'field-ration', name: 'Saha azığı', quantity: 2 }] },
  offers: [{ id: 'ration', itemId: 'field-ration', label: 'Saha azığı', priceCopper: 6, stockLimit: 4 }],
  service: { serviceId: 'dragonstone-market' },
});

const buyIntent = buildSettlementTradeActionIntent(panel, {
  action: 'buy',
  offerId: 'ration',
  quantity: 1,
  expectedFingerprint: panel.snapshotFingerprint,
});
let purchaseCalls = 0;
const buyResult = executeSettlementTradeIntent(buyIntent, {
  currentFingerprint: panel.snapshotFingerprint,
  purchase: (offerId, quantity, metadata) => {
    purchaseCalls += 1;
    assert.equal(offerId, 'ration');
    assert.equal(quantity, 1);
    assert.equal(metadata.expectedCopper, 6);
    return { ok: true, transactionId: 'buy-1' };
  },
});
assert.deepEqual(buyResult, { ok: true, transactionId: 'buy-1' });
assert.equal(purchaseCalls, 1);

const sellIntent = buildSettlementTradeActionIntent(panel, {
  action: 'sell',
  itemId: 'field-ration',
  quantity: 1,
  expectedFingerprint: panel.snapshotFingerprint,
});
let sellCalls = 0;
const sellResult = executeSettlementTradeIntent(sellIntent, {
  currentFingerprint: panel.snapshotFingerprint,
  sell: (itemId, quantity, metadata) => {
    sellCalls += 1;
    assert.equal(itemId, 'field-ration');
    assert.equal(quantity, 1);
    assert.equal(metadata.expectedCopper, 3);
    return { ok: true, transactionId: 'sell-1' };
  },
});
assert.deepEqual(sellResult, { ok: true, transactionId: 'sell-1' });
assert.equal(sellCalls, 1);

let staleCalls = 0;
const staleResult = executeSettlementTradeIntent(buyIntent, {
  currentFingerprint: 'changed',
  purchase: () => { staleCalls += 1; return { ok: true }; },
});
assert.equal(staleResult.ok, false);
assert.equal(staleResult.reason, 'stale-trade-snapshot');
assert.equal(staleCalls, 0);

assert.equal(executeSettlementTradeIntent(buyIntent).reason, 'purchase-handler-unavailable');
assert.equal(executeSettlementTradeIntent({ ok: false, reason: 'insufficient-funds' }).reason, 'insufficient-funds');
assert.equal(executeSettlementTradeIntent({ ok: true, action: 'craft' }).reason, 'unsupported-action');

console.log(JSON.stringify({ ok: true, purchaseCalls, sellCalls, staleRejected: true }));
