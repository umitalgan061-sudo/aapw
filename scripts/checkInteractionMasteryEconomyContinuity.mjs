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
controller.handleKeyDown({ code: 'Digit2', repeat: false });
assert.match(runtime.getRenderedText(), /Nöbetçi bileği taşı çantana eklendi\. 12 bakır ödendi\./);
assert.match(runtime.getRenderedText(), /Kese: 58 bakır/);
assert.match(runtime.getRenderedText(), /Son işlem: #1 Nöbetçi bileği taşı · 12 bakır · bakiye 58/);

const purchased = controller.getRpgSnapshot();
assert.equal(purchased.economy.copper, 58);
assert.equal(purchased.economy.stockByOffer['dragonstone-whetstone'], 1);
assert.equal(purchased.economy.ledger.transactionCount, 1);
assert.equal(purchased.economy.ledger.lifetimeSpentCopper, 12);
const stones = purchased.inventory.items.find((item) => item.itemId === 'dragonstone-whetstone');
assert.equal(stones?.quantity, 2, 'blocked craft must preserve mastery stone and grant the paid armorer supply');
assert.deepEqual(stones?.provenance, [
	{ sourceType: 'expedition-mastery', sourceId: 'dragonstone-expedition-mastery' },
	{ sourceType: 'settlement-service', sourceId: 'dragonstone-watch-armorer-honing' },
]);
assert.ok(inventoryEvents >= 2, 'mastery and armorer purchase must both publish inventory changes');
assert.ok(economyEvents >= 3, 'contract credit, mastery credit and armorer purchase must publish economy changes');
assert.ok(worldEvents >= 1, 'mastery completion must publish world-state change');

const forged = structuredClone(purchased);
forged.economy.ledger.transactionCount = 999;
forged.economy.ledger.lifetimeSpentCopper = 999999;
forged.economy.ledger.purchasesByOffer['dragonstone-whetstone'] = 999;
const restored = makeController();
restored.controller.restoreRpgSnapshot(forged);
const restoredSnapshot = restored.controller.getRpgSnapshot();
assert.equal(restoredSnapshot.economy.copper, 58);
assert.equal(restoredSnapshot.economy.stockByOffer['dragonstone-whetstone'], 1);
assert.equal(restoredSnapshot.economy.ledger.transactionCount, 1, 'finite stock remains authoritative over forged aggregate ledger totals');
assert.equal(restoredSnapshot.economy.ledger.lifetimeSpentCopper, 12);
assert.equal(restoredSnapshot.economy.ledger.purchasesByOffer['dragonstone-whetstone'], 1);
assert.deepEqual(restoredSnapshot.inventory.items.find((item) => item.itemId === 'dragonstone-whetstone')?.provenance, stones.provenance);
assert.equal(restoredSnapshot.worldState.dragonstoneExpeditionMasteryClaimed, true);

console.log('[RPG] PASS mastery credit -> armorer purchase -> provenance/ledger save-load continuity');
