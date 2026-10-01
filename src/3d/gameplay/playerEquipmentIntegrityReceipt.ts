/**
 * Deterministic equipment-loadout integrity receipt for the shipped player authority.
 * This is an observation-only contract: player.ts, inventory and socket mutation remain authoritative.
 */
import { resolvePlayerEquipmentCombatProfile } from './playerEquipmentCombatProfile.ts';

const SLOT_ORDER = Object.freeze(['head', 'chest', 'back', 'mainHand', 'offHand']);
const SURFACE_ORDER = Object.freeze(['skin', 'hair', 'eye', 'cloth', 'leather', 'metal', 'boot', 'weapon']);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value) => typeof value === 'string' ? value.trim() : '';
const uniqueSorted = (values) => Object.freeze([...new Set(values.filter(Boolean))].sort());

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freeze(nested);
  return Object.freeze(value);
}

export function resolvePlayerEquipmentIntegrityReceipt(input = {}) {
  const profile = input?.mainHand ? input : resolvePlayerEquipmentCombatProfile(input.equipment || input);
  const sourceIds = profile?.sourceIds && typeof profile.sourceIds === 'object' ? profile.sourceIds : {};
  const missingSlots = SLOT_ORDER.filter((slot) => !text(sourceIds[slot]));
  const occupiedSlots = SLOT_ORDER.filter((slot) => text(sourceIds[slot]));
  const materialSurfaces = uniqueSorted([
    ...(Array.isArray(profile?.mainHand?.materialSurfaces) ? profile.mainHand.materialSurfaces : []),
    ...(Array.isArray(profile?.armor?.materialSurfaces) ? profile.armor.materialSurfaces : []),
  ].map((surface) => text(surface)).filter((surface) => SURFACE_ORDER.includes(surface)));

  const errors = [];
  const warnings = [];
  if (!text(sourceIds.mainHand)) errors.push('missing-main-hand');
  if (profile?.ranged && !text(sourceIds.back)) warnings.push('ranged-back-socket-unresolved');
  if (profile?.twoHanded && text(sourceIds.offHand)) errors.push('two-handed-offhand-conflict');
  if (profile?.shieldEquipped && profile?.ranged) errors.push('shield-ranged-conflict');
  if (finite(profile?.mainHand?.damageMultiplier, 0) <= 0) errors.push('non-positive-weapon-damage');
  if (finite(profile?.armor?.movementMultiplier, 0) <= 0) errors.push('non-positive-movement-multiplier');
  if (materialSurfaces.length === 0) warnings.push('no-named-material-surfaces');
  if (materialSurfaces.length === 1) warnings.push('single-material-surface');

  const status = errors.length > 0 ? 'invalid' : warnings.length > 0 ? 'degraded' : 'ready';
  const canonical = [
    status,
    occupiedSlots.join(','),
    missingSlots.join(','),
    materialSurfaces.join(','),
    errors.join(','),
    warnings.join(','),
    Boolean(profile?.ranged),
    Boolean(profile?.twoHanded),
    Boolean(profile?.shieldEquipped),
  ].join('|');

  return freeze({
    version: 1,
    status,
    ready: status === 'ready',
    occupiedSlots: Object.freeze(occupiedSlots),
    missingSlots: Object.freeze(missingSlots),
    materialSurfaces,
    ranged: Boolean(profile?.ranged),
    twoHanded: Boolean(profile?.twoHanded),
    shieldEquipped: Boolean(profile?.shieldEquipped),
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    receiptKey: `equipment-integrity:${canonical}`,
  });
}

export function isPlayerEquipmentIntegrityReceipt(value) {
  return Boolean(value && value.version === 1 && ['ready', 'degraded', 'invalid'].includes(value.status)
    && Array.isArray(value.occupiedSlots) && Array.isArray(value.missingSlots)
    && Array.isArray(value.materialSurfaces) && Array.isArray(value.errors) && Array.isArray(value.warnings)
    && typeof value.receiptKey === 'string');
}
