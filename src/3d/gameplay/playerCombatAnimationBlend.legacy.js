/**
 * Pure combat/locomotion blend policy for the existing player animation director.
 *
 * This module intentionally contains no Three.js, DOM, input, or scene ownership. Callers feed
 * the already-resolved player state and apply the returned weights to their existing mixer.
 *
 * @module gameplay/playerCombatAnimationBlend
 */

const FINITE_FALLBACK = 0;

function finite(value, fallback = FINITE_FALLBACK) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizeState(value) {
  return String(value || 'idle').toLowerCase();
}

const COMBAT_STATES = new Set(['light-attack', 'heavy-attack', 'guard', 'dodge', 'hit-stagger']);

export function resolvePlayerCombatAnimationBlend({
  semanticState = 'idle',
  planarSpeedMps = 0,
  attackPhase = 0,
  guardWeight = 0,
  locomotionFadeInMps = 0.15,
  locomotionFadeOutMps = 5.6,
  combatOverlayWeight = 0.9,
  additiveFeedbackWeight = 0,
} = {}) {
  const state = normalizeState(semanticState);
  const speed = Math.max(0, finite(planarSpeedMps));
  const phase = clamp(finite(attackPhase), 0, 1);
  const guard = clamp(finite(guardWeight), 0, 1);
  const overlayCap = clamp(finite(combatOverlayWeight, 0.9), 0, 1);
  const additive = clamp(finite(additiveFeedbackWeight), 0, 1);
  const locomotion = state === 'idle'
    ? 0
    : smoothstep(Math.max(0, finite(locomotionFadeInMps, 0.15)), Math.max(0.16, finite(locomotionFadeOutMps, 5.6)), speed);
  const combat = COMBAT_STATES.has(state) ? overlayCap : 0;
  const attack = state === 'light-attack' || state === 'heavy-attack' ? overlayCap * Math.max(phase, 0.2) : 0;
  const dodge = state === 'dodge' ? overlayCap : 0;
  const stagger = state === 'hit-stagger' ? overlayCap : 0;
  const guardLayer = state === 'guard' ? Math.max(guard, 0.25) : 0;
  const locomotionWeight = clamp(locomotion * (1 - combat), 0, 1);
  const baseWeight = clamp(1 - locomotionWeight, 0, 1);

  return Object.freeze({
    semanticState: state,
    speedMps: Number(speed.toFixed(3)),
    locomotionWeight: Number(locomotionWeight.toFixed(4)),
    baseWeight: Number(baseWeight.toFixed(4)),
    combatOverlayWeight: Number(combat.toFixed(4)),
    attackWeight: Number(attack.toFixed(4)),
    guardWeight: Number(guardLayer.toFixed(4)),
    dodgeWeight: Number(dodge.toFixed(4)),
    staggerWeight: Number(stagger.toFixed(4)),
    additiveFeedbackWeight: Number(additive.toFixed(4)),
  });
}

export function validatePlayerCombatAnimationBlend(blend) {
  if (!blend || typeof blend !== 'object') return false;
  const weights = [
    blend.locomotionWeight,
    blend.baseWeight,
    blend.combatOverlayWeight,
    blend.attackWeight,
    blend.guardWeight,
    blend.dodgeWeight,
    blend.staggerWeight,
    blend.additiveFeedbackWeight,
  ];
  return weights.every((weight) => Number.isFinite(weight) && weight >= 0 && weight <= 1)
    && blend.locomotionWeight + blend.combatOverlayWeight <= 1.0001;
}
