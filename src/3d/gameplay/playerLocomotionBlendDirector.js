/**
 * Pure locomotion blend projection for existing player animation consumers.
 * Does not own AnimationMixer, movement, camera, input, or scene state.
 * @module gameplay/playerLocomotionBlendDirector
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalize = (value, fallback = 0) => clamp(finite(value, fallback), 0, 1);

const STATE = Object.freeze({
  IDLE: 'idle', WALK: 'walk', RUN: 'run', SPRINT: 'sprint', AIR: 'air', DODGE: 'dodge', ATTACK: 'attack', STUN: 'stun'
});

function normalizeState(value) {
  const state = String(value ?? '').toLowerCase();
  return Object.values(STATE).includes(state) ? state : STATE.IDLE;
}

function selectState(input) {
  if (input.stunned) return STATE.STUN;
  if (input.dodging) return STATE.DODGE;
  if (input.attacking) return STATE.ATTACK;
  if (!input.grounded) return STATE.AIR;
  const speed = finite(input.speed, 0);
  if (speed >= Math.max(0.1, finite(input.sprintThreshold, 6.5))) return STATE.SPRINT;
  if (speed >= Math.max(0.05, finite(input.runThreshold, 2.5))) return STATE.RUN;
  if (speed > 0.05) return STATE.WALK;
  return STATE.IDLE;
}

export function projectLocomotionBlend(input = {}) {
  const velocityX = finite(input.velocityX, 0);
  const velocityZ = finite(input.velocityZ, 0);
  const speed = Math.max(0, Math.hypot(velocityX, velocityZ));
  const state = selectState({ ...input, speed });
  const facingRadians = finite(input.facingRadians, 0);
  const moveRadians = Math.atan2(velocityX, velocityZ);
  const relativeRadians = Math.atan2(Math.sin(moveRadians - facingRadians), Math.cos(moveRadians - facingRadians));
  const strafe = clamp(Math.sin(relativeRadians), -1, 1);
  const forward = clamp(Math.cos(relativeRadians), -1, 1);
  const speedNorm = normalize(speed / Math.max(0.1, finite(input.maxSpeed, 8.2)));
  const sprintBlend = state === STATE.SPRINT ? speedNorm : 0;
  const runBlend = state === STATE.RUN ? speedNorm : state === STATE.SPRINT ? 1 : 0;
  const walkBlend = state === STATE.WALK ? speedNorm : 0;
  const attackBlend = state === STATE.ATTACK ? normalize(input.attackProgress) : 0;
  const dodgeBlend = state === STATE.DODGE ? normalize(input.dodgeProgress) : 0;
  const transitionSeconds = clamp(finite(input.transitionSeconds, 0.12), 0.02, 0.5);
  return Object.freeze({
    state,
    speed,
    speedNorm,
    grounded: Boolean(input.grounded),
    forward,
    strafe,
    walkBlend,
    runBlend,
    sprintBlend,
    attackBlend,
    dodgeBlend,
    transitionSeconds,
    animationRate: clamp(0.85 + speedNorm * 0.65, 0.5, 1.6),
  });
}

export function stableSerializeLocomotionBlend(input) {
  return JSON.stringify(projectLocomotionBlend(input));
}

export { STATE as LOCOMOTION_STATES };
