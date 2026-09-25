import assert from 'node:assert/strict';
import { createSettlementQuestChainInteractionPlan, isSettlementQuestChainInteractionPlan } from '../src/3d/gameplay/settlementQuestChainInteractionPlan.ts';

const ready = createSettlementQuestChainInteractionPlan({
  chainId: 'iron_and_oath',
  stepIndex: 0,
  completedCount: 0,
  serviceId: 'blacksmith',
  satisfiedConditions: ['flag_01'],
});
assert.equal(ready.status, 'ready');
assert.equal(ready.currentStep.action, 'talk');
assert.equal(isSettlementQuestChainInteractionPlan(ready), true);

const blocked = createSettlementQuestChainInteractionPlan({
  chainId: 'iron_and_oath',
  stepIndex: 2,
  completedCount: 2,
  serviceId: 'blacksmith',
  satisfiedConditions: [],
});
assert.equal(blocked.status, 'condition-blocked');
assert.deepEqual(blocked.missingConditions, ['item_03']);

const complete = createSettlementQuestChainInteractionPlan({
  chainId: 'iron_and_oath',
  stepIndex: 8,
  completedCount: 8,
  serviceId: 'blacksmith',
});
assert.equal(complete.status, 'complete');
assert.equal(complete.rewardPreview.perk, 'iron_hand');

const reordered = createSettlementQuestChainInteractionPlan({
  chainId: 'iron_and_oath',
  stepIndex: 0,
  completedCount: 0,
  serviceId: 'blacksmith',
  satisfiedConditions: ['flag_01', 'unused', 'flag_01'],
});
assert.equal(reordered.planKey, ready.planKey);

assert.equal(Object.isFrozen(ready), true);
assert.equal(isSettlementQuestChainInteractionPlan({ status: 'ready' }), false);
console.log(JSON.stringify({ ok: true, statuses: [ready.status, blocked.status, complete.status], deterministic: true }));
