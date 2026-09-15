/**
 * Deterministic defense-window policy for the existing player combat state machine.
 *
 * This module only projects dodge/parry/block timing metadata. `player.js` remains authoritative
 * for input, timers, animation, stamina, hitbox state and world mutation.
 *
 * @module gameplay/playerDefenseWindowDirector
 */

const ACTIONS = new Set(['dodge', 'parry', 'block']);
const MODES = new Set(['neutral', 'incoming', 'recovery']);
const MAX_WINDOW_MS = 1000;
const MAX_BUFFER_MS = 500;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalizeAction = (value) => ACTIONS.has(value) ? value : 'block';
const normalizeMode = (value) => MODES.has(value) ? value : 'neutral';

function computeWindow(action, mode, staminaRatio, poiseRatio) {
  const stamina = clamp(finite(staminaRatio, 1), 0, 1);
  const poise = clamp(finite(poiseRatio, 1), 0, 1);
  const incomingFactor = mode === 'incoming' ? 1.15 : mode === 'recovery' ? 0.9 : 1;
  const poiseFactor = 0.85 + poise * 0.15;
  const base = action === 'parry' ? 180 : action === 'dodge' ? 260 : 120;
  return clamp(base * incomingFactor * poiseFactor * (0.8 + stamina * 0.2), 60, MAX_WINDOW_MS);
}

export function resolvePlayerDefenseWindow(input = {}) {
  const action = normalizeAction(input.action);
  const mode = normalizeMode(input.mode);
  const windowMs = computeWindow(action, mode, input.staminaRatio, input.poiseRatio);
  const bufferMs = clamp(finite(input.bufferMs, 0), 0, MAX_BUFFER_MS);
  const active = input.active !== false && (mode !== 'recovery' || action === 'block');
  const canExecute = active && (action === 'block' || finite(input.stamina, 1) > 0);
  const outcome = !active ? 'inactive' : canExecute ? action : 'resource-gated';
  return Object.freeze({
    action,
    mode,
    active,
    canExecute,
    windowMs,
    bufferMs,
    outcome,
    perfectWindowMs: action === 'parry' ? Math.round(windowMs * 0.42) : action === 'dodge' ? Math.round(windowMs * 0.3) : 0,
    consumesStamina: action !== 'block',
    interruptsLightAttack: action === 'parry' || action === 'dodge',
  });
}

export function serializePlayerDefenseWindow(result = {}) {
  return JSON.stringify({
    action: result.action,
    mode: result.mode,
    active: Boolean(result.active),
    canExecute: Boolean(result.canExecute),
    windowMs: finite(result.windowMs),
    bufferMs: finite(result.bufferMs),
    outcome: result.outcome,
    perfectWindowMs: finite(result.perfectWindowMs),
    consumesStamina: Boolean(result.consumesStamina),
    interruptsLightAttack: Boolean(result.interruptsLightAttack),
  });
}
