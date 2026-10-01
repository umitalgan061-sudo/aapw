/**
 * Deterministic, read-only equipment stat sheet for existing player combat consumers.
 * The authoritative equipment/combat profile remains the source of weapon/armor data;
 * this adapter only projects bounded totals and capability flags.
 * @module gameplay/playerEquipmentStatSheet
 */
import { resolvePlayerEquipmentCombatProfile } from './playerEquipmentCombatProfile.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeId = (value, fallback) => {
  const id = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').slice(0, 96);
  return id || fallback;
};
const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
};

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function buildPlayerEquipmentStatSheet(equipment = {}, options = {}) {
  const profile = resolvePlayerEquipmentCombatProfile(equipment, options);
  const weapon = profile?.weapon ?? {};
  const armor = profile?.armor ?? {};
  const base = profile?.baseStats ?? {};
  const staminaMax = clamp(finiteOr(base.staminaMax, 100), 1, 1000);
  const healthMax = clamp(finiteOr(base.healthMax, 100), 1, 1000);
  const poiseMax = clamp(finiteOr(base.poiseMax, 100), 0, 1000);
  const damage = clamp(finiteOr(weapon.damageMultiplier, 1) * 100, 0, 1000);
  const reach = clamp(finiteOr(weapon.reachMultiplier, 1), 0.1, 10);
  const mobility = clamp(finiteOr(armor.movementMultiplier, 1), 0.1, 2);
  const staminaDrain = clamp(finiteOr(armor.staminaDrainMultiplier, 1) * finiteOr(weapon.staminaMultiplier, 1), 0.1, 4);
  const poise = clamp(poiseMax + finiteOr(armor.poiseBonus, 0), 0, 1000);
  const ranged = weapon.projectile === true;
  const twoHanded = weapon.twoHanded === true;
  const sheet = {
    schema: 'player-equipment-stat-sheet/v1',
    weaponId: normalizeId(profile?.weaponId, 'unarmed'),
    armorId: normalizeId(profile?.armorId, 'unarmored'),
    weaponFamily: normalizeId(weapon.animationFamily, 'unarmed'),
    armorFamily: normalizeId(armor.animationFamily, 'unarmored'),
    stats: {
      healthMax,
      staminaMax,
      poiseMax: poise,
      damage,
      reach,
      mobility,
      staminaDrain,
      guardDamageMultiplier: clamp(finiteOr(armor.guardDamageMultiplier, 1), 0.1, 2),
      dodgeDistanceMultiplier: clamp(finiteOr(armor.dodgeDistanceMultiplier, 1), 0.1, 2),
    },
    capabilities: {
      ranged,
      melee: !ranged,
      twoHanded,
      canGuard: true,
      canParry: !ranged,
      canDodge: mobility > 0.2,
    },
    materialIntent: {
      surfaces: Array.isArray(armor.materialSurfaces) ? armor.materialSurfaces.slice(0, 8) : [],
      sharedValidationRequired: true,
      editorRuntimeImportForbidden: true,
    },
  };
  return freezeDeep(sheet);
}

export function serializePlayerEquipmentStatSheet(sheet) {
  return stableStringify(sheet ?? {});
}

export function digestPlayerEquipmentStatSheet(sheet) {
  const serialized = serializePlayerEquipmentStatSheet(sheet);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
