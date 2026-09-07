/**
 * Deterministic, DOM-free equipment socket resolution for the existing player
 * presentation/runtime directors.
 *
 * This module is intentionally data-only: it does not load assets, create
 * Three.js nodes, or own inventory semantics. Callers provide the current
 * equipment snapshot and can apply the returned bindings to their existing
 * object3D hierarchy.
 */

const SOCKETS = Object.freeze([
  'head',
  'chest',
  'back',
  'mainHand',
  'offHand',
]);

const SLOT_TO_SOCKET = Object.freeze({
  helmet: 'head',
  head: 'head',
  chest: 'chest',
  armor: 'chest',
  back: 'back',
  cloak: 'back',
  weapon: 'mainHand',
  mainHand: 'mainHand',
  shield: 'offHand',
  offHand: 'offHand',
});

const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

const normalizeItem = (item, index) => {
  if (!item || typeof item !== 'object') return null;
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `item-${index}`;
  const slot = typeof item.slot === 'string' ? item.slot : '';
  const socket = SLOT_TO_SOCKET[slot] || (SOCKETS.includes(slot) ? slot : null);
  if (!socket) return null;
  return {
    id,
    socket,
    assetUrl: typeof item.assetUrl === 'string' ? item.assetUrl : null,
    stats: {
      armor: Math.max(0, finiteOr(item.stats?.armor, 0)),
      attack: Math.max(0, finiteOr(item.stats?.attack, 0)),
      poise: Math.max(0, finiteOr(item.stats?.poise, 0)),
    },
    materialProfile: typeof item.materialProfile === 'string' ? item.materialProfile : 'authored',
  };
};

export function resolvePlayerEquipmentSockets(equipment = []) {
  const bySocket = Object.fromEntries(SOCKETS.map((socket) => [socket, null]));
  const items = Array.isArray(equipment) ? equipment : [];

  items.forEach((item, index) => {
    const normalized = normalizeItem(item, index);
    if (!normalized) return;
    const previous = bySocket[normalized.socket];
    // Stable conflict rule: explicit priority wins, then lexicographically
    // smaller id. This makes replay/save-load and browser runs deterministic.
    const priority = finiteOr(item.priority, 0);
    const previousPriority = finiteOr(previous?.priority, 0);
    if (!previous || priority > previousPriority || (priority === previousPriority && normalized.id < previous.id)) {
      bySocket[normalized.socket] = { ...normalized, priority };
    }
  });

  const totals = Object.values(bySocket).reduce((sum, item) => {
    if (!item) return sum;
    return {
      armor: sum.armor + item.stats.armor,
      attack: sum.attack + item.stats.attack,
      poise: sum.poise + item.stats.poise,
    };
  }, { armor: 0, attack: 0, poise: 0 });

  return Object.freeze({
    sockets: Object.freeze(bySocket),
    totals: Object.freeze(totals),
    occupiedSockets: Object.freeze(SOCKETS.filter((socket) => bySocket[socket])),
  });
}

export function applyEquipmentSocketsToObject3D(object3D, resolved, attach = () => {}) {
  if (!object3D || !resolved?.sockets || typeof attach !== 'function') return 0;
  let attached = 0;
  for (const socket of SOCKETS) {
    const item = resolved.sockets[socket];
    if (!item) continue;
    attach(object3D, socket, item);
    attached += 1;
  }
  return attached;
}

export { SOCKETS };
