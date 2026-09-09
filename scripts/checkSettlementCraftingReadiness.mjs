import assert from 'node:assert/strict';
import {
  buildSettlementCraftingReadiness,
  serializeSettlementCraftingReadiness,
  validateSettlementCraftingReadiness,
} from '../src/3d/gameplay/settlementCraftingReadiness.js';

const snapshot = {
  station: 'blacksmith',
  insideSettlement: true,
  recipes: [
    { recipeId: 'iron-sword', name: 'Iron Sword', outputItemId: 'iron-sword', outputCount: 1, copper: 12, copperCost: 10, skill: 3, requiredSkill: 2, materials: [{ itemId: 'iron-ingot', owned: 2, required: 2 }] },
    { recipeId: 'steel-helm', copper: 4, copperCost: 10, skill: 1, requiredSkill: 4, materials: [{ itemId: 'steel', owned: 0, required: 2 }] },
  ],
};

const first = buildSettlementCraftingReadiness(snapshot);
const second = buildSettlementCraftingReadiness(snapshot);
assert.deepEqual(first, second);
assert.equal(first.availableCount, 1);
assert.equal(first.blockedCount, 1);
assert.equal(first.primaryRecipeId, 'iron-sword');
assert.equal(first.recipes[1].blockedReasons.includes('missing-materials'), true);
assert.equal(first.recipes[1].blockedReasons.includes('insufficient-skill'), true);
assert.equal(validateSettlementCraftingReadiness(first).ok, true);
assert.equal(serializeSettlementCraftingReadiness(first), serializeSettlementCraftingReadiness(second));
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.recipes), true);
assert.equal(Object.isFrozen(first.recipes[0]), true);

const outside = buildSettlementCraftingReadiness({ insideSettlement: false, recipes: [] });
assert.equal(outside.nextAction, 'return-to-blacksmith');
const defeated = buildSettlementCraftingReadiness({ defeated: true, recipes: [] });
assert.equal(defeated.nextAction, 'return-to-blacksmith');

const malformed = buildSettlementCraftingReadiness({ recipes: [{ recipeId: 'bad', copper: 'nan', materials: [{ itemId: 'ore', owned: 'nan', required: 2 }] }] });
assert.equal(Number.isFinite(malformed.recipes[0].copper), true);
assert.equal(Number.isFinite(malformed.recipes[0].materials[0].owned), true);

console.log('settlement crafting readiness checks passed');
