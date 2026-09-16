/**
 * Bounded runtime adapter over playerEquipmentCombatProfile.
 * Does not own inventory, scene graph, mixer, damage or material application.
 * @module gameplay/playerEquipmentCombatLoadout
 */
import {
  resolvePlayerEquipmentCombatProfile,
  resolvePlayerAttackTuning,
  resolvePlayerAnimationPlan,
  buildPlayerEquipmentSocketPlan,
  buildPlayerMaterialAssignmentMetadata,
} from './playerEquipmentCombatProfile.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
};

export function buildPlayerEquipmentCombatLoadout({
  equipment = {},
  baseAttack = {},
  attackKind = 'light',
  animation = {},
  actorRoot = null,
  material = {},
} = {}) {
  const profile = resolvePlayerEquipmentCombatProfile(equipment);
  const attack = resolvePlayerAttackTuning(baseAttack, profile, attackKind);
  const animationPlan = resolvePlayerAnimationPlan(profile, animation);
  const sockets = buildPlayerEquipmentSocketPlan(actorRoot, profile);
  const materialMetadata = buildPlayerMaterialAssignmentMetadata({ ...material, profile });
  return freezeDeep({
    version: 1,
    profile,
    attack,
    animation: animationPlan,
    sockets,
    material: materialMetadata,
    budget: {
      staminaCost: clamp(finiteOr(attack.cost, 0), 0, 80),
      reach: clamp(finiteOr(attack.reach, 0), 0, 12),
      duration: clamp(finiteOr(attack.duration, 0), 0.18, 2.5),
      poise: clamp(finiteOr(attack.armorPoiseBonus, 0), 0, 1000),
    },
  });
}

export function validatePlayerEquipmentCombatLoadout(loadout) {
  const errors = [];
  if (!loadout || loadout.version !== 1) errors.push('version');
  if (!loadout?.profile?.sourceIds?.mainHand) errors.push('mainHand');
  if (!Number.isFinite(loadout?.attack?.cost) || loadout.attack.cost < 0 || loadout.attack.cost > 80) errors.push('cost');
  if (!Number.isFinite(loadout?.attack?.reach) || loadout.attack.reach < 0.35 || loadout.attack.reach > 12) errors.push('reach');
  if (!loadout?.animation?.action) errors.push('animation');
  if (!loadout?.sockets?.bindings || !loadout?.material) errors.push('integration');
  return freezeDeep({ valid: errors.length === 0, errors });
}

export function loadoutDigest(loadout) {
  const validated = validatePlayerEquipmentCombatLoadout(loadout);
  return freezeDeep({
    valid: validated.valid,
    key: [
      loadout?.profile?.sourceIds?.mainHand,
      loadout?.profile?.sourceIds?.offHand,
      loadout?.profile?.sourceIds?.chest,
      loadout?.attack?.cost,
      loadout?.attack?.reach,
      loadout?.animation?.action,
      loadout?.animation?.family,
    ].join('|'),
  });
}
