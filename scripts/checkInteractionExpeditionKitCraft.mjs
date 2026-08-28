import assert from 'node:assert/strict';
import { createInteractionInventoryState } from '../src/3d/gameplay/interactionConfig.js';
import { QUARTERMASTER_OFFERS, createInteractionEconomyState } from '../src/3d/gameplay/interactionEconomy.js';

const armorer = QUARTERMASTER_OFFERS[1];
const recipe = armorer.fulfillment?.craftUpgrade;
assert.equal(armorer.fulfillment?.discipline, 'smithing');
assert.equal(recipe?.recipeId, 'dragonstone-expedition-maintenance-kit');
assert.deepEqual(recipe?.inputs, [
	{ itemId: 'dragonstone-travel-ration-pack', quantity: 1 },
	{ itemId: 'dragonstone-whetstone', quantity: 1 },
]);
assert.equal(recipe?.outputItemId, 'dragonstone-expedition-maintenance-kit');

function item(snapshot, itemId) {
	return snapshot.items.find((entry) => entry.itemId === itemId) ?? null;
}

const inventory = createInteractionInventoryState();
const economy = createInteractionEconomyState(60);
const grant = (...args) => inventory.grant(...args);

const beforeMissingInputsInventory = structuredClone(inventory.snapshot());
const beforeMissingInputsEconomy = structuredClone(economy.snapshot());
let result = economy.purchase(armorer, grant);
assert.equal(result.ok, false, 'authored smithing must fail closed when recipe inputs are missing');
assert.equal(result.reason, 'craft-input-missing');
assert.deepEqual(inventory.snapshot(), beforeMissingInputsInventory, 'missing-input smithing must not grant a paid fallback item');
assert.deepEqual(economy.snapshot(), beforeMissingInputsEconomy, 'missing-input smithing must not debit copper, finite stock or ledger state');

assert.equal(inventory.grant('dragonstone-travel-ration-pack', 1, {
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-watch-travel-ration-pack',
}), true);
assert.equal(inventory.grant('dragonstone-whetstone', 1, {
	sourceType: 'expedition-mastery',
	sourceId: 'dragonstone-expedition-mastery',
}), true);
const beforeCraft = structuredClone(inventory.snapshot());
assert.equal(item(beforeCraft, 'dragonstone-whetstone')?.quantity, 1);
assert.equal(item(beforeCraft, 'dragonstone-travel-ration-pack')?.quantity, 1);

result = economy.purchase(armorer, grant);
assert.equal(result.ok, true);
assert.equal(result.crafted, true);
assert.equal(result.craftedItemId, recipe.outputItemId);
assert.deepEqual(result.consumedItems, recipe.inputs, 'successful multi-input craft must report both canonical consumed ingredients');
assert.equal(result.balanceCopper, 48);
assert.equal(result.remainingStock, 1);
const crafted = inventory.snapshot();
assert.equal(item(crafted, 'dragonstone-whetstone'), null);
assert.equal(item(crafted, 'dragonstone-travel-ration-pack'), null);
assert.equal(item(crafted, recipe.outputItemId)?.quantity, 1);
assert.deepEqual(item(crafted, recipe.outputItemId)?.provenance, [{
	sourceType: 'settlement-crafting',
	sourceId: recipe.recipeId,
}]);
assert.equal(economy.snapshot().ledger.transactionCount, 1);
assert.equal(economy.snapshot().ledger.lifetimeSpentCopper, 12);

const restored = createInteractionInventoryState();
restored.restore(crafted);
assert.deepEqual(restored.snapshot(), crafted, 'crafted expedition kit must survive canonical inventory save/restore');

const outputFullInventory = createInteractionInventoryState();
const outputFullEconomy = createInteractionEconomyState(60);
assert.equal(outputFullInventory.grant('dragonstone-travel-ration-pack', 1), true);
assert.equal(outputFullInventory.grant('dragonstone-whetstone', 1), true);
assert.equal(outputFullInventory.grant(recipe.outputItemId, 1), true);
const outputFullBeforeInventory = structuredClone(outputFullInventory.snapshot());
const outputFullBeforeEconomy = structuredClone(outputFullEconomy.snapshot());
result = outputFullEconomy.purchase(armorer, (...args) => outputFullInventory.grant(...args));
assert.equal(result.ok, false);
assert.equal(result.reason, 'craft-output-full');
assert.deepEqual(outputFullInventory.snapshot(), outputFullBeforeInventory, 'output-capacity failure must not consume either ingredient');
assert.deepEqual(outputFullEconomy.snapshot(), outputFullBeforeEconomy, 'output-capacity failure must not debit copper, stock or ledger');

const missingInputInventory = createInteractionInventoryState();
assert.equal(missingInputInventory.grant('dragonstone-travel-ration-pack', 1), true);
const missingInputEconomy = createInteractionEconomyState(60);
const missingInputBeforeInventory = structuredClone(missingInputInventory.snapshot());
const missingInputBeforeEconomy = structuredClone(missingInputEconomy.snapshot());
result = missingInputEconomy.purchase(armorer, (...args) => missingInputInventory.grant(...args));
assert.equal(result.ok, false);
assert.equal(result.reason, 'craft-input-missing');
assert.deepEqual(missingInputInventory.snapshot(), missingInputBeforeInventory, 'partial recipe availability must preserve inventory atomically');
assert.deepEqual(missingInputEconomy.snapshot(), missingInputBeforeEconomy, 'partial recipe availability must not mutate economy state');

const duplicateInputInventory = createInteractionInventoryState();
assert.equal(duplicateInputInventory.grant('dragonstone-field-ration', 2), true);
const duplicateInputRecipe = {
	recipeId: 'duplicate-input-canonicalization-proof',
	inputs: [
		{ itemId: 'dragonstone-field-ration', quantity: 1 },
		{ itemId: 'dragonstone-field-ration', quantity: 1 },
	],
	outputItemId: recipe.outputItemId,
	outputQuantity: 1,
};
result = duplicateInputInventory.grant('dragonstone-whetstone', 1, {
	sourceType: 'settlement-service',
	sourceId: 'duplicate-input-proof',
	craftUpgrade: duplicateInputRecipe,
});
assert.equal(result.ok, true);
assert.equal(result.crafted, true);
assert.deepEqual(result.consumedItems, [{ itemId: 'dragonstone-field-ration', quantity: 2 }], 'duplicate authored inputs must collapse into one canonical consumption requirement');
assert.equal(item(duplicateInputInventory.snapshot(), 'dragonstone-field-ration'), null);
assert.equal(item(duplicateInputInventory.snapshot(), recipe.outputItemId)?.quantity, 1);
assert.deepEqual(item(duplicateInputInventory.snapshot(), recipe.outputItemId)?.provenance, [{
	sourceType: 'settlement-crafting',
	sourceId: duplicateInputRecipe.recipeId,
}]);

console.log('PASS checkInteractionExpeditionKitCraft: authored smithing fails closed, crafts atomically, rolls back safely, canonicalizes duplicate inputs, debits ledger once and survives save/load.');
