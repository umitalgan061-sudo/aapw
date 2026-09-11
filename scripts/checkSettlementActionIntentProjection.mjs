import assert from 'node:assert/strict';
import { projectSettlementActionIntents } from '../src/3d/gameplay/settlementActionIntentProjection.js';

const input = {
  inSettlement: true,
  questState: { active: true, currentStep: 'forge-order', currentLabel: 'Finish the forge order', rewardsReady: 1 },
  services: {
    tavern: { label: 'Copper Kettle', queueCount: 0 },
    blacksmith: { label: 'Old Anvil', actions: ['craft', 'repair'], usable: true },
    market: { label: 'Market Square', status: 'blocked' },
  },
};

const first = projectSettlementActionIntents(input);
const second = projectSettlementActionIntents({
  ...input,
  services: { ...input.services, market: { status: 'blocked' }, tavern: input.services.tavern, blacksmith: input.services.blacksmith },
});
assert.equal(first.status, 'ready');
assert.deepEqual(first, second);
assert.equal(first.intents[0].action, 'continueQuest');
assert.equal(first.intents[1].action, 'collectReward');
assert.equal(first.blockedCount, 1);
assert.equal(first.intents.some((item) => item.action === 'trade'), false);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.intents), true);
assert.equal(Object.isFrozen(first.services), true);

const outside = projectSettlementActionIntents({ inSettlement: false, services: input.services });
assert.equal(outside.status, 'outside-settlement');
assert.equal(outside.availableCount, 0);
assert.equal(outside.intents.length, 0);

const defeated = projectSettlementActionIntents({ inSettlement: true, defeated: true, services: input.services });
assert.equal(defeated.status, 'defeated');
assert.equal(defeated.intents.length, 0);

console.log('settlement action intent projection regression: ok');
