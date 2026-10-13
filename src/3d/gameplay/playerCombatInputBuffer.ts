/**
 * Deterministic, observation-only combat input buffer over the shipped player/equipment rules.
 * The existing player state machine remains the only mutation authority.
 */
// @ts-nocheck

import { resolvePlayerCombatEnvelope } from './playerEquipmentCombatRules.ts';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const normalizeKind = (value) => value === 'heavy' ? 'heavy' : value === 'light';
const normalizePhase = (value) => ['startup', 'active', 'recovery'].includes(value) ? value : 'idle';

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) freeze(nested);
  return value;
};

/**
 * Projects whether a buffered light/heavy input should be accepted for the next attack window.
 * No timers, player state, animation mixer or combat mutation are performed here.
 */
export function resolvePlayerCombatInputBuffer(profileInput = {}, {
  requestedKind = 'light',
  phase = 'idle',
  phaseElapsedSeconds = 0,
  grounded = true,
  attackBusy = false,
  guardBreak = false,
  staminaRatio = 1,
  comboStep = 0,
  maxComboStep = 3,
  inputAgeSeconds = 0,
  bufferWindowSeconds = 0.22,
} = {}) {
  const kind = normalizeKind(requestedKind);
  const normalizedPhase = normalizePhase(phase);
  const elapsed = clamp(phaseElapsedSeconds, 0, 10);
  const inputAge = clamp(inputAgeSeconds, 0, 10);
  const bufferWindow = clamp(bufferWindowSeconds, 0.04, 0.4);
  const combo = Math.max(0, Math.min(Math.floor(Number.isFinite(Number(maxComboStep)) ? Number(maxComboStep) : 3), Math.floor(Number.isFinite(Number(comboStep)) ? Number(comboStep) : 0)));
  const envelope = resolvePlayerCombatEnvelope(profileInput, { kind, staminaRatio });
  const phaseAllowsBuffer = normalizedPhase === 'active' || normalizedPhase === 'recovery';
  const withinWindow = phaseAllowsBuffer && inputAge <= bufferWindow;
  const nextStep = combo >= Math.max(0, maxComboStep - 1) ? 0 : combo + 1;
  const canBuffer = Boolean(grounded) && !guardBreak && !(!attackBusy && normalizedPhase !== 'idle') && withinWindow && envelope.staminaRatio > 0 && combo < maxComboStep;
  const reason = !grounded
    ? 'airborne'
    : guardBreak
      ? 'guard-break'
      : !withinWindow
        ? 'outside-buffer-window'
        : envelope.staminaRatio <= 0
          ? 'stamina-empty'
          : combo >= maxComboStep
            ? 'combo-complete'
            : 'ready';
  const replayKey = [kind, normalizedPhase, elapsed.toFixed(3), inputAge.toFixed(3), combo, maxComboStep, canBuffer ? '1' : '0'].join('|');
  return freeze({
    accepted: canBuffer,
    reason,
    requestedKind: kind,
    phase: normalizedPhase,
    phaseElapsedSeconds: Number(elapsed.toFixed(4)),
    inputAgeSeconds: Number(inputAge.toFixed(4)),
    bufferWindowSeconds: Number(bufferWindow.toFixed(4)),
    comboStep: combo,
    nextComboStep: canBuffer ? nextStep : combo,
    maxComboStep: Math.max(1, Math.floor(Number.isFinite(Number(maxComboStep)) ? Number(maxComboStep) : 3)),
    staminaRatio: envelope.staminaRatio,
    activeWindow: Object.freeze({ start: envelope.activeStart, end: envelope.activeEnd, duration: envelope.duration }),
    replayKey,
  });
}

export function isPlayerCombatInputBuffer(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof value.accepted === 'boolean'
    && typeof value.reason === 'string'
    && (value.requestedKind === 'light' || value.requestedKind === 'heavy')
    && typeof value.phase === 'string'
    && Number.isFinite(value.comboStep)
    && Number.isFinite(value.nextComboStep)
    && typeof value.replayKey === 'string'
    && Object.isFrozen(value);
}
