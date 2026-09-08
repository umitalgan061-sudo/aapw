/**
 * Deterministic reaction-window policy over the existing player combat profile.
 * This module does not own state, animation mixers, input, scene objects or health mutation.
 * @module gameplay/playerCombatReactionWindow
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const bool = (value) => value === true;
const ACTIONS = new Set(['idle', 'guard', 'parry', 'dodge', 'light', 'heavy', 'hit', 'staggered', 'defeated']);

function normalizeAction(value) {
  const action = String(value ?? 'idle').trim().toLowerCase();
  return ACTIONS.has(action) ? action : 'idle';
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function phaseFor(action, profile) {
  const phases = profile?.attack?.[action] || profile?.attackPhases?.[action] || {};
  const start = clamp(finiteOr(phases.activeStart, action === 'heavy' ? 0.28 : 0.14), 0, 0.95);
  const end = clamp(finiteOr(phases.activeEnd, action === 'heavy' ? 0.46 : 0.26), start, 1);
  const duration = clamp(finiteOr(phases.duration, action === 'heavy' ? 0.72 : 0.44), 0.05, 2);
  return { activeStart: start, activeEnd: end, duration };
}

export function buildPlayerCombatReactionWindow({ action = 'idle', elapsed = 0, profile = null, incoming = null } = {}) {
  const normalizedAction = normalizeAction(action);
  const phase = phaseFor(normalizedAction, profile);
  const t = clamp(finiteOr(elapsed, 0), 0, phase.duration);
  const progress = phase.duration > 0 ? t / phase.duration : 0;
  const attackActive = (normalizedAction === 'light' || normalizedAction === 'heavy') && progress >= phase.activeStart && progress <= phase.activeEnd;
  const parryWindow = normalizedAction === 'parry' && progress <= 0.34;
  const dodgeIFrames = normalizedAction === 'dodge' && progress >= 0.12 && progress <= 0.54;
  const guardWindow = normalizedAction === 'guard' && progress <= 0.95;
  const incomingKind = String(incoming?.kind ?? 'none').trim().toLowerCase();
  const incomingStrength = clamp(finiteOr(incoming?.strength, 0), 0, 1000);
  const canDeflect = bool(incoming?.active) && (parryWindow || guardWindow || dodgeIFrames);
  const response = parryWindow && incomingKind !== 'none' ? 'parried' : dodgeIFrames && incomingKind !== 'none' ? 'dodged' : guardWindow && incomingKind !== 'none' ? 'blocked' : 'hit';
  return freezeDeep({
    version: 1,
    action: normalizedAction,
    elapsed: t,
    duration: phase.duration,
    progress,
    attackActive,
    parryWindow,
    dodgeIFrames,
    guardWindow,
    incoming: { active: bool(incoming?.active), kind: incomingKind || 'none', strength: incomingStrength },
    canDeflect,
    response: bool(incoming?.active) ? response : 'none',
  });
}

export function buildPlayerCombatReactionSummary({ action = 'idle', elapsed = 0, profile = null, incoming = null } = {}) {
  const window = buildPlayerCombatReactionWindow({ action, elapsed, profile, incoming });
  return freezeDeep({
    version: 1,
    action: window.action,
    active: window.attackActive || window.parryWindow || window.dodgeIFrames || window.guardWindow,
    response: window.response,
    invulnerable: window.dodgeIFrames,
    perfectDefense: window.response === 'parried',
    hitboxActive: window.attackActive,
  });
}

export function serializePlayerCombatReactionWindow(value) {
  return JSON.stringify(value ?? null);
}
