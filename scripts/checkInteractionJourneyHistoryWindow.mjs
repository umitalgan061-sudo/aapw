#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	buildJourneyStateText,
	createInteractionInventoryState,
	createInteractionJourneyState,
	INTERACTION_JOURNEY_POLICY,
} from '../src/3d/gameplay/interactionConfig.js';
import { REST_KIND, evaluateFieldReadiness } from '../src/3d/gameplay/interactionFieldReadiness.js';

const inventory = createInteractionInventoryState();
assert.equal(inventory.grant('dragonstone-expedition-maintenance-kit', 1, {
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-expedition-maintenance-kit',
}), true);

const journey = createInteractionJourneyState();
const destinations = [
	'dragonstone-ridge',
	'dragonstone-harbor-road',
	'dragonstone-ridge',
	'dragonstone-harbor-road',
	'dragonstone-ridge',
	'dragonstone-harbor-road',
	'dragonstone-ridge',
];

for (const [index, destinationId] of destinations.entries()) {
	assert.equal(inventory.grant('dragonstone-travel-ration-pack', 1, {
		sourceType: 'settlement-crafting',
		sourceId: 'dragonstone-watch-travel-ration-pack',
	}), true, `settlement resupply must provision journey ${index + 1}`);
	const startingFatigueKm = journey.snapshot().fatigueKm;
	const steps = [];
	if (startingFatigueKm > 0) {
		steps.push({ type: 'rest', kind: REST_KIND.TAVERN, siteId: 'dragonstone-harbor-tavern', discovered: true, open: true });
	}
	steps.push({ type: 'travel', destinationId, discovered: true, routeOpen: true, distanceKm: 30 });
	const result = inventory.commitJourneyWithRestStops(steps, { startingFatigueKm });
	assert.equal(result.ok, true, `journey ${index + 1} must commit through the real inventory path`);
	assert.equal(result.plan.finalFatigueKm, 30);
	assert.equal(result.consumedQuantity, 1);
	assert.equal(journey.applyCommit(result), true);
}

const snapshot = journey.snapshot();
assert.equal(snapshot.commitCount, destinations.length);
assert.equal(snapshot.lastDestinationId, 'dragonstone-ridge');
assert.equal(snapshot.recentReceipts.length, INTERACTION_JOURNEY_POLICY.MAX_RECENT_RECEIPTS, 'ledger must keep only the bounded recent history window');
assert.deepEqual(snapshot.recentReceipts.map((receipt) => receipt.sequence), [3, 4, 5, 6, 7], 'oldest committed receipts must roll off without renumbering authoritative sequences');
assert.deepEqual(snapshot.recentReceipts.map((receipt) => receipt.destinationId), [
	'dragonstone-ridge',
	'dragonstone-harbor-road',
	'dragonstone-ridge',
	'dragonstone-harbor-road',
	'dragonstone-ridge',
]);
assert.ok(snapshot.recentReceipts.every((receipt) => receipt.totalDistanceKm === 30));
assert.ok(snapshot.recentReceipts.every((receipt) => receipt.consumedTravelPacks === 1));
assert.ok(snapshot.recentReceipts.every((receipt) => receipt.restStopCount === 1));

const readiness = evaluateFieldReadiness(inventory.snapshot());
const text = buildJourneyStateText(snapshot, readiness);
assert.equal(text, [
	'Sefer yorgunluğu: 30/36 km',
	'Kesintisiz kalan dayanıklılık: 6 km',
	'Son sefer hedefi: dragonstone-ridge',
	'Son sefer: 30 km · 1 yol azığı · 1 dinlenme',
].join('\n'), 'player-facing journey ledger must match the complete expected text and expose no internal sequence metadata');

const restored = createInteractionJourneyState();
restored.restore(structuredClone(snapshot));
assert.deepEqual(restored.snapshot(), snapshot, 'bounded journey history must survive save/load byte-for-byte at the state level');
assert.equal(buildJourneyStateText(restored.snapshot(), readiness), text, 'player-facing journey UX must remain stable after save/load');

console.log('PASS: seven reachable Dragonstone journeys retain only the latest five authoritative receipts while later legs recover at the tavern and preserve sequence, destination, fatigue and save/load UX continuity');
