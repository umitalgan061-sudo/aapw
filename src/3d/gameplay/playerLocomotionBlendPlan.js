/**
 * Deterministic locomotion/attack blend plan for the existing player animation runtime.
 *
 * This is a pure adapter: it does not own an AnimationMixer, clips, state mutation,
 * transforms, camera, input listeners or combat resolution. It consumes the already
 * resolved equipment/combat animation plan and emits bounded layer weights/fades for
 * the existing caller-owned mixer/controller.
 *
 * @module gameplay/playerLocomotionBlendPlan
 */

const MAX_NUMBER = 1000;
const MIN_NUMBER = 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const MOVEMENT_STATES = new Set(['idle', 'move', 'run', 'sprint', 'dodge', 'airborne', 'fall', 'land']);
const ATTACK_STATES = new Set(['light', 'heavy', 'ranged', 'archery', 'block', 'guard', 'parry', 'hit', 'defeat', 'none']);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function normalizeState(value, fallback, allowed) {
  const state = String(value ?? '').trim().toLowerCase();
  return allowed.has(state) ? state : fallback;
}

function normalizedSpeed(speedMps, maxSpeedMps) {
  const speed = clamp(finite(speedMps), 0, MAX_NUMBER);
  const max = Math.max(0.1, clamp(finite(maxSpeedMps, 5.2), 0.1, MAX_NUMBER));
  return clamp(speed / max, 0, 1);
}

function deriveLocomotionWeights({ movementState, speedRatio, grounded, turnRate }) {
  const turn = clamp(Math.abs(finite(turnRate)) / 180, 0, 1);
  const airborne = grounded ? 0 : 1;
  const move = movementState === 'idle' ? 0 : movementState === 'dodge' ? 0.82 : clamp(speedRatio * 1.12, 0, 1);
  const run = movementState === 'run' || movementState === 'sprint' ? clamp(speedRatio * 1.18, 0, 1) : 0;
  const sprint = movementState === 'sprint' ? clamp((speedRatio - 0.62) / 0.38, 0, 1) : 0;
  const dodge = movementState === 'dodge' ? 1 : 0;
  const fall = movementState === 'fall' || movementState === 'airborne' ? 1 : 0;
  const land = movementState === 'land' ? 1 : 0;

  return {
    idle: clamp(1 - Math.max(move, airborne, land) + turn * 0.05, 0, 1),
    move: clamp(move * (1 - airborne * 0.72), 0, 1),
    run: clamp(run * (1 - airborne * 0.55), 0, 1),
    sprint: clamp(sprint * (1 - airborne * 0.4), 0, 1),
    dodge,
    airborne,
    fall,
    land,
    turn,
  };
}

function deriveAttackWeights({ attackState, attackKind, comboStep, action }) {
  const normalizedAttack = normalizeState(attackState || attackKind, 'none', ATTACK_STATES);
  const kind = normalizeState(attackKind, normalizedAttack, ATTACK_STATES);
  const active = normalizedAttack !== 'none' || kind !== 'none' || Boolean(action && action !== 'none');
  const combo = clamp(Math.floor(finite(comboStep)), 0, 3);
  const emphasis = active ? clamp(0.64 + combo * 0.08, 0, 0.92) : 0;

  return {
    active: active ? 1 : 0,
    light: active && kind === 'light' ? emphasis : 0,
    heavy: active && kind === 'heavy' ? emphasis : 0,
    ranged: active && (kind === 'ranged' || kind === 'archery') ? emphasis : 0,
    defense: active && ['block', 'guard', 'parry'].includes(kind) ? emphasis : 0,
    reaction: active && ['hit', 'defeat'].includes(kind) ? emphasis : 0,
    comboStep: combo,
  };
}

function normalizeProfileAnimation(profile, animationPlan) {
  const family = String(animationPlan?.family || profile?.mainHand?.animationFamily || profile?.armor?.animationFamily || 'arming-sword');
  const action = String(animationPlan?.action || 'idle');
  const clip = String(animationPlan?.clip || action);
  return { family, action, clip };
}

export function createPlayerLocomotionBlendPlan(profile, {
  animationPlan = null,
  movementState = 'idle',
  attackState = 'none',
  attackKind = 'none',
  comboStep = 0,
  speedMps = 0,
  maxSpeedMps = 5.2,
  grounded = true,
  turnRate = 0,
  rootMotion = false,
} = {}) {
  const movement = normalizeState(movementState, 'idle', MOVEMENT_STATES);
  const normalizedGrounded = Boolean(grounded);
  const speedRatio = normalizedSpeed(speedMps, maxSpeedMps);
  const locomotion = deriveLocomotionWeights({ movementState: movement, speedRatio, grounded: normalizedGrounded, turnRate });
  const attack = deriveAttackWeights({ attackState, attackKind, comboStep, action: animationPlan?.action });
  const resolvedAnimation = normalizeProfileAnimation(profile, animationPlan);
  const attackDominance = clamp(Math.max(attack.active * 0.86, attack.light, attack.heavy, attack.ranged, attack.defense, attack.reaction), 0, 0.94);
  const upperBodyWeight = attackDominance;
  const lowerBodyWeight = clamp(1 - attackDominance * 0.58, 0.42, 1);
  const fadeInSeconds = clamp(0.08 + Math.abs(finite(turnRate)) / 360, 0.08, 0.34);
  const fadeOutSeconds = clamp(0.12 + speedRatio * 0.16, 0.12, 0.36);

  return freezeDeep({
    schema: 'player-locomotion-blend-plan/v1',
    animation: resolvedAnimation,
    movement: {
      state: movement,
      grounded: normalizedGrounded,
      speedMps: clamp(finite(speedMps), 0, MAX_NUMBER),
      maxSpeedMps: clamp(finite(maxSpeedMps, 5.2), 0.1, MAX_NUMBER),
      speedRatio,
      rootMotion: Boolean(rootMotion),
      weights: locomotion,
    },
    combat: {
      state: normalizeState(attackState, 'none', ATTACK_STATES),
      kind: normalizeState(attackKind, 'none', ATTACK_STATES),
      comboStep: attack.comboStep,
      weights: attack,
    },
    layers: {
      lowerBody: lowerBodyWeight,
      upperBody: upperBodyWeight,
      additiveReaction: attack.reaction,
      locomotionSuppression: clamp(attackDominance * 0.5, 0, 0.47),
    },
    transition: {
      fadeInSeconds,
      fadeOutSeconds,
      crossFade: clamp(Math.max(fadeInSeconds, fadeOutSeconds), 0.08, 0.4),
      interruptible: !['heavy', 'defeat'].includes(normalizeState(attackKind, 'none', ATTACK_STATES)),
    },
    ownership: {
      mixer: 'existing-player-animation-runtime',
      stateMutation: 'existing-player-state-machine',
      combat: 'existing-player-combat-runtime',
      assets: 'existing-asset-loader',
    },
  });
}

export function validatePlayerLocomotionBlendPlan(plan) {
  if (!plan || plan.schema !== 'player-locomotion-blend-plan/v1') return false;
  if (!plan.animation?.family || !plan.animation?.clip) return false;
  if (!MOVEMENT_STATES.has(plan.movement?.state)) return false;
  if (!ATTACK_STATES.has(plan.combat?.kind)) return false;
  const weights = [
    plan.layers?.lowerBody,
    plan.layers?.upperBody,
    plan.layers?.additiveReaction,
    plan.layers?.locomotionSuppression,
    plan.transition?.fadeInSeconds,
    plan.transition?.fadeOutSeconds,
    plan.transition?.crossFade,
  ];
  return weights.every((value) => Number.isFinite(value) && value >= MIN_NUMBER && value <= 1);
}
