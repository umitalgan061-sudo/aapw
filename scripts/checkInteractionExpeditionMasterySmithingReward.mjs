#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createInteractionController } from '../src/3d/gameplay/interaction.js';

function expeditionInventory({ packs = 2 } = {}) {
	return {
		items: [
			{ itemId: 'dragonstone-expedition-maintenance-kit', quantity: 1, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-expedition-maintenance-kit' }] },
			...(packs > 0 ? [{ itemId: 'dragonstone-travel-ration-pack', quantity: packs, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }] }] : []),
		],
	};
}

function makeController(dialogueBox) {
	return createInteractionController({
		interactionPrompt: { setVisible() {} },
		dialogueBox,
		greetingTemplate: 'Selam, {name}!',
		radiusMeters: 6,
	});
}

let renderedText = '';
let inventoryEvents = 0;
const dialogueBox = {
	show(text) { renderedText = String(text); },
	hide() { renderedText = ''; },
};
const quartermaster = { displayName: 'Dragonstone Levazımcısı', object3D: { name: 'stannis-guard-1', position: { x: 0, z: 0 } } };

const controller = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox,
	greetingTemplate: 'Selam, {name}!',
	radiusMeters: 6,
	onInventoryChanged() { inventoryEvents += 1; },
});
const save = controller.getRpgSnapshot();
save.inventory = expeditionInventory();
save.worldState = {
	dragonstoneWatchPolicy: null,
	dragonstoneExpeditionRoutes: ['dragonstone-watch-circuit', 'dragonstone-harbor-tavern-run'],
};
controller.restoreRpgSnapshot(save);
inventoryEvents = 0;
controller.update([quartermaster], { x: 1, z: 1 });
controller.handleKeyDown({ code: 'KeyT', repeat: false });
assert.match(renderedText, /Sefer ustalığı: İLERLEME 2\/3/);
controller.handleKeyDown({ code: 'Digit3', repeat: false });
assert.match(renderedText, /SEFER USTALIĞI KAZANILDI: 50 XP \+ 3 Dragonstone itibarı \+ 20 bakır \+ 1 Nöbetçi Bileği Taşı · kese 70/);
const whetstone = controller.getInventorySnapshot().items.find((item) => item.itemId === 'dragonstone-whetstone');
assert.equal(whetstone?.quantity, 1);
assert.deepEqual(whetstone?.provenance, [{ sourceType: 'expedition-mastery', sourceId: 'dragonstone-expedition-mastery' }]);
assert.equal(inventoryEvents, 2, 'journey provision consumption and mastery item grant must each emit inventory change');

const persisted = structuredClone(controller.getRpgSnapshot());
const restored = makeController(dialogueBox);
restored.restoreRpgSnapshot(persisted);
const restoredWhetstone = restored.getInventorySnapshot().items.find((item) => item.itemId === 'dragonstone-whetstone');
assert.equal(restoredWhetstone?.quantity, 1);
assert.deepEqual(restoredWhetstone?.provenance, [{ sourceType: 'expedition-mastery', sourceId: 'dragonstone-expedition-mastery' }]);

const replay = restored.getRpgSnapshot();
replay.inventory = {
	items: [
		...expeditionInventory().items,
		{ itemId: 'dragonstone-whetstone', quantity: 1, provenance: [{ sourceType: 'expedition-mastery', sourceId: 'dragonstone-expedition-mastery' }] },
	],
};
replay.journey = { fatigueKm: 0, commitCount: 1, lastDestinationId: 'dragonstone-harbor-road', recentReceipts: [] };
restored.restoreRpgSnapshot(replay);
restored.update([quartermaster], { x: 1, z: 1 });
restored.handleKeyDown({ code: 'KeyT', repeat: false });
restored.handleKeyDown({ code: 'Digit3', repeat: false });
assert.match(renderedText, /tekrar ödülü yok/);
assert.doesNotMatch(renderedText, /SEFER USTALIĞI KAZANILDI/);
assert.equal(restored.getInventorySnapshot().items.find((item) => item.itemId === 'dragonstone-whetstone')?.quantity, 1, 'mastery replay must not duplicate smithing supply');

const forged = makeController(dialogueBox);
const forgedSave = forged.getRpgSnapshot();
forgedSave.inventory = expeditionInventory();
forgedSave.worldState = {
	dragonstoneExpeditionRoutes: ['dragonstone-watch-circuit', 'dragonstone-harbor-tavern-run'],
	dragonstoneExpeditionMasteryClaimed: true,
};
forged.restoreRpgSnapshot(forgedSave);
assert.equal(forged.getWorldStateSnapshot().dragonstoneExpeditionMasteryClaimed, undefined, 'incomplete route set cannot forge mastery eligibility');
assert.equal(forged.getInventorySnapshot().items.some((item) => item.itemId === 'dragonstone-whetstone'), false, 'forged mastery flag cannot materialize a reward item on restore');

console.log('[RPG] PASS expedition mastery grants one persisted canonical smithing supply with provenance and replay protection');
