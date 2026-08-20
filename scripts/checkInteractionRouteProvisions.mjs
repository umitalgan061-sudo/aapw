import assert from 'node:assert/strict';
import {
	EXPEDITION_ROUTE_POLICY,
	FAST_TRAVEL_BLOCK_REASON,
	FIELD_READINESS_ITEMS,
	buildFastTravelRequestText,
	buildFieldReadinessText,
	evaluateExpeditionRoutePlan,
	evaluateFastTravelRequest,
	evaluateFieldReadiness,
} from '../src/3d/gameplay/interactionFieldReadiness.js';

function item(itemId, quantity) {
	return { itemId, quantity };
}

function snapshot(...items) {
	return { items };
}

const kitOnly = snapshot(item(FIELD_READINESS_ITEMS.EXPEDITION_MAINTENANCE_KIT, 1));
const onePack = snapshot(
	item(FIELD_READINESS_ITEMS.EXPEDITION_MAINTENANCE_KIT, 1),
	item(FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK, 1),
);
const twoPacksSplit = snapshot(
	item(FIELD_READINESS_ITEMS.EXPEDITION_MAINTENANCE_KIT, 1),
	item(FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK, 1),
	item(FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK, 1),
);
const forgedNegativePack = snapshot(
	item(FIELD_READINESS_ITEMS.EXPEDITION_MAINTENANCE_KIT, 1),
	item(FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK, -99),
);

assert.deepEqual(EXPEDITION_ROUTE_POLICY, {
	FIELD_KIT_BASE_RANGE_KM: 12,
	TRAVEL_PACK_RANGE_KM: 18,
	MAX_FAST_TRAVEL_RANGE_KM: 84,
});

const kitReadiness = evaluateFieldReadiness(kitOnly);
assert.equal(kitReadiness.tier, 'expedition-ready');
assert.equal(kitReadiness.travelCapacity.travelRationPacks, 0);
assert.equal(kitReadiness.travelCapacity.baseRangeKm, 12);
assert.equal(kitReadiness.travelCapacity.rationRangeKm, 0);
assert.equal(kitReadiness.travelCapacity.maxDistanceKm, 12);
assert.match(buildFieldReadinessText(kitReadiness), /Hızlı seyahat menzili: 12 km · Yol azığı: 0/);

const onePackReadiness = evaluateFieldReadiness(onePack);
assert.equal(onePackReadiness.travelCapacity.travelRationPacks, 1);
assert.equal(onePackReadiness.travelCapacity.rationRangeKm, 18);
assert.equal(onePackReadiness.travelCapacity.maxDistanceKm, 30);
assert.match(buildFieldReadinessText(onePackReadiness), /Hızlı seyahat menzili: 30 km · Yol azığı: 1/);

const splitReadiness = evaluateFieldReadiness(twoPacksSplit);
assert.equal(splitReadiness.travelCapacity.travelRationPacks, 2, 'duplicate snapshot stacks must canonicalize');
assert.equal(splitReadiness.travelCapacity.maxDistanceKm, 48);

const forgedReadiness = evaluateFieldReadiness(forgedNegativePack);
assert.equal(forgedReadiness.travelCapacity.travelRationPacks, 0);
assert.equal(forgedReadiness.travelCapacity.maxDistanceKm, 12);

const baseEdge = evaluateExpeditionRoutePlan(kitOnly, { distanceKm: 12 });
assert.equal(baseEdge.withinRange, true);
assert.equal(baseEdge.requiredTravelPacks, 0);
assert.equal(baseEdge.provisionShortfall, 0);

const baseOverflow = evaluateExpeditionRoutePlan(kitOnly, { distanceKm: 12.01 });
assert.equal(baseOverflow.withinRange, false);
assert.equal(baseOverflow.requiredTravelPacks, 1);
assert.equal(baseOverflow.provisionShortfall, 1);

const onePackEdge = evaluateExpeditionRoutePlan(onePack, { distanceKm: 30 });
assert.equal(onePackEdge.withinRange, true);
assert.equal(onePackEdge.requiredTravelPacks, 1);
assert.equal(onePackEdge.provisionShortfall, 0);

const onePackOverflow = evaluateExpeditionRoutePlan(onePack, { distanceKm: 30.01 });
assert.equal(onePackOverflow.withinRange, false);
assert.equal(onePackOverflow.requiredTravelPacks, 2);
assert.equal(onePackOverflow.provisionShortfall, 1);

const normalizedDistance = evaluateExpeditionRoutePlan(twoPacksSplit, { distanceKm: 29.999 });
assert.equal(normalizedDistance.distanceKm, 30);
assert.equal(normalizedDistance.requiredTravelPacks, 1);
assert.equal(normalizedDistance.withinRange, true);

const invalidDistances = [undefined, null, NaN, Infinity, -1];
for (const distanceKm of invalidDistances) {
	const plan = evaluateExpeditionRoutePlan(onePack, { distanceKm });
	if (distanceKm === null) {
		assert.equal(plan.distanceKm, 0, 'Number(null) is canonical zero-distance travel');
		continue;
	}
	assert.equal(plan.distanceKm, null);
	assert.equal(plan.requiredTravelPacks, 0);
	assert.equal(plan.withinRange, true);
}

const missingKitPlan = evaluateExpeditionRoutePlan(snapshot(item(FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK, 2)), { distanceKm: 4 });
assert.equal(missingKitPlan.maxDistanceKm, 0);
assert.equal(missingKitPlan.withinRange, false);

const shortTrip = evaluateFastTravelRequest(kitOnly, {
	destinationId: 'dragonstone-harbor',
	discovered: true,
	routeOpen: true,
	inCombat: false,
	distanceKm: 8,
});
assert.equal(shortTrip.allowed, true);
assert.deepEqual(shortTrip.reasons, []);
assert.equal(shortTrip.routePlan.requiredTravelPacks, 0);
assert.equal(buildFastTravelRequestText(shortTrip), 'Hızlı seyahat: HAZIR · dragonstone-harbor · 8 km');

const provisionedTrip = evaluateFastTravelRequest(onePack, {
	destinationId: 'dragonstone-watch-road',
	discovered: true,
	routeOpen: true,
	inCombat: false,
	distanceKm: 28,
});
assert.equal(provisionedTrip.allowed, true);
assert.equal(provisionedTrip.routePlan.requiredTravelPacks, 1);
assert.equal(buildFastTravelRequestText(provisionedTrip), 'Hızlı seyahat: HAZIR · dragonstone-watch-road · 28 km · 1 yol azığı');

const underProvisioned = evaluateFastTravelRequest(kitOnly, {
	destinationId: 'dragonstone-watch-road',
	discovered: true,
	routeOpen: true,
	inCombat: false,
	distanceKm: 28,
});
assert.equal(underProvisioned.allowed, false);
assert.deepEqual(underProvisioned.reasons, [FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS]);
assert.equal(underProvisioned.routePlan.requiredTravelPacks, 1);
assert.equal(underProvisioned.routePlan.provisionShortfall, 1);
assert.match(buildFastTravelRequestText(underProvisioned), /yol azığı menzili yetersiz/);

const layeredBlocks = evaluateFastTravelRequest(kitOnly, {
	destinationId: 'winterfell-road',
	discovered: false,
	routeOpen: false,
	inCombat: true,
	distanceKm: 40,
});
assert.deepEqual(layeredBlocks.reasons, [
	FAST_TRAVEL_BLOCK_REASON.UNDISCOVERED_DESTINATION,
	FAST_TRAVEL_BLOCK_REASON.COMBAT_ACTIVE,
	FAST_TRAVEL_BLOCK_REASON.ROUTE_BLOCKED,
	FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS,
]);

const capped = evaluateFieldReadiness(snapshot(
	item(FIELD_READINESS_ITEMS.EXPEDITION_MAINTENANCE_KIT, 1),
	item(FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK, 99),
));
assert.equal(capped.travelCapacity.maxDistanceKm, 84);
assert.equal(evaluateExpeditionRoutePlan(capped, { distanceKm: 84 }).withinRange, true);
assert.equal(evaluateExpeditionRoutePlan(capped, { distanceKm: 84.01 }).withinRange, false);

const before = JSON.stringify(onePack);
evaluateFastTravelRequest(onePack, {
	destinationId: 'dragonstone-harbor', discovered: true, routeOpen: true, inCombat: false, distanceKm: 20,
});
assert.equal(JSON.stringify(onePack), before, 'route authorization must remain side-effect free');

console.log('PASS interaction expedition route provision policy');
