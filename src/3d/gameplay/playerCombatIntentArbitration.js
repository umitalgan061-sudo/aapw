/**
 * Deterministic, read-only arbitration for already-normalized player input.
 * The existing input.js remains the device owner; this module only resolves conflicts
 * before the authoritative player state machine consumes them.
 * @module gameplay/playerCombatIntentArbitration
 */

const INTENTS = Object.freeze(['dodge', 'parry', 'heavy', 'light', 'guard', 'lockOn']);
const SOURCES = Object.freeze(['keyboard', 'mouse', 'gamepad', 'touch', 'unknown']);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const bool = (value) => value === true;
const normalizeSource = (value) => SOURCES.includes(value) ? value : 'unknown';

function readPressed(input, key) {
  return bool(input?.[`${key}Pressed`]) || bool(input?.buttons?.[key]);
}

export function resolvePlayerCombatIntent(input = {}, state = {}) {
  const candidates = INTENTS.filter((intent) => readPressed(input, intent));
  const attacking = candidates.includes('heavy') ? 'heavy' : candidates.includes('light') ? 'light' : null;
  const defensive = candidates.includes('parry') ? 'parry' : candidates.includes('dodge') ? 'dodge' : candidates.includes('guard') ? 'guard' : null;
  const intent = defensive || attacking || (candidates.includes('lockOn') ? 'lockOn' : null);
  const source = normalizeSource(input.source ?? state.source);
  const stamina = Math.max(0, finite(state.stamina, 0));
  const staminaCost = intent === 'dodge' ? 18 : intent === 'parry' ? 8 : intent === 'heavy' ? 20 : intent === 'light' ? 9 : 0;
  const blockedByStamina = staminaCost > 0 && stamina < staminaCost;
  const inRecovery = bool(state.inRecovery) || bool(state.hitStun) || bool(state.dead);
  const accepted = Boolean(intent) && !blockedByStamina && !inRecovery;
  return Object.freeze({
    intent: accepted ? intent : null,
    source,
    accepted,
    rejectedReason: accepted ? null : (inRecovery ? 'recovery' : blockedByStamina ? 'stamina' : 'none'),
    staminaCost: accepted ? staminaCost : 0,
    comboEligible: accepted && (intent === 'light' || intent === 'heavy'),
    lockOnRequested: accepted && intent === 'lockOn',
  });
}

export function createPlayerCombatIntentFrame(input = {}, state = {}) {
  const resolved = resolvePlayerCombatIntent(input, state);
  return Object.freeze({
    ...resolved,
    movementMagnitude: Number(Math.max(0, Math.min(1, finite(input.magnitude, 0))).toFixed(4)),
    lookX: Number(finite(input.lookX, 0).toFixed(4)),
    lookY: Number(finite(input.lookY, 0).toFixed(4)),
    running: bool(input.running),
    guarding: bool(input.guarding),
  });
}

export function serializePlayerCombatIntentFrame(frame) {
  return JSON.stringify(frame && typeof frame === 'object' ? frame : createPlayerCombatIntentFrame());
}
