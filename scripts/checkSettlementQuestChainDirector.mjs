import assert from 'node:assert/strict';
import { createSettlementQuestChainDirector } from '../src/3d/gameplay/settlementQuestChainDirector.js';
const director = createSettlementQuestChainDirector({ nodes: [
  { id: 'market-run', type: 'trade', order: 1, requiredFlag: 'market-open', completionReceipt: 'market-receipt' },
  { id: 'forge-blade', type: 'craft', order: 2, requiredDependency: 'market-run', requiredItem: 'iron-ingot', requiredSkill: 'smithing', requiredSkillLevel: 2, requiredReputation: 5 },
] });
const base = { settlementId: 'canonical-town-01', insideSettlement: true, state: { flags: { 'market-open': true }, services: { trade: true, craft: true }, items: { 'iron-ingot': 1 }, skills: { smithing: 2 }, reputation: { craft: 5 } } };
const blocked = director.evaluate(base);
assert.equal(blocked.rows[0].available, true);
assert.equal(blocked.rows[1].blockedReason, 'dependency-incomplete:market-run');
const receipt = director.evaluate({ ...base, state: { ...base.state, receipts: { 'market-receipt': true } } });
assert.equal(receipt.rows[0].complete, true);
assert.equal(receipt.rows[1].available, true);
assert.deepEqual(receipt, director.evaluate({ ...base, state: { ...base.state, receipts: { 'market-receipt': true } } }));
assert.equal(Object.isFrozen(receipt), true);
assert.equal(Object.isFrozen(receipt.rows[0]), true);
const outside = director.evaluate({ settlementId: 'canonical-town-01', insideSettlement: false, state: {} });
assert.equal(outside.totalSteps, 0);
console.log(JSON.stringify({ ok: true, steps: receipt.totalSteps, next: receipt.nextStepId }));
