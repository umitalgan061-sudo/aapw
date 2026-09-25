/**
 * Deterministic equipment identity helper for the existing player equipment/combat runtime.
 *
 * This is an observation-only compatibility boundary: it does not own equipment state,
 * sockets, scene mutation, or material assignment. Consumers can use it to avoid false
 * refreshes when provider object key order changes.
 */

const EQUIPMENT_KEYS = Object.freeze([
  'head',
  'chest',
  'back',
  'mainHand',
  'offHand',
  'helmet',
  'weapon',
  'shield',
]);

export function buildPlayerEquipmentIdentity(equipment = {}) {
  return EQUIPMENT_KEYS
    .map((key) => `${key}:${equipment?.[key] == null ? '' : String(equipment[key])}`)
    .join('|');
}

export function hasPlayerEquipmentChanged(previous = {}, next = {}) {
  return buildPlayerEquipmentIdentity(previous) !== buildPlayerEquipmentIdentity(next);
}

export function isPlayerEquipmentIdentity(value) {
  return typeof value === 'string' && value.split('|').length === EQUIPMENT_KEYS.length;
}
