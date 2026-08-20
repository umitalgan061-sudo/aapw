#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	buildExpeditionBoardText,
	createInteractionController,
	evaluateExpeditionBoard,
} from '../src/3d/gameplay/interaction.js';

function expeditionInventory({ packs = 2 } = {}) {
	return {
		items: [
			{ itemId: 'dragonstone-expedition-maintenance-kit', quantity: 1, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-expedition-maintenance-kit' }] },
			...(packs > 0 ? [{ itemId: 'dragonstone-travel-ration-pack', quantity: packs, provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }] }] : []),
		],
	};
}

const lockedBoard = evaluateExpeditionBoard({ items: [] }, { fatigueKm: 0 });
assert.equal(lockedBoard.entries.length, 3);
assert.equal(lockedBoard.entries.every((entry) => entry.ready === false), true);
assert.match(buildExpeditionBoardText(lockedBoard), /Dragonstone Sefer Panosu/);
assert.match(buildExpeditionBoardText(lockedBoard), /KİLİTLİ/);

const readyBoard = evaluateExpeditionBoard(expeditionInventory(), { fatigueKm: 0 });
assert.equal(readyBoard.entries[1].id, 'dragonstone-harbor-tavern-run');
assert.equal(readyBoard.entries[1].ready, true);
assert.equal(readyBoard.entries[1].plan.totalDistanceKm, 58);
assert.equal(readyBoard.entries[1].plan.startingTravelPacks, 2);
assert.equal(readyBoard.entries[1].plan.remainingTravelPacks, 0);
assert.equal(readyBoard.entries[1].plan.finalFatigueKm, 30);

let renderedText = '';
let renderedChoices = [];
let inventoryEvents = 0;
let journeyEvents = 0;
const dialogueBox = {
	show(text, choices = []) { renderedText = String(text); renderedChoices = [...choices]; },
	hide() { renderedText = ''; renderedChoices = []; },
};
const controller = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox,
	greetingTemplate: 'Selam, {name}!',
	radiusMeters: 6,
	onInventoryChanged() { inventoryEvents += 1; },
	onJourneyChanged() { journeyEvents += 1; },
});
const saved = controller.getRpgSnapshot();
saved.inventory = expeditionInventory();
controller.restoreRpgSnapshot(saved);
inventoryEvents = 0;
journeyEvents = 0;

const quartermaster = { displayName: 'Dragonstone Levazımcısı', object3D: { name: 'stannis-guard-1', position: { x: 0, z: 0 } } };
controller.update([quartermaster], { x: 1, z: 1 });
controller.handleKeyDown({ code: 'KeyT', repeat: false });
assert.match(renderedText, /Dragonstone Sefer Panosu/);
assert.equal(renderedChoices.length, 3);
assert.match(renderedChoices[1], /Liman Taverna Seferi — HAZIR/);

controller.handleKeyDown({ code: 'Digit2', repeat: false });
assert.match(renderedText, /SEFER TAMAMLANDI/);
assert.match(renderedText, /Taverna · dragonstone-harbor-tavern · DİNLENDİ/);
assert.equal(controller.getInventorySnapshot().fieldReadiness.travelCapacity.travelRationPacks, 0);
assert.equal(controller.getJourneySnapshot().fatigueKm, 30);
assert.equal(controller.getJourneySnapshot().lastDestinationId, 'dragonstone-harbor-road');
assert.equal(controller.getJourneySnapshot().commitCount, 1);
assert.equal(inventoryEvents, 1);
assert.equal(journeyEvents, 1);

controller.handleKeyDown({ code: 'KeyT', repeat: false });
assert.match(renderedText, /Dragonstone Sefer Panosu/);
assert.match(renderedText, /Mevcut yorgunluk: 30 km/);
assert.match(renderedText, /KİLİTLİ/);

const persisted = controller.getRpgSnapshot();
const restored = createInteractionController({ interactionPrompt: { setVisible() {} }, dialogueBox, greetingTemplate: 'Selam, {name}!', radiusMeters: 6 });
restored.restoreRpgSnapshot(structuredClone(persisted));
assert.equal(restored.getJourneySnapshot().fatigueKm, 30);
assert.equal(restored.getInventorySnapshot().fieldReadiness.travelCapacity.travelRationPacks, 0);

console.log(`[RPG] PASS playable expedition board ${JSON.stringify({ routes: readyBoard.entries.length, committedRoute: 'dragonstone-harbor-tavern-run', fatigueKm: controller.getJourneySnapshot().fatigueKm, packsRemaining: controller.getInventorySnapshot().fieldReadiness.travelCapacity.travelRationPacks })}`);
