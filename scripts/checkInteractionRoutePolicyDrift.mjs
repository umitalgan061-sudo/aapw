#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  EXPEDITION_ROUTE_POLICY,
  FAST_TRAVEL_BLOCK_REASON,
  evaluateExpeditionRoutePlan,
  evaluateFastTravelRequest,
  evaluateFieldReadiness,
} from '../src/3d/gameplay/interactionFieldReadiness.js';

const travelPackCount = 3;
const readiness = evaluateFieldReadiness({
  items: [
    { itemId: 'dragonstone-expedition-maintenance-kit', quantity: 1 },
    { itemId: 'dragonstone-travel-ration-pack', quantity: travelPackCount },
  ],
});

assert.equal(readiness.capabilities.fastTravelEligible, true, 'field kit should unlock fast travel');
assert.equal(readiness.travelCapacity.baseRangeKm, EXPEDITION_ROUTE_POLICY.FIELD_KIT_BASE_RANGE_KM);
assert.equal(readiness.travelCapacity.rationRangeKm, travelPackCount * EXPEDITION_ROUTE_POLICY.TRAVEL_PACK_RANGE_KM);

const authoredMaxRange = Math.min(
  EXPEDITION_ROUTE_POLICY.MAX_FAST_TRAVEL_RANGE_KM,
  EXPEDITION_ROUTE_POLICY.FIELD_KIT_BASE_RANGE_KM + travelPackCount * EXPEDITION_ROUTE_POLICY.TRAVEL_PACK_RANGE_KM,
);
assert.equal(readiness.travelCapacity.maxDistanceKm, authoredMaxRange, 'capacity must derive from the authored route policy');

const baseDistance = EXPEDITION_ROUTE_POLICY.FIELD_KIT_BASE_RANGE_KM;
const packDistance = EXPEDITION_ROUTE_POLICY.TRAVEL_PACK_RANGE_KM;
const boundaryCases = [
  { distanceKm: baseDistance, requiredTravelPacks: 0 },
  { distanceKm: baseDistance + 0.01, requiredTravelPacks: 1 },
  { distanceKm: baseDistance + packDistance, requiredTravelPacks: 1 },
  { distanceKm: baseDistance + packDistance + 0.01, requiredTravelPacks: 2 },
  { distanceKm: authoredMaxRange, requiredTravelPacks: travelPackCount },
];

for (const fixture of boundaryCases) {
  const plan = evaluateExpeditionRoutePlan(readiness, { distanceKm: fixture.distanceKm });
  assert.equal(plan.requiredTravelPacks, fixture.requiredTravelPacks, `wrong pack count at ${fixture.distanceKm} km`);
  assert.equal(plan.withinRange, true, `authored-capacity boundary should remain reachable at ${fixture.distanceKm} km`);
  assert.equal(plan.policy, EXPEDITION_ROUTE_POLICY, 'route plan must expose the canonical authored policy');
}

const blocked = evaluateFastTravelRequest(readiness, {
  destinationId: 'dragonstone-harbor-road',
  discovered: true,
  routeOpen: true,
  inCombat: false,
  distanceKm: authoredMaxRange + 0.01,
});
assert.equal(blocked.allowed, false, 'route beyond authored maximum must fail closed');
assert.deepEqual(blocked.reasons, [FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS]);
assert.equal(blocked.routePlan.provisionShortfall, 1);

console.log(JSON.stringify({
  status: 'PASS',
  baseRangeKm: baseDistance,
  travelPackRangeKm: packDistance,
  travelPackCount,
  authoredMaxRange,
  checkedBoundaries: boundaryCases.length,
  beyondRangeReason: blocked.reasons[0],
}));
