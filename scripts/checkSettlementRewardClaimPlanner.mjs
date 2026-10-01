import assert from 'node:assert/strict';
import { buildSettlementRewardClaimPlan, serializeSettlementRewardClaimPlan } from '../src/3d/gameplay/settlementRewardClaimPlanner.js';
import { buildSettlementQuestChainProgress } from '../src/3d/gameplay/settlementCampaignQuestChains.js';

const snapshot = Object.freeze({ level: 4, copper: 120, fatigue: 10 });
const completed = ['iron-01','iron-02','iron-03','iron-04','iron-05','iron-06','iron-07','iron-08'];
const a = buildSettlementRewardClaimPlan(snapshot, completed);
const b = buildSettlementRewardClaimPlan(snapshot, completed);
assert.equal(a.version, 1);
assert.equal(a.claimableCount, 1);
assert.equal(a.rewards[0].chainId, 'iron_and_oath');
assert.equal(a.rewards[0].xp, 120);
assert.equal(a.rewards[0].copper, 60);
assert.deepEqual(a, b);
assert.equal(serializeSettlementRewardClaimPlan(a), serializeSettlementRewardClaimPlan(b));
assert.throws(() => { a.chains.push({}); }, TypeError);

const blocked = buildSettlementRewardClaimPlan(snapshot, [], () => ({ ok: true, steps: [] }));
assert.equal(blocked.claimableCount, 0);
assert.equal(blocked.incompleteCount, 6);
assert.equal(blocked.summary.xp, 0);
assert.equal(blocked.summary.copper, 0);

const failClosed = buildSettlementRewardClaimPlan(snapshot, completed, () => ({ ok: false, reason: 'authoritative-progress-unavailable' }));
assert.equal(failClosed.claimableCount, 0);
assert.equal(failClosed.chains[0].reason, 'authoritative-progress-unavailable');

assert.equal(typeof buildSettlementQuestChainProgress, 'function');
console.log('settlement reward claim planner checks passed');
