import assert from 'node:assert/strict';
import { isSettlementRewardClaimPlan, projectSettlementRewardClaimPlan } from '../src/3d/gameplay/settlementRewardClaimPlan.ts';

const preview = { chains: [
  { id: 'tavern-chain', readyToClaim: true, locked: false, reward: { xp: 40, copper: 10, skillPoints: 1 } },
  { id: 'stable-chain', readyToClaim: true, locked: false, reward: { xp: 60, copper: 20, skillPoints: 2 } },
  { id: 'locked-chain', readyToClaim: false, locked: true, reward: { xp: 999, copper: 999, skillPoints: 9 } },
] };
const first = projectSettlementRewardClaimPlan({ preview, requestedChainIds: ['stable-chain', 'tavern-chain'] });
const second = projectSettlementRewardClaimPlan({ preview: { chains: [...preview.chains].reverse() }, requestedChainIds: ['tavern-chain', 'stable-chain', 'stable-chain'] });
assert.equal(first.canClaim, true);
assert.equal(first.reason, 'ready');
assert.deepEqual(first.claimableChainIds, ['stable-chain', 'tavern-chain']);
assert.deepEqual(first.totals, { xp: 100, copper: 30, skillPoints: 3 });
assert.equal(first.signature, second.signature);
assert.equal(isSettlementRewardClaimPlan(first), true);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.totals), true);
assert.throws(() => { first.requestedChainIds.push('tamper'); }, TypeError);

const duplicateReady = projectSettlementRewardClaimPlan({
  preview: { chains: [
    { id: 'stable-chain', readyToClaim: true, locked: false, reward: { xp: 60, copper: 20, skillPoints: 2 } },
    { id: 'stable-chain', readyToClaim: false, locked: true, reward: { xp: 999, copper: 999, skillPoints: 9 } },
  ] },
  requestedChainIds: ['stable-chain'],
});
const duplicateBlockedFirst = projectSettlementRewardClaimPlan({
  preview: { chains: [
    { id: 'stable-chain', readyToClaim: false, locked: true, reward: { xp: 999, copper: 999, skillPoints: 9 } },
    { id: 'stable-chain', readyToClaim: true, locked: false, reward: { xp: 60, copper: 20, skillPoints: 2 } },
  ] },
  requestedChainIds: ['stable-chain'],
});
assert.equal(duplicateReady.signature, duplicateBlockedFirst.signature);
assert.equal(duplicateReady.canClaim, true);
assert.deepEqual(duplicateReady.totals, { xp: 60, copper: 20, skillPoints: 2 });

const blocked = projectSettlementRewardClaimPlan({ preview, requestedChainIds: ['locked-chain'] });
assert.equal(blocked.canClaim, false);
assert.equal(blocked.reason, 'not-claimable');
assert.deepEqual(blocked.blockedChainIds, ['locked-chain']);

const missing = projectSettlementRewardClaimPlan({ preview, requestedChainIds: ['missing-chain'] });
assert.equal(missing.canClaim, false);
assert.equal(missing.reason, 'missing-chain');
assert.deepEqual(missing.missingChainIds, ['missing-chain']);

const empty = projectSettlementRewardClaimPlan({ preview, requestedChainIds: [] });
assert.equal(empty.canClaim, false);
assert.equal(empty.reason, 'empty-selection');

const tampered = { ...first, totals: { ...first.totals } };
assert.equal(isSettlementRewardClaimPlan(tampered), false);
console.log('settlement reward claim plan proof passed');
