#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createInteractionJourneyState } from '../src/3d/gameplay/interactionConfig.js';

const journey = createInteractionJourneyState();
journey.restore({
	fatigueKm: 31.234,
	commitCount: 2,
	lastDestinationId: 'dragonstone-harbor-road',
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
			finalFatigueKm: 31.234,
			destinationId: 'dragonstone-ridge',
			restStopCount: 0,
		},
	],
});

const canonical = journey.snapshot();
assert.equal(canonical.fatigueKm, 31.23, 'fatigue must normalize to two decimals');
assert.equal(canonical.commitCount, 2);
assert.equal(canonical.lastDestinationId, 'dragonstone-harbor-road');
assert.deepEqual(canonical.recentReceipts.map((receipt) => receipt.sequence), [1, 2]);
assert.equal(canonical.recentReceipts[0].restStopCount, 1, 'tavern recovery receipt must preserve one rest stop');

const forged = createInteractionJourneyState();
forged.restore({
	fatigueKm: -900,
	commitCount: 2,
	lastDestinationId: '   ',
	recentReceipts: [
		null,
		{ sequence: -1, totalDistanceKm: -5, consumedTravelPacks: -2, finalFatigueKm: -3, destinationId: '', restStopCount: -1 },
		{ sequence: 1, totalDistanceKm: 58.987, consumedTravelPacks: 999, finalFatigueKm: 999, destinationId: 'dragonstone-harbor-road', restStopCount: 999 },
		{ sequence: 2, totalDistanceKm: 30, consumedTravelPacks: 1, finalFatigueKm: 30, destinationId: 'dragonstone-ridge', restStopCount: 0 },
		{ sequence: 3, totalDistanceKm: 9000, consumedTravelPacks: 50, finalFatigueKm: 52, destinationId: 'forged-future-route', restStopCount: 50 },
		{ sequence: 99999999, totalDistanceKm: 1, consumedTravelPacks: 1, finalFatigueKm: 1, destinationId: 'forged-overflow', restStopCount: 1 },
	],
});

const sanitized = forged.snapshot();
assert.equal(sanitized.fatigueKm, 0, 'negative fatigue must fail closed to zero');
assert.equal(sanitized.commitCount, 2, 'saved commit count remains authoritative for journey history');
assert.equal(sanitized.lastDestinationId, null, 'blank destination must normalize to null');
assert.ok(sanitized.recentReceipts.length <= 5, 'recent receipt history must stay bounded');
for (const receipt of sanitized.recentReceipts) {
	assert.ok(receipt.sequence > 0, 'receipt sequence must be positive');
	assert.ok(receipt.sequence <= sanitized.commitCount, 'future forged receipt must not survive beyond authoritative commitCount');
	assert.ok(receipt.totalDistanceKm >= 0, 'distance must not become negative');
	assert.ok(receipt.consumedTravelPacks >= 0 && receipt.consumedTravelPacks <= 100, 'consumption count must stay bounded');
	assert.ok(receipt.finalFatigueKm >= 0 && receipt.finalFatigueKm <= 52, 'fatigue must stay inside journey policy');
	assert.ok(receipt.restStopCount >= 0 && receipt.restStopCount <= 100, 'rest-stop count must stay bounded');
}
assert.ok(!sanitized.recentReceipts.some((receipt) => receipt.destinationId === 'forged-future-route'));
assert.ok(!sanitized.recentReceipts.some((receipt) => receipt.destinationId === 'forged-overflow'));

const roundTrip = createInteractionJourneyState();
roundTrip.restore(structuredClone(sanitized));
assert.deepEqual(roundTrip.snapshot(), sanitized, 'sanitized journey history must become idempotent across save/load');

console.log('PASS: tavern expedition journey receipts stay bounded, reject future forged history beyond authoritative commitCount, and round-trip deterministically');
