#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	buildExpeditionBoardText,
	createInteractionController,
	evaluateExpeditionBoard,
} from '../src/3d/gameplay/interaction.js';
import { buildQuartermasterText } from '../src/3d/gameplay/interactionEconomy.js';

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
assert.match(buildExpeditionBoardText(lockedBoard), /Tamamlanan kontrat: 0\/3/);

const readyBoard = evaluateExpeditionBoard(expeditionInventory(), { fatigueKm: 0 }, { dragonstoneExpeditionRoutes: [] });
assert.equal(readyBoard.entries[1].id, 'dragonstone-harbor-tavern-run');
assert.equal(readyBoard.entries[1].ready, true);
assert.equal(readyBoard.entries[1].completed, false);
assert.equal(readyBoard.entries[1].firstRewardAvailable, true);
assert.deepEqual(readyBoard.entries[1].reward, { experience: 30, reputation: 2, copper: 12 });
assert.equal(readyBoard.entries[1].plan.totalDistanceKm, 58);
assert.equal(readyBoard.entries[1].plan.startingTravelPacks, 2);
assert.equal(readyBoard.entries[1].plan.remainingTravelPacks, 0);
assert.equal(readyBoard.entries[1].plan.finalFatigueKm, 30);
assert.match(buildExpeditionBoardText(readyBoard), /İLK ÖDÜL: 30 XP \+ 2 itibar \+ 12 bakır/);

let renderedText = '';
let renderedChoices = [];
let inventoryEvents = 0;
let journeyEvents = 0;
let progressionEvents = 0;
let reputationEvents = 0;
let worldEvents = 0;
let economyEvents = 0;
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
	onProgressionChanged() { progressionEvents += 1; },
	onReputationChanged() { reputationEvents += 1; },
	onWorldStateChanged() { worldEvents += 1; },
	onEconomyChanged() { economyEvents += 1; },
});
const saved = controller.getRpgSnapshot();
saved.inventory = expeditionInventory();
controller.restoreRpgSnapshot(saved);
inventoryEvents = 0;
journeyEvents = 0;
progressionEvents = 0;
reputationEvents = 0;
worldEvents = 0;
economyEvents = 0;

const quartermaster = { displayName: 'Dragonstone Levazımcısı', object3D: { name: 'stannis-guard-1', position: { x: 0, z: 0 } } };
controller.update([quartermaster], { x: 1, z: 1 });
controller.handleKeyDown({ code: 'KeyT', repeat: false });
assert.match(renderedText, /Dragonstone Sefer Panosu/);
assert.equal(renderedChoices.length, 3);
assert.match(renderedChoices[1], /Liman Taverna Seferi — HAZIR/);

controller.handleKeyDown({ code: 'Digit2', repeat: false });
assert.match(renderedText, /SEFER TAMAMLANDI/);
assert.match(renderedText, /Kontrat ödülü: 30 XP \+ 2 Dragonstone itibarı \+ 12 bakır · kese 52/);
assert.match(renderedText, /Taverna · dragonstone-harbor-tavern · DİNLENDİ/);
assert.equal(controller.getInventorySnapshot().fieldReadiness.travelCapacity.travelRationPacks, 0);
assert.equal(controller.getJourneySnapshot().fatigueKm, 30);
assert.equal(controller.getJourneySnapshot().lastDestinationId, 'dragonstone-harbor-road');
assert.equal(controller.getJourneySnapshot().commitCount, 1);
assert.equal(controller.getProgressionSnapshot().totalExperience, 30);
assert.equal(controller.getReputationSnapshot().dragonstone, 2);
assert.equal(controller.getEconomySnapshot().copper, 52);
assert.deepEqual(controller.getEconomySnapshot().ledger.recentCredits, [{
	sequence: 1,
	sourceId: 'expedition-contract',
	label: 'Sefer kontratı',
	creditedCopper: 12,
	balanceCopper: 52,
}]);
assert.match(buildQuartermasterText(controller.getEconomySnapshot()), /Son gelir: Sefer kontratı · \+12 bakır · bakiye 52/);
assert.deepEqual(controller.getWorldStateSnapshot().dragonstoneExpeditionRoutes, ['dragonstone-harbor-tavern-run']);
assert.equal(inventoryEvents, 1);
assert.equal(journeyEvents, 1);
assert.equal(progressionEvents, 1);
assert.equal(reputationEvents, 1);
assert.equal(worldEvents, 1);
assert.equal(economyEvents, 1);

controller.handleKeyDown({ code: 'KeyT', repeat: false });
assert.match(renderedText, /Dragonstone Sefer Panosu/);
assert.match(renderedText, /Mevcut yorgunluk: 30 km/);
assert.match(renderedText, /Tamamlanan kontrat: 1\/3/);
assert.match(renderedText, /Liman Taverna Seferi .*ÖDÜL ALINDI/);

const persisted = controller.getRpgSnapshot();
const restored = createInteractionController({ interactionPrompt: { setVisible() {} }, dialogueBox, greetingTemplate: 'Selam, {name}!', radiusMeters: 6 });
restored.restoreRpgSnapshot(structuredClone(persisted));
assert.equal(restored.getJourneySnapshot().fatigueKm, 30);
assert.equal(restored.getInventorySnapshot().fieldReadiness.travelCapacity.travelRationPacks, 0);
assert.equal(restored.getProgressionSnapshot().totalExperience, 30);
assert.equal(restored.getReputationSnapshot().dragonstone, 2);
assert.equal(restored.getEconomySnapshot().copper, 52);
assert.deepEqual(restored.getEconomySnapshot().ledger.recentCredits, persisted.economy.ledger.recentCredits);
assert.deepEqual(restored.getWorldStateSnapshot().dragonstoneExpeditionRoutes, ['dragonstone-harbor-tavern-run']);

// A repeated route remains playable when resources/fatigue permit, but XP/reputation/copper cannot be farmed.
const replaySave = restored.getRpgSnapshot();
replaySave.inventory = expeditionInventory();
replaySave.journey = { fatigueKm: 0, commitCount: 1, lastDestinationId: 'dragonstone-harbor-road', recentReceipts: [] };
restored.restoreRpgSnapshot(replaySave);
restored.update([quartermaster], { x: 1, z: 1 });
restored.handleKeyDown({ code: 'KeyT', repeat: false });
assert.match(renderedText, /Liman Taverna Seferi .*ÖDÜL ALINDI/);
restored.handleKeyDown({ code: 'Digit2', repeat: false });
assert.match(renderedText, /tekrar ödülü yok/);
assert.equal(restored.getProgressionSnapshot().totalExperience, 30);
assert.equal(restored.getReputationSnapshot().dragonstone, 2);
assert.equal(restored.getEconomySnapshot().copper, 52);
assert.equal(restored.getEconomySnapshot().ledger.recentCredits.length, 1);
assert.deepEqual(restored.getWorldStateSnapshot().dragonstoneExpeditionRoutes, ['dragonstone-harbor-tavern-run']);

// Forged/unknown route completion ids are ignored on restore and cannot mint copper; receipt history is bounded/sanitized independently.
const forged = restored.getRpgSnapshot();
forged.worldState.dragonstoneExpeditionRoutes = ['dragonstone-harbor-tavern-run', 'forged-route', '', 'dragonstone-harbor-tavern-run'];
forged.economy.copper = 52;
forged.economy.ledger.recentCredits = [
	{ sequence: 0, creditedCopper: 999, sourceId: 'ignored' },
	{ sequence: 1, creditedCopper: 12, sourceId: ' expedition-contract ', label: '  Sefer   kontratı  ', balanceCopper: 52 },
	...Array.from({ length: 8 }, (_, index) => ({ sequence: index + 2, creditedCopper: index + 1, sourceId: `source-${index}`, label: `Gelir ${index}`, balanceCopper: 52 })),
];
restored.restoreRpgSnapshot(forged);
assert.deepEqual(restored.getWorldStateSnapshot().dragonstoneExpeditionRoutes, ['dragonstone-harbor-tavern-run']);
assert.equal(restored.getEconomySnapshot().copper, 52);
assert.equal(restored.getEconomySnapshot().ledger.recentCredits.length, 5);
assert.deepEqual(restored.getEconomySnapshot().ledger.recentCredits.map((entry) => entry.sequence), [5, 6, 7, 8, 9]);
assert.equal(restored.getEconomySnapshot().ledger.recentCredits.at(-1).label, 'Gelir 7');

console.log(`[RPG] PASS expedition contracts + persisted bounded income receipts ${JSON.stringify({ routes: readyBoard.entries.length, rewardedRoute: 'dragonstone-harbor-tavern-run', xp: restored.getProgressionSnapshot().totalExperience, reputation: restored.getReputationSnapshot().dragonstone, copper: restored.getEconomySnapshot().copper, creditReceipts: restored.getEconomySnapshot().ledger.recentCredits.length })}`);
