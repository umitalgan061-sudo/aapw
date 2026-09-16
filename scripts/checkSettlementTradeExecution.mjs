import assert from 'node:assert/strict';
import { buildSettlementTradeActionIntent, buildSettlementTradePanel } from '../src/3d/gameplay/settlementTradeUx.js';
import { executeSettlementTradeIntent } from '../src/3d/gameplay/settlementTradeExecution.js';

const panel = buildSettlementTradePanel({
  economySnapshot: { copper: 10, stockByOffer: { ration: 2 } },
  inventorySnapshot: { items: [{ itemId: 'field-ration', name: 'Saha azığı', quantity: 2 }] },
  offers: [{ id: 'ration', itemId: 'field-ration', label: 'Saha azığı', priceCopper: 6, stockLimit: 4 }],
  service: { serviceId: 'dragonstone-market' },
});
const intent = buildSettlementTradeActionIntent(panel, { action: 'buy', offerId: 'ration', expectedFingerprint: panel.snapshotFingerprint });
let calls = 0;
const result = executeSettlementTradeIntent(intent, {
  currentFingerprint: panel.snapshotFingerprint,
  purchase: (offerId, quantity, metadata) => {
    calls += 1;
    assert.equal(offerId, 'ration');
    assert.equal(quantity, 1);
    assert.equal(metadata.expectedCopper, 6);
    return { ok: true, transactionId: 'buy-1' };
  },
});
assert.deepEqual(result, { ok: true, transactionId: 'buy-1' });
assert.equal(calls, 1);
let staleCalls = 0;
const stale = executeSettlementTradeIntent(intent, {
  currentFingerprint: 'changed',
  purchase: () => { staleCalls += 1; return { ok: true }; },
});
assert.equal(stale.reason, 'stale-trade-snapshot');
assert.equal(staleCalls, 0);
console.log(JSON.stringify({ ok: true, delegated: calls, staleRejected: true }));
