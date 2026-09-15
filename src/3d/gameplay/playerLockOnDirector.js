/**
 * Deterministic lock-on target projection for the existing player combat caller.
 * The runtime remains responsible for target discovery, camera rotation, input and scene mutation.
 * @module gameplay/playerLockOnDirector
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function normalizeTarget(row, index) {
  const source = row && typeof row === 'object' ? row : {};
  return {
    id: String(source.id ?? source.targetId ?? `target-${index}`),
    distanceMeters: Math.max(0, finite(source.distanceMeters ?? source.distance, Infinity)),
    angleDegrees: finite(source.angleDegrees ?? source.angle, 180),
    visible: source.visible !== false,
    alive: source.alive !== false,
    priority: finite(source.priority, 0),
  };
}

function scoreTarget(target, maxDistanceMeters, maxAngleDegrees) {
  if (!target.visible || !target.alive) return -Infinity;
  if (target.distanceMeters > maxDistanceMeters || Math.abs(target.angleDegrees) > maxAngleDegrees) return -Infinity;
  const distanceScore = 1 - clamp(target.distanceMeters / Math.max(0.001, maxDistanceMeters), 0, 1);
  const angleScore = 1 - clamp(Math.abs(target.angleDegrees) / Math.max(0.001, maxAngleDegrees), 0, 1);
  return target.priority * 0.2 + angleScore * 0.55 + distanceScore * 0.25;
}

export function projectPlayerLockOn(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const requested = source.requested !== false;
  const maxDistanceMeters = clamp(finite(source.maxDistanceMeters, 18), 1, 60);
  const maxAngleDegrees = clamp(finite(source.maxAngleDegrees, 52), 5, 180);
  const currentTargetId = source.currentTargetId == null ? '' : String(source.currentTargetId);
  const targets = Array.isArray(source.targets) ? source.targets.map(normalizeTarget) : [];

  let best = null;
  let bestScore = -Infinity;
  for (const target of targets) {
    const score = scoreTarget(target, maxDistanceMeters, maxAngleDegrees);
    if (score > bestScore || (score === bestScore && best && target.id < best.id)) {
      best = target;
      bestScore = score;
    }
  }

  const retained = currentTargetId ? targets.find((target) => target.id === currentTargetId) : null;
  const retainedScore = retained ? scoreTarget(retained, maxDistanceMeters * 1.15, maxAngleDegrees * 1.1) : -Infinity;
  const selected = requested && retainedScore >= 0 && retainedScore >= bestScore - 0.12 ? retained : (requested ? best : null);

  const result = {
    requested,
    active: Boolean(selected),
    targetId: selected ? selected.id : null,
    candidateCount: targets.length,
    visibleCandidateCount: targets.filter((target) => target.visible && target.alive).length,
    maxDistanceMeters,
    maxAngleDegrees,
    score: selected ? Number(bestScore.toFixed(6)) : 0,
    reason: !requested ? 'not-requested' : selected ? 'target-selected' : 'no-valid-target',
  };
  return Object.freeze(result);
}

export function serializePlayerLockOnProjection(projection) {
  const value = projection && typeof projection === 'object' ? projection : projectPlayerLockOn();
  return JSON.stringify({
    active: Boolean(value.active),
    candidateCount: Math.max(0, Math.floor(finite(value.candidateCount))),
    maxAngleDegrees: finite(value.maxAngleDegrees),
    maxDistanceMeters: finite(value.maxDistanceMeters),
    reason: String(value.reason ?? ''),
    requested: Boolean(value.requested),
    score: finite(value.score),
    targetId: value.targetId == null ? null : String(value.targetId),
    visibleCandidateCount: Math.max(0, Math.floor(finite(value.visibleCandidateCount))),
  });
}
