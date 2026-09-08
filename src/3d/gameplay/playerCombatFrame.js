/**
 * Deterministic combat frame over the existing player/equipment authorities.
 * No scene mutation, inventory ownership, or second combat state machine.
 * @module gameplay/playerCombatFrame
 */
import { resolvePlayerAnimationPlan, resolvePlayerAttackTuning, resolvePlayerEquipmentCombatProfile } from './playerEquipmentCombatProfile.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(v)) ? Number(v) : min));
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const freeze = (v) => Object.freeze(v);
const vec = (v = {}) => freeze({ x: finite(v.x), y: finite(v.y), z: finite(v.z) });

export function createPlayerCombatFrame(input = {}) {
  const motion = input.motion ?? input.player?.getMotionState?.() ?? {};
  const equipment = resolvePlayerEquipmentCombatProfile(input.equipment ?? {});
  const attackKind = motion.attackKind === 'heavy' ? 'heavy' : motion.attackKind === 'light' ? 'light' : 'none';
  const tuning = attackKind === 'none' ? null : resolvePlayerAttackTuning(input.attackBase, equipment, attackKind);
  const state = typeof motion.state === 'string' ? motion.state : 'idle';
  const active = Boolean(motion.attackActive) && Boolean(tuning);
  const progress = tuning ? clamp(finite(motion.attackProgress, finite(motion.attackElapsed) / tuning.duration), 0, 1) : 0;
  const hitbox = active ? freeze({ enabled: true, shape: 'capsule', origin: vec(motion.position), radius: clamp(tuning.reach * 0.18, 0.12, 0.5), length: clamp(tuning.reach, 0.35, 12), damageScale: tuning.damageScale, guardBreakMultiplier: tuning.guardBreakMultiplier }) : freeze({ enabled: false, shape: 'capsule', origin: vec(motion.position), radius: 0, length: 0, damageScale: 0, guardBreakMultiplier: 0 });
  const hurtbox = freeze({ enabled: true, shape: 'capsule', origin: vec(motion.position), radius: clamp(finite(input.hurtbox?.radius, 0.38), 0.2, 1.2), height: clamp(finite(input.hurtbox?.height, 1.8), 0.8, 3.2), invulnerable: Boolean(motion.isDodgeInvulnerable) });
  const animation = resolvePlayerAnimationPlan(equipment, { movementState: state, attackKind, comboStep: motion.attackComboStep, speedMps: motion.speedMps, grounded: motion.isGrounded !== false });
  return freeze({
    version: 1,
    state,
    attack: freeze({ kind: attackKind, active, progress, tuning }),
    hitbox,
    hurtbox,
    guard: freeze({ guarding: Boolean(motion.guarding), parryWindowSeconds: Math.max(0, finite(motion.parryWindowRemaining)), poise: Math.max(0, finite(motion.poise)), maxPoise: Math.max(1, finite(motion.maxPoise, 100)) }),
    lockOn: freeze({ id: typeof input.target?.id === 'string' && input.target.id.trim() ? input.target.id.trim() : null, locked: Boolean(input.target?.locked), distanceMeters: input.target?.id ? Math.max(0, finite(input.target.distanceMeters)) : null }),
    animation,
    equipmentRevisionKey: animation.equipmentRevisionKey,
  });
}

export function serializePlayerCombatFrame(input = {}) {
  return JSON.stringify(createPlayerCombatFrame(input));
}

export function validatePlayerCombatFrame(frame) {
  const f = frame && typeof frame === 'object' ? frame : {};
  const valid = f.version === 1 && Boolean(f.hitbox?.enabled !== undefined) && Boolean(f.hurtbox?.enabled) && typeof f.animation?.action === 'string' && Number.isFinite(f.attack?.progress);
  return freeze({ valid, deterministicShape: valid && f.attack.progress >= 0 && f.attack.progress <= 1, readOnly: true });
}
