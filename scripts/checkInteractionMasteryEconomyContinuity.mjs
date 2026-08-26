#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createInteractionController } from '../src/3d/gameplay/interaction.js';

function makeController({ onInventoryChanged = () => {}, onEconomyChanged = () => {}, onWorldStateChanged = () => {} } = {}) {
	let renderedText = '';
	const controller = createInteractionController({
		interactionPrompt: { setVisible() {} },
		dialogueBox: {
			show(text) { renderedText = String(text); },
			hide() { renderedText = ''; },
		},
		greetingTemplate: 'Selam, {name}!',
		radiusMeters: 6,
		onInventoryChanged,
		onEconomyChanged,
		onWorldStateChanged,
	});
	return { controller, getRenderedText: () => renderedText };
}

function seededMasterySave(controller) {
	const save = controller.getRpgSnapshot();
	save.inventory = {
		items: [
			{
				itemId: 'dragonstone-expedition-maintenance-kit',
				quantity: 1,
				provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-expedition-maintenance-kit' }],
			},
			{
				itemId: 'dragonstone-travel-ration-pack',
				quantity: 2,
				provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }],
			},
		],
	};
	save.worldState = {
		dragonstoneWatchPolicy: null,
		dragonstoneExpeditionRoutes: ['dragonstone-watch-circuit', 'dragonstone-harbor-tavern-run'],
	};
	return save;
}

let inventoryEvents = 0;
let economyEvents = 0;
let worldEvents = 0;
const runtime = makeController({
	onInventoryChanged() { inventoryEvents += 1; },
	onEconomyChanged() { economyEvents += 1; },
	onWorldStateChanged() { worldEvents += 1; },
});
const { controller } = runtime;
controller.restoreRpgSnapshot(seededMasterySave(controller));
inventoryEvents = 0;
economyEvents = 0;
worldEvents = 0;

const quartermaster = {
	displayName: 'Dragonstone Levazımcısı',
	object3D: { name: 'stannis-guard-1', position: { x: 0, z: 0 } },
};
controller.update([quartermaster], { x: 1, z: 1 });
controller.handleKeyDown({ code: 'KeyT', repeat: false });
assert.match(runtime.getRenderedText(), /Sefer ustalığı: İLERLEME 2\/3/);
controller.handleKeyDown({ code: 'Digit3', repeat: false });
assert.match(runtime.getRenderedText(), /SEFER USTALIĞI KAZANILDI/);
assert.match(runtime.getRenderedText(), /kese 70/);

const masterySnapshot = controller.getRpgSnapshot();
assert.equal(masterySnapshot.worldState.dragonstoneExpeditionMasteryClaimed, true);
assert.equal(masterySnapshot.economy.copper, 70);
assert.equal(masterySnapshot.economy.ledger.recentCredits.at(-1)?.sourceId, 'expedition-mastery');
assert.equal(masterySnapshot.economy.ledger.recentCredits.at(-1)?.creditedCopper, 20);
const masteryStone = masterySnapshot.inventory.items.find((item) => item.itemId === 'dragonstone-whetstone');
assert.equal(masteryStone?.quantity, 1);
assert.deepEqual(masteryStone?.provenance, [{ sourceType: 'expedition-mastery', sourceId: 'dragonstone-expedition-mastery' }]);

controller.handleKeyDown({ code: 'KeyB', repeat: false });
assert.match(runtime.getRenderedText(), /Son gelir: Sefer ustalığı · \+20 bakır · bakiye 70/);
const beforeBlockedArmorer = controller.getRpgSnapshot();
controller.handleKeyDown({ code: 'Digit2', repeat: false });
assert.match(runtime.getRenderedText(), /Satın alma başarısız\./);
assert.match(runtime.getRenderedText(), /Kese: 70 bakır/);
assert.match(runtime.getRenderedText(), /Nöbetçi bileği taşı — 12 bakır · stok 2\/2 · aldın 0/);

const blocked = controller.getRpgSnapshot();
assert.deepEqual(blocked.inventory, beforeBlockedArmorer.inventory, 'blocked smithing must preserve mastery inventory atomically');
assert.equal(blocked.economy.copper, 70, 'blocked smithing must not charge copper');
assert.equal(blocked.economy.stockByOffer['dragonstone-whetstone'], 2, 'blocked smithing must not decrement finite stock');
assert.equal(blocked.economy.ledger.transactionCount, 0, 'blocked smithing must not append purchase ledger state');
assert.equal(blocked.economy.ledger.lifetimeSpentCopper, 0);
assert.equal(blocked.economy.ledger.purchasesByOffer['dragonstone-whetstone'] ?? 0, 0);
const stones = blocked.inventory.items.find((item) => item.itemId === 'dragonstone-whetstone');
assert.equal(stones?.quantity, 1, 'blocked craft must preserve the mastery stone without granting a paid fallback item');
assert.deepEqual(stones?.provenance, [
	{ sourceType: 'expedition-mastery', sourceId: 'dragonstone-expedition-mastery' },
]);
assert.ok(inventoryEvents >= 1, 'mastery completion must publish its inventory change');
assert.ok(economyEvents >= 2, 'contract and mastery credits must publish economy changes');
assert.ok(worldEvents >= 1, 'mastery completion must publish world-state change');

const forged = structuredClone(blocked);
forged.economy.ledger.transactionCount = 999;
forged.economy.ledger.lifetimeSpentCopper = 999999;
forged.economy.ledger.purchasesByOffer['dragonstone-whetstone'] = 999;
const restored = makeController();
restored.controller.restoreRpgSnapshot(forged);
const restoredSnapshot = restored.controller.getRpgSnapshot();
assert.equal(restoredSnapshot.economy.copper, 70);
assert.equal(restoredSnapshot.economy.stockByOffer['dragonstone-whetstone'], 2);
assert.equal(restoredSnapshot.economy.ledger.transactionCount, 0, 'finite stock remains authoritative over forged aggregate ledger totals');
assert.equal(restoredSnapshot.economy.ledger.lifetimeSpentCopper, 0);
assert.equal(restoredSnapshot.economy.ledger.purchasesByOffer['dragonstone-whetstone'] ?? 0, 0);
assert.deepEqual(restoredSnapshot.inventory.items.find((item) => item.itemId === 'dragonstone-whetstone')?.provenance, stones.provenance);
assert.equal(restoredSnapshot.worldState.dragonstoneExpeditionMasteryClaimed, true);

console.log('[RPG] PASS mastery credit -> blocked armorer smithing -> atomic provenance/ledger save-load continuity');
