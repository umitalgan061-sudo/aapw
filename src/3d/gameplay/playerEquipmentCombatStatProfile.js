/**
 * Deterministic read-only combat stat projection over the existing equipment/loadout snapshot.
 * The caller remains authoritative for inventory, sockets, scene attachment and mutation.
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;

const ROLE_DEFAULTS = Object.freeze({
  weapon: Object.freeze({ damage: 0, armor: 0, poise: 0, weight: 0, reachMeters: 0 }),
  armor: Object.freeze({ damage: 0, armor: 0, poise: 0, weight: 0, reachMeters: 0 }),
  accessory: Object.freeze({ damage: 0, armor: 0, poise: 0, weight: 0, reachMeters: 0 }),
});

function normalizeItem(item) {
  const role = ['weapon', 'armor', 'accessory'].includes(item?.role) ? item.role : 'accessory';
  const defaults = ROLE_DEFAULTS[role];
  return Object.freeze({
    id: text(item?.id, 'unknown-item'),
    role,
    damage: clamp(finite(item?.damage, defaults.damage), 0, 500),
    armor: clamp(finite(item?.armor, defaults.armor), 0, 500),
    poise: clamp(finite(item?.poise, defaults.poise), 0, 250),
    weight: clamp(finite(item?.weight, defaults.weight), 0, 100),
    reachMeters: clamp(finite(item?.reachMeters, defaults.reachMeters), 0, 8),
    ready: item?.ready !== false,
  });
}

function stableItems(items) {
  return [...(Array.isArray(items) ? items : [])]
    .map(normalizeItem)
    .sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id));
}

export function buildPlayerEquipmentCombatStatProfile(snapshot = {}) {
  const items = stableItems(snapshot.items);
  const totals = items.reduce((acc, item) => {
    acc.damage += item.damage;
    acc.armor += item.armor;
    acc.poise += item.poise;
    acc.weight += item.weight;
    acc.reachMeters = Math.max(acc.reachMeters, item.reachMeters);
    return acc;
  }, { damage: 0, armor: 0, poise: 0, weight: 0, reachMeters: 0 });
  const capacity = clamp(finite(snapshot.capacity, 40), 1, 200);
  const encumbrance = clamp(totals.weight / capacity, 0, 1);
  const weapon = items.find((item) => item.role === 'weapon' && item.ready) ?? null;
  const readiness = items.length === 0 ? 'empty' : items.every((item) => item.ready) ? 'ready' : 'partial';
  const profile = {
    schema: 'player-equipment-combat-stat-profile/v1',
    items,
    totals: Object.freeze({
      damage: Number(totals.damage.toFixed(3)),
      armor: Number(totals.armor.toFixed(3)),
      poise: Number(totals.poise.toFixed(3)),
      weight: Number(totals.weight.toFixed(3)),
      reachMeters: Number(totals.reachMeters.toFixed(3)),
    }),
    capacity,
    encumbrance: Number(encumbrance.toFixed(4)),
    movementPenalty: Number((encumbrance * encumbrance).toFixed(4)),
    readiness,
    weaponId: weapon?.id ?? null,
    assetReadyCount: items.filter((item) => item.ready).length,
    assetMissingCount: items.filter((item) => !item.ready).length,
  };
  return Object.freeze(profile);
}

export function serializePlayerEquipmentCombatStatProfile(profile) {
  return JSON.stringify(profile);
}
