/**
 * Deterministic lock-on target ranking adapter for the shipped player combat rules.
 *
 * This module does not own camera, target transforms, scene traversal, input, AI, or
 * player state. Callers provide a bounded candidate snapshot and remain authoritative
 * for target acquisition and camera application.
 *
 * @module gameplay/playerLockOnTargetDirector
 */

import { resolvePlayerEquipmentCombatProfile, resolvePlayerLockOnRules } from './playerEquipmentCombatRules.js';

const MAX_CANDIDATES = 24;
const MAX_HISTORY = 8;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function normalizeId(value, fallback) {
  const id = typeof value === 'string' ? value.trim().slice(0, 96) : '';
  return id || fallback;
}

function normalizeCandidate(candidate, index) {
  const item = candidate && typeof candidate === 'object' ? candidate : {};
  return Object.freeze({
    id: normalizeId(item.id, `candidate-${index}`),
    distanceMeters: Math.max(0, finite(item.distanceMeters, Number.POSITIVE_INFINITY)),
    angleRad: Math.max(0, finite(item.angleRad, Math.PI)),
    alive: item.alive !== false,
    visible: item.visible !== false,
    priority: clamp(finite(item.priority, 0), 0, 1),
    movesAway: Boolean(item.movesAway),
  });
}

function freezeList(items) {
  return Object.freeze(items.slice());
}

export function rankPlayerLockOnTargets(profileInput = {}, candidates = [], {
  currentTargetId = null,
  currentLocked = false,
  maxResults = 8,
} = {}) {
  const profile = profileInput?.mainHand ? profileInput : resolvePlayerEquipmentCombatProfile(profileInput);
  const source = Array.isArray(candidates) ? candidates.slice(0, MAX_CANDIDATES) : [];
  const ranked = source.map(normalizeCandidate).map((candidate, index) => {
    const rules = resolvePlayerLockOnRules(profile, {
      targetDistanceMeters: candidate.distanceMeters,
      targetAngleRad: candidate.angleRad,
      targetAlive: candidate.alive,
      targetVisible: candidate.visible,
      targetPriority: candidate.priority,
      currentLocked: currentLocked && candidate.id === currentTargetId,
      targetMovesAway: candidate.movesAway,
    });
    return Object.freeze({
      ...candidate,
      index,
      ...rules,
      retainCurrentBias: currentLocked && candidate.id === currentTargetId ? 0.08 : 0,
      rankingScore: Number((rules.score + (currentLocked && candidate.id === currentTargetId ? 0.08 : 0)).toFixed(6)),
    });
  });
  ranked.sort((a, b) => b.rankingScore - a.rankingScore || a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id));
  const limit = Math.max(0, Math.min(MAX_CANDIDATES, Math.floor(Number(maxResults) || 8)));
  return Object.freeze({
    currentTargetId: currentTargetId || null,
    candidates: freezeList(ranked.slice(0, limit)),
    eligible: freezeList(ranked.filter((candidate) => candidate.eligible).slice(0, limit)),
    best: ranked.find((candidate) => candidate.eligible) || null,
  });
}

export function createPlayerLockOnTargetDirector({ profile = {}, maxHistory = MAX_HISTORY } = {}) {
  const historyLimit = Math.max(1, Math.min(MAX_HISTORY, Math.floor(Number(maxHistory) || MAX_HISTORY)));
  const history = [];
  let serial = 0;
  let disposed = false;
  let lockedTargetId = null;

  function evaluate(candidates, options = {}) {
    if (disposed) return Object.freeze({ serial, disposed: true, lockedTargetId: null, decision: 'disposed', ranking: Object.freeze({ candidates: Object.freeze([]), eligible: Object.freeze([]), best: null }) });
    const currentTargetId = options.currentTargetId ?? lockedTargetId;
    const currentLocked = options.currentLocked ?? Boolean(currentTargetId);
    const ranking = rankPlayerLockOnTargets(profile, candidates, { ...options, currentTargetId, currentLocked });
    const current = ranking.candidates.find((candidate) => candidate.id === currentTargetId) || null;
    let decision = 'none';
    let nextTargetId = null;
    if (current?.maintain) {
      decision = 'maintain';
      nextTargetId = current.id;
    } else if (ranking.best?.acquire) {
      decision = 'acquire';
      nextTargetId = ranking.best.id;
    } else if (current?.breakLock) {
      decision = 'break';
    }
    lockedTargetId = nextTargetId;
    const receipt = Object.freeze({
      serial: ++serial,
      decision,
      previousTargetId: currentTargetId || null,
      nextTargetId,
      score: nextTargetId ? Number((ranking.candidates.find((candidate) => candidate.id === nextTargetId)?.rankingScore || 0).toFixed(6)) : 0,
      ranking,
    });
    history.push(receipt);
    if (history.length > historyLimit) history.splice(0, history.length - historyLimit);
    return receipt;
  }

  function snapshot() {
    return Object.freeze({ serial, disposed, lockedTargetId, history: Object.freeze(history.slice()) });
  }

  function reset() {
    if (disposed) return;
    lockedTargetId = null;
    history.length = 0;
  }

  function dispose() {
    disposed = true;
    lockedTargetId = null;
    history.length = 0;
  }

  return Object.freeze({ evaluate, snapshot, reset, dispose });
}

export { MAX_CANDIDATES as PLAYER_LOCK_ON_MAX_CANDIDATES, MAX_HISTORY as PLAYER_LOCK_ON_MAX_HISTORY };
