import assert from 'node:assert/strict';
import { buildSettlementQuestHandoff, serializeSettlementQuestHandoff } from '../src/3d/gameplay/settlementQuestHandoff.js';

const snapshot = {
  settlementId: 'winterfell',
  questId: 'repair-gate',
  insideSettlement: true,
  health: 100,
  objectives: [
    { id: 'speak-smith', title: 'Speak with the smith', service: 'blacksmith', active: true, required: 1, progress: 0, action: 'talk-to-npc' },
    { id: 'bring-iron', title: 'Bring iron', service: 'market', blocked: true, reason: 'missing-item', required: 3, progress: 1 },
    { id: 'open-gate', title: 'Open the gate', complete: true, required: 1, progress: 1 },
  ],
  rewards: [{ id: 'xp', kind: 'xp', label: 'Experience', amount: 40, claimable: true }],
};

const first = buildSettlementQuestHandoff(snapshot);
const second = buildSettlementQuestHandoff(snapshot);
assert.deepEqual(first, second);
assert.equal(first.canInteract, true);
assert.equal(first.activeObjectiveId, 'speak-smith');
assert.equal(first.summary.blockedObjectives, 1);
assert.equal(first.summary.claimableRewards, 1);
assert.equal(first.nextAction, 'claim-reward');
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.objectives), true);
assert.equal(serializeSettlementQuestHandoff(snapshot), JSON.stringify(first));

const outside = buildSettlementQuestHandoff({ settlementId: 'winterfell', insideSettlement: false, health: 100 });
assert.equal(outside.canInteract, false);
assert.equal(outside.blockedReason, 'outside-settlement');
assert.equal(outside.nextAction, 'return-to-settlement');

const defeated = buildSettlementQuestHandoff({ insideSettlement: true, health: 0 });
assert.equal(defeated.blockedReason, 'player-defeated');
assert.equal(defeated.nextAction, 'return-to-settlement');

const malformed = buildSettlementQuestHandoff({ objectives: [{ required: 'x', progress: Infinity }], rewards: [{ amount: NaN }] });
assert.equal(malformed.objectives[0].required, 1);
assert.equal(malformed.objectives[0].progress, 0);
assert.equal(malformed.rewards[0].amount, 0);
assert.equal(JSON.parse(serializeSettlementQuestHandoff(malformed)).version, 1);

console.log('checkSettlementQuestHandoff: PASS');
