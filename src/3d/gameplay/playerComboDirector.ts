/** Production TypeScript owner for deterministic player light/heavy combo progression. */
// @ts-nocheck
/**
 * Bounded combo progression adapter over the existing equipment/combat rules.
 * It owns no player timers, animation mixers, damage mutation, or inventory state.
 * The shipped player state machine remains authoritative; this module only resolves
 * the next attack intent and its timing window from already-resolved combat state.
 */

import { resolvePlayerCombatEnvelope } from './playerEquipmentCombatRules.ts';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeKind = (value) => value === 'heavy' ? 'heavy' : 'light';
const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
};

const COMBO_STEPS = freezeDeep({
  light: [
    { step: 1, kind: 'light', recovery: 0.16, chainOpen: 0.21, chainClose: 0.36, lunge: 0.58, damageBias: 1 },
    { step: 2, kind: 'light', recovery: 0.18, chainOpen: 0.19, chainClose: 0.34, lunge: 0.64, damageBias: 1.06 },
    { step: 3, kind: 'heavy', recovery: 0.28, chainOpen: 0.24, chainClose: 0.48, lunge: 0.82, damageBias: 1.28 },
  ],
  heavy: [
    { step: 1, kind: 'heavy', recovery: 0.28, chainOpen: 0.32, chainClose: 0.58, lunge: 0.88, damageBias: 1 },
    { step: 2, kind: 'heavy', recovery: 0.32, chainOpen: 0.3, chainClose: 0.56, lunge: 0.98, damageBias: 1.12 },
  ],
});

function stepFor(kind, step) {
  const list = COMBO_STEPS[normalizeKind(kind)];
  const index = clamp(finite(step, 1) - 1, 0, list.length - 1);
  return list[index];
}

export function resolvePlayerComboFrame(profileInput = {}, {
  requestedKind = 'light',
  comboStep = 0,
  phaseTime = 0,
  bufferedKind = null,
  staminaRatio = 1,
  poiseRatio = 1,
  grounded = true,
  attackBusy = false,
  guardBreak = false,
} = {}) {
  const requested = normalizeKind(requestedKind);
  const currentStep = Math.max(0, Math.floor(finite(comboStep, 0)));
  const currentKind = currentStep > 0 ? requested : null;
  const nextRequested = bufferedKind ? normalizeKind(bufferedKind) : requested;
  const nextStep = currentStep > 0 ? currentStep + 1 : 1;
  const pattern = stepFor(nextRequested, nextStep);
  const envelope = resolvePlayerCombatEnvelope(profileInput, {
    kind: pattern.kind,
    staminaRatio,
    poiseRatio,
  });
  const phase = Math.max(0, finite(phaseTime, 0));
  const canBuffer = attackBusy && phase >= pattern.chainOpen && phase <= pattern.chainClose;
  const staminaReady = finite(staminaRatio, 1) >= clamp(envelope.staminaCost / 100, 0.08, 0.95);
  const canStart = Boolean(grounded) && !guardBreak && !attackBusy && staminaReady;
  const canChain = Boolean(grounded) && !guardBreak && attackBusy && canBuffer && staminaReady;
  const terminal = nextStep >= COMBO_STEPS[nextRequested].length;
  const damageScale = Number((envelope.damageScaleAtCurrentStamina * pattern.damageBias).toFixed(4));

  return freezeDeep({
    current: Object.freeze({ kind: currentKind, step: currentStep }),
    requested: nextRequested,
    next: Object.freeze({
      kind: pattern.kind,
      step: pattern.step,
      terminal,
      lungeMeters: pattern.lunge,
      damageScale,
      recoverySeconds: pattern.recovery,
    }),
    timing: Object.freeze({
      phaseSeconds: phase,
      chainOpen: pattern.chainOpen,
      chainClose: pattern.chainClose,
      bufferAccepted: canBuffer,
    }),
    availability: Object.freeze({
      canStart,
      canChain,
      staminaReady,
      grounded: Boolean(grounded),
      attackBusy: Boolean(attackBusy),
      guardBreak: Boolean(guardBreak),
    }),
    envelope,
  });
}

export function resolvePlayerComboTransition(profileInput = {}, current = {}, input = {}) {
  const frame = resolvePlayerComboFrame(profileInput, {
    ...input,
    requestedKind: input.requestedKind ?? current.kind ?? 'light',
    comboStep: current.step ?? 0,
    phaseTime: input.phaseTime ?? 0,
    attackBusy: input.attackBusy ?? current.step > 0,
  });
  const accepted = frame.availability.canStart || frame.availability.canChain;
  return freezeDeep({
    accepted,
    reason: accepted ? (frame.availability.canChain ? 'buffered-chain' : 'new-attack') : frame.availability.guardBreak ? 'guard-break' : frame.availability.staminaReady ? 'timing-or-grounded' : 'insufficient-stamina',
    next: frame.next,
    timing: frame.timing,
    availability: frame.availability,
  });
}

export function validatePlayerComboFrame(frame) {
  const errors = [];
  if (!frame || typeof frame !== 'object') errors.push('missing-frame');
  if (!frame?.next?.kind || !['light', 'heavy'].includes(frame.next.kind)) errors.push('invalid-next-kind');
  if (!Number.isInteger(frame?.next?.step) || frame.next.step < 1) errors.push('invalid-next-step');
  if (frame?.timing?.chainOpen > frame?.timing?.chainClose) errors.push('invalid-chain-window');
  if (frame?.availability?.canChain && !frame?.timing?.bufferAccepted) errors.push('chain-without-buffer');
  return freezeDeep({ ok: errors.length === 0, errors });
}

export { COMBO_STEPS };
