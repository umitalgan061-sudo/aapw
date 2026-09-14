import assert from 'node:assert/strict';
import { createSettlementQuestChainDirector } from '../src/3d/gameplay/settlementQuestChainDirector.js';

const director = createSettlementQuestChainDirector({
  nodes: [
    { id: 'talk-warden', type: 'talk', title: 'Warden briefing', order: 2 },
    { id: 'market-run', type: 'trade', title: 'Restock the market', requiredFlag: 'market-open', order: 1 },
    { id: 'forge-blade', type: 'craft', title: 'Forge a field blade', requiredItem: 'iron-ingot', requiredSkill: 'smithing', requiredSkillLevel: 2, order: 3 },
  ],
});

const input = {
  settlementId: 'canonical-town-01',
  insideSettlement: true,
  alive: true,
  state: {
    flags: { 'market-open': true },
    items: { 'iron-ingot': 1 },
    skills: { smithing: 2 },
    services: { trade: true, craft: true },
    completedSteps: { 'market-run': true },
  },
};

const first = director.evaluate(input);
const second = director.evaluate(input);
assert.deepEqual(first, second);
assert.equal(first.nextStepId, 'talk-warden');
assert.equal(first.rows.find((row) => row.id === 'market-run').complete, true);
assert.equal(first.rows.find((row) => row.id === 'forge-blade').available, true);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.rows[0]), true);

const blocked = director.evaluate({
  ...input,
  state: { services: { trade: false, craft: false } },
});
assert.equal(blocked.rows.find((row) => row.id === 'market-run').blockedReason, 'missing-flag:market-open');
assert.equal(blocked.rows.find((row) => row.id === 'forge-blade').blockedReason, 'missing-item:iron-ingot');

const outside = director.evaluate({ settlementId: 'canonical-town-01', insideSettlement: false, alive: true, state: {} });
assert.equal(outside.totalSteps, 0);
assert.equal(outside.nextStepId, null);

console.log(JSON.stringify({ ok: true, fingerprint: first.fingerprint, steps: first.totalSteps }));
