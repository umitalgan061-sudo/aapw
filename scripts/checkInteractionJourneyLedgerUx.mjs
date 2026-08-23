#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildJourneyStateText, createInteractionJourneyState } from '../src/3d/gameplay/interactionConfig.js';
import { evaluateFieldReadiness } from '../src/3d/gameplay/interactionFieldReadiness.js';

const readiness = evaluateFieldReadiness({
	items: [
		{ itemId: 'dragonstone-expedition-maintenance-kit', quantity: 1 },
		{ itemId: 'dragonstone-travel-ration-pack', quantity: 2 },
	],
});

const journey = createInteractionJourneyState();
journey.restore({
	fatigueKm: 30,
	commitCount: 2,
	lastDestinationId: 'dragonstone-ridge',
	recentReceipts: [
		{
			sequence: 1,
			totalDistanceKm: 58,
			consumedTravelPacks: 2,
			finalFatigueKm: 30,
			destinationId: 'dragonstone-harbor-road',
			restStopCount: 1,
		},
		{
			sequence: 2,
			totalDistanceKm: 30,
			consumedTravelPacks: 1,
			finalFatigueKm: 30,
			destinationId: 'dragonstone-ridge',
			restStopCount: 0,
		},
		{
			sequence: 3,
			totalDistanceKm: 9999,
			consumedTravelPacks: 99,
			finalFatigueKm: 52,
			destinationId: 'forged-future-route',
			restStopCount: 99,
		},
	],
});

const snapshot = journey.snapshot();
assert.deepEqual(snapshot.recentReceipts.map((receipt) => receipt.sequence), [1, 2], 'future forged receipt must not survive restore');
assert.equal(snapshot.lastDestinationId, 'dragonstone-ridge', 'saved destination must match the latest authoritative committed journey');
assert.equal(snapshot.recentReceipts.at(-1)?.destinationId, snapshot.lastDestinationId, 'latest visible receipt and saved destination must stay coherent');

const text = buildJourneyStateText(snapshot, readiness);
assert.match(text, /Sefer yorgunluğu: 30\//, 'UX must surface current fatigue from authoritative journey state');
assert.match(text, /Son sefer hedefi: dragonstone-ridge/, 'UX must surface the destination of the latest authoritative journey');
assert.match(text, /Son sefer: 30 km · 1 yol azığı · 0 dinlenme/, 'UX must summarize the latest accepted journey receipt');
assert.ok(!text.includes('forged-future-route'), 'forged future destination must never surface in player-facing journey UX');
assert.ok(!text.includes('9999 km'), 'forged future distance must never surface in player-facing journey UX');
assert.ok(!text.includes('99 yol azığı'), 'forged future consumption must never surface in player-facing journey UX');

const roundTrip = createInteractionJourneyState();
roundTrip.restore(structuredClone(snapshot));
const roundTripSnapshot = roundTrip.snapshot();
assert.deepEqual(roundTripSnapshot, snapshot, 'journey ledger must remain idempotent across save/load');
assert.equal(buildJourneyStateText(roundTripSnapshot, readiness), text, 'player-facing journey UX must be stable after save/load');

console.log('PASS: authoritative journey receipts drive coherent, stable player-facing travel UX; forged future ledger entries stay invisible across save/load');
