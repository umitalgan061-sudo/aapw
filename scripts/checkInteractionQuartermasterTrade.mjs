import assert from 'node:assert/strict';
import { createInteractionController } from '../src/3d/gameplay/interaction.js';
import {
	QUARTERMASTER_NPC_ID,
	QUARTERMASTER_OFFERS,
	STARTING_COPPER,
	buildQuartermasterText,
	createInteractionEconomyState,
} from '../src/3d/gameplay/interactionEconomy.js';
import {
	INTERACTION_CONFIG,
	INTERACTION_ITEMS,
	createInteractionInventoryState,
} from '../src/3d/gameplay/interactionConfig.js';

assert.equal(QUARTERMASTER_NPC_ID, 'stannis-guard-1');
assert.equal(STARTING_COPPER, 40);
assert.equal(QUARTERMASTER_OFFERS.length, 2);

const inventory = createInteractionInventoryState();
const economy = createInteractionEconomyState();
const grant = (itemId, quantity, provenance) => inventory.grant(itemId, quantity, provenance);

const ration = QUARTERMASTER_OFFERS[0];
const whetstone = QUARTERMASTER_OFFERS[1];
assert.equal(INTERACTION_ITEMS[ration.itemId]?.stackLimit, 5);
assert.equal(INTERACTION_ITEMS[whetstone.itemId]?.stackLimit, 3);

let result = economy.purchase(ration, grant);
assert.equal(result.ok, true);
assert.equal(result.balanceCopper, 34);
assert.equal(inventory.snapshot().items.find((item) => item.itemId === ration.itemId)?.quantity, 1);
assert.deepEqual(
	inventory.snapshot().items.find((item) => item.itemId === ration.itemId)?.provenance,
	[{ sourceType: 'vendor', sourceId: QUARTERMASTER_NPC_ID }],
);

result = economy.purchase(whetstone, grant);
assert.equal(result.ok, true);
assert.equal(result.balanceCopper, 22);
assert.equal(inventory.snapshot().items.find((item) => item.itemId === whetstone.itemId)?.quantity, 1);

// Stack cap rejects a purchase without charging the player.
for (let index = 0; index < 4; index += 1) economy.purchase(ration, grant);
assert.equal(inventory.snapshot().items.find((item) => item.itemId === ration.itemId)?.quantity, 5);
const beforeFullAttempt = economy.snapshot().copper;
result = economy.purchase(ration, grant);
assert.equal(result.ok, false);
assert.equal(result.reason, 'inventory-full');
assert.equal(economy.snapshot().copper, beforeFullAttempt);

// Insufficient funds also fail without inventory mutation.
const poorEconomy = createInteractionEconomyState(5);
const poorInventory = createInteractionInventoryState();
result = poorEconomy.purchase(ration, (...args) => poorInventory.grant(...args));
assert.equal(result.ok, false);
assert.equal(result.reason, 'insufficient-funds');
assert.equal(poorEconomy.snapshot().copper, 5);
assert.equal(poorInventory.snapshot().items.length, 0);

// Save/restore is deterministic and malformed/legacy state falls back to the starting purse.
const saved = economy.snapshot();
const restored = createInteractionEconomyState(0);
restored.restore(saved);
assert.deepEqual(restored.snapshot(), saved);
restored.restore({ copper: -50 });
assert.equal(restored.snapshot().copper, STARTING_COPPER);
restored.restore(null);
assert.equal(restored.snapshot().copper, STARTING_COPPER);

const text = buildQuartermasterText({ copper: 17 }, QUARTERMASTER_OFFERS, 'Satın alma tamamlandı.');
assert.match(text, /Dragonstone Levazımcısı/);
assert.match(text, /Kese: 17 bakır/);
assert.match(text, /saha azığı — 6 bakır/);
assert.match(text, /bileği taşı — 12 bakır/);
assert.match(text, /Satın alma tamamlandı/);

// Prove the real shipped interaction seam: proximity -> B shop -> number purchase -> inventory -> save.
const dialogueHistory = [];
const economyChanges = [];
const inventoryChanges = [];
const quartermaster = {
	object3D: { name: QUARTERMASTER_NPC_ID, position: { x: 0, z: 0 } },
	displayName: 'Kapı Nöbetçisi',
};
const controller = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: {
		show: (body, choices = []) => dialogueHistory.push({ body, choices }),
		hide: () => dialogueHistory.push({ hidden: true }),
	},
	greetingTemplate: INTERACTION_CONFIG.GREETING_TEMPLATE,
	greetingsByNpcId: INTERACTION_CONFIG.GREETINGS_BY_NPC_ID,
	choicesByNpcId: INTERACTION_CONFIG.CHOICES_BY_NPC_ID,
	radiusMeters: INTERACTION_CONFIG.PROMPT_RADIUS_METERS,
	onEconomyChanged: (snapshot) => economyChanges.push(structuredClone(snapshot)),
	onInventoryChanged: (snapshot) => inventoryChanges.push(structuredClone(snapshot)),
});
controller.update([quartermaster], { x: 0, z: 0 });
controller.handleKeyDown({ code: 'KeyB', repeat: false });
assert.match(dialogueHistory.at(-1).body, /Dragonstone Levazımcısı/);
assert.deepEqual(dialogueHistory.at(-1).choices, [
	'Dragonstone saha azığı — 6 bakır',
	'Nöbetçi bileği taşı — 12 bakır',
]);
controller.handleKeyDown({ code: 'Digit1', repeat: false });
assert.deepEqual(controller.getEconomySnapshot(), { copper: 34 });
assert.equal(controller.getInventorySnapshot().items.find((item) => item.itemId === ration.itemId)?.quantity, 1);
assert.match(dialogueHistory.at(-1).body, /çantana eklendi/);
assert.equal(economyChanges.length, 1);
assert.equal(inventoryChanges.length, 1);

const runtimeSaved = controller.getRpgSnapshot();
assert.equal(runtimeSaved.schemaVersion, 5);
assert.deepEqual(runtimeSaved.economy, { copper: 34 });
const runtimeRestored = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: { show() {}, hide() {} },
	greetingTemplate: INTERACTION_CONFIG.GREETING_TEMPLATE,
	greetingsByNpcId: INTERACTION_CONFIG.GREETINGS_BY_NPC_ID,
	choicesByNpcId: INTERACTION_CONFIG.CHOICES_BY_NPC_ID,
	radiusMeters: INTERACTION_CONFIG.PROMPT_RADIUS_METERS,
});
runtimeRestored.restoreRpgSnapshot(runtimeSaved);
assert.deepEqual(runtimeRestored.getEconomySnapshot(), { copper: 34 });
assert.equal(runtimeRestored.getInventorySnapshot().items.find((item) => item.itemId === ration.itemId)?.quantity, 1);

// Moving away closes the shop; B cannot open it without the canonical quartermaster nearby.
controller.update([], { x: 100, z: 100 });
controller.handleKeyDown({ code: 'KeyB', repeat: false });
assert.deepEqual(controller.getEconomySnapshot(), { copper: 34 });

console.log('PASS checkInteractionQuartermasterTrade: deterministic economy plus shipped proximity/shop/purchase/persistence interaction verified.');
