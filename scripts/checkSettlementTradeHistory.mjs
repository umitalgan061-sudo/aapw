import assert from 'node:assert/strict';
import { createSettlementTradeHistory } from '../src/3d/gameplay/settlementTradeHistory.js';

const receipt = (overrides = {}) => ({
  ok: true,
  kind: 'buy',
  subject: 'iron-ore',
  quantity: 2,
  copper: 14,
  snapshotFingerprint: 'market-a',
  message: 'Bought 2 iron-ore for 14 copper.',
  ...overrides,
});

const history = createSettlementTradeHistory({ limit: 2 });
assert.equal(history.add(receipt()).added, true);
assert.equal(history.add(receipt()).reason, 'duplicate-trade-receipt');
assert.equal(history.add(receipt({ subject: 'coal', snapshotFingerprint: 'market-b' })).added, true);
assert.equal(history.add(receipt({ subject: 'hide', snapshotFingerprint: 'market-c' })).added, true);
assert.deepEqual(history.list().map((entry) => entry.subject), ['hide', 'coal']);

const snapshot = history.exportSnapshot();
assert.equal(snapshot.version, 1);
assert.equal(snapshot.limit, 2);
assert.equal(snapshot.entries.length, 2);

const restored = createSettlementTradeHistory({ limit: 5 });
assert.equal(restored.importSnapshot(snapshot).imported, true);
assert.deepEqual(restored.list().map((entry) => entry.subject), ['hide', 'coal']);
assert.equal(restored.importSnapshot({ version: 2, entries: [] }).reason, 'invalid-trade-history-snapshot');
assert.equal(restored.add({ ok: true, kind: 'buy', subject: '', quantity: 1, copper: 1, snapshotFingerprint: 'x' }).reason, 'invalid-trade-receipt');

const failed = createSettlementTradeHistory();
assert.equal(failed.add(receipt({ ok: false, reason: 'stale-trade-snapshot', message: 'Market changed.' })).entry.ok, false);
assert.equal(failed.list()[0].reason, 'stale-trade-snapshot');

console.log('Settlement trade history contract: PASS');
