/**
 * Deterministic lock-on target selection for the existing player combat pipeline.
 *
 * This module is a pure read-only policy layer. It does not own target mutation,
 * camera rotation, input polling, scene traversal, hitboxes or AI state.
 *
 * @module gameplay/playerLockOnTargetDirector
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback = 0) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const freeze = (value) => Object.freeze(value);

export const PLAYER_LOCK_ON_LIMITS = freeze({
  maxCandidates: 32,
  maxDistanceMeters: 40,
  minDistanceMeters: 0.05,
  maxScore: 4,
  angleWeight: 2.2,
  distanceWeight: 1.1,
  threatWeight: 0.9,
  visibilityWeight: 0.7,
});

const normalizeId = (value, fallback = 'unknown') => {
  const id = String(value ?? '').trim();
  return id || fallback;
};

function normalizeVector2(value) {
  const x = finite(value?.x, 0);
  const y = finite(value?.y, 0);
  const length = Math.hypot(x, y);
  if (length <= 1e-6) return { x: 0, y: 1 };
  return { x: x / length, y: y / length };
}

function normalizeCandidate(candidate, index) {
  const direction = normalizeVector2(candidate?.screenDirection ?? candidate?.direction);
  const distance = clamp(positive(candidate?.distanceMeters, PLAYER_LOCK_ON_LIMITS.maxDistanceMeters), PLAYER_LOCK_ON_LIMITS.minDistanceMeters, PLAYER_LOCK_ON_LIMITS.maxDistanceMeters);
  const angle = clamp(Math.abs(finite(candidate?.angleRadians, Math.PI)), 0, Math.PI);
  const visibility = clamp(finite(candidate?.visibility, 0), 0, 1);
  const threat = clamp(finite(candidate?.threat, 0), 0, 1);
  const enabled = candidate?.enabled !== false && candidate?.alive !== false && candidate?.lockable !== false;
  return {
    id: normalizeId(candidate?.id ?? candidate?.targetId, `candidate-${index}`),
    direction,
    distanceMeters: distance,
    angleRadians: angle,
    visibility,
    threat,
    enabled,
    faction: normalizeId(candidate?.faction, 'neutral'),
  };
}

function scoreCandidate(candidate, facing = { x: 0, y: 1 }) {
  const facingVector = normalizeVector2(facing);
  const alignment = clamp(candidate.direction.x * facingVector.x + candidate.direction.y * facingVector.y, -1, 1);
  const angleScore = clamp(1 - (candidate.angleRadians / Math.PI), 0, 1);
  const distanceScore = clamp(1 - ((candidate.distanceMeters - PLAYER_LOCK_ON_LIMITS.minDistanceMeters) / (PLAYER_LOCK_ON_LIMITS.maxDistanceMeters - PLAYER_LOCK_ON_LIMITS.minDistanceMeters)), 0, 1);
  const raw = (angleScore * PLAYER_LOCK_ON_LIMITS.angleWeight)
    + (distanceScore * PLAYER_LOCK_ON_LIMITS.distanceWeight)
    + (candidate.threat * PLAYER_LOCK_ON_LIMITS.threatWeight)
    + (candidate.visibility * PLAYER_LOCK_ON_LIMITS.visibilityWeight)
    + (Math.max(0, alignment) * 0.5);
  return clamp(raw, 0, PLAYER_LOCK_ON_LIMITS.maxScore);
}

export function buildPlayerLockOnTargetPlan({ candidates = [], facing, currentTargetId = null, maxCandidates = PLAYER_LOCK_ON_LIMITS.maxCandidates, allowFriendly = false } = {}) {
  const normalized = Array.isArray(candidates) ? candidates.slice(0, PLAYER_LOCK_ON_LIMITS.maxCandidates).map(normalizeCandidate) : [];
  const filtered = normalized.filter((candidate) => candidate.enabled && candidate.distanceMeters <= PLAYER_LOCK_ON_LIMITS.maxDistanceMeters && (allowFriendly || candidate.faction !== 'player'));
  const ranked = filtered.map((candidate) => ({
    ...candidate,
    score: scoreCandidate(candidate, facing),
  })).sort((left, right) => right.score - left.score || left.distanceMeters - right.distanceMeters || left.id.localeCompare(right.id));
  const limit = clamp(Math.trunc(finite(maxCandidates, 1)), 1, PLAYER_LOCK_ON_LIMITS.maxCandidates);
  const currentId = currentTargetId == null ? null : normalizeId(currentTargetId, null);
  const current = currentId ? ranked.find((candidate) => candidate.id === currentId) || null : null;
  const selected = current || ranked[0] || null;
  return freeze({
    version: 1,
    selectedTargetId: selected?.id ?? null,
    selectedScore: selected ? clamp(selected.score, 0, PLAYER_LOCK_ON_LIMITS.maxScore) : 0,
    retainedCurrentTarget: Boolean(current),
    candidates: freeze(ranked.slice(0, limit).map((candidate) => freeze(candidate))),
    candidateCount: ranked.length,
    hasTarget: Boolean(selected),
  });
}

export function buildPlayerLockOnCyclePlan(plan, direction = 1) {
  const candidates = Array.isArray(plan?.candidates) ? plan.candidates : [];
  if (!candidates.length) return freeze({ version: 1, selectedTargetId: null, cycleIndex: -1, hasTarget: false });
  const currentIndex = Math.max(0, candidates.findIndex((candidate) => candidate.id === plan?.selectedTargetId));
  const step = finite(direction, 1) < 0 ? -1 : 1;
  const cycleIndex = (currentIndex + step + candidates.length) % candidates.length;
  return freeze({
    version: 1,
    selectedTargetId: candidates[cycleIndex]?.id ?? null,
    cycleIndex,
    hasTarget: Boolean(candidates[cycleIndex]),
  });
}

export function auditPlayerLockOnTargetPlan(plan) {
  const errors = [];
  const warnings = [];
  if (!plan || plan.version !== 1) errors.push('invalid-plan-version');
  if (plan?.candidateCount !== (Array.isArray(plan?.candidates) ? plan.candidates.length : 0)) warnings.push('candidate-count-is-ranked-window');
  if (plan?.selectedTargetId && !plan.candidates?.some((candidate) => candidate.id === plan.selectedTargetId)) errors.push('selected-target-missing');
  for (const candidate of plan?.candidates || []) {
    if (!Number.isFinite(candidate.score)) errors.push(`${candidate.id}:score-not-finite`);
    if (!Number.isFinite(candidate.distanceMeters)) errors.push(`${candidate.id}:distance-not-finite`);
    if (candidate.distanceMeters < PLAYER_LOCK_ON_LIMITS.minDistanceMeters || candidate.distanceMeters > PLAYER_LOCK_ON_LIMITS.maxDistanceMeters) warnings.push(`${candidate.id}:distance-clamped`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), warnings: freeze(warnings) });
}

export function buildPlayerLockOnEvidence(input = {}) {
  const plan = buildPlayerLockOnTargetPlan(input);
  const audit = auditPlayerLockOnTargetPlan(plan);
  const cycleRight = buildPlayerLockOnCyclePlan(plan, 1);
  const cycleLeft = buildPlayerLockOnCyclePlan(plan, -1);
  return freeze({ version: 1, plan, audit, cycleRight, cycleLeft });
}
