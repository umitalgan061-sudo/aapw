#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createInteractionController } from '../src/3d/gameplay/interaction.js';
import { INTERACTION_CONFIG } from '../src/3d/gameplay/interactionConfig.js';

const dialogueHistory = [];
const inventoryChanges = [];
const guard1 = { object3D: { name: 'stannis-guard-1', position: { x: 0, z: 0 } }, displayName: 'Birinci Nöbetçi' };
const guard2 = { object3D: { name: 'stannis-guard-2', position: { x: 0, z: 0 } }, displayName: 'İkinci Nöbetçi' };
const EMPTY_LEDGER = {
	transactionCount: 0,
	lifetimeSpentCopper: 0,
	purchasesByOffer: {
		'dragonstone-field-ration': 0,
		'dragonstone-whetstone': 0,
		'dragonstone-watch-ration-allotment': 0,
	},
	recentTransactions: [],
};
const FULL_QUARTERMASTER_ECONOMY = {
	copper: 40,
	stockByOffer: {
		'dragonstone-field-ration': 4,
		'dragonstone-whetstone': 2,
		'dragonstone-watch-ration-allotment': 1,
	},
	ledger: EMPTY_LEDGER,
};

function createController(overrides = {}) {
	return createInteractionController({
		interactionPrompt: { setVisible() {} },
		dialogueBox: {
			show: (text, choices = []) => dialogueHistory.push({ text, choices }),
			hide: () => dialogueHistory.push({ hidden: true }),
		},
		greetingTemplate: INTERACTION_CONFIG.GREETING_TEMPLATE,
		greetingsByNpcId: INTERACTION_CONFIG.GREETINGS_BY_NPC_ID,
		choicesByNpcId: INTERACTION_CONFIG.CHOICES_BY_NPC_ID,
		radiusMeters: INTERACTION_CONFIG.PROMPT_RADIUS_METERS,
		...overrides,
	});
}

function key(controller, code) {
	controller.handleKeyDown({ code, repeat: false });
}

function talk(controller, npc, visibleChoiceIndex) {
	controller.update([npc], { x: 0, z: 0 });
	key(controller, 'KeyE');
	controller.handleChoice(visibleChoiceIndex);
	key(controller, 'KeyE');
}

const controller = createController({
	onInventoryChanged: (snapshot) => inventoryChanges.push(structuredClone(snapshot)),
});
assert.deepEqual(controller.getInventorySnapshot(), { totalWeightKg: 0, items: [] });

talk(controller, guard1, 0);
talk(controller, guard2, 0);
talk(controller, guard1, 1);
let inventory = controller.getInventorySnapshot();
assert.equal(inventory.items.length, 1);
assert.equal(inventory.items[0].itemId, 'dragonstone-watch-seal');
assert.equal(inventory.items[0].quantity, 1);
assert.deepEqual(inventory.items[0].provenance, [{ sourceType: 'quest', sourceId: 'law-of-the-watch' }]);
assert.equal(inventory.totalWeightKg, 0.15);
assert.equal(inventoryChanges.length, 1);

talk(controller, guard1, 1);
assert.deepEqual(controller.getInventorySnapshot(), inventory);
assert.equal(inventoryChanges.length, 1);

talk(controller, guard1, 2);
talk(controller, guard2, 1);
talk(controller, guard2, 2);
talk(controller, guard1, 0);
inventory = controller.getInventorySnapshot();
assert.equal(inventory.items.length, 2);
assert.equal(inventory.totalWeightKg, 0.2);
assert.equal(inventory.items.find((item) => item.itemId === 'watch-captains-writ')?.quantity, 1);
assert.deepEqual(inventory.items.find((item) => item.itemId === 'watch-captains-writ')?.provenance,[{ sourceType: 'quest', sourceId: 'watch-under-pressure' }]);
assert.equal(inventoryChanges.length, 2);

key(controller, 'KeyI');
const inventoryPanel = dialogueHistory.at(-1)?.text ?? '';
assert.match(inventoryPanel, /Envanter/);
assert.match(inventoryPanel, /Dragonstone Nöbet Mührü/);
assert.match(inventoryPanel, /Nöbet Kaptanının Buyruğu/);
assert.match(inventoryPanel, /Toplam ağırlık: 0\.2 kg/);
assert.match(inventoryPanel, /Kaynak: quest\/watch-under-pressure/);
key(controller, 'KeyI');

const saved = controller.getRpgSnapshot();
assert.equal(saved.schemaVersion, 5);
assert.deepEqual(saved.inventory, inventory);
assert.deepEqual(saved.economy, FULL_QUARTERMASTER_ECONOMY);
const restored = createController();
restored.restoreRpgSnapshot(saved);
assert.deepEqual(restored.getInventorySnapshot(), inventory);
assert.deepEqual(restored.getEconomySnapshot(), FULL_QUARTERMASTER_ECONOMY);

const legacyV3 = structuredClone(saved);
legacyV3.schemaVersion = 3;
delete legacyV3.inventory;
delete legacyV3.economy;
const migrated = createController();
migrated.restoreRpgSnapshot(legacyV3);
assert.deepEqual(migrated.getInventorySnapshot(), inventory);
assert.deepEqual(migrated.getEconomySnapshot(), FULL_QUARTERMASTER_ECONOMY);
migrated.restoreRpgSnapshot(legacyV3);
assert.deepEqual(migrated.getInventorySnapshot(), inventory);
assert.deepEqual(migrated.getEconomySnapshot(), FULL_QUARTERMASTER_ECONOMY);

console.log('[checkInteractionInventoryRewards] PASS: quest rewards -> inventory -> UI -> schema v5 ledger/receipt-aware persistence/migration');
