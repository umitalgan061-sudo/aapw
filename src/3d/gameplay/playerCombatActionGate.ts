/**
 * Deterministic action admission over the existing player/equipment combat rules.
 * This is a pure presentation/validation adapter; the shipped player state machine
 * remains the only authority for timers, mutation and damage application.
 */
// @ts-nocheck

import {
  resolvePlayerDefenseRules,
  resolvePlayerDodgeRules,
  resolvePlayerRangedRules,
  resolvePlayerCombatEnvelope,
  resolvePlayerLockOnRules,
} from './playerEquipmentCombatRules.ts';

const ACTIONS = Object.freeze(['light', 'heavy', 'guard', 'parry', 'dodge', 'ranged', 'lockOn']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function normalizeAction(value) {
  return ACTIONS.includes(value) ? value : null;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) freeze(nested);
  return value;
}

function admission(action, allowed, reason, evidence = {}) {
  return Object.freeze({ action, allowed: Boolean(allowed), reason, evidence: freeze({ ...evidence }) });
}

export function resolvePlayerCombatActionGate(profileInput = {}, {
  requestedAction = null,
  staminaRatio = 1,
  poiseRatio = 1,
  grounded = true,
  attackBusy = false,
  guardBreak = false,
  parryWindowOpen = false,
  dodgeInvulnerable = false,
  moving = false,
  lockOn = false,
  targetDistanceMeters = Infinity,
  targetAngleRad = Math.PI,
  targetAlive = true,
  targetVisible = true,
  targetPriority = 0,
  currentLocked = false,
  targetMovesAway = false,
  attackKind = 'light',
} = {}) {
  const action = normalizeAction(requestedAction);
  const stamina = clamp(finite(staminaRatio, 1), 0, 1);
  const poise = clamp(finite(poiseRatio, 1), 0, 1);
  const defense = resolvePlayerDefenseRules(profileInput, {
    staminaRatio: stamina,
    poiseRatio: poise,
    guardInput: action === 'guard' || action === 'parry',
    parryWindowOpen,
    dodgeInvulnerable,
  });
  const dodge = resolvePlayerDodgeRules(profileInput, { staminaRatio: stamina, grounded, attackBusy, guardBreak });
  const ranged = resolvePlayerRangedRules(profileInput, { staminaRatio: stamina, lockOn, moving });
  const envelope = resolvePlayerCombatEnvelope(profileInput, { kind: attackKind, staminaRatio: stamina, poiseRatio: poise });
  const lock = resolvePlayerLockOnRules(profileInput, {
    targetDistanceMeters,
    targetAngleRad,
    targetAlive,
    targetVisible,
    targetPriority,
    currentLocked,
    targetMovesAway,
  });

  const admissions = Object.freeze({
    light: admission('light', grounded && !attackBusy && !guardBreak && stamina >= 0.12, !grounded ? 'airborne' : attackBusy ? 'attack-busy' : guardBreak ? 'guard-break' : stamina < 0.12 ? 'stamina-low' : 'allowed', { grounded, attackBusy, guardBreak, staminaRatio: stamina, staminaCost: 12 }),
    heavy: admission('heavy', grounded && !attackBusy && !guardBreak && stamina >= 0.24, !grounded ? 'airborne' : attackBusy ? 'attack-busy' : guardBreak ? 'guard-break' : stamina < 0.24 ? 'stamina-low' : 'allowed', { grounded, attackBusy, guardBreak, staminaRatio: stamina, staminaCost: 24 }),
    guard: admission('guard', defense.guardAvailable, !grounded ? 'airborne' : defense.guardAvailable ? 'allowed' : dodgeInvulnerable ? 'dodge-invulnerable' : stamina <= 0 ? 'stamina-empty' : 'guard-unavailable', { grounded, staminaRatio: stamina, staminaCostMultiplier: defense.staminaCostMultiplier }),
    parry: admission('parry', defense.parryAvailable, defense.parryAvailable ? 'allowed' : !parryWindowOpen ? 'window-closed' : !defense.guardAvailable ? 'guard-unavailable' : stamina < 0.08 ? 'stamina-low' : 'parry-unavailable', { grounded, staminaRatio: stamina, parryWindowOpen }),
    dodge: admission('dodge', dodge.canStart, dodge.canStart ? 'allowed' : !grounded ? 'airborne' : attackBusy ? 'attack-busy' : guardBreak ? 'guard-break' : stamina < 0.28 ? 'stamina-low' : 'dodge-unavailable', { grounded, attackBusy, guardBreak, staminaRatio: stamina, iframeWindow: dodge.iframeWindow }),
    ranged: admission('ranged', ranged.ranged && stamina > 0.05, !ranged.ranged ? 'not-ranged-loadout' : stamina <= 0.05 ? 'stamina-low' : 'allowed', { ranged: ranged.ranged, stableAim: ranged.stableAim, releaseQuality: ranged.releaseQuality }),
    lockOn: admission('lockOn', lock.eligible || lock.maintain || lock.breakLock, lock.acquire ? 'acquire' : lock.maintain ? 'maintain' : lock.breakLock ? 'break' : 'ineligible', { eligible: lock.eligible, maintain: lock.maintain, breakLock: lock.breakLock, score: lock.score, maxRange: lock.maxRange }),
  });

  const selected = action ? admissions[action] : admission(null, false, 'no-action', { supportedActions: ACTIONS });
  return freeze({
    version: 1,
    action,
    selected,
    admissions,
    context: Object.freeze({ grounded: Boolean(grounded), attackBusy: Boolean(attackBusy), guardBreak: Boolean(guardBreak), staminaRatio: stamina, poiseRatio: poise, attackKind: attackKind === 'heavy' ? 'heavy' : 'light', envelope }),
    gateKey: [action ?? 'none', selected.allowed ? 'allow' : 'deny', selected.reason, Math.round(stamina * 1000), Math.round(poise * 1000), lock.eligible ? 'target' : 'no-target'].join('|'),
  });
}

export function isPlayerCombatActionGate(value) {
  try {
    return Boolean(
      value &&
      value.version === 1 &&
      typeof value.gateKey === 'string' &&
      value.selected &&
      typeof value.selected.allowed === 'boolean' &&
      typeof value.selected.reason === 'string' &&
      value.admissions &&
      ACTIONS.every((action) => value.admissions[action]?.action === action),
    );
  } catch {
    return false;
  }
}

export { ACTIONS as PLAYER_COMBAT_ACTIONS };
