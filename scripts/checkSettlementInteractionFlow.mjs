import assert from 'node:assert/strict';
import {
  buildSettlementInteractionFlow,
  serializeSettlementInteractionFlow,
} from '../src/3d/gameplay/settlementInteractionFlow.js';

const context = Object.freeze({
  inSettlement: true,
  doorAvailable: true,
  npcAvailable: true,
  questAvailable: true,
  serviceAvailable: true,
  objectiveReady: false,
  canSave: true,
  fatigue: 55,
  copper: 90,
});

const first = buildSettlementInteractionFlow(context);
const second = buildSettlementInteractionFlow(context);
assert.equal(first.version, 1);
assert.equal(first.actionableCount, 6);
assert.equal(first.blockedCount, 2);
assert.equal(first.fatigueBand, 'medium');
assert.equal(first.steps[1].id, 'open-door');
assert.equal(first.steps[1].state, 'available');
assert.equal(first.steps[5].state, 'blocked');
assert.equal(first.steps[5].reason, 'context-gate');
assert.deepEqual(first, second);
assert.equal(serializeSettlementInteractionFlow(first), serializeSettlementInteractionFlow(second));
assert.throws(() => { first.steps.push({}); }, TypeError);

const outside = buildSettlementInteractionFlow({ inSettlement: false });
assert.equal(outside.summary.headline, 'Yerleşime giriş bekleniyor');
assert.equal(outside.actionableCount, 1);
assert.equal(outside.steps[0].actionable, true);
assert.equal(outside.steps[1].actionable, false);

const malformed = buildSettlementInteractionFlow({ inSettlement: 'yes', fatigue: 'bad', copper: null });
assert.equal(malformed.context.inSettlement, false);
assert.equal(malformed.context.fatigue, 0);
assert.equal(malformed.context.copper, 0);
assert.equal(malformed.fatigueBand, 'low');
console.log('settlement interaction flow checks passed');
