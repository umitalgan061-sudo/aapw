/**
 * Deterministic guard/parry response policy over caller-owned combat samples.
 *
 * The player state machine remains authoritative for mutation, timing and animation. This
 * module only resolves a defensive response frame for existing combat consumers.
 */

const RESPONSE_ORDER = Object.freeze(['parry', 'block', 'guardBreak', 'hit']);
const DEFAULTS = Object.freeze({
  parryWindow: 0.16,
  guardWindow: 0.42,
  poiseDamage: 0.35,
  guardBreakThreshold: 1,
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function normalizeId(value, fallback = 'unknown') {
  const id = String(value ?? '').trim();
  return id || fallback;
}

function normalizeTiming(input = {}) {
  const elapsed = Math.max(0, finite(input.elapsed, 0));
  const parryWindow = clamp(input.parryWindow ?? DEFAULTS.parryWindow, 0, 2);
  const guardWindow = clamp(input.guardWindow ?? DEFAULTS.guardWindow, parryWindow, 4);
  return { elapsed, parryWindow, guardWindow };
}

function resolveResponse(input = {}) {
  const timing = normalizeTiming(input);
  const attack = input.attack || {};
  const defender = input.defender || {};
  const attacker = input.attacker || {};
  const attackActive = input.attackActive !== false;
  const incomingDamage = Math.max(0, finite(input.incomingDamage, finite(attack.damage, 0)));
  const incomingPoise = Math.max(0, finite(input.incomingPoise, finite(attack.poiseDamage, 0)));
  const guarding = input.guarding === true || defender.guarding === true;
  const parryRequested = input.parry === true || defender.parry === true;
  const guardBroken = input.guardBroken === true || defender.guardBroken === true;
  const invulnerable = input.invulnerable === true || defender.invulnerable === true;
  const sameFaction = input.sameFaction === true || attacker.faction === defender.faction;

  let response = 'hit';
  let blockedDamage = incomingDamage;
  let poiseDamage = incomingPoise;
  let reason = 'unguarded-hit';

  if (!attackActive) {
    response = 'none';
    blockedDamage = 0;
    poiseDamage = 0;
    reason = 'attack-inactive';
  } else if (sameFaction) {
    response = 'none';
    blockedDamage = 0;
    poiseDamage = 0;
    reason = 'same-faction';
  } else if (invulnerable) {
    response = 'none';
    blockedDamage = 0;
    poiseDamage = 0;
    reason = 'invulnerable';
  } else if (guardBroken) {
    response = 'guardBreak';
    reason = 'guard-already-broken';
  } else if (guarding && parryRequested && timing.elapsed <= timing.parryWindow) {
    response = 'parry';
    blockedDamage = 0;
    poiseDamage = 0;
    reason = 'parry-window';
  } else if (guarding && timing.elapsed <= timing.guardWindow) {
    response = 'block';
    blockedDamage = incomingDamage * 0.2;
    poiseDamage = Math.min(incomingPoise, DEFAULTS.poiseDamage);
    reason = 'guard-window';
  }

  return {
    response,
    reason,
    attackId: normalizeId(attack.id, 'incoming-attack'),
    defenderId: normalizeId(defender.id, 'defender'),
    incomingDamage: Number(blockedDamage.toFixed(6)),
    incomingPoise: Number(poiseDamage.toFixed(6)),
    timing,
    critical: response === 'parry',
    consumesGuard: response === 'block' || response === 'parry',
    responseOrder: RESPONSE_ORDER,
  };
}

export function createPlayerGuardParryDirector(input = {}) {
  const response = resolveResponse(input);
  const output = {
    ok: response.response !== 'none' || response.reason !== 'attack-inactive',
    ...response,
    summary: `${response.response}:${response.reason}`,
  };
  return deepFreeze(output);
}

export function serializePlayerGuardParryFrame(frame) {
  return JSON.stringify(frame);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
