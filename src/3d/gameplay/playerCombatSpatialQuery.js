/**
 * World-space query adapter for the existing player hitbox/hurtbox contract.
 *
 * This module does not own collision detection, physics, damage or player state. It converts the
 * already-resolved hitbox/hurtbox descriptor into bounded, deterministic query primitives that
 * the existing combat/physics owner can execute against the live scene.
 *
 * @module gameplay/playerCombatSpatialQuery
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const vector = (value = {}, fallback = 0) => Object.freeze({
  x: finite(value.x, fallback),
  y: finite(value.y, fallback),
  z: finite(value.z, fallback),
});
const length = (v) => Math.hypot(v.x, v.y, v.z);
const normalize = (v) => {
  const magnitude = length(v);
  if (magnitude <= 1e-6) return Object.freeze({ x: 0, y: 0, z: 1 });
  return Object.freeze({ x: v.x / magnitude, y: v.y / magnitude, z: v.z / magnitude });
};
const add = (a, b) => Object.freeze({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (v, factor) => Object.freeze({ x: v.x * factor, y: v.y * factor, z: v.z * factor });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

function normalizeOrigin(origin) {
  return vector(origin, 0);
}

function normalizeForward(forward) {
  return normalize(vector(forward, 0));
}

function buildCapsule(origin, up, height, radius) {
  const half = Math.max(radius, (height - radius * 2) * 0.5);
  const center = add(origin, scale(up, radius + half));
  return Object.freeze({
    shape: 'capsule',
    center,
    radius: clamp(finite(radius, 0.3), 0.05, 1.5),
    halfHeight: clamp(half, 0.05, 3),
    tag: 'player-hurtbox',
  });
}

function buildArc(origin, forward, up, hitbox = {}) {
  const reach = clamp(finite(hitbox.activeReachMeters, 1), 0.1, 6);
  const width = clamp(finite(hitbox.widthMeters, 0.5), 0.05, 4);
  const height = clamp(finite(hitbox.heightMeters, 0.6), 0.05, 4);
  const center = add(origin, add(scale(forward, reach * 0.5), scale(up, height * 0.5)));
  return Object.freeze({
    shape: 'arc',
    origin,
    center,
    forward,
    reachMeters: reach,
    widthMeters: width,
    heightMeters: height,
    halfAngleRad: clamp(Math.atan2(width * 0.5, Math.max(reach, 0.1)), 0.08, 1.35),
    attackKind: String(hitbox.attackKind || 'light'),
    tag: 'player-hitbox',
  });
}

export function buildPlayerCombatSpatialQuery({
  descriptor = {},
  origin = {},
  forward = { x: 0, y: 0, z: 1 },
  up = { x: 0, y: 1, z: 0 },
  maxTargets = 8,
  queryId = 0,
} = {}) {
  const normalizedOrigin = normalizeOrigin(origin);
  const normalizedForward = normalizeForward(forward);
  const normalizedUp = normalizeForward(up);
  const hurtbox = descriptor.hurtbox || {};
  const hitbox = descriptor.hitbox || {};
  const boundedTargets = clamp(Math.floor(finite(maxTargets, 8)), 1, 32);
  const grounded = descriptor.grounded !== false;
  const hitQuery = buildArc(normalizedOrigin, normalizedForward, normalizedUp, hitbox);
  const hurtQuery = buildCapsule(normalizedOrigin, normalizedUp, hurtbox.height, hurtbox.radius);
  return Object.freeze({
    version: 1,
    queryId: Math.max(0, Math.floor(finite(queryId, 0))),
    grounded,
    hitbox: hitQuery,
    hurtbox: hurtQuery,
    bounds: Object.freeze({ maxTargets: boundedTargets, maxDistanceMeters: clamp(hitQuery.reachMeters + 1, 1, 8) }),
    filters: Object.freeze({
      includeTags: Object.freeze(['combatant']),
      excludeTags: Object.freeze(['player-self']),
      requireLineOfSight: true,
      requireAlive: true,
    }),
    acceptance: Object.freeze({
      visualColliderParityRequired: Boolean(descriptor.separation?.visualColliderParityRequired ?? true),
      groundedContactRequired: Boolean(descriptor.separation?.groundedContactRequired ?? true),
      maxVerticalPenetrationMeters: clamp(finite(descriptor.separation?.maxVerticalPenetrationMeters, 0.025), 0, 0.25),
      maxHorizontalPenetrationMeters: clamp(finite(descriptor.separation?.maxHorizontalPenetrationMeters, 0.04), 0, 0.5),
    }),
  });
}

export function rankPlayerCombatSpatialCandidates(query, candidates = []) {
  if (!query || !Array.isArray(candidates)) return Object.freeze([]);
  const origin = query.hitbox.origin;
  const forward = query.hitbox.forward;
  const maxDistance = query.bounds.maxDistanceMeters;
  const ranked = [];
  for (const candidate of candidates) {
    if (!candidate || candidate.id == null || candidate.alive === false) continue;
    const position = vector(candidate.position, 0);
    const delta = Object.freeze({ x: position.x - origin.x, y: position.y - origin.y, z: position.z - origin.z });
    const distance = length(delta);
    if (distance > maxDistance) continue;
    const direction = normalize(delta);
    const alignment = dot(forward, direction);
    if (alignment < Math.cos(query.hitbox.halfAngleRad)) continue;
    const score = Number((alignment * 0.7 + (1 - clamp(distance / maxDistance, 0, 1)) * 0.3).toFixed(6));
    ranked.push(Object.freeze({ id: String(candidate.id), distanceMeters: Number(distance.toFixed(4)), alignment: Number(alignment.toFixed(6)), score }));
  }
  ranked.sort((a, b) => b.score - a.score || a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id));
  return Object.freeze(ranked.slice(0, query.bounds.maxTargets));
}

export function validatePlayerCombatSpatialQuery(query) {
  const errors = [];
  if (!query || query.version !== 1) errors.push('invalid-version');
  if (!query?.hitbox?.origin || !query?.hitbox?.forward) errors.push('missing-hitbox-space');
  if (!query?.hurtbox?.center || query?.hurtbox?.radius <= 0) errors.push('invalid-hurtbox');
  if (query?.bounds?.maxTargets < 1) errors.push('invalid-target-bound');
  if (query?.filters?.requireLineOfSight !== true) errors.push('los-required');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
