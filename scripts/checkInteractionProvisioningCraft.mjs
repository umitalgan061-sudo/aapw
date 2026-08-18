import assert from 'node:assert/strict';
import { buildQuartermasterText, createInteractionEconomyState, QUARTERMASTER_OFFERS } from '../src/3d/gameplay/interactionEconomy.js';
import { createInteractionInventoryState, INTERACTION_ITEMS } from '../src/3d/gameplay/interactionConfig.js';

const ration = QUARTERMASTER_OFFERS[0];
const rationPrep = QUARTERMASTER_OFFERS[2];
const recipe = rationPrep.fulfillment?.craftUpgrade;
assert.deepEqual(recipe, {
	recipeId: 'dragonstone-watch-travel-ration-pack',
	inputItemId: 'dragonstone-field-ration',
	inputQuantity: 2,
	outputItemId: 'dragonstone-travel-ration-pack',
	outputQuantity: 1,
	label: '2 saha azığını 1 yol azığı paketine hazırla',
});
assert.equal(rationPrep.fulfillment?.discipline, 'provisioning');
assert.equal(rationPrep.fulfillment?.stationId, 'dragonstone-ration-prep-table');
assert.equal(INTERACTION_ITEMS[recipe.outputItemId]?.stackLimit, 2);

function item(snapshot, itemId) {
	return snapshot.items.find((entry) => entry.itemId === itemId) ?? null;
}

const legacyInventory = createInteractionInventoryState();
const legacyEconomy = createInteractionEconomyState();
let result = legacyEconomy.purchase(rationPrep, (...args) => legacyInventory.grant(...args));
assert.equal(result.ok, true);
assert.equal(result.crafted, false, 'service without two carried rations must preserve legacy ration fulfillment');
assert.equal(item(legacyInventory.snapshot(), ration.itemId)?.quantity, 1);
assert.equal(item(legacyInventory.snapshot(), recipe.outputItemId), null);

const inventory = createInteractionInventoryState();
assert.equal(inventory.grant(ration.itemId, 2, { sourceType: 'vendor', sourceId: 'stannis-guard-1' }), true);
const economy = createInteractionEconomyState();
const before = structuredClone(economy.snapshot());
result = economy.purchase(rationPrep, (...args) => inventory.grant(...args));
assert.equal(result.ok, true);
assert.equal(result.crafted, true);
assert.equal(result.craftedItemId, recipe.outputItemId);
assert.equal(result.spentCopper, 5);
assert.equal(result.balanceCopper, 35);
assert.equal(result.remainingStock, 0);
assert.equal(item(inventory.snapshot(), ration.itemId), null, 'two input rations must be consumed atomically');
const travelPack = item(inventory.snapshot(), recipe.outputItemId);
assert.equal(travelPack?.quantity, 1);
assert.deepEqual(travelPack?.provenance, [{
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-watch-travel-ration-pack',
}]);
assert.notDeepEqual(economy.snapshot(), before);

const savedInventory = structuredClone(inventory.snapshot());
const restoredInventory = createInteractionInventoryState();
restoredInventory.restore(savedInventory);
assert.deepEqual(restoredInventory.snapshot(), savedInventory, 'crafted provisioning output must survive inventory save/load');

const tamperedSave = structuredClone(savedInventory);
tamperedSave.items.push({
	itemId: 'future-forged-ration',
	name: 'Sahte Gelecek Eşyası',
	rarity: 'legendary',
	weightKg: -999,
	quantity: 999,
	provenance: [{ sourceType: 'forged', sourceId: 'future' }],
});
const tamperedPack = tamperedSave.items.find((entry) => entry.itemId === recipe.outputItemId);
tamperedPack.name = 'Sahte Yol Azığı';
tamperedPack.rarity = 'legendary';
tamperedPack.weightKg = -999;
tamperedPack.quantity = 999;
const sanitizedInventory = createInteractionInventoryState();
sanitizedInventory.restore(tamperedSave);
const sanitizedSnapshot = sanitizedInventory.snapshot();
const sanitizedPack = item(sanitizedSnapshot, recipe.outputItemId);
assert.equal(sanitizedSnapshot.items.length, 1, 'restore must reject unknown future/forged inventory item ids');
assert.equal(sanitizedPack?.name, INTERACTION_ITEMS[recipe.outputItemId].name, 'restore must rebuild authored item names');
assert.equal(sanitizedPack?.rarity, INTERACTION_ITEMS[recipe.outputItemId].rarity, 'restore must rebuild authored rarity');
assert.equal(sanitizedPack?.weightKg, INTERACTION_ITEMS[recipe.outputItemId].weightKg, 'restore must rebuild authored weight');
assert.equal(sanitizedPack?.quantity, INTERACTION_ITEMS[recipe.outputItemId].stackLimit, 'restore must clamp crafted output to authored stack limit');
assert.equal(sanitizedSnapshot.totalWeightKg, Number((INTERACTION_ITEMS[recipe.outputItemId].weightKg * INTERACTION_ITEMS[recipe.outputItemId].stackLimit).toFixed(2)));

const blockedInventory = createInteractionInventoryState();
assert.equal(blockedInventory.grant(ration.itemId, 2), true);
assert.equal(blockedInventory.grant(recipe.outputItemId, INTERACTION_ITEMS[recipe.outputItemId].stackLimit), true);
const blockedEconomy = createInteractionEconomyState();
const blockedInventoryBefore = structuredClone(blockedInventory.snapshot());
const blockedEconomyBefore = structuredClone(blockedEconomy.snapshot());
result = blockedEconomy.purchase(rationPrep, (...args) => blockedInventory.grant(...args));
assert.equal(result.ok, false);
assert.equal(result.reason, 'craft-output-full');
assert.deepEqual(blockedInventory.snapshot(), blockedInventoryBefore, 'failed crafting must not consume ingredients');
assert.deepEqual(blockedEconomy.snapshot(), blockedEconomyBefore, 'failed crafting must not debit copper or finite service stock');

const text = buildQuartermasterText(createInteractionEconomyState().snapshot());
assert.match(text, /HİZMET: Erzak hazırlama/);
assert.match(text, /DÖNÜŞÜM: 2 saha azığını 1 yol azığı paketine hazırla/);

console.log('PASS checkInteractionProvisioningCraft: ration prep preserves legacy fulfillment, atomically converts two rations into a persistent travel pack, sanitizes forged save metadata, and failed output-capacity craft leaves inventory/economy unchanged.');
