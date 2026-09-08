/**
 * Deterministic animation presentation policy for the existing player combat state machine.
 * This module only resolves presentation state; it does not own mixers, clips, input, or combat.
 * @module gameplay/playerCombatAnimationBlendPolicy
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const PLAYER_COMBAT_ANIMATION_POLICY = freeze({
  version: 1,
  maxLocomotionSpeedMps: 8.2,
  crossfadeSeconds: 0.12,
  attackCrossfadeSeconds: 0.06,
  hitReactionCrossfadeSeconds: 0.04,
  supportedStates: freeze(['idle', 'walk', 'run', 'guard', 'dodge', 'light', 'heavy', 'parry', 'hit-stagger', 'guard-break', 'defeated']),
});

function normalizeState(state) {
  const value = String(state ?? '').trim().toLowerCase();
  if (value === 'attack-light' || value === 'light-attack') return 'light';
  if (value === 'attack-heavy' || value === 'heavy-attack') return 'heavy';
  if (PLAYER_COMBAT_ANIMATION_POLICY.supportedStates.includes(value)) return value;
  return 'idle';
}

function locomotionAction({ state, speedMps, guarding, grounded }) {
  if (!grounded) return 'idle';
  if (state === 'dodge') return 'dodge';
  if (state === 'light') return 'light';
  if (state === 'heavy') return 'heavy';
  if (state === 'parry') return 'parry';
  if (state === 'hit-stagger') return 'hit-stagger';
  if (state === 'guard-break') return 'guard-break';
  if (state === 'defeated') return 'defeated';
  if (guarding) return 'guard';
  if (speedMps >= 5.2) return 'run';
  if (speedMps >= 0.08) return 'walk';
  return 'idle';
}

export function resolvePlayerCombatAnimationBlend({
  state = 'idle',
  speedMps = 0,
  grounded = true,
  guarding = false,
  attackKind = 'none',
  comboStep = 0,
  feedbackOutcome = 'none',
  feedbackIntensity = 0,
  equipment = {},
} = {}) {
  const normalizedState = normalizeState(state);
  const boundedSpeed = clamp(Math.abs(finite(speedMps)), 0, PLAYER_COMBAT_ANIMATION_POLICY.maxLocomotionSpeedMps);
  const normalizedCombo = clamp(Math.floor(finite(comboStep)), 0, 3);
  const normalizedIntensity = clamp(finite(feedbackIntensity), 0, 1);
  const action = locomotionAction({ state: normalizedState, speedMps: boundedSpeed, guarding: Boolean(guarding), grounded: Boolean(grounded) });
  const isAttack = action === 'light' || action === 'heavy';
  const isReaction = action === 'hit-stagger' || action === 'guard-break' || action === 'defeated';
  const locomotionWeight = isAttack || isReaction || action === 'dodge' ? 0 : clamp(boundedSpeed / PLAYER_COMBAT_ANIMATION_POLICY.maxLocomotionSpeedMps, 0, 1);
  const attackWeight = isAttack ? 1 : 0;
  const reactionWeight = isReaction ? Math.max(0.45, normalizedIntensity) : 0;
  const crossfadeSeconds = isReaction
    ? PLAYER_COMBAT_ANIMATION_POLICY.hitReactionCrossfadeSeconds
    : (isAttack ? PLAYER_COMBAT_ANIMATION_POLICY.attackCrossfadeSeconds : PLAYER_COMBAT_ANIMATION_POLICY.crossfadeSeconds);
  return freeze({
    action,
    state: normalizedState,
    grounded: Boolean(grounded),
    speedMps: Number(boundedSpeed.toFixed(3)),
    locomotionWeight: Number(locomotionWeight.toFixed(3)),
    attackWeight,
    reactionWeight: Number(reactionWeight.toFixed(3)),
    crossfadeSeconds,
    timeScale: isAttack ? (action === 'heavy' ? 0.94 : 1.04) : 1,
    attackKind: isAttack ? (attackKind === 'heavy' ? 'heavy' : 'light') : 'none',
    comboStep: normalizedCombo,
    feedbackOutcome: String(feedbackOutcome ?? 'none'),
    equipment: freeze({
      mainHand: String(equipment.mainHand ?? ''),
      offHand: String(equipment.offHand ?? ''),
      armorWeight: clamp(finite(equipment.armorWeight), 0, 1),
    }),
  });
}

export function blendPolicyAudit(frame) {
  const errors = [];
  if (!frame || typeof frame !== 'object') errors.push('missing-frame');
  if (frame && !PLAYER_COMBAT_ANIMATION_POLICY.supportedStates.includes(frame.state)) errors.push('unsupported-state');
  if (frame && (frame.locomotionWeight < 0 || frame.locomotionWeight > 1)) errors.push('locomotion-weight-range');
  if (frame && (frame.attackWeight < 0 || frame.attackWeight > 1)) errors.push('attack-weight-range');
  if (frame && (frame.reactionWeight < 0 || frame.reactionWeight > 1)) errors.push('reaction-weight-range');
  if (frame && !Number.isFinite(frame.crossfadeSeconds)) errors.push('non-finite-crossfade');
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}
