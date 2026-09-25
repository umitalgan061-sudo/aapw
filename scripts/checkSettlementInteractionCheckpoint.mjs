import assert from 'node:assert/strict';
import { createSettlementInteractionCheckpoint, isSettlementInteractionCheckpoint } from '../src/3d/gameplay/settlementInteractionCheckpoint.ts';

const base = {
  serviceId: 'blacksmith', stage: 'service', requestedAction: 'craft',
  availableActions: ['craft', 'repair', 'craft'], missingQuestIds: [],
  visitCount: 2, interactionSequence: 7, serviceOpen: true, accessAllowed: true, questSatisfied: true,
};

const ready = createSettlementInteractionCheckpoint(base);
assert.equal(ready.reason, 'ready');
assert.equal(ready.ready, true);
assert.equal(ready.actionAllowed, true);
assert.equal(isSettlementInteractionCheckpoint(ready), true);
assert.equal(Object.isFrozen(ready), true);
assert.equal(Object.isFrozen(ready.availableActions), true);

const reordered = createSettlementInteractionCheckpoint({ ...base, availableActions: ['repair', 'craft'] });
assert.equal(reordered.checkpointKey, ready.checkpointKey);

const blocked = createSettlementInteractionCheckpoint({ ...base, serviceOpen: false });
assert.equal(blocked.reason, 'service-closed');
assert.equal(blocked.ready, false);

const questBlocked = createSettlementInteractionCheckpoint({ ...base, missingQuestIds: ['quest-02', 'quest-01'], questSatisfied: false });
assert.equal(questBlocked.reason, 'quest-blocked');
assert.deepEqual(questBlocked.missingQuestIds, ['quest-01', 'quest-02']);

const unavailable = createSettlementInteractionCheckpoint({ ...base, requestedAction: 'trade' });
assert.equal(unavailable.reason, 'action-unavailable');
assert.equal(unavailable.actionAllowed, false);

const invalid = createSettlementInteractionCheckpoint({ serviceId: 'unknown', stage: 'service', requestedAction: 'craft' });
assert.equal(invalid.reason, 'invalid-input');
assert.equal(invalid.ready, false);

const tampered = { ...ready, ready: false };
assert.equal(isSettlementInteractionCheckpoint(tampered), false);
assert.equal(isSettlementInteractionCheckpoint({ ...ready, checkpointKey: 'ffffffff' }), false);
assert.equal(isSettlementInteractionCheckpoint({ ...ready, availableActions: ['craft', 'repair'] }), false);
assert.equal(isSettlementInteractionCheckpoint({ ...ready, visitCount: '2' }), false);
assert.equal(isSettlementInteractionCheckpoint({ ...ready, serviceOpen: 1 }), false);
assert.equal(isSettlementInteractionCheckpoint(Object.freeze({ ...ready, availableActions: Object.freeze(['craft', 'repair']), checkpointKey: ready.checkpointKey })), false);
assert.equal(isSettlementInteractionCheckpoint(new Proxy(ready, { get() { throw new Error('poisoned accessor'); } })), false);

console.log('settlement-interaction-checkpoint: 14 checks passed');
