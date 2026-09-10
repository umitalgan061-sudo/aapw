import assert from 'node:assert/strict';
import { createSettlementQuestChainDirector } from '../src/3d/gameplay/settlementQuestChainDirector.js';

const director = createSettlementQuestChainDirector({
  nodes: [
    { id: 'talk-warden', type: 'talk', title: 'Warden briefing', order: 2, requiredDialogueChoice: 'warden-helped' },
    { id: 'market-run', type: 'trade', title: 'Restock the market', order: 1, requiredFlag: 'market-open', requiredGold: 25 },
    { id: 'forge-blade', type: 'craft', title: 'Forge a field blade', requiredDependency: 'market-run', requiredItem: 'iron-ingot', requiredItemCount: 2, requiredSkill: 'smithing', requiredSkillLevel: 2, requiredReputation: 5, order: 3 },
  ],
});

const input = {
  settlementId: 'canonical-town-01',
  insideSettlement: true,
  alive: true,
  state: {
    flags: { 'market-open': true },
    gold: 25,
    items: { 'iron-ingot': 2 },
    skills: { smithing: 2 },
    reputation: { craft: 5 },
    dialogueChoices: { 'warden-helped': true },
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

const quantityBlocked = director.evaluate({
  ...input,
  state: { ...input.state, items: { 'iron-ingot': 1 } },
});
assert.equal(quantityBlocked.rows.find((row) => row.id === 'forge-blade').blockedReason, 'missing-item:iron-ingot');

const goldBlocked = director.evaluate({
  ...input,
  state: { ...input.state, gold: 10, completedSteps: {} },
});
assert.equal(goldBlocked.rows.find((row) => row.id === 'market-run').blockedReason, 'insufficient-gold:25');

const dependencyBlocked = director.evaluate({
  ...input,
  state: { flags: { 'market-open': true }, gold: 25, items: { 'iron-ingot': 2 }, skills: { smithing: 2 }, reputation: { craft: 5 }, services: { trade: true, craft: true } },
});
assert.equal(dependencyBlocked.rows.find((row) => row.id === 'forge-blade').blockedReason, 'dependency-incomplete:market-run');

const blocked = director.evaluate({
  ...input,
  state: { services: { trade: false, craft: false }, gold: 25, items: { 'iron-ingot': 2 }, skills: { smithing: 2 }, reputation: { craft: 0 } },
});
assert.equal(blocked.rows.find((row) => row.id === 'market-run').blockedReason, 'missing-flag:market-open');
assert.equal(blocked.rows.find((row) => row.id === 'forge-blade').blockedReason, 'dependency-incomplete:market-run');

const dialogueBlocked = director.evaluate({
  ...input,
  state: { flags: { 'market-open': true }, gold: 25, items: { 'iron-ingot': 2 }, skills: { smithing: 2 }, reputation: { craft: 5 }, services: { trade: true, craft: true } },
});
assert.equal(dialogueBlocked.rows.find((row) => row.id === 'talk-warden').blockedReason, 'dialogue-choice-missing:warden-helped');

const outside = director.evaluate({ settlementId: 'canonical-town-01', insideSettlement: false, alive: true, state: {} });
assert.equal(outside.totalSteps, 0);
assert.equal(outside.nextStepId, null);

console.log(JSON.stringify({ ok: true, fingerprint: first.fingerprint, steps: first.totalSteps }));
