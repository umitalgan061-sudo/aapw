/**
 * Şafak Kartalı — navigation safety projection over canonical navigation/terrain owners.
 * No pathfinder or terrain state is owned here; this policy only admits/rejects a proposed path.
 */
const freeze = Object.freeze;
const numberValue = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const stringValue = (value, fallback = '') => value == null ? fallback : String(value);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, numberValue(value, min)));

export const NAVIGATION_SAFETY_POLICY = freeze({
  id: 'safak-kartali-navigation-safety-2026-09-14-v2',
  deterministic: true,
  maxWaypoints: 32,
  maxHazards: 24,
  maxSlopeDegrees: 38,
  minimumWaterClearanceMeters: 2,
  settlementBufferMeters: 3,
  roadPreferenceMeters: 10,
});

function positionOf(value) {
  const position = value?.object3D?.position ?? value?.position ?? value?.transform?.position ?? value;
  if (!position) return null;
  const x = numberValue(position.x, NaN);
  const z = numberValue(position.z, NaN);
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

function distance2d(left, right) {
  if (!left || !right) return Infinity;
  return Math.hypot(left.x - right.x, left.z - right.z);
}

export function normalizeSurfaceSample(sample = {}) {
  return freeze({
    x: numberValue(sample.x),
    z: numberValue(sample.z),
    groundY: Number.isFinite(Number(sample.groundY)) ? Number(sample.groundY) : null,
    slopeDegrees: Math.abs(numberValue(sample.slopeDegrees)),
    waterDepth: Math.max(0, numberValue(sample.waterDepth)),
    distanceToRoad: Number.isFinite(Number(sample.distanceToRoad)) ? Number(sample.distanceToRoad) : null,
    distanceToSettlement: Number.isFinite(Number(sample.distanceToSettlement)) ? Number(sample.distanceToSettlement) : null,
    insideSettlement: Boolean(sample.insideSettlement),
    walkable: sample.walkable !== false,
    navTagged: Boolean(sample.navTagged),
  });
}

export function evaluateStep(sample = {}, actor = {}) {
  const normalized = normalizeSurfaceSample(sample);
  const kind = stringValue(actor.kind, 'npc').toLowerCase();
  const reasons = [];
  if (!normalized.walkable) reasons.push('not-walkable');
  if (normalized.slopeDegrees > NAVIGATION_SAFETY_POLICY.maxSlopeDegrees && !['goat', 'dragon'].includes(kind)) reasons.push('slope-too-steep');
  if (normalized.waterDepth > 2 && !['bird', 'dragon'].includes(kind)) reasons.push('deep-water');
  if (actor.requiresSettlement && !normalized.insideSettlement && normalized.distanceToSettlement != null) reasons.push('outside-settlement-context');
  return freeze({ ok: reasons.length === 0, sample: normalized, reasons: freeze(reasons) });
}

export function validatePath(samples = [], actor = {}) {
  const rows = (Array.isArray(samples) ? samples : [])
    .slice(0, NAVIGATION_SAFETY_POLICY.maxWaypoints)
    .map((sample) => evaluateStep(sample, actor));
  const blockedIndex = rows.findIndex((row) => !row.ok);
  return freeze({
    ok: blockedIndex < 0,
    blockedIndex,
    steps: rows.length,
    reasons: freeze(rows.filter((row) => !row.ok).flatMap((row) => row.reasons)),
  });
}

function hazardAt(point, hazards) {
  const p = positionOf(point);
  return (Array.isArray(hazards) ? hazards : []).some((hazard) => {
    const center = positionOf(hazard);
    const radius = Math.max(0, numberValue(hazard?.radius, 4));
    return distance2d(p, center) <= radius;
  });
}

export function nearestSafePoint(points = [], hazards = []) {
  return (Array.isArray(points) ? points : []).find((point) => !hazardAt(point, hazards)) ?? null;
}

export function buildFleePath(origin, threat, safePoints = []) {
  const start = positionOf(origin) ?? { x: 0, z: 0 };
  const danger = positionOf(threat) ?? start;
  const away = { x: start.x + (start.x - danger.x), z: start.z + (start.z - danger.z) };
  const destination = nearestSafePoint([...(Array.isArray(safePoints) ? safePoints : []), away], []);
  return freeze({ origin: start, threat: danger, destination, mode: 'flee' });
}

export function roadPreference(actor = {}, surface = {}) {
  const kind = stringValue(actor.kind, 'npc').toLowerCase();
  if (kind === 'npc' || kind === 'horse') {
    if (surface.distanceToRoad == null) return .45;
    return surface.distanceToRoad <= NAVIGATION_SAFETY_POLICY.roadPreferenceMeters ? .9 : .35;
  }
  return .2;
}

export function settlementSafety(actor = {}, surface = {}) {
  const kind = stringValue(actor.kind, 'npc').toLowerCase();
  const distance = numberValue(surface.distanceToSettlement, Infinity);
  if (kind === 'npc') return clamp(distance / NAVIGATION_SAFETY_POLICY.settlementBufferMeters);
  if (['wolf', 'animal', 'creature'].includes(kind)) return distance >= NAVIGATION_SAFETY_POLICY.settlementBufferMeters ? 1 : 0;
  return 1;
}

export function navigationIntent(actor = {}, context = {}) {
  const validation = validatePath(context.pathSamples ?? [], actor);
  if (!validation.ok) return freeze({ intent: 'repath', reason: validation.reasons[0] ?? 'blocked-path' });
  if (context.threatPosition) return freeze({ intent: 'chase', reason: 'threat-contact' });
  if (context.fleePosition) return freeze({ intent: 'flee', reason: 'danger-contact' });
  if (context.returnHome) return freeze({ intent: 'return', reason: 'return-home' });
  return freeze({ intent: 'follow-schedule', reason: 'occupation-or-ambient' });
}

export function buildHazardMap(hazards = []) {
  return freeze((Array.isArray(hazards) ? hazards : [])
    .slice(0, NAVIGATION_SAFETY_POLICY.maxHazards)
    .map((hazard, index) => freeze({ id: stringValue(hazard?.id, `hazard-${index}`), position: positionOf(hazard), radius: Math.max(0, numberValue(hazard?.radius, 4)), type: stringValue(hazard?.type, 'danger') })));
}

export function scoreCandidatePoint(point, context = {}) {
  const position = positionOf(point);
  const distanceToGoal = distance2d(position, positionOf(context.goal));
  const road = roadPreference(context.actor, normalizeSurfaceSample(context.surface ?? point));
  const settlement = settlementSafety(context.actor, normalizeSurfaceSample(context.surface ?? point));
  const hazard = hazardAt(position, context.hazards) ? 1 : 0;
  return clamp(1 - Math.min(1, distanceToGoal / 300) * .5 + road * .25 + settlement * .25 - hazard * .9);
}

export function chooseSafeCandidate(points = [], context = {}) {
  return (Array.isArray(points) ? points : [])
    .map((point, index) => ({ point, index, score: scoreCandidatePoint(point, context) }))
    .filter((row) => !hazardAt(row.point, context.hazards))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0] ?? null;
}

export function deterministicNavigationFingerprint(value, seed = 0) {
  let hash = 2166136261;
  for (const character of `${seed}|${JSON.stringify(value ?? null)}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function auditNavigation(result) {
  const errors = [];
  if (result?.steps > NAVIGATION_SAFETY_POLICY.maxWaypoints) errors.push('waypoint-overflow');
  if (result?.blockedIndex < -1) errors.push('invalid-blocked-index');
  return freeze({ ok: !errors.length, errors: freeze(errors), fingerprint: deterministicNavigationFingerprint(result) });
}
