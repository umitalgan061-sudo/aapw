import assert from 'node:assert/strict';
import {
  GEOGRAPHIC_SETTLEMENT_PROP_ASSETS,
  GEOGRAPHIC_SETTLEMENT_PROP_POLICY,
  planGeographicSettlementProps,
  summarizeGeographicSettlementPropPlan,
  validateGeographicSettlementPropPlan,
  worldPlacementPolicyForGeographicSettlementProps,
} from '../src/3d/world/geographicSettlementProps.js';

const seats = [
  { id: 'north', x: -420, z: -860 }, { id: 'reach', x: 620, z: -430 },
  { id: 'coast', x: -820, z: 540 }, { id: 'dorne', x: 860, z: 730 },
  { id: 'mountain', x: -940, z: -720 },
];
const roads = [
  { points: [{ x: -420, z: -860 }, { x: -40, z: -720 }, { x: 620, z: -430 }] },
  { points: [{ x: -820, z: 540 }, { x: -420, z: -860 }] },
  { points: [{ x: 860, z: 730 }, { x: 620, z: -430 }] },
  { points: [{ x: -940, z: -720 }, { x: -420, z: -860 }] },
];
function ground(x, z) {
  return 18 + Math.sin(x / 510) * 2.2 + Math.cos(z / 430) * 1.5 + Math.sin((x + z) / 170) * 0.35;
}

assert.equal(GEOGRAPHIC_SETTLEMENT_PROP_POLICY.assetFirst, true);
assert.equal(GEOGRAPHIC_SETTLEMENT_PROP_POLICY.deterministic, true);
assert.equal(GEOGRAPHIC_SETTLEMENT_PROP_POLICY.placementAuthority, 'WorldAssetPlacementPipeline');
assert.equal(Object.keys(GEOGRAPHIC_SETTLEMENT_PROP_ASSETS).length, 5);
for (const asset of Object.values(GEOGRAPHIC_SETTLEMENT_PROP_ASSETS)) assert.match(asset.src, /^assets\/models\/props\/.*\.glb$/);

const options = { seats, roadEdges: roads, sampleHeightMeters: ground, seaLevelMeters: 0, radiusMeters: 3000, isMobileClass: false };
const a = planGeographicSettlementProps(options);
const b = planGeographicSettlementProps(options);
assert.deepEqual(a, b, 'same canonical inputs must produce deterministic planning');
assert.equal(a.length, seats.length);
const validation = validateGeographicSettlementPropPlan(a);
assert.equal(validation.ok, true, validation.errors.join('\n'));
const summary = summarizeGeographicSettlementPropPlan(a);
assert.ok(summary.placementCount > 0);
assert.ok(summary.familyCount >= 2);
assert.ok(summary.minPairDistanceMeters >= 13 - 1e-6);
for (const seat of a) {
  assert.ok(seat.placements.length <= 12);
  for (const p of seat.placements) {
    assert.ok(p.distanceFromSeat >= 162 && p.distanceFromSeat <= 204);
    assert.ok(p.slopeDegrees <= 22 + 1e-6);
    assert.ok(p.waterDepth <= 0.02 + 1e-6);
    assert.ok(p.roadDistance >= 6 - 1e-6);
    assert.ok(typeof p.family === 'string');
    assert.ok(typeof p.roleId === 'string');
  }
}
const mobile = planGeographicSettlementProps({ ...options, isMobileClass: true });
assert.ok(mobile.every((seat) => seat.placements.length <= 5));
const policy = worldPlacementPolicyForGeographicSettlementProps();
assert.equal(policy.maxSlopeDegrees, 22);
assert.equal(policy.maxWaterDepth, 0.02);
assert.equal(policy.minRoadDistance, 6);
const invalid = [{ seatId: 'bad', placements: [{ family: 'barrel', x: 0, z: 0, distanceFromSeat: 10, slopeDegrees: 30, waterDepth: 1, roadDistance: 0 }] }];
assert.equal(validateGeographicSettlementPropPlan(invalid).ok, false);
console.log(JSON.stringify({ ok: true, policy: GEOGRAPHIC_SETTLEMENT_PROP_POLICY.id, placementCount: summary.placementCount, familyIds: summary.familyIds, minPairDistanceMeters: summary.minPairDistanceMeters }));
