/**
 * Runtime-facing animation blend plan over the authoritative equipment/combat profile.
 * Does not own AnimationMixer or mutate scene state.
 */
import { resolvePlayerAnimationPlan } from './playerEquipmentCombatProfile.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
};

function normalizeLayers(layers = {}) {
  const locomotion = clamp(finite(layers.locomotion, 1), 0, 1);
  const combat = clamp(finite(layers.combat, 0), 0, 1);
  const additive = clamp(finite(layers.additive, 0), 0, 1);
  const total = locomotion + combat;
  return { locomotion: locomotion / Math.max(1, total), combat: combat / Math.max(1, total), additive };
}

export function buildPlayerAnimationBlendPlan(profile, state = {}, options = {}) {
  const movementState = String(state.movementState ?? 'idle');
  const attackKind = state.attackKind === 'heavy' ? 'heavy' : state.attackKind === 'light' ? 'light' : 'none';
  const comboStep = clamp(Math.floor(finite(state.comboStep, 0)), 0, 3);
  const speedMps = clamp(finite(state.speedMps, 0), 0, 30);
  const grounded = state.grounded !== false;
  const plan = resolvePlayerAnimationPlan(profile, { movementState, attackKind, comboStep, speedMps, grounded });
  const layers = normalizeLayers({
    locomotion: movementState === 'idle' || attackKind === 'none' ? 1 : 0.32,
    combat: attackKind === 'none' ? 0 : 0.9,
    additive: movementState === 'guard' || movementState === 'parry' ? 0.35 : movementState === 'hit-stagger' ? 0.6 : 0,
    ...options.layers,
  });
  return freezeDeep({
    version: 1,
    action: plan.action,
    family: plan.family,
    timeScale: clamp(finite(options.timeScale, plan.timeScale), 0.35, 2.2),
    weights: layers,
    comboStep: plan.comboStep,
    locomotionLayer: plan.locomotionLayer,
    grounded: plan.grounded,
    crossFadeSeconds: clamp(finite(options.crossFadeSeconds, 0.12), 0.03, 0.4),
    rootMotion: Boolean(options.rootMotion && attackKind !== 'none' && grounded),
    equipmentRevisionKey: plan.equipmentRevisionKey,
    source: 'playerEquipmentCombatProfile',
  });
}

export function serializePlayerAnimationBlendPlan(plan) {
  return JSON.stringify(plan ?? null);
}
