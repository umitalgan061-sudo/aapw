/**
 * Deterministic left/right lock-on target cycling over the existing gameLoopHelpers
 * lock evaluation contract. It does not own input, camera, NPC AI, or player state.
 * @module gameplay/playerCombatLockOnCycle
 */

import { evaluatePlayerLockTarget } from '../gameLoopHelpers.js';

const MAX_CANDIDATES = 64;
const DEFAULT_MAX_DISTANCE_METERS = 30;
const DEFAULT_HALF_ANGLE_DEGREES = 125;
const EPSILON = 1e-9;

const clampIndex = (value, length) => {
  if (!length) return -1;
  const normalized = Number.isFinite(value) ? Math.trunc(value) : 0;
  return ((normalized % length) + length) % length;
};

const stableId = (evaluation, fallbackIndex) => String(evaluation?.id ?? `candidate-${fallbackIndex}`);

export function buildPlayerLockOnCycleCandidates({ playerPosition, forward, candidates = [], maxDistanceMeters = DEFAULT_MAX_DISTANCE_METERS, halfAngleDegrees = DEFAULT_HALF_ANGLE_DEGREES } = {}) {
  const bounded = Array.isArray(candidates) ? candidates.slice(0, MAX_CANDIDATES) : [];
  return bounded
    .map((entity, index) => ({ entity, index, evaluation: evaluatePlayerLockTarget({ playerPosition, forward, entity, index, maxDistanceMeters, halfAngleDegrees }) }))
    .filter((entry) => entry.evaluation?.eligible)
    .sort((a, b) => {
      const scoreDelta = Number(a.evaluation.score) - Number(b.evaluation.score);
      if (Math.abs(scoreDelta) > EPSILON) return scoreDelta;
      const idDelta = stableId(a.evaluation, a.index).localeCompare(stableId(b.evaluation, b.index));
      return idDelta || a.index - b.index;
    });
}

export function selectPlayerLockOnCycleTarget(entries = [], { currentTargetId = null, direction = 1 } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const currentIndex = entries.findIndex((entry) => stableId(entry.evaluation, entry.index) === String(currentTargetId));
  const step = direction < 0 ? -1 : 1;
  const nextIndex = clampIndex((currentIndex < 0 ? (step < 0 ? entries.length : -1) : currentIndex) + step, entries.length);
  const selected = entries[nextIndex];
  return selected ? Object.freeze({
    entity: selected.entity,
    index: selected.index,
    targetId: stableId(selected.evaluation, selected.index),
    distanceMeters: Number(Number(selected.evaluation.distanceMeters).toFixed(3)),
    angleDegrees: Number(Number(selected.evaluation.angleDegrees).toFixed(2)),
    score: Number(Number(selected.evaluation.score).toFixed(6)),
    cycleIndex: nextIndex,
    direction: step,
  }) : null;
}

export function cyclePlayerLockOnTarget({ playerPosition, forward, candidates = [], currentTargetId = null, direction = 1, maxDistanceMeters, halfAngleDegrees } = {}) {
  const entries = buildPlayerLockOnCycleCandidates({ playerPosition, forward, candidates, maxDistanceMeters, halfAngleDegrees });
  return selectPlayerLockOnCycleTarget(entries, { currentTargetId, direction });
}
