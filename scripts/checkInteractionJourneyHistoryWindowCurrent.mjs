#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	INTERACTION_JOURNEY_POLICY,
	buildJourneyStateText,
	createInteractionInventoryState,
	createInteractionJourneyState,
} from '../src/3d/gameplay/interactionConfig.js';
import {
	EXPEDITION_BOARD_ROUTES,
	EXPEDITION_TAVERN_RECOVERY,
} from '../src/3d/gameplay/interaction.js';
import {
	QUARTERMASTER_OFFERS,
	createInteractionEconomyState,
} from '../src/3d/gameplay/interactionEconomy.js';

const harborRoute = EXPEDITION_BOARD_ROUTES.find((route) => route.id === 'dragonstone-harbor-tavern-run');
const rationService = QUARTERMASTER_OFFERS.find((offer) => offer.fulfillment?.serviceId === 'dragonstone-watch-ration-prep');
assert.ok(harborRoute, 'canonical Dragonstone harbor tavern expedition must exist');
assert.ok(rationService, 'merged quartermaster ration-prep settlement service must exist');
assert.equal(INTERACTION_JOURNEY_POLICY.MAX_RECENT_RECEIPTS, 5);

const inventory = createInteractionInventoryState();
const economy = createInteractionEconomyState();
const journey = createInteractionJourneyState();

// Keep the test on the shipped settlement/economy seam before exercising history.
assert.equal(inventory.grant('dragonstone-expedition-maintenance-kit', 1, {
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-expedition-maintenance-kit',
}), true);
let serviceResult = economy.purchase(rationService, (...args) => inventory.grant(...args));
assert.equal(serviceResult.ok, true, 'the merged ration-prep service must supply the first travel provision');
assert.equal(serviceResult.remainingStock, 0, 'finite settlement-service stock remains authoritative');
assert.deepEqual(
	inventory.snapshot().items.find((item) => item.itemId === 'dragonstone-travel-ration-pack')?.provenance,
	[{ sourceType: 'settlement-service', sourceId: 'dragonstone-watch-ration-prep' }],
	'first provision must retain settlement-service provenance',
);

function grantHistoryFixturePacks(quantity) {
	const granted = inventory.grant('dragonstone-travel-ration-pack', quantity, {
		sourceType: 'settlement-crafting',
		sourceId: 'journey-history-window-fixture',
	});
	assert.equal(granted, true, 'history isolation fixture must fit the canonical travel-pack stack');
}

function recoverCarriedFatigue() {
	const before = journey.snapshot();
	assert.ok(before.fatigueKm > 0, 'recovery is only valid after a committed expedition leaves carried fatigue');
	const result = inventory.commitJourneyWithRestStops(EXPEDITION_TAVERN_RECOVERY.steps, {
		startingFatigueKm: before.fatigueKm,
	});
	assert.equal(result.ok, true, 'canonical tavern recovery must remain reachable');
	assert.equal(journey.applyRecovery(result), true, 'recovery must update fatigue without creating a receipt');
	const after = journey.snapshot();
	assert.equal(after.fatigueKm, 0);
	assert.equal(after.commitCount, before.commitCount);
	assert.deepEqual(after.recentReceipts, before.recentReceipts);
}

function commitHarborJourney(expectedSequence) {
	const result = inventory.commitJourneyWithRestStops(harborRoute.steps, {
		startingFatigueKm: journey.snapshot().fatigueKm,
	});
	assert.equal(result.ok, true, `journey ${expectedSequence} must be reachable through the canonical route planner`);
	assert.equal(result.plan.complete, true);
	assert.equal(result.plan.totalDistanceKm, 58);
	assert.equal(result.plan.finalFatigueKm, 30);
	assert.equal(result.consumedQuantity, 2);
	assert.equal(journey.applyCommit(result), true);
	const snapshot = journey.snapshot();
	assert.equal(snapshot.commitCount, expectedSequence);
	assert.equal(snapshot.lastDestinationId, 'dragonstone-harbor-road');
	assert.equal(snapshot.recentReceipts.at(-1)?.sequence, expectedSequence);
}

// The real finite service supplied one pack. Add only the second pack needed for journey #1.
grantHistoryFixturePacks(1);
commitHarborJourney(1);

for (let sequence = 2; sequence <= 7; sequence += 1) {
	recoverCarriedFatigue();
	// Deliberate history-window isolation fixture: do not weaken or reset finite economy stock.
	grantHistoryFixturePacks(2);
	commitHarborJourney(sequence);
}

const finalJourney = journey.snapshot();
assert.equal(finalJourney.commitCount, 7);
assert.equal(finalJourney.fatigueKm, 30);
assert.equal(finalJourney.lastDestinationId, 'dragonstone-harbor-road');
assert.equal(finalJourney.recentReceipts.length, INTERACTION_JOURNEY_POLICY.MAX_RECENT_RECEIPTS);
assert.deepEqual(
	finalJourney.recentReceipts.map((receipt) => receipt.sequence),
	[3, 4, 5, 6, 7],
	'bounded history must evict only the two oldest receipts without renumbering survivors',
);
assert.ok(finalJourney.recentReceipts.every((receipt) => receipt.totalDistanceKm === 58));
assert.ok(finalJourney.recentReceipts.every((receipt) => receipt.consumedTravelPacks === 2));
assert.ok(finalJourney.recentReceipts.every((receipt) => receipt.restStopCount === 1));
assert.ok(finalJourney.recentReceipts.every((receipt) => receipt.destinationId === 'dragonstone-harbor-road'));

const playerText = buildJourneyStateText(finalJourney, inventory.snapshot().fieldReadiness);
assert.match(playerText, /Sefer yorgunluğu: 30\/44 km/);
assert.match(playerText, /Son sefer hedefi: dragonstone-harbor-road/);
assert.match(playerText, /Son sefer: 58 km · 2 yol azığı · 1 dinlenme/);
assert.doesNotMatch(playerText, /\bsequence\b|sıra\s*[:#]?\s*7/i, 'internal receipt sequence metadata must remain outside player-facing UX');

const savedJourney = structuredClone(finalJourney);
const restored = createInteractionJourneyState();
restored.restore(savedJourney);
assert.deepEqual(restored.snapshot(), finalJourney, 'bounded receipts must survive save/load exactly');
assert.equal(
	buildJourneyStateText(restored.snapshot(), inventory.snapshot().fieldReadiness),
	playerText,
	'player-facing travel state must remain stable after restore',
);

const economyAfterHistory = economy.snapshot();
assert.equal(economyAfterHistory.ledger.transactionCount, 1, 'history isolation must not fabricate extra settlement purchases');
assert.equal(economyAfterHistory.stockByOffer[rationService.id], 0, 'sold-out service state must remain sold out during history qualification');

console.log('PASS: current-main Dragonstone settlement service feeds a real tavern expedition, seven canonical commits retain only receipts 3-7, tavern recovery creates no fake journey, finite economy stock is not reset, and bounded journey state survives save/load.');
