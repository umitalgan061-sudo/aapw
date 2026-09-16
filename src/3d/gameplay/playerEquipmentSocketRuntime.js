const SOCKETS = Object.freeze(['head', 'chest', 'hands', 'legs', 'feet', 'mainHand', 'offHand', 'back']);
const EQUIPMENT_KINDS = Object.freeze(['armor', 'weapon', 'shield', 'accessory', 'mount']);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const text = (value, fallback = '') => String(value ?? fallback).trim() || fallback;
const stableKey = (value, fallback = 'item') => text(value, fallback).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');

const normalizeItem = (item, index) => {
  const id = stableKey(item?.id, `item-${index + 1}`);
  const kind = EQUIPMENT_KINDS.includes(item?.kind) ? item.kind : 'accessory';
  const socket = SOCKETS.includes(item?.socket) ? item.socket : null;
  const stats = item?.stats && typeof item.stats === 'object' ? item.stats : {};
  return Object.freeze({
    id,
    kind,
    socket,
    asset: text(item?.asset, ''),
    materialManifestId: text(item?.materialManifestId, ''),
    stats: Object.freeze({
      armor: clamp(stats.armor, 0, 999),
      attack: clamp(stats.attack, 0, 999),
      poise: clamp(stats.poise, 0, 999),
      weight: clamp(stats.weight, 0, 999),
    }),
    sourceIndex: index,
  });
};

const fallbackSocketFor = (kind) => ({ armor: 'chest', weapon: 'mainHand', shield: 'offHand', mount: 'back', accessory: 'hands' })[kind] ?? 'hands';

export function resolvePlayerEquipmentSocketRuntime({
  equipment = [],
  preferredSockets = {},
  maxItems = 16,
  requireMaterialManifest = false,
} = {}) {
  const normalized = Array.isArray(equipment) ? equipment.slice(0, Math.max(0, Math.floor(finite(maxItems, 16)))) : [];
  const occupied = new Set();
  const slots = {};
  const rejected = [];

  normalized.forEach((raw, index) => {
    const item = normalizeItem(raw, index);
    const preferred = SOCKETS.includes(preferredSockets[item.id]) ? preferredSockets[item.id] : null;
    const socket = item.socket ?? preferred ?? fallbackSocketFor(item.kind);
    const validMaterial = !requireMaterialManifest || item.materialManifestId.length > 0;
    if (!validMaterial || occupied.has(socket)) {
      rejected.push(Object.freeze({ id: item.id, reason: !validMaterial ? 'missing-material-manifest' : 'socket-occupied', socket }));
      return;
    }
    occupied.add(socket);
    slots[socket] = Object.freeze({
      itemId: item.id,
      kind: item.kind,
      asset: item.asset,
      materialManifestId: item.materialManifestId,
      stats: item.stats,
    });
  });

  const totals = Object.values(slots).reduce((sum, slot) => ({
    armor: sum.armor + slot.stats.armor,
    attack: sum.attack + slot.stats.attack,
    poise: sum.poise + slot.stats.poise,
    weight: sum.weight + slot.stats.weight,
  }), { armor: 0, attack: 0, poise: 0, weight: 0 });

  return Object.freeze({
    slots: Object.freeze({ ...slots }),
    occupiedSockets: Object.freeze([...occupied].sort()),
    rejected: Object.freeze(rejected),
    totals: Object.freeze(totals),
    manifestValidation: Object.freeze({
      required: Boolean(requireMaterialManifest),
      missing: rejected.filter((entry) => entry.reason === 'missing-material-manifest').length,
    }),
  });
}

export function validatePlayerEquipmentSocketRuntime(result) {
  if (!result || typeof result !== 'object') return false;
  if (!Array.isArray(result.occupiedSockets) || result.occupiedSockets.some((socket) => !SOCKETS.includes(socket))) return false;
  if (!Array.isArray(result.rejected)) return false;
  if (!result.totals || Object.values(result.totals).some((value) => !Number.isFinite(value) || value < 0)) return false;
  const socketIds = Object.keys(result.slots ?? {});
  return socketIds.every((socket) => SOCKETS.includes(socket)) && new Set(socketIds).size === socketIds.length;
}

export { SOCKETS, EQUIPMENT_KINDS };
