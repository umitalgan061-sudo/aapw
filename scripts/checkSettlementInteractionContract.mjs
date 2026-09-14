import assert from 'node:assert/strict';
import {
  buildSettlementInteractionContract,
  listSettlementInteractionActions,
  serializeSettlementInteractionContract,
  validateSettlementInteractionContract,
} from '../src/3d/gameplay/settlementInteractionContract.js';

const journey = {
  settlementId: 'winterfell',
  chapter: 'arrival',
  beats: [
    { role: 'gate', targetId: 'gate-01', questHook: 'arrival' },
    { role: 'market', targetId: 'market-01', rewardHook: 'trade' },
    { role: 'tavern', targetId: 'tavern-01', questHook: 'rumor' },
    { role: 'blacksmith', targetId: 'smith-01' },
  ],
};

const inside = buildSettlementInteractionContract(journey, {
  capabilities: { insideSettlement: true },
  fatigue: 30,
  health: 100,
});
const insideRepeat = buildSettlementInteractionContract(journey, {
  capabilities: { insideSettlement: true },
  fatigue: 30,
  health: 100,
});
assert.deepEqual(inside, insideRepeat);
assert.equal(validateSettlementInteractionContract(inside).ok, true);
assert.equal(inside.availableCount, inside.stepCount);
assert.equal(inside.primaryAction, 'gate:enter');
assert.deepEqual(listSettlementInteractionActions('market'), ['trade']);
assert.equal(Object.isFrozen(inside), true);
assert.equal(Object.isFrozen(inside.steps), true);
assert.equal(Object.isFrozen(inside.steps[0]), true);
assert.equal(serializeSettlementInteractionContract(inside), serializeSettlementInteractionContract(insideRepeat));

const outside = buildSettlementInteractionContract(journey, { insideSettlement: false, health: 100 });
assert.equal(outside.availableCount, 0);
assert.ok(outside.steps.every((step) => step.blockingReason === 'outside-settlement'));

const defeated = buildSettlementInteractionContract(journey, { insideSettlement: true, defeated: true });
assert.ok(defeated.steps.every((step) => step.blockingReason === 'player-defeated'));

const saveDisabled = buildSettlementInteractionContract({ beats: [{ role: 'house', targetId: 'house-01' }] }, { insideSettlement: true, saveEnabled: false });
const saveStep = saveDisabled.steps.find((step) => step.action === 'save');
assert.equal(saveStep.blockingReason, 'save-disabled');

const malformed = buildSettlementInteractionContract({ beats: [{ role: 'unknown', targetId: '' }] }, { fatigue: 'bad', health: NaN });
assert.ok(malformed.steps.length === 0);
assert.equal(validateSettlementInteractionContract(malformed).ok, true);

console.log('settlement interaction contract: PASS');
