import assert from 'node:assert/strict';
import { createInteractionController } from '../src/3d/gameplay/interaction.js';
import {
	QUARTERMASTER_NPC_ID,
	QUARTERMASTER_OFFERS,
	STARTING_COPPER,
	buildQuartermasterText,
	createInteractionEconomyState,
} from '../src/3d/gameplay/interactionEconomy.js';
import { INTERACTION_CONFIG, INTERACTION_ITEMS, createInteractionInventoryState } from '../src/3d/gameplay/interactionConfig.js';

const ration = QUARTERMASTER_OFFERS[0];
const whetstone = QUARTERMASTER_OFFERS[1];
assert.equal(QUARTERMASTER_NPC_ID, 'stannis-guard-1');
assert.equal(STARTING_COPPER, 40);
assert.equal(ration.stockLimit, 4);
assert.equal(whetstone.stockLimit, 2);
assert.equal(INTERACTION_ITEMS[ration.itemId]?.stackLimit, 5);
assert.equal(INTERACTION_ITEMS[whetstone.itemId]?.stackLimit, 3);

const inventory = createInteractionInventoryState();
const economy = createInteractionEconomyState();
const grant = (itemId, quantity, provenance) => inventory.grant(itemId, quantity, provenance);
assert.deepEqual(economy.snapshot(), {
	copper: 40,
	stockByOffer: { 'dragonstone-field-ration': 4, 'dragonstone-whetstone': 2 },
});

let result = economy.purchase(ration, grant);
assert.equal(result.ok, true);
assert.equal(result.balanceCopper, 34);
assert.equal(result.remainingStock, 3);
assert.deepEqual(inventory.snapshot().items[0].provenance, [{ sourceType: 'vendor', sourceId: QUARTERMASTER_NPC_ID }]);

result = economy.purchase(whetstone, grant);
assert.equal(result.ok, true);
assert.equal(result.balanceCopper, 22);
assert.equal(result.remainingStock, 1);
assert.deepEqual(economy.snapshot().stockByOffer, { 'dragonstone-field-ration': 3, 'dragonstone-whetstone': 1 });

const stockEconomy = createInteractionEconomyState(100);
const stockInventory = createInteractionInventoryState();
for (let index = 0; index < whetstone.stockLimit; index += 1) {
	assert.equal(stockEconomy.purchase(whetstone, (...args) => stockInventory.grant(...args)).ok, true);
}
const stockBefore = structuredClone(stockEconomy.snapshot());
const inventoryBefore = structuredClone(stockInventory.snapshot());
result = stockEconomy.purchase(whetstone, (...args) => stockInventory.grant(...args));
assert.equal(result.reason, 'out-of-stock');
assert.deepEqual(stockEconomy.snapshot(), stockBefore);
assert.deepEqual(stockInventory.snapshot(), inventoryBefore);

const fullEconomy = createInteractionEconomyState(100);
const fullInventory = createInteractionInventoryState();
for (let index = 0; index < INTERACTION_ITEMS[ration.itemId].stackLimit; index += 1) fullInventory.grant(ration.itemId, 1);
const fullBefore = structuredClone(fullEconomy.snapshot());
result = fullEconomy.purchase(ration, (...args) => fullInventory.grant(...args));
assert.equal(result.reason, 'inventory-full');
assert.deepEqual(fullEconomy.snapshot(), fullBefore);

const poorEconomy = createInteractionEconomyState(5);
const poorBefore = structuredClone(poorEconomy.snapshot());
result = poorEconomy.purchase(ration, () => true);
assert.equal(result.reason, 'insufficient-funds');
assert.deepEqual(poorEconomy.snapshot(), poorBefore);

const saved = economy.snapshot();
const restored = createInteractionEconomyState(0);
restored.restore(saved);
assert.deepEqual(restored.snapshot(), saved);
restored.restore({ copper: 17 });
assert.deepEqual(restored.snapshot(), { copper: 17, stockByOffer: { 'dragonstone-field-ration': 4, 'dragonstone-whetstone': 2 } });
restored.restore({ copper: 17, stockByOffer: { [ration.id]: 999, [whetstone.id]: -2 } });
assert.deepEqual(restored.snapshot().stockByOffer, { 'dragonstone-field-ration': 4, 'dragonstone-whetstone': 2 });

const text = buildQuartermasterText(saved, QUARTERMASTER_OFFERS, 'Satın alma tamamlandı.');
assert.match(text, /Kese: 22 bakır/);
assert.match(text, /saha azığı — 6 bakır · stok 3\/4/);
assert.match(text, /bileği taşı — 12 bakır · stok 1\/2/);

const dialogueHistory = [];
const economyChanges = [];
const inventoryChanges = [];
const quartermaster = { object3D: { name: QUARTERMASTER_NPC_ID, position: { x: 0, z: 0 } }, displayName: 'Kapı Nöbetçisi' };
const controller = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: { show: (body, choices = []) => dialogueHistory.push({ body, choices }), hide() {} },
	greetingTemplate: INTERACTION_CONFIG.GREETING_TEMPLATE,
	greetingsByNpcId: INTERACTION_CONFIG.GREETINGS_BY_NPC_ID,
	choicesByNpcId: INTERACTION_CONFIG.CHOICES_BY_NPC_ID,
	radiusMeters: INTERACTION_CONFIG.PROMPT_RADIUS_METERS,
	onEconomyChanged: (snapshot) => economyChanges.push(structuredClone(snapshot)),
	onInventoryChanged: (snapshot) => inventoryChanges.push(structuredClone(snapshot)),
});
controller.update([quartermaster], { x: 0, z: 0 });
controller.handleKeyDown({ code: 'KeyB', repeat: false });
assert.match(dialogueHistory.at(-1).body, /stok 4\/4/);
controller.handleKeyDown({ code: 'Digit1', repeat: false });
assert.equal(controller.getEconomySnapshot().copper, 34);
assert.equal(controller.getEconomySnapshot().stockByOffer[ration.id], 3);
assert.match(dialogueHistory.at(-1).body, /stok 3\/4/);
assert.equal(economyChanges.length, 1);
assert.equal(inventoryChanges.length, 1);

const runtimeSaved = controller.getRpgSnapshot();
assert.equal(runtimeSaved.schemaVersion, 5);
const runtimeRestored = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: { show() {}, hide() {} },
	greetingTemplate: INTERACTION_CONFIG.GREETING_TEMPLATE,
	greetingsByNpcId: INTERACTION_CONFIG.GREETINGS_BY_NPC_ID,
	choicesByNpcId: INTERACTION_CONFIG.CHOICES_BY_NPC_ID,
	radiusMeters: INTERACTION_CONFIG.PROMPT_RADIUS_METERS,
});
runtimeRestored.restoreRpgSnapshot(runtimeSaved);
assert.deepEqual(runtimeRestored.getEconomySnapshot(), runtimeSaved.economy);
controller.update([], { x: 100, z: 100 });
controller.handleKeyDown({ code: 'KeyB', repeat: false });
assert.equal(controller.getEconomySnapshot().stockByOffer[ration.id], 3);

console.log('PASS checkInteractionQuartermasterTrade: deterministic purse, finite vendor stock, shipped purchase UX and persistence verified.');
