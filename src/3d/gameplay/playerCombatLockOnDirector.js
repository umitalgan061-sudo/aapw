/**
 * Deterministic lock-on candidate director for the existing player combat pipeline.
 * Pure/read-only: caller owns scene queries, camera, target lifecycle and state mutation.
 * @module gameplay/playerCombatLockOnDirector
 */

const MAX_CANDIDATES = 32;
const MAX_DISTANCE = 1000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const idOf = (value) => String(value ?? '').trim().slice(0, 96);
const norm = (x, z) => {
  const length = Math.hypot(x, z);
  return length > 1e-6 ? { x: x / length, z: z / length } : { x: 0, z: 1 };
};
function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}
function normalizeCandidate(candidate, index) {
  const position = candidate?.position ?? {};
  const x = finite(position.x), z = finite(position.z);
  const id = idOf(candidate?.id || candidate?.actorId || `target-${index + 1}`) || `target-${index + 1}`;
  return {
    id,
    x,
    z,
    distance: clamp(Math.hypot(x, z), 0, MAX_DISTANCE),
    hostile: candidate?.hostile !== false,
    alive: candidate?.alive !== false,
    lockable: candidate?.lockable !== false,
    priority: clamp(finite(candidate?.priority), -100, 100),
  };
}

export function createPlayerCombatLockOnDirector({ maxDistance = 18, coneDegrees = 110, hysteresis = 1.2 } = {}) {
  const distanceLimit = clamp(finite(maxDistance, 18), 0.5, MAX_DISTANCE);
  const coneCos = Math.cos(clamp(finite(coneDegrees, 110), 10, 180) * Math.PI / 360);
  const retainBias = clamp(finite(hysteresis, 1.2), 0, 10);

  function evaluate({ candidates = [], forward = { x: 0, z: 1 }, currentTargetId = null } = {}) {
    const look = norm(finite(forward?.x), finite(forward?.z, 1));
    const normalized = Array.isArray(candidates) ? candidates.slice(0, MAX_CANDIDATES).map(normalizeCandidate) : [];
    const scored = normalized
      .filter((candidate) => candidate.alive && candidate.lockable && candidate.hostile && candidate.distance <= distanceLimit)
      .map((candidate) => {
        const direction = norm(candidate.x, candidate.z);
        const dot = clamp(direction.x * look.x + direction.z * look.z, -1, 1);
        const inCone = dot >= coneCos;
        const score = inCone ? (dot * 100) + candidate.priority - candidate.distance * 2 + (candidate.id === currentTargetId ? retainBias : 0) : -Infinity;
        return { ...candidate, dot, inCone, score };
      })
      .filter((candidate) => candidate.inCone)
      .sort((a, b) => b.score - a.score || a.distance - b.distance || a.id.localeCompare(b.id));
    const selected = scored[0] || null;
    return freezeDeep({
      locked: Boolean(selected),
      targetId: selected?.id || null,
      distance: selected?.distance || 0,
      dot: selected?.dot || 0,
      candidateCount: scored.length,
      maxDistance: distanceLimit,
      coneDegrees: Math.round(Math.acos(coneCos) * 360 / Math.PI),
      candidates: scored.map(({ id, distance, dot, score }) => ({ id, distance, dot, score })),
    });
  }

  return Object.freeze({ evaluate });
}

export function serializePlayerCombatLockOnState(state) {
  return JSON.stringify(state ?? {});
}
