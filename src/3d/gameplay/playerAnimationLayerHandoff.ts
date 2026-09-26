/** Observation-only animation handoff over the shipped equipment profile authority. */
import { resolvePlayerEquipmentCombatProfile, resolvePlayerAnimationPlan } from './playerEquipmentCombatProfile.ts';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const PHASES = Object.freeze(['idle', 'windup', 'active', 'recovery', 'defense', 'dodge', 'hit-stagger']);

function normalizePhase(motion = {}, attack = {}) {
  if (motion.state === 'dodge') return 'dodge';
  if (motion.state === 'parry' || motion.state === 'guard' || motion.state === 'guard-break') return 'defense';
  if (motion.state === 'hit-stagger') return 'hit-stagger';
  if (attack.attackPhase && attack.attackPhase !== 'none') return String(attack.attackPhase);
  if (String(motion.state || '').startsWith('attack-')) return 'windup';
  return 'idle';
}

function normalizeAttackKind(attack = {}, motion = {}) {
  const value = attack.kind ?? motion.attackKind;
  return value === 'heavy' ? 'heavy' : value === 'light' ? 'light' : 'none';
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function composePlayerAnimationLayerHandoff({
  equipment = {},
  motion = {},
  attack = {},
  now = 0,
} = {}) {
  const profile = resolvePlayerEquipmentCombatProfile(equipment);
  const phase = normalizePhase(motion, attack);
  const attackKind = normalizeAttackKind(attack, motion);
  const comboStep = clamp(Math.floor(finite(attack.comboStep ?? motion.attackComboStep, 0)), 0, 3);
  const grounded = Boolean(attack.grounded ?? motion.isGrounded ?? true);
  const speedMps = clamp(Math.max(0, finite(motion.speedMps, 0)), 0, 30);
  const plan = resolvePlayerAnimationPlan(profile, {
    movementState: motion.state || 'idle',
    attackKind,
    comboStep,
    speedMps,
    grounded,
  });
  const locomotionWeight = phase === 'idle' || phase === 'dodge' || phase === 'hit-stagger' ? 1 : 0;
  const attackWeight = attackKind === 'none' ? 0 : clamp(0.84 + Math.max(0, comboStep - 1) * 0.08, 0, 1);
  const defenseWeight = phase === 'defense' ? 1 : 0;
  return deepFreeze({
    version: 1,
    timestamp: Math.max(0, finite(now, 0)),
    phase: PHASES.includes(phase) ? phase : 'idle',
    attackKind,
    comboStep,
    grounded,
    plan,
    layers: {
      locomotion: { action: plan.action, weight: locomotionWeight },
      attack: { action: attackKind === 'none' ? null : plan.action, weight: attackWeight },
      defense: { action: phase === 'defense' ? plan.action : null, weight: defenseWeight },
    },
    blend: {
      crossfadeSeconds: phase === 'dodge' ? 0.06 : attackKind === 'heavy' ? 0.12 : 0.1,
      locomotionPreserved: locomotionWeight > 0 && grounded,
      rootMotionAllowed: phase === 'active' && grounded && attackKind !== 'none',
    },
    equipmentRevisionKey: plan.equipmentRevisionKey,
  });
}

export function isPlayerAnimationLayerHandoff(value) {
  return Boolean(
    value &&
    value.version === 1 &&
    PHASES.includes(value.phase) &&
    value.plan &&
    value.layers &&
    value.blend &&
    typeof value.equipmentRevisionKey === 'string'
  );
}
