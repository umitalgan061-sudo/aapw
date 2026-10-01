import assert from 'node:assert/strict';
import {
  advanceSettlementQuestChain,
  availableSettlementQuestNodes,
  createSettlementQuestChainState,
  settlementQuestChainSnapshot,
} from '../src/3d/gameplay/settlementQuestChainState.js';

const definition = {
  id: 'ridge-supply-chain',
  settlementId: 'winterfell-market',
  nodes: [
    { id: 'deliver-grain', title: 'Deliver grain', rewardCopper: 20, requiredItem: 'grain-sack', requiredQuantity: 2 },
    { id: 'repair-forge', title: 'Repair forge', prerequisites: ['deliver-grain'], rewardCopper: 40 },
    { id: 'open-road', title: 'Open the road', prerequisites: ['repair-forge'], rewardCopper: 80 },
  ],
};

const state = createSettlementQuestChainState(definition);
assert.deepEqual(availableSettlementQuestNodes(state).map((node) => node.id), ['deliver-grain']);
const missing = advanceSettlementQuestChain(state, 'deliver-grain', { itemCounts: { 'grain-sack': 1 } });
assert.equal(missing.ok, false);
assert.equal(missing.reason, 'required-item-missing');
const first = advanceSettlementQuestChain(state, 'deliver-grain', { itemCounts: { 'grain-sack': 2 } });
assert.equal(first.ok, true);
assert.equal(first.nextNode, 'repair-forge');
const second = advanceSettlementQuestChain(first.state, 'repair-forge');
assert.equal(second.ok, true);
assert.equal(second.nextNode, 'open-road');
const blocked = advanceSettlementQuestChain(state, 'repair-forge');
assert.equal(blocked.ok, false);
assert.equal(blocked.reason, 'prerequisite-not-met');
const snapshotA = settlementQuestChainSnapshot(second.state);
const snapshotB = settlementQuestChainSnapshot(second.state);
assert.deepEqual(snapshotA, snapshotB);
assert.deepEqual(snapshotA.completed, ['deliver-grain', 'repair-forge']);
console.log('SETTLEMENT_QUEST_CHAIN_STATE_OK');
