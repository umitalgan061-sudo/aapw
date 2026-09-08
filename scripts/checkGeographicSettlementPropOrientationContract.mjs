import assert from 'node:assert/strict';
import {
  GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY,
  angularDistanceRadians,
  buildOrientationManifest,
  chooseFieldAxisRadians,
  compareOrientationRecords,
  directionAngleRadians,
  dominantRoadAxisRadians,
  inwardSettlementAngle,
  makeOrientationRecord,
  nearestRoadDirection,
  orientationEvidence,
  orientationFingerprint,
  orientationHistogram,
  preferredOrientationAngleRadians,
  roadApproachAngleRadians,
  semanticOrientationIntent,
  validateOrientationContract,
} from '../src/3d/world/geographicSettlementPropOrientation.js';

const EPSILON = 1e-9;
const almostEqual = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: expected ${expected}, received ${actual}`);
};

const roadEdges = [
  {
    id: 'north-south',
    points: [
      { x: -100, z: 0 },
      { x: 100, z: 0 },
    ],
  },
];

const angledRoadEdges = [
  {
    id: 'diagonal',
    points: [
      { x: -100, z: -100 },
      { x: 100, z: 100 },
    ],
  },
];

function placement(family, overrides = {}) {
  return {
    family,
    x: 10,
    z: 20,
    seatX: 0,
    seatZ: 0,
    yaw: 0.25,
    ...overrides,
  };
}

console.info(`[orientation] policy=${GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY.id}`);

// 1. Canonical vector primitives.
almostEqual(directionAngleRadians({ x: 0, z: 0 }, { x: 1, z: 0 }), 0, 'east direction');
almostEqual(directionAngleRadians({ x: 0, z: 0 }, { x: 0, z: 1 }), Math.PI / 2, 'south direction');
almostEqual(directionAngleRadians({ x: 0, z: 0 }, { x: -1, z: 0 }), Math.PI, 'west direction');
almostEqual(directionAngleRadians({ x: 0, z: 0 }, { x: 0, z: -1 }), -Math.PI / 2, 'north direction');
assert.equal(directionAngleRadians({ x: 0, z: 0 }, { x: 0, z: 0 }), null, 'degenerate direction is null');
assert.equal(directionAngleRadians({ x: NaN, z: 0 }, { x: 0, z: 0 }), null, 'invalid direction is null');

// 2. Angle normalization and circular distance.
almostEqual(angularDistanceRadians(Math.PI * 2, 0), 0, '2π and zero are equivalent');
almostEqual(angularDistanceRadians(Math.PI + 0.1, -Math.PI + 0.1), 0, 'wrapped angles are equivalent');
almostEqual(angularDistanceRadians(Math.PI / 2, -Math.PI / 2), Math.PI, 'opposite angles remain π apart');

// 3. Settlement-facing semantics always point to the canonical seat.
const bench = placement('bench');
const bonfire = placement('bonfire');
almostEqual(inwardSettlementAngle(bench), Math.atan2(-20, -10), 'bench inward angle');
almostEqual(preferredOrientationAngleRadians(bench, roadEdges), inwardSettlementAngle(bench), 'bench faces settlement');
almostEqual(preferredOrientationAngleRadians(bonfire, roadEdges), inwardSettlementAngle(bonfire), 'bonfire faces settlement');
assert.equal(semanticOrientationIntent('bench'), 'settlement-facing', 'bench intent');
assert.equal(semanticOrientationIntent('bonfire'), 'sheltered-inward', 'bonfire intent');

// 4. Cargo reads the road frontage, including the half-turn normal used by the placer-facing side.
const cargo = placement('barrel');
const nearest = nearestRoadDirection({ x: 10, z: 20 }, roadEdges);
assert.ok(nearest, 'cargo gets a nearby road segment');
almostEqual(nearest.angleRadians, 0, 'horizontal road angle');
almostEqual(roadApproachAngleRadians({ x: 10, z: 20 }, roadEdges), Math.PI / 2, 'frontage approach is perpendicular');
almostEqual(preferredOrientationAngleRadians(cargo, roadEdges), Math.PI / 2, 'barrel uses road frontage');
assert.equal(semanticOrientationIntent('crate'), 'road-frontage', 'crate intent');

// 5. Field dirt remains parallel to the access road rather than facing the seat.
const field = placement('farmDirt');
almostEqual(preferredOrientationAngleRadians(field, roadEdges), 0, 'field axis follows road');
almostEqual(chooseFieldAxisRadians(field, roadEdges), 0, 'local field axis follows nearest road');
assert.equal(semanticOrientationIntent('farmDirt'), 'field-axis', 'field intent');

// 6. Diagonal roads preserve their world-space axis.
const diagonal = placement('farmDirt', { x: 5, z: 5 });
almostEqual(preferredOrientationAngleRadians(diagonal, angledRoadEdges), Math.PI / 4, 'diagonal road axis');
almostEqual(chooseFieldAxisRadians(diagonal, angledRoadEdges), Math.PI / 4, 'diagonal field axis');
const diagonalCargo = placement('crate', { x: 5, z: 5 });
almostEqual(
  preferredOrientationAngleRadians(diagonalCargo, angledRoadEdges),
  Math.PI * 3 / 4,
  'diagonal cargo frontage remains perpendicular',
);

// 7. Missing road falls back deterministically instead of returning NaN.
const remoteCargo = placement('crate', { yaw: 1.25 });
almostEqual(preferredOrientationAngleRadians(remoteCargo, []), Math.atan2(-20, -10) + Math.PI, 'remote cargo radial fallback');
const remoteField = placement('farmDirt', { yaw: -0.75 });
almostEqual(preferredOrientationAngleRadians(remoteField, []), -0.75, 'remote field keeps explicit source yaw');

// 8. Evidence is stable and records both preferred and source orientation.
const evidence = orientationEvidence(cargo, roadEdges);
assert.equal(evidence.family, 'barrel');
assert.equal(evidence.intent, 'road-frontage');
assert.ok(Number.isFinite(evidence.preferredYawRadians));
assert.ok(Number.isFinite(evidence.actualYawRadians));
assert.ok(Number.isFinite(evidence.deltaRadians));
assert.equal(evidence.road.distanceMeters, 20);
assert.equal(orientationFingerprint(evidence), 'barrel|road-frontage|1.57080|0.25000');

// 9. A source yaw that exactly matches the preferred semantic orientation passes strictly.
const alignedCargo = placement('barrel', { yaw: Math.PI / 2 });
const alignedEvidence = orientationEvidence(alignedCargo, roadEdges);
assert.equal(alignedEvidence.withinTolerance, true);
assert.equal(alignedEvidence.deltaRadians, 0);
const alignedContract = validateOrientationContract({ placements: [alignedCargo], roadEdges });
assert.equal(alignedContract.ok, true);
assert.equal(alignedContract.strictPass, true);
assert.equal(alignedContract.errors.length, 0);
assert.equal(alignedContract.warnings.length, 0);

// 10. An intentionally wrong semantic orientation is still structurally valid but auditable.
const wrongBench = placement('bench', { yaw: 0 });
const wrongContract = validateOrientationContract({ placements: [wrongBench], roadEdges });
assert.equal(wrongContract.ok, true);
assert.equal(wrongContract.strictPass, false);
assert.equal(wrongContract.warnings.length, 1);
assert.match(wrongContract.warnings[0], /^bench:orientation-delta:/);

// 11. Histogram counts and ratio are deterministic.
const histogram = orientationHistogram([
  alignedCargo,
  alignedCargo,
  wrongBench,
  field,
], roadEdges);
assert.equal(histogram.placementCount, 4);
assert.deepEqual(histogram.familyCounts, { barrel: 2, bench: 1, farmDirt: 1 });
assert.equal(histogram.orientationPassCount, 2);
almostEqual(histogram.orientationPassRatio, 0.5, 'orientation pass ratio');

// 12. Contract can require representation of every supported family without changing pass/fail for absent families.
const familyContract = validateOrientationContract({ placements: [alignedCargo], roadEdges, requireAllFamilies: true });
assert.equal(familyContract.ok, true);
assert.equal(familyContract.strictPass, false);
assert.equal(familyContract.warnings.filter((warning) => warning.startsWith('missing-family:')).length, 4);

// 13. Dominant road axis is independent from the placement seat.
almostEqual(dominantRoadAxisRadians(roadEdges), 0, 'dominant horizontal axis');
almostEqual(dominantRoadAxisRadians(angledRoadEdges), Math.PI / 4, 'dominant diagonal axis');
assert.equal(dominantRoadAxisRadians([]), null, 'no road axis');

// 14. Field fallback uses dominant axis when no local segment is close enough.
const farField = placement('farmDirt', { x: 900, z: 900, yaw: 1.75 });
almostEqual(chooseFieldAxisRadians(farField, angledRoadEdges), Math.PI / 4, 'field uses dominant road axis fallback');

// 15. Orientation records are immutable and comparable.
const recordA = makeOrientationRecord(alignedCargo, roadEdges);
const recordB = makeOrientationRecord(alignedCargo, roadEdges);
assert.deepEqual(compareOrientationRecords(recordA, recordB), { equal: true, differences: [] });
const recordC = makeOrientationRecord(wrongBench, roadEdges);
assert.equal(compareOrientationRecords(recordA, recordC).equal, false);
assert.ok(compareOrientationRecords(recordA, recordC).differences.includes('family'));

// 16. Manifest captures the geographic anchor and orientation authority.
const manifest = buildOrientationManifest({ seatId: 'seat-1', placement: alignedCargo, roadEdges });
assert.equal(manifest.policyId, GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY.id);
assert.deepEqual(manifest.seatAnchor, { x: 0, z: 0 });
assert.deepEqual(manifest.placement, { x: 10, z: 20 });
assert.equal(manifest.orientation.withinTolerance, true);

// 17. Multiple family intentions remain explicit and machine-readable.
assert.deepEqual(
  Object.fromEntries(['barrel', 'crate', 'bench', 'bonfire', 'farmDirt'].map((family) => [family, semanticOrientationIntent(family)])),
  {
    barrel: 'road-frontage',
    crate: 'road-frontage',
    bench: 'settlement-facing',
    bonfire: 'sheltered-inward',
    farmDirt: 'field-axis',
  },
);

// 18. Deterministic repeat: same placement and road graph produce byte-equivalent fingerprints.
const repeatA = orientationEvidence(field, roadEdges);
const repeatB = orientationEvidence(field, roadEdges);
assert.deepEqual(repeatA, repeatB);
assert.equal(orientationFingerprint(repeatA), orientationFingerprint(repeatB));

// 19. Road segment selection is nearest-distance stable for overlapping candidates.
const twoRoads = [
  { id: 'far', points: [{ x: -100, z: 12 }, { x: 100, z: 12 }] },
  { id: 'near', points: [{ x: -100, z: 3 }, { x: 100, z: 3 }] },
];
const twoRoadNearest = nearestRoadDirection({ x: 0, z: 0 }, twoRoads);
assert.ok(twoRoadNearest);
almostEqual(twoRoadNearest.distanceMeters, 3, 'nearest road wins');

// 20. Tolerance is intentionally narrow enough to catch visible 90° semantic errors.
assert.ok(GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY.angleToleranceRadians < Math.PI / 2);
assert.ok(Math.PI / 2 > GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY.angleToleranceRadians * 2);

console.info(`[orientation] PASS: ${histogram.placementCount} placements evaluated, ${histogram.orientationPassCount} within semantic yaw tolerance.`);
