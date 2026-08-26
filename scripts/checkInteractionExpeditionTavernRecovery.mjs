#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	EXPEDITION_BOARD_ROUTES,
	buildExpeditionBoardText,
	createInteractionController,
	evaluateExpeditionBoard,
} from '../src/3d/gameplay/interaction.js';
import {
	createInteractionInventoryState,
	createInteractionJourneyState,
} from '../src/3d/gameplay/interactionConfig.js';
import { QUARTERMASTER_NPC_ID } from '../src/3d/gameplay/interactionEconomy.js';

const route = EXPEDITION_BOARD_ROUTES.find((entry) => entry.id === 'dragonstone-harbor-tavern-run');
assert.ok(route, 'canonical Dragonstone harbor tavern expedition must exist');
assert.equal(route.steps.length, 3);
assert.equal(route.steps[0].type, 'travel');
assert.equal(route.steps[1].type, 'rest');
assert.equal(route.steps[1].kind, 'tavern');
assert.equal(route.steps[1].siteId, 'dragonstone-harbor-tavern');
assert.equal(route.steps[2].type, 'travel');

const inventory = createInteractionInventoryState();
assert.equal(inventory.grant('dragonstone-expedition-maintenance-kit', 1, {
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-expedition-maintenance-kit',
}), true);
assert.equal(inventory.grant('dragonstone-travel-ration-pack', 2, {
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-watch-travel-ration-pack',
}), true);

const before = inventory.snapshot();
assert.equal(before.fieldReadiness.capabilities.fastTravelEligible, true);
assert.equal(before.fieldReadiness.travelCapacity.travelRationPacks, 2);

const committed = inventory.commitJourneyWithRestStops(route.steps, { startingFatigueKm: 0 });
assert.equal(committed.ok, true);
assert.equal(committed.reason, 'committed');
assert.equal(committed.plan.complete, true);
assert.equal(committed.plan.totalDistanceKm, 58);
assert.equal(committed.plan.steps[0].fatigueAfterKm, 28);
assert.equal(committed.plan.steps[1].fatigueBeforeKm, 28);
assert.equal(committed.plan.steps[1].fatigueAfterKm, 0, 'tavern rest must fully recover carried fatigue');
assert.equal(committed.plan.steps[2].fatigueAfterKm, 30);
assert.equal(committed.plan.finalFatigueKm, 30);
assert.equal(committed.consumedQuantity, 2);
assert.equal(inventory.quantityOf('dragonstone-travel-ration-pack'), 0);
assert.equal(inventory.quantityOf('dragonstone-expedition-maintenance-kit'), 1, 'field kit must survive expedition travel');

const journey = createInteractionJourneyState();
assert.equal(journey.applyCommit(committed), true);
const journeySnapshot = journey.snapshot();
assert.equal(journeySnapshot.commitCount, 1);
assert.equal(journeySnapshot.fatigueKm, 30);
assert.equal(journeySnapshot.lastDestinationId, 'dragonstone-harbor-road');
assert.deepEqual(journeySnapshot.recentReceipts, [{
	sequence: 1,
	totalDistanceKm: 58,
	consumedTravelPacks: 2,
	finalFatigueKm: 30,
	destinationId: 'dragonstone-harbor-road',
	restStopCount: 1,
}]);

const board = evaluateExpeditionBoard(inventory.snapshot(), journeySnapshot, {});
assert.equal(board.entries.length, 3, 'recovery must not become a fourth contract');
assert.equal(board.recovery?.id, 'dragonstone-harbor-tavern-recovery');
assert.equal(board.recovery?.ready, true, 'carried fatigue must unlock canonical tavern recovery');
assert.equal(board.recovery?.plan?.totalDistanceKm, 0, 'recovery must never record travel distance');
assert.equal(board.recovery?.plan?.startingFatigueKm, 30);
assert.equal(board.recovery?.plan?.finalFatigueKm, 0);
const boardText = buildExpeditionBoardText(board);
assert.match(boardText, /Tamamlanan kontrat: 0\/3/, 'recovery must not inflate the authored contract denominator');
assert.match(boardText, /4\. Liman tavernasında dinlen · HAZIR · sefer kaydı oluşturmaz/, 'recovery must be visibly discoverable as the fourth board action');

const shownDialogues = [];
const controller = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: { show(text, choices = []) { shownDialogues.push({ text, choices }); }, hide() {} },
	greetingTemplate: '{name}',
	radiusMeters: 3,
});
controller.restoreRpgSnapshot({
	schemaVersion: 6,
	inventory: inventory.snapshot(),
	journey: journeySnapshot,
});
controller.update([{ object3D: { name: QUARTERMASTER_NPC_ID, position: { x: 0, z: 0 } } }], { x: 0, z: 0 });
assert.equal(controller.showExpeditionBoard(), true, 'canonical quartermaster proximity must open the expedition board');
const renderedBoard = shownDialogues.at(-1);
assert.equal(renderedBoard.choices.length, 4, 'touch/mobile board must render three contracts plus recovery as activation targets');
assert.match(renderedBoard.choices[3], /^Liman tavernasında dinlen — HAZIR$/, 'the fourth touch target must map to canonical tavern recovery');
controller.handleChoice(3);
assert.match(shownDialogues.at(-1).text, /DİNLENME TAMAMLANDI/, 'activating the fourth rendered choice must execute recovery without a keyboard');
assert.equal(controller.getJourneySnapshot().fatigueKm, 0, 'touch recovery must clear carried fatigue');
assert.equal(controller.getJourneySnapshot().commitCount, journeySnapshot.commitCount, 'touch recovery must not create a journey commit');

const recovery = inventory.commitJourneyWithRestStops(board.recovery.steps, {
	startingFatigueKm: journeySnapshot.fatigueKm,
});
assert.equal(recovery.ok, true);
assert.equal(recovery.plan.totalDistanceKm, 0);
assert.equal(recovery.consumedQuantity, 0, 'tavern recovery must not consume travel packs');

const journeyBeforeInvalidRecovery = journey.snapshot();
const fabricatedTravelRecovery = {
	...recovery,
	plan: {
		...recovery.plan,
		totalDistanceKm: 1,
	},
};
assert.equal(journey.applyRecovery(fabricatedTravelRecovery), false, 'recovery must reject any fabricated travel distance');
assert.deepEqual(journey.snapshot(), journeyBeforeInvalidRecovery, 'rejected travel recovery must not mutate journey state');

const staleFatigueRecovery = {
	...recovery,
	plan: {
		...recovery.plan,
		startingFatigueKm: journeySnapshot.fatigueKm - 1,
	},
};
assert.equal(journey.applyRecovery(staleFatigueRecovery), false, 'recovery must reject stale starting fatigue');
assert.deepEqual(journey.snapshot(), journeyBeforeInvalidRecovery, 'stale recovery must not mutate journey state');

const nonImprovingRecovery = {
	...recovery,
	plan: {
		...recovery.plan,
		finalFatigueKm: journeySnapshot.fatigueKm,
	},
};
assert.equal(journey.applyRecovery(nonImprovingRecovery), false, 'recovery must strictly reduce authoritative fatigue');
assert.deepEqual(journey.snapshot(), journeyBeforeInvalidRecovery, 'non-improving recovery must not mutate journey state');

assert.equal(journey.applyRecovery(recovery), true);
const recoveredJourney = journey.snapshot();
assert.equal(recoveredJourney.fatigueKm, 0, 'tavern recovery must clear carried expedition fatigue');
assert.equal(recoveredJourney.commitCount, journeySnapshot.commitCount, 'recovery must not create a journey commit');
assert.equal(recoveredJourney.lastDestinationId, journeySnapshot.lastDestinationId, 'recovery must not rewrite the last destination');
assert.deepEqual(recoveredJourney.recentReceipts, journeySnapshot.recentReceipts, 'recovery must not fabricate a journey receipt');

const savedInventory = inventory.snapshot();
const savedJourney = journey.snapshot();
const restoredInventory = createInteractionInventoryState();
const restoredJourney = createInteractionJourneyState();
restoredInventory.restore(savedInventory);
restoredJourney.restore(savedJourney);

assert.deepEqual(restoredInventory.snapshot(), savedInventory, 'inventory must round-trip after tavern expedition recovery');
assert.deepEqual(restoredJourney.snapshot(), savedJourney, 'recovered journey state must round-trip without receipt drift');
assert.equal(restoredInventory.snapshot().fieldReadiness.tier, 'expedition-ready');
assert.equal(restoredInventory.snapshot().fieldReadiness.travelCapacity.travelRationPacks, 0);
assert.equal(restoredJourney.snapshot().fatigueKm, 0);
assert.equal(restoredJourney.snapshot().commitCount, 1);

console.log('PASS: canonical harbor tavern expedition and board recovery stay keyboard/touch discoverable while clearing fatigue and rejecting travel, stale-fatigue, and non-improving recovery receipts without provisions, commit, destination, receipt, or save/load drift');
