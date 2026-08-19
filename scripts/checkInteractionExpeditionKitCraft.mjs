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

let result = economy.purchase(armorer, grant);
assert.equal(result.ok, true, 'first armorer service remains backwards-compatible and grants a whetstone');
assert.equal(result.crafted, false);
assert.equal(item(inventory.snapshot(), 'dragonstone-whetstone')?.quantity, 1);
assert.equal(economy.snapshot().copper, 48);
assert.equal(economy.snapshot().stockByOffer[armorer.id], 1);

assert.equal(inventory.grant('dragonstone-travel-ration-pack', 1, {
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-watch-travel-ration-pack',
}), true);
const beforeCraft = structuredClone(inventory.snapshot());
assert.equal(item(beforeCraft, 'dragonstone-whetstone')?.quantity, 1);
assert.equal(item(beforeCraft, 'dragonstone-travel-ration-pack')?.quantity, 1);

result = economy.purchase(armorer, grant);
assert.equal(result.ok, true);
assert.equal(result.crafted, true);
assert.equal(result.craftedItemId, recipe.outputItemId);
assert.deepEqual(result.consumedItems, recipe.inputs, 'successful multi-input craft must report both canonical consumed ingredients');
assert.equal(result.balanceCopper, 36);
assert.equal(result.remainingStock, 0);
const crafted = inventory.snapshot();
assert.equal(item(crafted, 'dragonstone-whetstone'), null);
assert.equal(item(crafted, 'dragonstone-travel-ration-pack'), null);
assert.equal(item(crafted, recipe.outputItemId)?.quantity, 1);
assert.deepEqual(item(crafted, recipe.outputItemId)?.provenance, [{
	sourceType: 'settlement-crafting',
	sourceId: recipe.recipeId,
}]);
assert.equal(economy.snapshot().ledger.transactionCount, 2);
assert.equal(economy.snapshot().ledger.lifetimeSpentCopper, 24);

const restored = createInteractionInventoryState();
restored.restore(crafted);
assert.deepEqual(restored.snapshot(), crafted, 'crafted expedition kit must survive canonical inventory save/restore');

const outputFullInventory = createInteractionInventoryState();
const outputFullEconomy = createInteractionEconomyState(60);
assert.equal(
	outputFullEconomy.purchase(armorer, (...args) => outputFullInventory.grant(...args)).ok,
	true,
	'output-full rollback fixture must first obtain its whetstone through the normal armorer fallback',
);
assert.equal(outputFullInventory.grant('dragonstone-travel-ration-pack', 1), true);
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
result = missingInputEconomy.purchase(armorer, (...args) => missingInputInventory.grant(...args));
assert.equal(result.ok, true);
assert.equal(result.crafted, false);
assert.equal(item(missingInputInventory.snapshot(), 'dragonstone-travel-ration-pack')?.quantity, 1);
assert.equal(item(missingInputInventory.snapshot(), 'dragonstone-whetstone')?.quantity, 1, 'missing recipe input falls back to normal service fulfillment without consuming the pack');

console.log('PASS checkInteractionExpeditionKitCraft: armorer service supports atomic two-input smithing, rollback, fallback, ledger debit and save/load.');
