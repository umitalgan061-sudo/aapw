#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	buildJourneyStateText,
	createInteractionInventoryState,
	createInteractionJourneyState,
} from '../src/3d/gameplay/interactionConfig.js';
import { REST_KIND, evaluateFieldReadiness } from '../src/3d/gameplay/interactionFieldReadiness.js';

const inventory = createInteractionInventoryState();
assert.equal(inventory.grant('dragonstone-expedition-maintenance-kit', 1, {
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-expedition-maintenance-kit',
}), true);
assert.equal(inventory.grant('dragonstone-travel-ration-pack', 2, {
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-watch-travel-ration-pack',
}), true);

const journey = createInteractionJourneyState();
const firstJourney = inventory.commitJourneyWithRestStops([
	{ type: 'travel', destinationId: 'dragonstone-watch-road', discovered: true, routeOpen: true, distanceKm: 28 },
	{ type: 'rest', kind: REST_KIND.TAVERN, siteId: 'dragonstone-harbor-tavern', discovered: true, open: true },
	{ type: 'travel', destinationId: 'dragonstone-harbor-road', discovered: true, routeOpen: true, distanceKm: 30 },
], { startingFatigueKm: journey.snapshot().fatigueKm });
assert.equal(firstJourney.ok, true, 'first canonical tavern journey must commit through the real inventory path');
assert.equal(firstJourney.plan.finalFatigueKm, 30);
assert.equal(firstJourney.consumedQuantity, 2);
assert.equal(journey.applyCommit(firstJourney), true);

assert.equal(inventory.grant('dragonstone-travel-ration-pack', 1, {
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-watch-travel-ration-pack',
}), true, 'settlement resupply must make the follow-up journey reachable');
const secondJourney = inventory.commitJourneyWithRestStops([
	{ type: 'rest', kind: REST_KIND.TAVERN, siteId: 'dragonstone-harbor-tavern', discovered: true, open: true },
	{ type: 'travel', destinationId: 'dragonstone-ridge', discovered: true, routeOpen: true, distanceKm: 30 },
], { startingFatigueKm: journey.snapshot().fatigueKm });
assert.equal(secondJourney.ok, true, 'second journey must recover carried fatigue before travelling');
assert.equal(secondJourney.plan.steps[0].fatigueBeforeKm, 30);
assert.equal(secondJourney.plan.steps[0].fatigueAfterKm, 0);
assert.equal(secondJourney.plan.finalFatigueKm, 30);
assert.equal(secondJourney.consumedQuantity, 1);
assert.equal(journey.applyCommit(secondJourney), true);

const legitimate = journey.snapshot();
assert.equal(legitimate.commitCount, 2);
assert.equal(legitimate.lastDestinationId, 'dragonstone-ridge');
assert.deepEqual(legitimate.recentReceipts.map((receipt) => ({
	sequence: receipt.sequence,
	destinationId: receipt.destinationId,
	restStopCount: receipt.restStopCount,
})), [
	{ sequence: 1, destinationId: 'dragonstone-harbor-road', restStopCount: 1 },
	{ sequence: 2, destinationId: 'dragonstone-ridge', restStopCount: 1 },
], 'both authoritative receipts must originate from reachable committed journeys');

const forgedSave = structuredClone(legitimate);
forgedSave.recentReceipts.push({
	sequence: 3,
	totalDistanceKm: 9999,
	consumedTravelPacks: 99,
	finalFatigueKm: 52,
	destinationId: 'forged-future-route',
	restStopCount: 99,
});

const restored = createInteractionJourneyState();
restored.restore(forgedSave);
const snapshot = restored.snapshot();
assert.deepEqual(snapshot.recentReceipts.map((receipt) => receipt.sequence), [1, 2], 'future forged receipt must not survive restore');
assert.equal(snapshot.lastDestinationId, 'dragonstone-ridge', 'saved destination must match the latest authoritative committed journey');
assert.equal(snapshot.recentReceipts.at(-1)?.destinationId, snapshot.lastDestinationId, 'latest visible receipt and saved destination must stay coherent');

const readiness = evaluateFieldReadiness(inventory.snapshot());
const text = buildJourneyStateText(snapshot, readiness);
assert.match(text, /Sefer yorgunluğu: 30\//, 'UX must surface current fatigue from authoritative journey state');
assert.match(text, /Son sefer hedefi: dragonstone-ridge/, 'UX must surface the destination of the latest authoritative journey');
assert.match(text, /Son sefer: 30 km · 1 yol azığı · 1 dinlenme/, 'UX must summarize the latest accepted journey receipt');
assert.ok(!text.includes('forged-future-route'), 'forged future destination must never surface in player-facing journey UX');
assert.ok(!text.includes('9999 km'), 'forged future distance must never surface in player-facing journey UX');
assert.ok(!text.includes('99 yol azığı'), 'forged future consumption must never surface in player-facing journey UX');

const roundTrip = createInteractionJourneyState();
roundTrip.restore(structuredClone(snapshot));
const roundTripSnapshot = roundTrip.snapshot();
assert.deepEqual(roundTripSnapshot, snapshot, 'journey ledger must remain idempotent across save/load');
assert.equal(buildJourneyStateText(roundTripSnapshot, readiness), text, 'player-facing journey UX must be stable after save/load');

console.log('PASS: reachable committed journey receipts drive coherent, stable player-facing travel UX; forged future ledger entries stay invisible across save/load');
