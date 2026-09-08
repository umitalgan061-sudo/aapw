import assert from 'node:assert/strict';
import { createSettlementTradeHistory } from '../src/3d/gameplay/settlementTradeHistory.js';
import { createSettlementTradeHistoryViewModel } from '../src/3d/gameplay/settlementTradeHistoryViewModel.js';

const history = createSettlementTradeHistory({ limit: 3 });
history.add({ ok: true, kind: 'buy', subject: 'iron-ore', quantity: 2, copper: 14, snapshotFingerprint: 'a' });
history.add({ ok: false, kind: 'sell', subject: 'hide', quantity: 1, copper: 0, reason: 'stale-trade-snapshot', snapshotFingerprint: 'b' });
history.add({ ok: true, kind: 'sell', subject: 'coal', quantity: 3, copper: 21, snapshotFingerprint: 'c' });

const view = createSettlementTradeHistoryViewModel(history);
assert.equal(view.empty, false);
assert.equal(view.rows.length, 3);
assert.equal(view.rows[0].label, 'Sell · coal ×3 · Successful · 21 copper');
assert.equal(view.rows[1].label, 'Sell · hide ×1 · Failed · stale-trade-snapshot');
assert.deepEqual(view.totals, { trades: 3, successful: 2, failed: 1, copper: 35, quantity: 5 });

const empty = createSettlementTradeHistoryViewModel(null);
assert.equal(empty.empty, true);
assert.deepEqual(empty.totals, { trades: 0, successful: 0, failed: 0, copper: 0, quantity: 0 });
console.log('Settlement trade history view model contract: PASS');
