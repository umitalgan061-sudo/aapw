/**
 * Production adapter that composes the existing input, equipment and animation contracts
 * into one immutable player combat frame. It owns no movement, collision, health or inventory.
 */
import { resolvePlayerEquipmentCombatProfile } from './playerEquipmentCombatProfile.ts';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const finiteOr = (value: unknown, fallback: number): number => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeKind = (value: unknown): 'none' | 'light' | 'heavy' => value === 'heavy' || value === 'light' ? value : 'none';

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  return Object.freeze(value);
}

export type PlayerCombatFrameInput = {
  timestamp?: number;
  revision?: number;
  input?: Record<string, unknown>;
  equipment?: Record<string, unknown>;
  motion?: Record<string, unknown>;
  attack?: Record<string, unknown>;
  animation?: Record<string, unknown>;
  outcome?: Record<string, unknown> | null;
};

export function composePlayerCombatFrame({
  timestamp = 0,
  revision = 0,
  input = {},
  equipment = {},
  motion = {},
  attack = {},
  animation = {},
  outcome = null,
}: PlayerCombatFrameInput = {}) {
  const equipmentProfile = resolvePlayerEquipmentCombatProfile(equipment);
  const moveX = clamp(finiteOr(input.moveX, 0), -1, 1);
  const moveZ = clamp(finiteOr(input.moveZ, 0), -1, 1);
  const moveMagnitude = clamp(finiteOr(input.moveMagnitude, Math.hypot(moveX, moveZ)), 0, 1);
  const staminaRatio = clamp(finiteOr(motion.staminaRatio, 1), 0, 1);
  const poiseRatio = clamp(finiteOr(motion.poiseRatio, 1), 0, 1);
  const attackKind = normalizeKind(attack.kind);
  const comboStep = Math.max(0, Math.floor(finiteOr(attack.comboStep, 0)));
  const animationState = String(animation.state ?? motion.state ?? 'idle');
  const weapon = equipmentProfile?.mainHand ?? {};
  const armor = equipmentProfile?.armor ?? {};
  const sourceIds = equipmentProfile?.sourceIds ?? {};
  const materialSurfaces = Array.isArray(armor.materialSurfaces) ? [...armor.materialSurfaces] : [];
  const frame = {
    timestamp: finiteOr(timestamp, 0),
    revision: Math.max(0, Math.floor(finiteOr(revision, 0))),
    input: {
      moveX,
      moveZ,
      moveMagnitude,
      sprint: Boolean(input.sprint),
      guard: Boolean(input.guard),
      dodge: Boolean(input.dodge),
      lockOn: Boolean(input.lockOn),
      lightAttack: Boolean(input.lightAttack),
      heavyAttack: Boolean(input.heavyAttack),
    },
    motion: {
      state: String(motion.state ?? 'idle'),
      planarSpeedMps: Math.max(0, finiteOr(motion.planarSpeedMps, 0)),
      staminaRatio,
      poiseRatio,
      grounded: motion.grounded !== false,
    },
    combat: {
      attackKind,
      comboStep,
      active: Boolean(attack.active),
      weaponId: String(weapon.id ?? 'unarmed'),
      weaponAnimationFamily: String(weapon.animationFamily ?? 'unarmed'),
      armorId: String(armor.id ?? 'unarmored'),
      armorAnimationFamily: String(armor.animationFamily ?? 'unarmored'),
      projectile: Boolean(weapon.projectile),
      ranged: Boolean(equipmentProfile?.ranged),
      shieldEquipped: Boolean(equipmentProfile?.shieldEquipped),
      twoHanded: Boolean(equipmentProfile?.twoHanded || weapon.twoHanded),
      sourceIds: {
        mainHand: String(sourceIds.mainHand ?? 'unarmed'),
        offHand: String(sourceIds.offHand ?? 'none'),
        chest: String(sourceIds.chest ?? 'unarmored'),
      },
      materialSurfaces,
    },
    animation: {
      state: animationState,
      transition: String(animation.transition ?? 'stable'),
      locomotionWeight: clamp(finiteOr(animation.locomotionWeight, moveMagnitude), 0, 1),
      attackWeight: clamp(finiteOr(animation.attackWeight, attackKind === 'none' ? 0 : 1), 0, 1),
      footPlantWeight: clamp(finiteOr(animation.footPlantWeight, 1), 0, 1),
      environmentValid: animation.environmentValid !== false,
    },
    outcome: outcome ? { ...outcome } : null,
  };
  return freezeDeep(frame);
}

export function isPlayerCombatFrame(value: unknown): boolean {
  const frame = value as Record<string, any> | null;
  return Boolean(
    frame &&
    Object.isFrozen(frame) &&
    frame.input && Object.isFrozen(frame.input) &&
    frame.motion && Object.isFrozen(frame.motion) &&
    frame.combat && Object.isFrozen(frame.combat) &&
    frame.animation && Object.isFrozen(frame.animation) &&
    typeof frame.revision === 'number' &&
    typeof frame.combat.weaponId === 'string' &&
    typeof frame.combat.armorId === 'string' &&
    Array.isArray(frame.combat.materialSurfaces)
  );
}