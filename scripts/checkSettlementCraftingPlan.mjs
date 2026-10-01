import assert from 'node:assert/strict';
import { buildSettlementCraftingPlan, createSettlementCraftingSnapshot } from '../src/3d/gameplay/settlementCraftingPlan.js';

const recipes = [
  { id: 'iron-sword', station: 'blacksmith', outputId: 'iron-sword', outputQuantity: 1, ingredients: [{ id: 'iron-ingot', quantity: 2 }, { id: 'leather', quantity: 1 }] },
  { id: 'nails', station: 'blacksmith', outputId: 'nails', outputQuantity: 8, ingredients: [{ id: 'iron-ingot', quantity: 1 }] },
  { id: 'stew', station: 'tavern', outputId: 'stew', outputQuantity: 1, ingredients: [{ id: 'meat', quantity: 1 }] },
];

const plan = buildSettlementCraftingPlan({ recipes, inventory: { 'iron-ingot': 2, leather: 1 }, station: 'blacksmith' });
assert.equal(plan.recipes.length, 2);
assert.equal(plan.craftableCount, 1);
assert.equal(plan.recipes[0].id, 'iron-sword');
assert.equal(plan.recipes[1].missing[0].id, 'iron-ingot');

const repeated = buildSettlementCraftingPlan({ recipes, inventory: { 'iron-ingot': 2, leather: 1 }, station: 'blacksmith' });
assert.deepEqual(createSettlementCraftingSnapshot(plan), createSettlementCraftingSnapshot(repeated));

const limited = buildSettlementCraftingPlan({ recipes, inventory: new Map([['meat', 1]]), limit: 1 });
assert.equal(limited.recipes.length, 1);
assert.equal(limited.station, null);

const malformed = buildSettlementCraftingPlan({ recipes: [null, { id: 'bad', ingredients: [] }, ...recipes], inventory: {} });
assert.equal(malformed.recipes.length, 3);
assert.equal(malformed.recipes.some((recipe) => recipe.id === 'bad'), false);
console.log('SETTLEMENT_CRAFTING_PLAN_OK');
