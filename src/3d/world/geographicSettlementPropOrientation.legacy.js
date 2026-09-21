/**
 * Semantic orientation contract for geographic settlement-fringe props.
 *
 * Placement remains owned by geographicSettlementProps.js. This module only derives and
 * audits the yaw an already-selected prop should prefer from its geographic context.
 * It deliberately does not sample terrain, mutate geometry, or create a second placement system.
 *
 * Orientation semantics:
 * - storage-yard cargo: present a long face / usable opening toward the road approach.
 * - rest-edge benches: face the canonical settlement seat so the prop reads as a social edge.
 * - hearth-shelter bonfires: face inward toward the settlement while remaining radially offset.
 * - field-edge farm dirt: align with the local access/road axis, not randomly with the seat.
 *
 * All calculations are deterministic and operate in world X/Z coordinates.
 */

export const GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY = Object.freeze({
  version: 1,
  id: 'settlement-fringe-geographic-prop-orientation-2026-09-08-v1',
  angleToleranceRadians: 0.35,
  roadSearchRadiusMeters: 36,
  minimumDirectionalLengthMeters: 1e-6,
  familyIntent: Object.freeze({
    barrel: 'road-frontage',
    crate: 'road-frontage',
    bench: 'settlement-facing',
    bonfire: 'sheltered-inward',
    farmDirt: 'field-axis',
  }),
});

const CARGO_FAMILIES = Object.freeze(new Set(['barrel', 'crate']));
const SETTLEMENT_FACING_FAMILIES = Object.freeze(new Set(['bench', 'bonfire']));

function finite(value) {
  return Number.isFinite(Number(value));
}

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

export function normalizeRadians(angle) {
  if (!finite(angle)) return 0;
  let value = Number(angle);
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return normalizeZero(value);
}

export function angularDistanceRadians(a, b) {
  return Math.abs(normalizeRadians(Number(a) - Number(b)));
}

export function directionAngleRadians(from, to) {
  const dx = Number(to?.x) - Number(from?.x);
  const dz = Number(to?.z) - Number(from?.z);
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length < GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY.minimumDirectionalLengthMeters) return null;
  return normalizeRadians(Math.atan2(dz, dx));
}

export function inwardSettlementAngle(placement = {}) {
  return directionAngleRadians(
    { x: placement?.x, z: placement?.z },
    { x: placement?.seatX, z: placement?.seatZ },
  );
}

export function outwardSettlementAngle(placement = {}) {
  const inward = inwardSettlementAngle(placement);
  return inward == null ? null : normalizeRadians(inward + Math.PI);
}

function segmentDistanceSquared(point, a, b) {
  const ax = Number(a?.x);
  const az = Number(a?.z);
  const bx = Number(b?.x);
  const bz = Number(b?.z);
  const px = Number(point?.x);
  const pz = Number(point?.z);
  const abx = bx - ax;
  const abz = bz - az;
  const lengthSquared = abx * abx + abz * abz;
  if (![ax, az, bx, bz, px, pz].every(Number.isFinite)) return Infinity;
  if (lengthSquared <= 1e-12) return Math.hypot(px - ax, pz - az) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / lengthSquared));
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return (px - cx) ** 2 + (pz - cz) ** 2;
}

function normalizeRoadEdges(edges) {
  return (Array.isArray(edges) ? edges : []).flatMap((edge) => {
    const points = Array.isArray(edge?.points) ? edge.points : [];
    const segments = [];
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      const angle = directionAngleRadians(a, b);
      if (angle == null) continue;
      segments.push(Object.freeze({ a, b, angle }));
    }
    return segments;
  });
}

export function nearestRoadDirection(point, roadEdges = [], maxDistanceMeters = GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY.roadSearchRadiusMeters) {
  const maxDistance = finite(maxDistanceMeters) ? Math.max(0, Number(maxDistanceMeters)) : GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY.roadSearchRadiusMeters;
  const segments = normalizeRoadEdges(roadEdges);
  let best = null;
  let bestDistanceSquared = maxDistance * maxDistance;
  for (const segment of segments) {
    const distanceSquared = segmentDistanceSquared(point, segment.a, segment.b);
    if (distanceSquared <= bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      best = Object.freeze({
        angleRadians: segment.angle,
        distanceMeters: Math.sqrt(Math.max(0, distanceSquared)),
      });
    }
  }
  return best;
}

export function roadApproachAngleRadians(point, roadEdges = [], fallback = null) {
  const nearest = nearestRoadDirection(point, roadEdges);
  if (nearest) return normalizeRadians(nearest.angleRadians + Math.PI / 2);
  return fallback == null ? null : normalizeRadians(fallback);
}

function intentForFamily(family) {
  const normalized = String(family ?? '');
  return GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY.familyIntent[normalized] || 'settlement-edge';
}

export function semanticOrientationIntent(family) {
  return intentForFamily(family);
}

function fallbackRadialAngle(placement) {
  const outward = outwardSettlementAngle(placement);
  return outward == null ? 0 : outward;
}

export function preferredOrientationAngleRadians(placement = {}, roadEdges = []) {
  const family = String(placement?.family ?? '');
  const intent = intentForFamily(family);
  const inward = inwardSettlementAngle(placement);
  const roadApproach = roadApproachAngleRadians(
    { x: placement?.x, z: placement?.z },
    roadEdges,
    placement?.yaw,
  );

  switch (intent) {
    case 'road-frontage':
      return roadApproach == null ? fallbackRadialAngle(placement) : roadApproach;
    case 'settlement-facing':
    case 'sheltered-inward':
      return inward == null ? fallbackRadialAngle(placement) : inward;
    case 'field-axis': {
      const roadDirection = nearestRoadDirection({ x: placement?.x, z: placement?.z }, roadEdges);
      return roadDirection?.angleRadians ?? (placement?.yaw == null ? fallbackRadialAngle(placement) : normalizeRadians(placement.yaw));
    }
    default:
      return placement?.yaw == null ? fallbackRadialAngle(placement) : normalizeRadians(placement.yaw);
  }
}

export function orientationEvidence(placement = {}, roadEdges = []) {
  const preferred = preferredOrientationAngleRadians(placement, roadEdges);
  const actual = finite(placement?.yaw) ? normalizeRadians(placement.yaw) : null;
  const delta = actual == null ? Infinity : angularDistanceRadians(actual, preferred);
  const tolerance = GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY.angleToleranceRadians;
  return Object.freeze({
    family: String(placement?.family ?? ''),
    intent: intentForFamily(placement?.family),
    preferredYawRadians: preferred,
    actualYawRadians: actual,
    deltaRadians: delta,
    withinTolerance: Number.isFinite(delta) && delta <= tolerance,
    road: nearestRoadDirection({ x: placement?.x, z: placement?.z }, roadEdges),
    inwardYawRadians: inwardSettlementAngle(placement),
    toleranceRadians: tolerance,
  });
}

export function auditOrientationPlacement(placement = {}, roadEdges = []) {
  const evidence = orientationEvidence(placement, roadEdges);
  const warnings = [];
  const errors = [];
  if (!finite(placement?.x) || !finite(placement?.z)) errors.push('non-finite-position');
  if (evidence.actualYawRadians == null) errors.push('missing-yaw');
  if (!evidence.withinTolerance && evidence.actualYawRadians != null) warnings.push(`orientation-delta:${evidence.deltaRadians.toFixed(3)}`);
  if (evidence.intent === 'road-frontage' && !evidence.road) warnings.push('cargo-without-road-axis-falls-back-to-radial');
  if ((evidence.intent === 'settlement-facing' || evidence.intent === 'sheltered-inward') && evidence.inwardYawRadians == null) warnings.push('settlement-facing-without-seat-anchor');
  return Object.freeze({
    ok: errors.length === 0,
    pass: errors.length === 0 && warnings.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    evidence,
  });
}

function averageUnitAngle(angles) {
  const finiteAngles = (angles || []).filter(finite);
  if (!finiteAngles.length) return 0;
  let x = 0;
  let z = 0;
  for (const angle of finiteAngles) {
    x += Math.cos(Number(angle));
    z += Math.sin(Number(angle));
  }
  return normalizeRadians(Math.atan2(z, x));
}

export function dominantRoadAxisRadians(roadEdges = []) {
  const segments = normalizeRoadEdges(roadEdges);
  if (!segments.length) return null;
  const doubled = segments.map((segment) => normalizeRadians(segment.angle * 2));
  return normalizeRadians(averageUnitAngle(doubled) / 2);
}

export function chooseFieldAxisRadians(placement = {}, roadEdges = []) {
  const local = nearestRoadDirection({ x: placement?.x, z: placement?.z }, roadEdges);
  if (local) return local.angleRadians;
  const dominant = dominantRoadAxisRadians(roadEdges);
  if (dominant != null) return dominant;
  return finite(placement?.yaw) ? normalizeRadians(placement.yaw) : fallbackRadialAngle(placement);
}

export function orientationFingerprint(evidence = {}) {
  const family = String(evidence.family ?? '');
  const preferred = finite(evidence.preferredYawRadians) ? Number(evidence.preferredYawRadians).toFixed(5) : 'nan';
  const actual = finite(evidence.actualYawRadians) ? Number(evidence.actualYawRadians).toFixed(5) : 'nan';
  const intent = String(evidence.intent ?? '');
  return `${family}|${intent}|${preferred}|${actual}`;
}

export function orientationHistogram(placements = [], roadEdges = []) {
  const counts = new Map();
  const deltas = [];
  let passCount = 0;
  for (const placement of placements || []) {
    const audit = auditOrientationPlacement(placement, roadEdges);
    const family = String(placement?.family ?? 'unknown');
    counts.set(family, (counts.get(family) || 0) + 1);
    if (audit.evidence.withinTolerance) passCount += 1;
    if (Number.isFinite(audit.evidence.deltaRadians)) deltas.push(audit.evidence.deltaRadians);
  }
  const meanDelta = deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : 0;
  return Object.freeze({
    placementCount: (placements || []).length,
    orientationPassCount: passCount,
    orientationPassRatio: placements?.length ? passCount / placements.length : 1,
    meanDeltaRadians: meanDelta,
    familyCounts: Object.freeze(Object.fromEntries([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])))),
  });
}

export function validateOrientationContract({ placements = [], roadEdges = [], requireAllFamilies = false } = {}) {
  const errors = [];
  const warnings = [];
  const audits = [];
  const seen = new Set();
  for (const placement of placements || []) {
    const audit = auditOrientationPlacement(placement, roadEdges);
    audits.push(audit);
    const family = String(placement?.family ?? '');
    if (family) seen.add(family);
    errors.push(...audit.errors.map((entry) => `${family || 'unknown'}:${entry}`));
    warnings.push(...audit.warnings.map((entry) => `${family || 'unknown'}:${entry}`));
  }
  if (requireAllFamilies) {
    for (const family of Object.keys(GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY.familyIntent)) {
      if (!seen.has(family)) warnings.push(`missing-family:${family}`);
    }
  }
  const histogram = orientationHistogram(placements, roadEdges);
  return Object.freeze({
    ok: errors.length === 0,
    strictPass: errors.length === 0 && warnings.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    audits: Object.freeze(audits),
    histogram,
    policyId: GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY.id,
  });
}

export function makeOrientationRecord(placement = {}, roadEdges = []) {
  const evidence = orientationEvidence(placement, roadEdges);
  return Object.freeze({
    family: evidence.family,
    intent: evidence.intent,
    preferredYawRadians: evidence.preferredYawRadians,
    sourceYawRadians: evidence.actualYawRadians,
    deltaRadians: evidence.deltaRadians,
    withinTolerance: evidence.withinTolerance,
    roadDistanceMeters: evidence.road?.distanceMeters ?? null,
    roadYawRadians: evidence.road?.angleRadians ?? null,
    inwardYawRadians: evidence.inwardYawRadians,
    orientationPolicyId: GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY.id,
  });
}

export function compareOrientationRecords(a = {}, b = {}) {
  const fields = ['family', 'intent', 'preferredYawRadians', 'sourceYawRadians', 'deltaRadians', 'withinTolerance'];
  const differences = [];
  for (const field of fields) {
    const av = a?.[field];
    const bv = b?.[field];
    if (typeof av === 'number' && typeof bv === 'number') {
      if (Math.abs(av - bv) > 1e-9) differences.push(field);
    } else if (av !== bv) {
      differences.push(field);
    }
  }
  return Object.freeze({ equal: differences.length === 0, differences: Object.freeze(differences) });
}

export function buildOrientationManifest({ seatId = null, placement = {}, roadEdges = [] } = {}) {
  return Object.freeze({
    policyId: GEOGRAPHIC_SETTLEMENT_PROP_ORIENTATION_POLICY.id,
    seatId,
    seatAnchor: Object.freeze({ x: finite(placement?.seatX) ? Number(placement.seatX) : null, z: finite(placement?.seatZ) ? Number(placement.seatZ) : null }),
    placement: Object.freeze({ x: finite(placement?.x) ? Number(placement.x) : null, z: finite(placement?.z) ? Number(placement.z) : null }),
    orientation: makeOrientationRecord(placement, roadEdges),
  });
}

export const __ORIENTATION_TEST_HOOKS = Object.freeze({
  finite,
  normalizeZero,
  segmentDistanceSquared,
  normalizeRoadEdges,
  intentForFamily,
  fallbackRadialAngle,
  averageUnitAngle,
  CARGO_FAMILIES,
  SETTLEMENT_FACING_FAMILIES,
});
