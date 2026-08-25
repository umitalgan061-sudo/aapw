#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	buildJourneyStateText,
	INTERACTION_JOURNEY_POLICY,
} from '../src/3d/gameplay/interactionConfig.js';
import {
	EXPEDITION_BOARD_ROUTES,
	EXPEDITION_TAVERN_RECOVERY,
	createInteractionController,
} from '../src/3d/gameplay/interaction.js';
import { QUARTERMASTER_NPC_ID } from '../src/3d/gameplay/interactionEconomy.js';

function createDialogueBox() {
	return {
		visible: false,
		text: '',
		choices: [],
		show(text, choices = []) {
			this.visible = true;
			this.text = String(text ?? '');
			this.choices = [...choices];
		},
		hide() {
			this.visible = false;
			this.text = '';
			this.choices = [];
		},
	};
}

function createController(dialogueBox) {
	return createInteractionController({
		interactionPrompt: { setVisible() {} },
		dialogueBox,
		greetingTemplate: '{name}: selam',
		radiusMeters: 6,
	});
}

const quartermaster = {
	displayName: 'Dragonstone Levazımcısı',
	object3D: { name: QUARTERMASTER_NPC_ID, position: { x: 0, z: 0 } },
};
const key = (controller, code) => controller.handleKeyDown({ code, repeat: false });
const inventoryItem = (itemId, quantity, sourceId) => ({
	itemId,
	quantity,
	provenance: [{ sourceType: 'settlement-crafting', sourceId }],
});

const dialogue = createDialogueBox();
const controller = createController(dialogue);
controller.update([quartermaster], { x: 0, z: 0 });

const seeded = structuredClone(controller.getRpgSnapshot());
seeded.inventory = {
	...(seeded.inventory ?? {}),
	items: [
		inventoryItem('dragonstone-expedition-maintenance-kit', 1, 'dragonstone-expedition-maintenance-kit'),
		inventoryItem('dragonstone-travel-ration-pack', 1, 'dragonstone-watch-travel-ration-pack'),
		inventoryItem('dragonstone-field-ration', 2, 'journey-history-fixture'),
	],
};
controller.restoreRpgSnapshot(seeded);

const harborRouteIndex = EXPEDITION_BOARD_ROUTES.findIndex((route) => route.id === 'dragonstone-harbor-tavern-run');
assert.equal(harborRouteIndex, 1, 'canonical harbor tavern expedition must remain the second authored board route');
assert.equal(EXPEDITION_TAVERN_RECOVERY.steps.length, 1);
assert.equal(EXPEDITION_TAVERN_RECOVERY.steps[0].siteId, 'dragonstone-harbor-tavern');

// Prove the merged settlement-service path can prepare the second pack before the first expedition.
key(controller, 'KeyB');
assert.equal(dialogue.choices.length, 3, 'quartermaster must expose the authored ration-prep service');
key(controller, 'Digit3');
assert.match(dialogue.text, /Nöbetçi yol azığı hazırlama hizmeti/);
const preparedInventory = controller.getInventorySnapshot();
assert.equal(preparedInventory.items.find((item) => item.itemId === 'dragonstone-travel-ration-pack')?.quantity, 2, 'ration-prep service must leave two prepared travel packs ready for the route');
assert.equal(preparedInventory.items.find((item) => item.itemId === 'dragonstone-field-ration'), undefined, 'ration-prep crafting must atomically consume its two field-ration inputs');
assert.equal(controller.getEconomySnapshot().copper, 35, 'the real settlement-service purchase must charge five copper');

key(controller, 'KeyT');
assert.equal(dialogue.choices.length, EXPEDITION_BOARD_ROUTES.length + 1, 'board must expose three contracts plus the canonical recovery action');
assert.match(dialogue.choices[harborRouteIndex], /HAZIR/);
assert.match(dialogue.choices.at(-1), /Liman tavernasında dinlen — KİLİTLİ/, 'zero-fatigue recovery must remain unavailable');
key(controller, 'Digit2');
assert.match(dialogue.text, /SEFER TAMAMLANDI/);

let journey = controller.getJourneySnapshot();
assert.equal(journey.commitCount, 1);
assert.equal(journey.fatigueKm, 30);
assert.equal(journey.recentReceipts[0].totalDistanceKm, 58);
assert.equal(journey.recentReceipts[0].consumedTravelPacks, 2);
assert.equal(journey.recentReceipts[0].restStopCount, 1);

function replaceTravelPacksForHistoryIsolation(quantity) {
	const saved = structuredClone(controller.getRpgSnapshot());
	const items = (saved.inventory?.items ?? []).filter((item) => item.itemId !== 'dragonstone-travel-ration-pack');
	if (quantity > 0) items.push(inventoryItem('dragonstone-travel-ration-pack', quantity, 'journey-history-window-fixture'));
	saved.inventory = { ...(saved.inventory ?? {}), items };
	controller.restoreRpgSnapshot(saved);
}

for (let journeyNumber = 2; journeyNumber <= 7; journeyNumber += 1) {
	const beforeRecovery = structuredClone(controller.getJourneySnapshot());
	assert.equal(beforeRecovery.fatigueKm, 30, `journey ${journeyNumber} must start with carried fatigue from the previous contract`);

	key(controller, 'KeyT');
	assert.match(dialogue.choices[harborRouteIndex], /KİLİTLİ/, 'carried fatigue plus zero provisions must keep the authored route blocked');
	assert.match(dialogue.choices[3], /Liman tavernasında dinlen — HAZIR/, 'canonical tavern recovery must stay player-reachable');
	key(controller, 'Digit4');
	assert.match(dialogue.text, /DİNLENME TAMAMLANDI/);

	const afterRecovery = controller.getJourneySnapshot();
	assert.equal(afterRecovery.fatigueKm, 0);
	assert.equal(afterRecovery.commitCount, beforeRecovery.commitCount, 'recovery must not create a zero-distance history entry');
	assert.equal(afterRecovery.lastDestinationId, beforeRecovery.lastDestinationId, 'recovery must not rewrite last destination');
	assert.deepEqual(afterRecovery.recentReceipts, beforeRecovery.recentReceipts, 'recovery must not mutate the bounded receipt window');

	// Refill only the inventory dependency so this acceptance isolates history rollover from finite service stock policy.
	replaceTravelPacksForHistoryIsolation(2);
	key(controller, 'KeyT');
	assert.match(dialogue.choices[harborRouteIndex], /HAZIR/, `controlled canonical resupply must make journey ${journeyNumber} reachable`);
	key(controller, 'Digit2');
	assert.match(dialogue.text, /SEFER TAMAMLANDI/);
}

journey = controller.getJourneySnapshot();
assert.equal(journey.commitCount, 7);
assert.equal(journey.lastDestinationId, 'dragonstone-harbor-road');
assert.equal(journey.recentReceipts.length, INTERACTION_JOURNEY_POLICY.MAX_RECENT_RECEIPTS, 'ledger must retain only the bounded recent history window');
assert.deepEqual(journey.recentReceipts.map((receipt) => receipt.sequence), [3, 4, 5, 6, 7], 'old receipts must roll off without renumbering authoritative sequences');
assert.ok(journey.recentReceipts.every((receipt) => receipt.destinationId === 'dragonstone-harbor-road'));
assert.ok(journey.recentReceipts.every((receipt) => receipt.totalDistanceKm === 58));
assert.ok(journey.recentReceipts.every((receipt) => receipt.consumedTravelPacks === 2));
assert.ok(journey.recentReceipts.every((receipt) => receipt.restStopCount === 1));

const snapshot = controller.getRpgSnapshot();
const journeyText = buildJourneyStateText(snapshot.journey, snapshot.inventory.fieldReadiness);
assert.match(journeyText, /Sefer yorgunluğu: 30\/36 km/);
assert.match(journeyText, /Son sefer hedefi: dragonstone-harbor-road/);
assert.match(journeyText, /Son sefer: 58 km · 2 yol azığı · 1 dinlenme/);
assert.doesNotMatch(journeyText, /\bsequence\b|sıra\s*[:#]?\s*7/i, 'internal receipt sequence metadata must stay out of player-visible UX');

const restoredDialogue = createDialogueBox();
const restored = createController(restoredDialogue);
restored.restoreRpgSnapshot(structuredClone(snapshot));
assert.deepEqual(restored.getJourneySnapshot(), journey, 'bounded journey history must survive controller save/load exactly');
restored.update([quartermaster], { x: 0, z: 0 });
key(restored, 'KeyI');
assert.match(restoredDialogue.text, /Son sefer: 58 km · 2 yol azığı · 1 dinlenme/);
assert.doesNotMatch(restoredDialogue.text, /\bsequence\b|sıra\s*[:#]?\s*7/i, 'inventory UX must not leak internal history sequence metadata after save/load');

console.log('PASS: real ration-prep service seeds a canonical board expedition, repeated board recovery preserves history semantics, receipts roll to 3-7, and bounded journey state survives save/load without sequence leakage');
