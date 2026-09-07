import assert from 'node:assert/strict';
import {
  GEOGRAPHIC_SETTLEMENT_PROP_POLICY,
  GEOGRAPHIC_SETTLEMENT_PROP_ASSETS,
  planGeographicSettlementProps,
  validateGeographicSettlementPropPlan,
  summarizeGeographicSettlementPropPlan,
  worldPlacementPolicyForGeographicSettlementProps,
} from '../src/3d/world/geographicSettlementProps.js';
import {
  GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY,
  deriveGeographicSettlementPropContext,
  scoreGeographicSettlementPropContext,
  auditGeographicSettlementPropPlan,
  auditGeographicSettlementPropPlanAgainstCanonicalSeats,
  buildStablePropFingerprint,
  deterministicContextKey,
  geographicSettlementPropRolePalette,
  semanticRoleForGeographicSettlementPropFamily,
  contextOrientationAngleRadians,
  contextSummaryForPlacement,
} from '../src/3d/world/geographicSettlementPropQuality.js';

const seats = [
  { id: 'north', x: -420, z: -860 },
  { id: 'reach', x: 620, z: -430 },
  { id: 'coast', x: -820, z: 540 },
  { id: 'dorne', x: 860, z: 730 },
  { id: 'mountain', x: -940, z: -720 },
  { id: 'temperate', x: 220, z: 690 },
  { id: 'jungle', x: 1050, z: -870 },
];

const roads = [
  { points: [{ x: -420, z: -860 }, { x: -40, z: -720 }, { x: 620, z: -430 }] },
  { points: [{ x: -820, z: 540 }, { x: -420, z: -860 }] },
  { points: [{ x: 860, z: 730 }, { x: 620, z: -430 }] },
  { points: [{ x: -940, z: -720 }, { x: -420, z: -860 }] },
  { points: [{ x: 220, z: 690 }, { x: 620, z: -430 }] },
  { points: [{ x: 1050, z: -870 }, { x: 620, z: -430 }] },
];

function ground(x, z) {
  return 18
    + Math.sin(x / 510) * 2.2
    + Math.cos(z / 430) * 1.5
    + Math.sin((x + z) / 170) * 0.35;
}

const options = {
  seats,
  roadEdges: roads,
  sampleHeightMeters: ground,
  seaLevelMeters: 0,
  radiusMeters: 3000,
  isMobileClass: false,
};

assert.equal(GEOGRAPHIC_SETTLEMENT_PROP_POLICY.assetFirst, true);
assert.equal(GEOGRAPHIC_SETTLEMENT_PROP_POLICY.deterministic, true);
assert.equal(GEOGRAPHIC_SETTLEMENT_PROP_POLICY.placementAuthority, 'WorldAssetPlacementPipeline');
assert.equal(GEOGRAPHIC_SETTLEMENT_PROP_POLICY.materialAuthority, 'MaterialAssignmentCore');
assert.equal(GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.requireManifest, true);
assert.equal(GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.requireWorldPlacementGate, true);
assert.deepEqual(GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.ringMeters, { min: 162, max: 204 });
assert.equal(Object.keys(GEOGRAPHIC_SETTLEMENT_PROP_ASSETS).length, 5);
assert.deepEqual(Object.keys(GEOGRAPHIC_SETTLEMENT_PROP_ASSETS).sort(), ['barrel', 'bench', 'bonfire', 'crate', 'farmDirt']);

for (const [family, asset] of Object.entries(GEOGRAPHIC_SETTLEMENT_PROP_ASSETS)) {
  assert.match(asset.src, /^assets\/models\/props\/.*\.glb$/);
  assert.ok(Number.isFinite(asset.weight));
  assert.ok(asset.weight > 0);
  assert.equal(typeof asset.materialRecipeId, 'string');
  assert.ok(asset.materialRecipeId.length > 0);
  assert.equal(typeof family, 'string');
}

const first = planGeographicSettlementProps(options);
const second = planGeographicSettlementProps(options);
assert.deepEqual(first, second, 'planning must be byte-stable for identical canonical inputs');
assert.equal(buildStablePropFingerprint(first), buildStablePropFingerprint(second));
assert.ok(first.length === seats.length);

const planValidation = validateGeographicSettlementPropPlan(first);
assert.equal(planValidation.ok, true, planValidation.errors.join('\n'));
const qualityValidation = auditGeographicSettlementPropPlan(first);
assert.equal(qualityValidation.ok, true, qualityValidation.errors.join('\n'));
const canonicalValidation = auditGeographicSettlementPropPlanAgainstCanonicalSeats(first, seats);
assert.equal(canonicalValidation.ok, true, canonicalValidation.errors.join('\n'));

const summary = summarizeGeographicSettlementPropPlan(first);
assert.ok(summary.placementCount > 0);
assert.ok(summary.familyCount >= 2);
assert.ok(summary.minPairDistanceMeters >= 13 - 1e-6);
assert.ok(summary.maxPairDistanceMeters >= summary.minPairDistanceMeters);
assert.equal(summary.placementCount, first.reduce((sum, seat) => sum + seat.placements.length, 0));

for (const seatPlan of first) {
  assert.ok(seatPlan.placements.length <= 12);
  assert.ok(seatPlan.placements.length >= 0);
  for (const placement of seatPlan.placements) {
    assert.ok(placement.distanceFromSeat >= 162 - 1e-6);
    assert.ok(placement.distanceFromSeat <= 204 + 1e-6);
    assert.ok(placement.slopeDegrees <= 22 + 1e-6);
    assert.ok(placement.waterDepth <= 0.02 + 1e-6);
    assert.ok(placement.roadDistance >= 6 - 1e-6);
    assert.equal(typeof placement.family, 'string');
    assert.equal(typeof placement.roleId, 'string');
    assert.equal(typeof placement.biomeKind, 'string');
    assert.equal(typeof placement.biomeId, 'string');
    assert.ok(Number.isFinite(placement.influence));
    assert.ok(placement.influence >= 0 && placement.influence <= 1);

    const context = deriveGeographicSettlementPropContext(placement);
    assert.ok(context.semanticRole.length > 0);
    assert.ok(context.approach.length > 0);
    assert.ok(['inner', 'middle', 'outer'].includes(context.ringBand));
    assert.ok(['frontage', 'near', 'remote'].includes(context.roadBand));
    assert.equal(context.family, placement.family);
    assert.equal(context.biomeKind, placement.biomeKind);
    assert.equal(context.roleId, undefined);
    assert.equal(typeof deterministicContextKey(placement), 'string');
    assert.equal(deterministicContextKey(placement), deterministicContextKey(placement));
    assert.equal(contextSummaryForPlacement(placement).semanticRole, semanticRoleForGeographicSettlementPropFamily(placement.family));
    assert.ok(Number.isFinite(contextOrientationAngleRadians(placement)));
    assert.ok(geographicSettlementPropRolePalette(placement.family).length > 0);

    const scored = scoreGeographicSettlementPropContext(placement);
    assert.equal(scored.context.family, placement.family);
    assert.equal(scored.context.semanticRole, semanticRoleForGeographicSettlementPropFamily(placement.family));
    assert.ok(Array.isArray(scored.reasons));
  }
}

const policy = worldPlacementPolicyForGeographicSettlementProps();
assert.equal(policy.maxSlopeDegrees, 22);
assert.equal(policy.maxWaterDepth, 0.02);
assert.equal(policy.minRoadDistance, 6);
assert.equal(policy.minSettlementDistance, 0);

const mobile = planGeographicSettlementProps({ ...options, isMobileClass: true });
const mobileValidation = validateGeographicSettlementPropPlan(mobile);
assert.equal(mobileValidation.ok, true, mobileValidation.errors.join('\n'));
assert.ok(mobile.every((seat) => seat.placements.length <= 5));
assert.equal(buildStablePropFingerprint(mobile), buildStablePropFingerprint(planGeographicSettlementProps({ ...options, isMobileClass: true })));

const translated = planGeographicSettlementProps({
  ...options,
  seats: seats.map((seat) => ({ ...seat, x: seat.x + 777, z: seat.z - 333 })),
  roadEdges: roads.map((edge) => ({ points: edge.points.map((point) => ({ x: point.x + 777, z: point.z - 333 })) })),
  sampleHeightMeters: (x, z) => ground(x - 777, z + 333),
});
assert.equal(translated.length, first.length);
for (let index = 0; index < first.length; index += 1) {
  assert.equal(translated[index].placements.length, first[index].placements.length);
  for (let item = 0; item < first[index].placements.length; item += 1) {
    assert.equal(translated[index].placements[item].family, first[index].placements[item].family);
    assert.equal(translated[index].placements[item].roleId, first[index].placements[item].roleId);
    assert.ok(Math.abs((translated[index].placements[item].x - first[index].placements[item].x) - 777) < 1e-6);
    assert.ok(Math.abs((translated[index].placements[item].z - first[index].placements[item].z) + 333) < 1e-6);
  }
}

function invalidPlan(base) {
  return base.map((seat) => ({
    ...seat,
    placements: seat.placements.map((placement, index) => index === 0
      ? { ...placement, distanceFromSeat: 4, slopeDegrees: 45, waterDepth: 2, roadDistance: 0 }
      : placement),
  }));
}
assert.equal(auditGeographicSettlementPropPlan(invalidPlan(first)).ok, false);

const duplicatePlan = first.map((seat) => ({
  ...seat,
  placements: seat.placements.length > 0
    ? [seat.placements[0], { ...seat.placements[0], candidateIndex: `${seat.placements[0].candidateIndex}-duplicate` }]
    : seat.placements,
}));
assert.equal(auditGeographicSettlementPropPlan(duplicatePlan).ok, false);

const unknownSeatPlan = [...first, { seatId: 'missing-seat', targetCount: 1, placements: [] }];
assert.equal(auditGeographicSettlementPropPlanAgainstCanonicalSeats(unknownSeatPlan, seats).ok, false);

const roleCases = [
  ['barrel', 'storage-yard'],
  ['crate', 'storage-yard'],
  ['bench', 'rest-edge'],
  ['bonfire', 'hearth-shelter'],
  ['farmDirt', 'field-edge'],
];
for (const [family, expectedRole] of roleCases) assert.equal(semanticRoleForGeographicSettlementPropFamily(family), expectedRole);

const specialContexts = [
  { family: 'farmDirt', roleId: 'fertile', biomeKind: 'lush-grassland', biomeId: 'reach', influence: 0.9, x: 12, z: 18, seatX: 0, seatZ: 0, distanceFromSeat: Math.hypot(12, 18), roadDistance: 40 },
  { family: 'bonfire', roleId: 'cold', biomeKind: 'snow', biomeId: 'lands-always-winter', influence: 0.95, x: 0, z: 20, seatX: 0, seatZ: 0, distanceFromSeat: 20, roadDistance: 8 },
  { family: 'crate', roleId: 'temperate', biomeKind: 'temperate-coast', biomeId: 'braavos-coast', influence: 0.8, x: 18, z: 0, seatX: 0, seatZ: 0, distanceFromSeat: 18, roadDistance: 12 },
];
for (const placement of specialContexts) {
  const context = deriveGeographicSettlementPropContext(placement);
  const score = scoreGeographicSettlementPropContext(placement);
  assert.ok(context.semanticRole.length > 0);
  assert.ok(Number.isFinite(score.score));
  assert.ok(contextSummaryForPlacement(placement).key.includes(placement.family));
}

const sourceSet = new Set(Object.values(GEOGRAPHIC_SETTLEMENT_PROP_ASSETS).map((asset) => asset.src));
assert.equal(sourceSet.size, Object.keys(GEOGRAPHIC_SETTLEMENT_PROP_ASSETS).length);

console.log(JSON.stringify({
  ok: true,
  planPolicy: GEOGRAPHIC_SETTLEMENT_PROP_POLICY.id,
  qualityPolicy: GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.id,
  placementCount: summary.placementCount,
  familyIds: summary.familyIds,
  semanticRoles: qualityValidation.semanticRoles,
  minPairDistanceMeters: summary.minPairDistanceMeters,
  fingerprint: buildStablePropFingerprint(first),
}, null, 2));
