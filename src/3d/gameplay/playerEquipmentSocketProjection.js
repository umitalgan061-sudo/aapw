/**
 * Read-only equipment socket projection over caller-owned player equipment state.
 *
 * This module does not load assets, mutate scene nodes, or replace the existing
 * equipment/player framework. It produces a deterministic attachment plan that
 * runtime owners can apply through the shared material/placement contract.
 * @module gameplay/playerEquipmentSocketProjection
 */

const SOCKETS = Object.freeze(['head', 'chest', 'back', 'main-hand', 'off-hand', 'waist', 'legs', 'feet']);
const SLOT_ALIASES = Object.freeze({
  helmet: 'head', armour: 'chest', armor: 'chest', cloak: 'back', cape: 'back',
  weapon: 'main-hand', shield: 'off-hand', boots: 'feet', greaves: 'legs'
});
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const clamp01 = value => Math.max(0, Math.min(1, finite(value, 0)));

function normalizeSocket(value) {
  const normalized = text(value).toLowerCase();
  return SOCKETS.includes(normalized) ? normalized : (SLOT_ALIASES[normalized] || 'chest');
}

function normalizeItem(item, index) {
  const id = text(item?.id, `item-${index + 1}`);
  const socket = normalizeSocket(item?.socket ?? item?.slot);
  const priority = finite(item?.priority, 0);
  const weight = clamp01(item?.weight ?? 1);
  const visible = item?.visible !== false;
  const materialRecipe = text(item?.materialRecipe, 'imported-preserve');
  return Object.freeze({
    id, socket, priority, weight, visible, materialRecipe,
    source: text(item?.source, 'caller-owned-equipment')
  });
}

function compareItems(a, b) {
  return b.priority - a.priority || b.weight - a.weight || a.id.localeCompare(b.id);
}

export function projectPlayerEquipmentSockets({
  items = [],
  activeSocket = null,
  grounded = true,
  placementConfidence = 1,
  sharedMaterialCore = 'merged-590'
} = {}) {
  const normalized = Array.isArray(items) ? items.map(normalizeItem) : [];
  const bySocket = new Map(SOCKETS.map(socket => [socket, []]));
  for (const item of normalized) bySocket.get(item.socket).push(item);
  const sockets = SOCKETS.map(socket => {
    const candidates = bySocket.get(socket).filter(item => item.visible).sort(compareItems);
    const selected = candidates[0] || null;
    return Object.freeze({
      socket,
      selected,
      candidateIds: Object.freeze(candidates.map(item => item.id)),
      occupied: Boolean(selected),
      grounded: Boolean(grounded),
      placementConfidence: clamp01(placementConfidence)
    });
  });
  const requested = activeSocket == null ? null : normalizeSocket(activeSocket);
  const active = sockets.find(entry => entry.socket === requested) || null;
  const result = {
    version: 1,
    sockets: Object.freeze(sockets),
    activeSocket: active?.socket ?? null,
    activeItemId: active?.selected?.id ?? null,
    equippedCount: normalized.filter(item => item.visible).length,
    sharedMaterialCore: text(sharedMaterialCore, 'merged-590'),
    materialPlacementSequence: Object.freeze([
      'hydrate-or-verify-caller-owned-asset',
      'analyze-mesh-material-slots',
      'select-named-part-or-layered-recipe',
      'validate-material-assignment',
      'apply-grounded-socket-transform',
      'record-manifest',
      'attach-through-runtime-owner'
    ])
  };
  return Object.freeze(result);
}

export function validatePlayerEquipmentSocketProjection(projection) {
  if (!projection || projection.version !== 1 || !Array.isArray(projection.sockets)) return false;
  if (projection.sockets.length !== SOCKETS.length) return false;
  return projection.sockets.every(entry => SOCKETS.includes(entry.socket)
    && Array.isArray(entry.candidateIds)
    && typeof entry.occupied === 'boolean'
    && Number.isFinite(entry.placementConfidence)
    && entry.placementConfidence >= 0 && entry.placementConfidence <= 1);
}

export { SOCKETS };
