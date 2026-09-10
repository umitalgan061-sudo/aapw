/**
 * Deterministic, read-only locomotion/combat animation blend projection.
 * Existing player.js remains authoritative for movement, state and AnimationMixer playback.
 * @module gameplay/playerLocomotionCombatBlendContract
 */

const MAX_SPEED = 12;
const MAX_WEIGHT = 1;
const STATES = new Set(['idle', 'walk', 'sprint', 'guard', 'parry', 'dodge', 'attack-light', 'attack-heavy', 'hit-stagger', 'guard-break', 'airborne']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizedState = (value) => STATES.has(value) ? value : 'idle';

export function resolvePlayerLocomotionCombatBlend(observation = {}) {
  const state = normalizedState(observation.state);
  const speedMps = clamp(Math.abs(finite(observation.speedMps)), 0, MAX_SPEED);
  const grounded = observation.grounded !== false;
  const attackKind = observation.attackKind === 'heavy' ? 'heavy' : observation.attackKind === 'light' ? 'light' : 'none';
  const guardHeld = observation.guardHeld === true;
  const dodgeActive = observation.dodgeActive === true;
  const normalizedSpeed = speedMps / MAX_SPEED;
  const locomotion = {
    idle: state === 'idle' && speedMps < 0.05 ? 1 : 0,
    walk: state === 'walk' ? clamp(normalizedSpeed * 1.35, 0, 1) : 0,
    sprint: state === 'sprint' ? clamp(normalizedSpeed, 0, 1) : 0,
  };
  const combat = {
    guard: guardHeld || state === 'guard' ? 1 : 0,
    parry: state === 'parry' ? 1 : 0,
    dodge: dodgeActive || state === 'dodge' ? 1 : 0,
    attackLight: attackKind === 'light' || state === 'attack-light' ? 1 : 0,
    attackHeavy: attackKind === 'heavy' || state === 'attack-heavy' ? 1 : 0,
    stagger: state === 'hit-stagger' ? 1 : 0,
    guardBreak: state === 'guard-break' ? 1 : 0,
  };
  const locomotionWeight = clamp(1 - Math.max(...Object.values(combat)), 0, MAX_WEIGHT);
  const result = {
    state,
    grounded,
    speedMps: Number(speedMps.toFixed(3)),
    locomotion: Object.freeze({ ...locomotion, blend: Number(locomotionWeight.toFixed(3)) }),
    combat: Object.freeze(combat),
    priority: combat.stagger ? 'stagger' : combat.guardBreak ? 'guard-break' : combat.attackHeavy ? 'attack-heavy' : combat.attackLight ? 'attack-light' : combat.dodge ? 'dodge' : combat.parry ? 'parry' : combat.guard ? 'guard' : (grounded ? (speedMps > 0.05 ? 'locomotion' : 'idle') : 'airborne'),
    ownership: Object.freeze({ movement: 'gameplay/player.js', animationPlayback: 'gameplay/player.js', projection: 'playerLocomotionCombatBlendContract' }),
  };
  return deepFreeze(result);
}

export function validatePlayerLocomotionCombatBlend(result) {
  if (!result || typeof result !== 'object') return false;
  if (!STATES.has(result.state) || !Number.isFinite(result.speedMps)) return false;
  if (!result.locomotion || !result.combat || !result.ownership) return false;
  return Object.values(result.locomotion).every((value) => Number.isFinite(value))
    && Object.values(result.combat).every((value) => value === 0 || value === 1)
    && result.locomotion.blend >= 0 && result.locomotion.blend <= 1;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
