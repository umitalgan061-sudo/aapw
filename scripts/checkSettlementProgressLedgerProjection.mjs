import assert from 'node:assert/strict';
import { createSettlementProgressLedgerProjection, isSettlementProgressLedgerReceipt } from '../src/3d/gameplay/settlementProgressLedgerProjection.ts';

const source = {
  settlementId: 'dragonstone',
  service: 'blacksmith',
  requiredActions: ['craft', 'repair', 'craft', '', 42],
  completedActions: ['repair', 'craft', 'unknown', 'craft'],
};
const before = structuredClone(source);
const receipt = createSettlementProgressLedgerProjection(source);
assert.equal(receipt.settlementId, 'dragonstone');
assert.equal(receipt.service, 'blacksmith');
assert.deepEqual(receipt.requiredActions, ['craft', 'repair']);
assert.deepEqual(receipt.completedActions, ['craft', 'repair']);
assert.equal(receipt.progress, 1);
assert.equal(receipt.readyToAdvance, true);
assert.equal(isSettlementProgressLedgerReceipt(receipt), true);
assert.deepEqual(source, before, 'projection must not mutate caller input');
assert.equal(createSettlementProgressLedgerProjection({ ...source, requiredActions: [...source.requiredActions].reverse(), completedActions: [...source.completedActions].reverse() }).signature, receipt.signature, 'input order must not change signature');
assert.throws(() => { receipt.completedActions.push('tamper'); }, TypeError);
assert.equal(createSettlementProgressLedgerProjection({ service: 'market', requiredActions: ['trade'], completedActions: [] }).progress, 0);
assert.equal(createSettlementProgressLedgerProjection({ service: 'unknown', requiredActions: ['trade'], completedActions: ['trade'] }).service, 'tavern');
assert.equal(createSettlementProgressLedgerProjection({ requiredActions: [], completedActions: [] }).readyToAdvance, false);
console.log('settlement progress ledger projection proof: PASS');
