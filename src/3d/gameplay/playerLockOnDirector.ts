/** Production TypeScript owner for player lock-on target selection. */
// @ts-nocheck

import { resolvePlayerEquipmentCombatProfile, resolvePlayerLockOnRules } from './playerEquipmentCombatProfile.ts';

export const PLAYER_LOCK_ON_EVENT = 'aapw:player-lock-on-change';
const MAX_TARGETS = 32;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function normalizeTarget(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? raw.actorId ?? raw.uuid ?? `target-${index}`);
  return {
    id,
    distanceMeters: Math.max(0, finite(raw.distanceMeters ?? raw.distance, Infinity)),
    angleRad: Math.max(0, finite(raw.angleRad ?? raw.angle, Math.PI)),
    alive: raw.alive !== false,
    visible: raw.visible !== false,
    priority: clamp(finite(raw.priority, 0), 0, 1),
    movesAway: Boolean(raw.movesAway),
    object3D: raw.object3D ?? raw.object ?? null,
  };
}

function rankTargets(profile, targets, currentId) {
  return targets
    .map((target) => ({
      target,
      rules: resolvePlayerLockOnRules(profile, {
        targetDistanceMeters: target.distanceMeters,
        targetAngleRad: target.angleRad,
        targetAlive: target.alive,
        targetVisible: target.visible,
        targetPriority: target.priority,
        currentLocked: target.id === currentId,
        targetMovesAway: target.movesAway,
      }),
    }))
    .filter((entry) => entry.rules.eligible || entry.target.id === currentId)
    .sort((a, b) => {
      if (b.rules.score !== a.rules.score) return b.rules.score - a.rules.score;
      return a.target.id.localeCompare(b.target.id);
    });
}

export function createPlayerLockOnDirector({
  equipmentProvider = () => ({}),
  target = globalThis,
  maxTargets = MAX_TARGETS,
  emitEvents = true,
  onChange = null,
} = {}) {
  let disposed = false;
  let currentId = null;
  let revision = 0;
  let current = Object.freeze({ active: false, targetId: null, revision: 0, score: 0, rules: null });
  const history = [];

  function readEquipment() {
    try {
      return typeof equipmentProvider === 'function' ? equipmentProvider() || {} : equipmentProvider || {};
    } catch {
      return {};
    }
  }

  function publish(next) {
    current = Object.freeze(next);
    history.push(current);
    if (history.length > 24) history.splice(0, history.length - 24);
    if (typeof onChange === 'function') {
      try { onChange(current); } catch { /* consumer isolation */ }
    }
    if (emitEvents && typeof target?.dispatchEvent === 'function' && typeof target?.CustomEvent === 'function') {
      target.dispatchEvent(new target.CustomEvent(PLAYER_LOCK_ON_EVENT, { detail: current }));
    }
    return current;
  }

  function acquire(rawTargets = []) {
    if (disposed) return current;
    const profile = resolvePlayerEquipmentCombatProfile(readEquipment());
    const targets = rawTargets.slice(0, Math.max(1, maxTargets)).map(normalizeTarget).filter(Boolean);
    const ranked = rankTargets(profile, targets, currentId);
    const best = ranked.find((entry) => entry.rules.eligible) || null;
    currentId = best?.target.id ?? null;
    revision += 1;
    return publish({
      active: Boolean(best),
      targetId: currentId,
      revision,
      score: best?.rules.score ?? 0,
      rules: best?.rules ?? null,
      target: best?.target ?? null,
    });
  }

  function refresh(rawTargets = []) {
    if (!currentId) return acquire(rawTargets);
    const profile = resolvePlayerEquipmentCombatProfile(readEquipment());
    const targets = rawTargets.slice(0, Math.max(1, maxTargets)).map(normalizeTarget).filter(Boolean);
    const currentTarget = targets.find((item) => item.id === currentId);
    if (!currentTarget) return release('missing-target');
    const rules = resolvePlayerLockOnRules(profile, {
      targetDistanceMeters: currentTarget.distanceMeters,
      targetAngleRad: currentTarget.angleRad,
      targetAlive: currentTarget.alive,
      targetVisible: currentTarget.visible,
      targetPriority: currentTarget.priority,
      currentLocked: true,
      targetMovesAway: currentTarget.movesAway,
    });
    if (rules.breakLock || !rules.maintain) return release('break-lock');
    revision += 1;
    return publish({ active: true, targetId: currentId, revision, score: rules.score, rules, target: currentTarget });
  }

  function release(reason = 'manual') {
    if (disposed) return current;
    currentId = null;
    revision += 1;
    return publish({ active: false, targetId: null, revision, score: 0, rules: null, target: null, reason });
  }

  function read() { return current; }
  function readHistory() { return history.slice(); }
  function dispose() { disposed = true; currentId = null; history.length = 0; }

  return Object.freeze({ acquire, refresh, release, read, readHistory, dispose });
}

export function isPlayerLockOnState(value) {
  return Boolean(value && typeof value === 'object' && typeof value.active === 'boolean' && Number.isInteger(value.revision) && (value.targetId === null || typeof value.targetId === 'string'));
}
