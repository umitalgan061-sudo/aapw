import assert from 'node:assert/strict';
import {
  acknowledgeSettlementActionReceipt,
  projectSettlementActionReceipt,
  serializeSettlementActionReceipt,
} from '../src/3d/gameplay/settlementActionReceipt.js';

const input = {
  entries: [
    { id: 'market-buy', status: 'success', action: 'buy', service: 'market', message: 'Alındı', delta: { copper: -12, xp: 4 } },
    { id: 'gate-travel', status: 'blocked', action: 'travel', service: 'gate', message: 'Yorgunsun', delta: { fatigue: 2 } },
    { id: 'smith-craft', status: 'success', action: 'craft', service: 'blacksmith', message: 'Üretildi', delta: { copper: -8, xp: 20, reputation: 1 } },
  ],
};

const first = projectSettlementActionReceipt(input);
const second = projectSettlementActionReceipt(input);
assert.deepEqual(first, second);
assert.equal(first.latest.id, 'smith-craft');
assert.equal(first.statusCounts.success, 2);
assert.equal(first.statusCounts.blocked, 1);
assert.equal(first.totals.copper, -20);
assert.equal(first.totals.xp, 24);
assert.equal(first.hasBlockingResult, true);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.latest.delta), true);

const acknowledged = acknowledgeSettlementActionReceipt(first, 'gate-travel');
assert.equal(acknowledged.history.find((entry) => entry.id === 'gate-travel').acknowledged, true);
assert.equal(acknowledged.history.find((entry) => entry.id === 'market-buy').acknowledged, false);

const allAcknowledged = acknowledgeSettlementActionReceipt(first);
assert.equal(allAcknowledged.history.every((entry) => entry.acknowledged), true);
assert.equal(serializeSettlementActionReceipt(first), serializeSettlementActionReceipt(second));

const malformed = projectSettlementActionReceipt({ entries: [null, { status: 'wat', delta: { copper: 'bad' } }] });
assert.equal(malformed.latest.status, 'info');
assert.equal(Number.isFinite(malformed.totals.copper), true);
assert.equal(malformed.history.length, 2);
console.log('settlement action receipt checks passed');
