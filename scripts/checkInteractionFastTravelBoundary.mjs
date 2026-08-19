#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	FAST_TRAVEL_BLOCK_REASON,
	FIELD_READINESS_TIER,
	buildFastTravelRequestText,
	evaluateFastTravelRequest,
} from '../src/3d/gameplay/interactionFieldReadiness.js';

const ready = Object.freeze({
	tier: FIELD_READINESS_TIER.EXPEDITION_READY,
	capabilities: Object.freeze({ fastTravelEligible: true }),
});

const zeroDistance = evaluateFastTravelRequest(ready, {
	destinationId: '  dragonstone-harbor  ',
	discovered: true,
	distanceKm: 0,
});
assert.equal(zeroDistance.allowed, true);
assert.equal(zeroDistance.destinationId, 'dragonstone-harbor');
assert.equal(zeroDistance.distanceKm, 0);
assert.deepEqual(zeroDistance.reasons, []);
assert.equal(buildFastTravelRequestText(zeroDistance), 'Hızlı seyahat: HAZIR · dragonstone-harbor · 0 km');

for (const invalidDistance of [-1, Number.NaN, Number.POSITIVE_INFINITY, 'unknown']) {
	const decision = evaluateFastTravelRequest(ready, {
		destinationId: 'dragonstone-harbor',
		discovered: true,
		distanceKm: invalidDistance,
	});
	assert.equal(decision.allowed, true);
	assert.equal(decision.distanceKm, null);
	assert.equal(buildFastTravelRequestText(decision), 'Hızlı seyahat: HAZIR · dragonstone-harbor');
}

const missingDestination = evaluateFastTravelRequest(ready, {
	destinationId: '   ',
	discovered: true,
	routeOpen: false,
	inCombat: true,
});
assert.equal(missingDestination.allowed, false);
assert.equal(missingDestination.destinationId, null);
assert.deepEqual(missingDestination.reasons, [
	FAST_TRAVEL_BLOCK_REASON.NO_DESTINATION,
	FAST_TRAVEL_BLOCK_REASON.COMBAT_ACTIVE,
	FAST_TRAVEL_BLOCK_REASON.ROUTE_BLOCKED,
]);
assert.match(buildFastTravelRequestText(missingDestination), /hedef seçilmedi/);
assert.match(buildFastTravelRequestText(missingDestination), /çatışma sürüyor/);
assert.match(buildFastTravelRequestText(missingDestination), /rota şu anda kapalı/);

assert.equal(ready.tier, FIELD_READINESS_TIER.EXPEDITION_READY);
assert.equal(ready.capabilities.fastTravelEligible, true);
console.log('[RPG] PASS fast-travel boundary normalization, blocking order, and pure readiness consumption');
