import assert from 'node:assert/strict';
import {
  createSettlementServiceJourneyPlan,
  applySettlementServiceJourneyPlan,
  normalizeSettlementJourneyInput,
} from '../src/3d/modern/settlementServiceJourneyPlan.ts';

const input = {
  settlementId: '  dragonstone-watch  ',
  serviceId: 'stable',
  action: 'travel',
  currentStage: 'enter',
  questIds: ['travel-2', 'travel-1', 'travel-1'],
  completedQuestIds: ['travel-1'],
  visitCount: 3,
  interactionSequence: 8,
};
const snapshot = JSON.stringify(input);
const normalized = normalizeSettlementJourneyInput(input);
assert.deepEqual(normalized.missingQuestIds, ['travel-2']);
assert.deepEqual(normalized.questIds, ['travel-1', 'travel-2']);
assert.equal(JSON.stringify(input), snapshot, 'normalization must not mutate caller input');
assert.throws(() => { normalized.questIds.push('x'); }, TypeError);

const locked = createSettlementServiceJourneyPlan(input);
assert.equal(locked.allowed, false);
assert.equal(locked.reason, 'quest-locked');
assert.deepEqual(locked.missingQuestIds, ['travel-2']);

const allowed = createSettlementServiceJourneyPlan({ ...input, completedQuestIds: ['travel-1', 'travel-2'] });
assert.equal(allowed.allowed, true);
assert.equal(allowed.nextStage, 'service');
assert.equal(allowed.visitCount, 4);
assert.equal(allowed.interactionSequence, 9);
assert.equal(allowed.receiptKey, 'dragonstone-watch:stable:travel:enter:4:9');

const applied = applySettlementServiceJourneyPlan({ settlementId: 'old', visitCount: 0 }, allowed);
assert.equal(applied.applied, true);
assert.equal(applied.state.activeStage, 'service');
assert.equal(applied.state.lastAction, 'travel');
assert.equal(applied.state.lastReceiptKey, allowed.receiptKey);
assert.throws(() => { applied.state.lastAction = 'trade'; }, TypeError);

const blocked = applySettlementServiceJourneyPlan({ visitCount: 2 }, locked);
assert.equal(blocked.applied, false);
assert.equal(blocked.reason, 'plan-blocked');
assert.deepEqual(blocked.state, { visitCount: 2 });

assert.equal(createSettlementServiceJourneyPlan({ serviceId: 'market', action: 'craft', currentStage: 'service' }).reason, 'action-unavailable');
assert.equal(createSettlementServiceJourneyPlan({ serviceId: 'stable', action: 'travel', currentStage: 'service', destinationKnown: false }).reason, 'destination-unknown');
assert.equal(createSettlementServiceJourneyPlan({ serviceId: 'tavern', action: 'rest', currentStage: 'service', serviceOpen: false }).reason, 'service-closed');

console.log('settlement service journey plan checks passed');
