/**
 * Deterministic lock-on targeting projection over caller-owned actor observations.
 * Existing ActorRegistry/NPC AI/player state remain authoritative for discovery and mutation.
 * @module gameplay/playerCombatTargetingDirector
 */

const MAX_TARGETS = 32;
const MAX_DISTANCE_METERS = 40;
const DEFAULT_FOV_COSINE = 0.15;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalizeId = (value, fallback) => { const id = String(value ?? fallback).trim(); return id.length > 0 ? id.slice(0, 96) : fallback; };
const normalizeVector = (vector = {}) => { const x = finite(vector.x), y = finite(vector.y), z = finite(vector.z); const length = Math.hypot(x, y, z); return length > 0.0001 ? { x: x / length, y: y / length, z: z / length } : { x: 0, y: 0, z: 1 }; };
const stableStringify = (value) => { if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`; return JSON.stringify(value); };
function rankTarget(player = {}, target = {}, index = 0) {
  const px = finite(player.position?.x), pz = finite(player.position?.z), tx = finite(target.position?.x), tz = finite(target.position?.z);
  const dx = tx - px, dz = tz - pz, distance = Math.hypot(dx, dz);
  const direction = distance > 0.0001 ? { x: dx / distance, z: dz / distance } : { x: 0, z: 1 };
  const forward = normalizeVector(player.forward);
  const facingCosine = clamp(direction.x * forward.x + direction.z * forward.z, -1, 1);
  const fovCosine = clamp(finite(player.fovCosine, DEFAULT_FOV_COSINE), -1, 1);
  const hostile = target.hostile !== false && target.isAlive !== false && target.visible !== false;
  const selectable = hostile && distance <= MAX_DISTANCE_METERS && facingCosine >= fovCosine;
  const score = selectable ? distance + (1 - ((facingCosine + 1) * 0.5)) * 8 : Number.POSITIVE_INFINITY;
  return { id: normalizeId(target.id, `target-${index}`), distanceMeters: Number(distance.toFixed(4)), facingCosine: Number(facingCosine.toFixed(4)), selectable, score: Number.isFinite(score) ? Number(score.toFixed(4)) : null, reason: selectable ? 'eligible' : (!hostile ? 'not-hostile-or-alive' : distance > MAX_DISTANCE_METERS ? 'out-of-range' : 'outside-fov') };
}
export function createPlayerCombatTargetingDirector(options = {}) {
  const maxTargets = clamp(Math.floor(finite(options.maxTargets, MAX_TARGETS)), 1, MAX_TARGETS); let disposed = false;
  let snapshot = Object.freeze({ selectedTargetId: null, targets: Object.freeze([]), lockOn: false, digest: stableStringify({ selectedTargetId: null, targets: [], lockOn: false }) });
  const update = (observation = {}) => { if (disposed) return snapshot; const player = observation.player ?? {}; const candidates = Array.isArray(observation.targets) ? observation.targets.slice(0, maxTargets) : []; const ranked = candidates.map((target, index) => rankTarget(player, target, index)).sort((a, b) => (a.selectable !== b.selectable ? (a.selectable ? -1 : 1) : (a.score ?? Infinity) - (b.score ?? Infinity) || a.id.localeCompare(b.id))); const selected = observation.lockOn === false ? null : ranked.find((target) => target.selectable)?.id ?? null; const result = { selectedTargetId: selected, lockOn: selected !== null, targets: ranked }; const frozen = Object.freeze({ ...result, targets: Object.freeze(ranked.map((target) => Object.freeze(target))), digest: stableStringify(result) }); snapshot = frozen; return snapshot; };
  return Object.freeze({ update, read: () => snapshot, dispose: () => { disposed = true; snapshot = Object.freeze({ selectedTargetId: null, targets: Object.freeze([]), lockOn: false, digest: stableStringify({ selectedTargetId: null, targets: [], lockOn: false }) }); } });
}
export function validatePlayerCombatTargetingSnapshot(snapshot = {}) { return Boolean(snapshot && typeof snapshot === 'object' && (snapshot.selectedTargetId === null || typeof snapshot.selectedTargetId === 'string') && Array.isArray(snapshot.targets) && typeof snapshot.digest === 'string' && Object.isFrozen(snapshot)); }
