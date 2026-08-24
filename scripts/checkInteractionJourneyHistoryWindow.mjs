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
	object3D: { name: 'stannis-guard-1', position: { x: 0, z: 0 } },
};
const key = (controller, code) => controller.handleKeyDown({ code, repeat: false });
const travelPack = (quantity) => ({
	itemId: 'dragonstone-travel-ration-pack',
	quantity,
	provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }],
});
const maintenanceKit = {
	itemId: 'dragonstone-expedition-maintenance-kit',
	quantity: 1,
	provenance: [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-expedition-maintenance-kit' }],
};

const dialogue = createDialogueBox();
const controller = createController(dialogue);
controller.update([quartermaster], { x: 0, z: 0 });

function replaceTravelPacks(quantity) {
	const saved = structuredClone(controller.getRpgSnapshot());
	const items = (saved.inventory?.items ?? []).filter((item) => item.itemId !== 'dragonstone-travel-ration-pack');
	if (quantity > 0) items.push(travelPack(quantity));
	saved.inventory = { ...(saved.inventory ?? {}), items };
	controller.restoreRpgSnapshot(saved);
}

const seeded = structuredClone(controller.getRpgSnapshot());
seeded.inventory = { ...(seeded.inventory ?? {}), items: [maintenanceKit, travelPack(2)] };
controller.restoreRpgSnapshot(seeded);

const harborRouteIndex = EXPEDITION_BOARD_ROUTES.findIndex((route) => route.id === 'dragonstone-harbor-tavern-run');
assert.equal(harborRouteIndex, 1, 'canonical harbor tavern expedition must remain the second authored board route');
assert.equal(EXPEDITION_TAVERN_RECOVERY.steps.length, 1);
assert.equal(EXPEDITION_TAVERN_RECOVERY.steps[0].siteId, 'dragonstone-harbor-tavern');

key(controller, 'KeyT');
assert.equal(dialogue.choices.length, EXPEDITION_BOARD_ROUTES.length + 1, 'expedition board must expose the canonical tavern recovery as a real fourth player choice');
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

for (let journeyNumber = 2; journeyNumber <= 7; journeyNumber += 1) {
	const beforeRecovery = structuredClone(controller.getJourneySnapshot());
	assert.equal(beforeRecovery.fatigueKm, 30, `journey ${journeyNumber} must start with carried fatigue from the previous contract`);

	key(controller, 'KeyT');
	assert.equal(dialogue.choices.length, 4);
	assert.match(dialogue.choices[harborRouteIndex], /KİLİTLİ/, 'with carried fatigue and no resupply the authored route must not pretend to be reachable');
	assert.match(dialogue.choices[3], /Liman tavernasında dinlen — HAZIR/, 'the board must expose the reachable canonical recovery action');
	assert.match(dialogue.text, /4\. Liman tavernasında dinlen · HAZIR · sefer kaydı oluşturmaz/);
	key(controller, 'Digit4');
	assert.match(dialogue.text, /DİNLENME TAMAMLANDI/);

	const afterRecovery = controller.getJourneySnapshot();
	assert.equal(afterRecovery.fatigueKm, 0, 'canonical tavern recovery must clear carried fatigue');
	assert.equal(afterRecovery.commitCount, beforeRecovery.commitCount, 'recovery must not create a fake zero-kilometre journey receipt');
	assert.equal(afterRecovery.lastDestinationId, beforeRecovery.lastDestinationId, 'recovery must not rewrite the authoritative last destination');
	assert.deepEqual(afterRecovery.recentReceipts, beforeRecovery.recentReceipts, 'recovery must leave bounded journey receipt history unchanged');

	replaceTravelPacks(2);
	key(controller, 'KeyT');
	assert.match(dialogue.choices[harborRouteIndex], /HAZIR/, `settlement resupply plus board recovery must make journey ${journeyNumber} player-reachable`);
	key(controller, 'Digit2');
	assert.match(dialogue.text, /SEFER TAMAMLANDI/);
}

journey = controller.getJourneySnapshot();
assert.equal(journey.commitCount, 7);
assert.equal(journey.lastDestinationId, 'dragonstone-harbor-road');
assert.equal(journey.recentReceipts.length, INTERACTION_JOURNEY_POLICY.MAX_RECENT_RECEIPTS, 'ledger must keep only the bounded recent history window');
assert.deepEqual(journey.recentReceipts.map((receipt) => receipt.sequence), [3, 4, 5, 6, 7], 'oldest committed receipts must roll off without renumbering authoritative sequences');
assert.ok(journey.recentReceipts.every((receipt) => receipt.destinationId === 'dragonstone-harbor-road'));
assert.ok(journey.recentReceipts.every((receipt) => receipt.totalDistanceKm === 58));
assert.ok(journey.recentReceipts.every((receipt) => receipt.consumedTravelPacks === 2));
assert.ok(journey.recentReceipts.every((receipt) => receipt.restStopCount === 1));

const snapshot = controller.getRpgSnapshot();
const expectedJourneyText = [
	'Sefer yorgunluğu: 30/36 km',
	'Kesintisiz kalan dayanıklılık: 6 km',
	'Son sefer hedefi: dragonstone-harbor-road',
	'Son sefer: 58 km · 2 yol azığı · 1 dinlenme',
].join('\n');
assert.equal(buildJourneyStateText(snapshot.journey, snapshot.inventory.fieldReadiness), expectedJourneyText, 'player-facing journey ledger must match the complete expected text and expose no internal sequence metadata');

const restoredDialogue = createDialogueBox();
const restored = createController(restoredDialogue);
restored.restoreRpgSnapshot(structuredClone(snapshot));
assert.deepEqual(restored.getJourneySnapshot(), journey, 'bounded journey history must survive controller save/load exactly');
restored.update([quartermaster], { x: 0, z: 0 });
key(restored, 'KeyI');
assert.ok(restoredDialogue.text.includes(expectedJourneyText), 'the shipped controller inventory UX must expose the same journey ledger after save/load');
assert.doesNotMatch(restoredDialogue.text, /\bsequence\b|sıra\s*[:#]?\s*7/i, 'internal receipt sequence metadata must stay out of player-visible UX');

console.log('PASS: seven player-reachable Dragonstone board expeditions use canonical tavern recovery between contracts, retain only receipts 3-7, and preserve destination, fatigue and ledger UX across save/load');
