/**
 * Deterministic, DOM-free target selection for the existing player combat stack.
 *
 * This module only ranks caller-provided actors. It does not spawn actors, own AI,
 * mutate scene state, or create a second combat framework.
 */

const DEFAULTS = Object.freeze({ maxDistanceMeters: 18, maxAngleRadians: Math.PI * 0.75, preferLockedTarget: true });
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const normalizeVector = (v) => { const x = finite(v?.x), y = finite(v?.y), z = finite(v?.z), length = Math.hypot(x, z); return length > 1e-9 ? { x: x / length, y, z: z / length } : { x: 0, y, z: 1 }; };
const distanceXZ = (a, b) => Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));
const scoreTarget = ({ actor, distance, angle, locked, maxDistanceMeters }) => { const priority = finite(actor.priority), health = finite(actor.health, 1), lockBonus = locked ? 1000 : 0, distanceRatio = maxDistanceMeters > 0 ? distance / maxDistanceMeters : 1; return lockBonus + priority * 10 + (1 - Math.min(1, distanceRatio)) * 4 + (1 - Math.min(1, angle / Math.PI)) * 2 + Math.min(1, health); };
export function selectPlayerCombatTarget({ playerPosition = { x: 0, z: 0 }, forward = { x: 0, z: 1 }, actors = [], lockedTargetId = null, maxDistanceMeters = DEFAULTS.maxDistanceMeters, maxAngleRadians = DEFAULTS.maxAngleRadians, preferLockedTarget = DEFAULTS.preferLockedTarget } = {}) {
  const facing = normalizeVector(forward), maxDistance = Math.max(0, finite(maxDistanceMeters, DEFAULTS.maxDistanceMeters)), maxAngle = Math.max(0, finite(maxAngleRadians, DEFAULTS.maxAngleRadians)), candidates = [];
  for (const actor of Array.isArray(actors) ? actors : []) { if (!actor || typeof actor !== 'object' || actor.isTargetable === false) continue; const distance = distanceXZ(playerPosition, actor.position); if (!Number.isFinite(distance) || distance > maxDistance) continue; const toTarget = { x: finite(actor.position?.x) - finite(playerPosition?.x), z: finite(actor.position?.z) - finite(playerPosition?.z) }, length = Math.hypot(toTarget.x, toTarget.z); if (length <= 1e-9) continue; const dot = Math.max(-1, Math.min(1, (toTarget.x * facing.x + toTarget.z * facing.z) / length)), angle = Math.acos(dot); if (angle > maxAngle) continue; const id = typeof actor.id === 'string' && actor.id.trim() ? actor.id.trim() : `actor-${candidates.length}`, locked = preferLockedTarget && lockedTargetId && id === lockedTargetId; candidates.push({ actor, id, distance, angle, locked, score: scoreTarget({ actor, distance, angle, locked, maxDistanceMeters: maxDistance }) }); }
  candidates.sort((a, b) => b.score - a.score || a.distance - b.distance || a.angle - b.angle || a.id.localeCompare(b.id)); const winner = candidates[0] || null;
  return Object.freeze({ target: winner?.actor || null, targetId: winner?.id || null, distanceMeters: winner?.distance ?? null, angleRadians: winner?.angle ?? null, candidateCount: candidates.length, candidates: Object.freeze(candidates.map(({ actor, id, distance, angle, locked }) => Object.freeze({ actor, id, distance, angle, locked }))) });
}
export { DEFAULTS as PLAYER_COMBAT_TARGETING_DEFAULTS };
