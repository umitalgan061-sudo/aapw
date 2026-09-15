/**
 * Stateful lock-on adapter for the existing player combat targeting director.
 *
 * It keeps target selection deterministic while preventing frame-to-frame target churn.
 * The caller still owns actors, camera, input, scene state and combat authority.
 * No occlusion raycast is invented here: `isTargetVisible` is an optional caller probe.
 */

import { selectPlayerCombatTarget, PLAYER_COMBAT_TARGETING_DEFAULTS } from './playerCombatTargetingDirector.js';

const EVENT_NAME = 'aapw:player-combat-targeting';
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const freeze = (value) => Object.freeze(value);

function normalizeOptions(options = {}) {
  const defaults = PLAYER_COMBAT_TARGETING_DEFAULTS;
  return freeze({
    maxDistanceMeters: Math.max(0, finite(options.maxDistanceMeters, defaults.maxDistanceMeters)),
    maxAngleRadians: Math.max(0, finite(options.maxAngleRadians, defaults.maxAngleRadians)),
    preferLockedTarget: options.preferLockedTarget !== false,
    acquireScoreMargin: Math.max(0, finite(options.acquireScoreMargin, 0.35)),
    retainDistanceMultiplier: Math.max(1, finite(options.retainDistanceMultiplier, 1.18)),
    retainAngleMultiplier: Math.max(1, finite(options.retainAngleMultiplier, 1.22)),
    lostGraceSeconds: Math.max(0, finite(options.lostGraceSeconds, 0.18)),
  });
}

function targetSnapshot(selection, reason, lockedTargetId, visible) {
  return freeze({
    targetId: selection.targetId,
    distanceMeters: selection.distanceMeters,
    angleRadians: selection.angleRadians,
    candidateCount: selection.candidateCount,
    reason,
    lockedTargetId,
    visible,
  });
}

export function createPlayerCombatTargetingRuntime({
  target = globalThis,
  options = {},
  isTargetVisible = null,
  onChange = null,
} = {}) {
  const config = normalizeOptions(options);
  let lockedTargetId = null;
  let lostForSeconds = 0;
  let lastSnapshot = targetSnapshot({ targetId: null, distanceMeters: null, angleRadians: null, candidateCount: 0 }, 'init', null, true);

  function emit(snapshot) {
    lastSnapshot = snapshot;
    if (typeof onChange === 'function') onChange(snapshot);
    if (typeof target?.dispatchEvent === 'function' && typeof target?.CustomEvent === 'function') {
      target.dispatchEvent(new target.CustomEvent(EVENT_NAME, { detail: snapshot }));
    }
    return snapshot;
  }

  function inspectVisibility(candidate) {
    if (!candidate?.target || typeof isTargetVisible !== 'function') return true;
    return isTargetVisible(candidate.target) !== false;
  }

  function update({ playerPosition, forward, actors, deltaSeconds = 0 } = {}) {
    const dt = clamp(finite(deltaSeconds), 0, 0.5);
    const visibleActors = (Array.isArray(actors) ? actors : []).filter((actor) => inspectVisibility({ target: actor }));
    const selection = selectPlayerCombatTarget({
      playerPosition,
      forward,
      actors: visibleActors,
      lockedTargetId,
      maxDistanceMeters: config.maxDistanceMeters,
      maxAngleRadians: config.maxAngleRadians,
      preferLockedTarget: config.preferLockedTarget,
    });
    const current = selection.targetId ? selection.candidates.find((candidate) => candidate.id === selection.targetId) : null;
    const retained = lockedTargetId ? selection.candidates.find((candidate) => candidate.id === lockedTargetId) : null;
    const currentVisible = Boolean(retained && inspectVisibility(retained));

    if (lockedTargetId && !retained) {
      lostForSeconds += dt;
      if (lostForSeconds <= config.lostGraceSeconds) {
        return emit(targetSnapshot(lastSnapshot, 'grace', lockedTargetId, false));
      }
      lockedTargetId = null;
      lostForSeconds = 0;
    }

    if (!lockedTargetId && selection.targetId) {
      lockedTargetId = selection.targetId;
      lostForSeconds = 0;
      return emit(targetSnapshot(selection, 'acquire', lockedTargetId, true));
    }

    if (!lockedTargetId) return emit(targetSnapshot(selection, 'idle', null, true));

    const challenger = selection.targetId && selection.targetId !== lockedTargetId ? selection.candidates[0] : null;
    const retainedScore = retained ? (1 - Math.min(1, retained.distance / config.maxDistanceMeters)) * 4 + (1 - Math.min(1, retained.angle / Math.PI)) * 2 : -Infinity;
    const challengerScore = challenger ? (1 - Math.min(1, challenger.distance / config.maxDistanceMeters)) * 4 + (1 - Math.min(1, challenger.angle / Math.PI)) * 2 : -Infinity;
    const retainedWithinBand = retained && retained.distance <= config.maxDistanceMeters * config.retainDistanceMultiplier && retained.angle <= config.maxAngleRadians * config.retainAngleMultiplier;

    if (currentVisible && retainedWithinBand && (!challenger || challengerScore <= retainedScore + config.acquireScoreMargin)) {
      return emit(targetSnapshot({ ...selection, targetId: lockedTargetId, distanceMeters: retained.distance, angleRadians: retained.angle }, 'retain', lockedTargetId, true));
    }

    if (challenger && challengerScore > retainedScore + config.acquireScoreMargin) {
      lockedTargetId = challenger.id;
      lostForSeconds = 0;
      return emit(targetSnapshot(selection, 'switch', lockedTargetId, true));
    }

    if (!currentVisible) {
      lostForSeconds += dt;
      if (lostForSeconds > config.lostGraceSeconds) {
        lockedTargetId = null;
        lostForSeconds = 0;
        return emit(targetSnapshot(selection, 'release', null, false));
      }
    } else {
      lostForSeconds = 0;
    }
    return emit(targetSnapshot(selection, 'hold', lockedTargetId, currentVisible));
  }

  function clear(reason = 'clear') {
    lockedTargetId = null;
    lostForSeconds = 0;
    return emit(targetSnapshot({ targetId: null, distanceMeters: null, angleRadians: null, candidateCount: 0 }, reason, null, true));
  }

  return freeze({
    update,
    clear,
    get lockedTargetId() { return lockedTargetId; },
    get lastSnapshot() { return lastSnapshot; },
    options: config,
  });
}

export { EVENT_NAME as PLAYER_COMBAT_TARGETING_EVENT };
