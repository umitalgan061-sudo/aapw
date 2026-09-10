/**
 * Deterministic read-only equipment/loadout projection for settlement UX.
 * Existing runtime remains authoritative for inventory/equipment mutation.
 */
export const SETTLEMENT_EQUIPMENT_LOADOUT_VERSION = 1;
const LIMITS = Object.freeze({ slots: 16, items: 96, text: 96 });
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, LIMITS.text) : fallback;
};
const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const integer = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Math.trunc(finite(value, fallback))));
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const stable = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const digest = (value) => {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const freeze = (value) => Object.freeze(value);

function normalizeSlots(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(Object.entries(source).slice(0, LIMITS.slots).map(([slot, itemId]) => [text(slot), text(itemId)]));
}
function normalizeInventory(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(Object.entries(source).slice(0, LIMITS.items).map(([itemId, quantity]) => [text(itemId), integer(quantity, 0, 9999, 0)]));
}
function normalizeCatalog(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(Object.entries(source).slice(0, LIMITS.items).map(([itemId, item]) => {
    const record = item && typeof item === 'object' ? item : {};
    return [text(itemId), { label: text(record.label, text(itemId)), slot: text(record.slot, 'misc'), weight: Math.max(0, finite(record.weight, 0)), value: Math.max(0, integer(record.value, 0, 999999, 0)), equipped: Boolean(record.equipped) }];
  }));
}

export function buildSettlementEquipmentLoadout(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const inventory = normalizeInventory(source.inventory);
  const slots = normalizeSlots(source.equipment);
  const catalog = normalizeCatalog(source.catalog);
  const rows = [];
  let equippedWeight = 0;
  let equippedValue = 0;
  for (const [slot, itemId] of Object.entries(slots)) {
    const item = catalog[itemId] ?? { label: itemId || 'Boş', slot, weight: 0, value: 0, equipped: Boolean(itemId) };
    const quantity = itemId ? inventory[itemId] ?? 0 : 0;
    if (itemId) { equippedWeight += item.weight; equippedValue += item.value; }
    rows.push(freeze({ slot, itemId, label: item.label, quantity, weight: item.weight, value: item.value, missing: Boolean(itemId && quantity < 1), available: Boolean(itemId && quantity > 0) }));
  }
  const carriedWeight = Math.max(0, finite(source.carryWeight, 0));
  const maxCarryWeight = Math.max(1, finite(source.maxCarryWeight, 24));
  const ratio = Math.min(1, carriedWeight / maxCarryWeight);
  const output = {
    version: SETTLEMENT_EQUIPMENT_LOADOUT_VERSION,
    settlementId: text(source.settlementId, 'settlement'),
    slots: rows,
    summary: {
      slotCount: rows.length,
      equippedCount: rows.filter((row) => row.itemId).length,
      missingCount: rows.filter((row) => row.missing).length,
      equippedWeight: Number(equippedWeight.toFixed(3)),
      equippedValue,
      carriedWeight: Number(carriedWeight.toFixed(3)),
      maxCarryWeight: Number(maxCarryWeight.toFixed(3)),
      carryRatio: Number(ratio.toFixed(4)),
      encumbered: carriedWeight >= maxCarryWeight,
    },
    nextAction: rows.find((row) => row.missing)?.slot ? `restock:${rows.find((row) => row.missing).slot}` : (rows.find((row) => !row.itemId)?.slot ? `equip:${rows.find((row) => !row.itemId).slot}` : 'continue'),
  };
  const frozen = freeze(output);
  return freeze({ ...frozen, fingerprint: digest(frozen), stable: stable(frozen) });
}

export function applySettlementEquipmentLoadout(target, projection) {
  if (!target || typeof target !== 'object') return false;
  target.settlementEquipmentLoadout = clone(projection);
  return true;
}
