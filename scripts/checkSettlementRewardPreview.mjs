import assert from 'node:assert/strict';
import { isSettlementRewardPreview, projectSettlementRewardPreview } from '../src/3d/gameplay/settlementRewardPreview.ts';

const input = {
  chains: [
    { id: 'stable-chain', service: 'stable', steps: [{ id: 'a' }, { id: 'b' }], completedSteps: 2, reward: { xp: 50, copper: 20, perk: 'stable_hand', skill: 'riding', skillPoints: 1 } },
    { id: 'blacksmith-chain', service: 'blacksmith', totalSteps: 3, completedSteps: 1, reward: { xp: 125, copper: 70, perk: 'forge_master', skill: 'smithing', skillPoints: 2 } },
    { id: 'locked-chain', service: 'tavern', totalSteps: 1, completedSteps: 1, locked: true, reward: { xp: 999, copper: 999 } },
    { id: '', service: 'market', reward: { xp: 999 } },
  ],
};
const first = projectSettlementRewardPreview(input);
const second = projectSettlementRewardPreview({ chains: [...input.chains].reverse() });
assert.equal(first.claimableCount, 1);
assert.deepEqual(first.claimableChainIds, ['stable-chain']);
assert.deepEqual(first.totals, { xp: 175, copper: 90, skillPoints: 3 });
assert.equal(first.signature, second.signature);
assert.equal(isSettlementRewardPreview(first), true);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.chains[0]), true);
assert.throws(() => { first.claimableChainIds.push('tamper'); }, TypeError);
assert.equal(input.chains[0].completedSteps, 2);
console.log('settlement reward preview proof passed');
