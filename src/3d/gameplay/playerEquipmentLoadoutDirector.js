const DEFAULT_SOCKETS = Object.freeze(['head', 'chest', 'hands', 'legs', 'mainHand', 'offHand']);

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const idOf = (value, fallback) => {
  const id = typeof value === 'string' ? value.trim() : '';
  return id || fallback;
};

const normalizeItem = (item, index) => {
  const source = item && typeof item === 'object' ? item : {};
  const stats = source.stats && typeof source.stats === 'object' ? source.stats : {};
  const socket = idOf(source.socket, 'unslotted');
  return {
    id: idOf(source.id, `item-${index + 1}`),
    socket,
    slot: idOf(source.slot, socket),
    category: idOf(source.category, 'misc'),
    assetKey: idOf(source.assetKey, ''),
    enabled: source.enabled !== false,
    stats: {
      armor: clamp(finite(stats.armor), 0, 10000),
      damage: clamp(finite(stats.damage), 0, 10000),
      poise: clamp(finite(stats.poise), 0, 10000),
      weight: clamp(finite(stats.weight), 0, 1000)
    }
  };
};

export function buildPlayerEquipmentLoadout(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const sockets = Array.isArray(source.sockets) && source.sockets.length
    ? source.sockets.map((socket, index) => idOf(socket, `socket-${index + 1}`))
    : [...DEFAULT_SOCKETS];
  const items = Array.isArray(source.items) ? source.items.map(normalizeItem) : [];
  const equipped = new Map();
  const rejected = [];

  for (const item of items) {
    if (!item.enabled || !sockets.includes(item.socket)) {
      rejected.push({ id: item.id, reason: !item.enabled ? 'disabled' : 'unknown-socket' });
      continue;
    }
    if (equipped.has(item.socket)) {
      rejected.push({ id: item.id, reason: 'socket-occupied' });
      continue;
    }
    equipped.set(item.socket, item);
  }

  const ordered = sockets.map((socket) => equipped.get(socket) || null);
  const totals = ordered.reduce((acc, item) => {
    if (!item) return acc;
    acc.armor += item.stats.armor;
    acc.damage += item.stats.damage;
    acc.poise += item.stats.poise;
    acc.weight += item.stats.weight;
    return acc;
  }, { armor: 0, damage: 0, poise: 0, weight: 0 });

  const result = {
    sockets: [...sockets],
    slots: ordered.map((item, index) => ({ socket: sockets[index], item })),
    rejected,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value.toFixed(4))])),
    encumbrance: clamp(totals.weight / 100, 0, 1),
    assetReadiness: ordered.reduce((count, item) => count + (item && item.assetKey ? 1 : 0), 0) / Math.max(1, ordered.filter(Boolean).length)
  };

  return deepFreeze(result);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function serializePlayerEquipmentLoadout(loadout) {
  return JSON.stringify(loadout && typeof loadout === 'object' ? loadout : buildPlayerEquipmentLoadout());
}

export const PLAYER_EQUIPMENT_DEFAULT_SOCKETS = DEFAULT_SOCKETS;
