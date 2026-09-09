import assert from 'node:assert/strict';
import { planSettlementNextStep, serializeSettlementNextStepPlan } from '../src/3d/gameplay/settlementNextStepPlanner.js';

const snapshot = {
  settlementId: 'winterfell', copper: 120, fatigue: 82, health: 100,
  unlockedServices: ['tavern', 'market', 'blacksmith', 'gate', 'house'],
  inventory: { iron_ore: 3, wood: 2 }, perks: ['roadwise'],
  quests: { supply: { state: 'active', step: 1 } },
};
const context = {
  recipeId: 'iron_sword', routeId: 'north_gate',
  objectives: [
    { id: 'rest', label: 'Dinlen', serviceId: 'tavern', action: 'rest' },
    { id: 'deliver', label: 'Erzak teslim et', serviceId: 'tavern', action: 'advanceQuest', questId: 'supply', requiredItem: 'travel_rations', requiredQuantity: 1 },
  ],
};
const first = planSettlementNextStep(snapshot, context);
const second = planSettlementNextStep(snapshot, context);
assert.deepEqual(first, second, 'planning must be deterministic');
assert.equal(first.primary.serviceId, 'tavern');
assert.equal(first.primary.action, 'rest');
assert.equal(first.primary.available, true);
assert.equal(first.objectives[1].status, 'blocked');
assert.equal(first.alternatives.length <= 6, true);
assert.equal(first.summary.objectiveCount, 2);
assert.equal(first.summary.actionableObjectives, 1);
assert.equal(serializeSettlementNextStepPlan(first), serializeSettlementNextStepPlan(second));
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.primary), false, 'serialized clone contract remains immutable at root without deep-freeze dependency');
const malformed = planSettlementNextStep(null, null);
assert.equal(typeof malformed.digest, 'string');
assert.equal(malformed.primary.serviceId, 'house');
console.log(`settlement-next-step-planner checks passed: ${first.digest}`);
