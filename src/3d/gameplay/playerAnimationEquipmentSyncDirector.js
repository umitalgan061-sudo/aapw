const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
};

const LAYER_ORDER = ['locomotion', 'upperBody', 'defense', 'reaction'];
const DEFAULT_SOCKET_BY_SLOT = Object.freeze({
  mainHand: 'mixamorigRightHand',
  offHand: 'mixamorigLeftHand',
  back: 'mixamorigSpine2',
  head: 'mixamorigHead',
});

function normalizeLayer(layer, index) {
  const id = text(layer?.id, `layer-${index}`);
  const family = text(layer?.family, id);
  const clip = text(layer?.clip, 'idle');
  return {
    id,
    family,
    clip,
    weight: clamp(layer?.weight, 0, 1),
    additive: Boolean(layer?.additive),
    enabled: layer?.enabled !== false,
    priority: clamp(layer?.priority, 0, 100),
  };
}

function normalizeEquipment(item, index) {
  const slot = text(item?.slot, `slot-${index}`);
  const socket = text(item?.socket, DEFAULT_SOCKET_BY_SLOT[slot] || 'root');
  return {
    id: text(item?.id, `${slot}-${index}`),
    slot,
    socket,
    visible: item?.visible !== false,
    weight: clamp(item?.weight, 0, 250),
    handedness: text(item?.handedness, slot === 'offHand' ? 'left' : slot === 'mainHand' ? 'right' : 'none'),
    weaponClass: text(item?.weaponClass, 'utility'),
    ready: item?.ready !== false,
  };
}

function dedupeLayers(layers) {
  const byFamily = new Map();
  for (const layer of layers) {
    if (!layer.enabled) continue;
    const current = byFamily.get(layer.family);
    if (!current || layer.priority > current.priority || (layer.priority === current.priority && layer.id < current.id)) byFamily.set(layer.family, layer);
  }
  return [...byFamily.values()].sort((a, b) => a.priority - b.priority || a.family.localeCompare(b.family) || a.id.localeCompare(b.id));
}

function dedupeEquipment(items) {
  const bySocket = new Map();
  const rejected = [];
  for (const item of items) {
    const current = bySocket.get(item.socket);
    if (!current) bySocket.set(item.socket, item);
    else if (item.ready && !current.ready) { rejected.push(current.id); bySocket.set(item.socket, item); }
    else if (item.ready === current.ready && item.id < current.id) { rejected.push(current.id); bySocket.set(item.socket, item); }
    else rejected.push(item.id);
  }
  return { equipped: [...bySocket.values()].sort((a, b) => a.socket.localeCompare(b.socket) || a.id.localeCompare(b.id)), rejected: rejected.sort() };
}

export function buildPlayerAnimationEquipmentSyncSnapshot(input = {}) {
  const layers = dedupeLayers((Array.isArray(input.layers) ? input.layers : []).map(normalizeLayer));
  const equipment = dedupeEquipment((Array.isArray(input.equipment) ? input.equipment : []).map(normalizeEquipment));
  const locomotion = text(input.locomotion, 'idle');
  const combatPhase = text(input.combatPhase, 'neutral');
  const totalWeight = equipment.equipped.reduce((sum, item) => sum + item.weight, 0);
  const encumbrance = clamp(totalWeight / 100, 0, 1);
  const upperBodyLock = Boolean(input.upperBodyLock) || combatPhase === 'attack' || combatPhase === 'guard';
  const animation = {
    layers,
    locomotion,
    combatPhase,
    upperBodyLock,
    crossFadeSeconds: clamp(input.crossFadeSeconds, 0, 0.35),
    dominantClip: layers.find((layer) => layer.family === 'upperBody')?.clip || layers.find((layer) => layer.family === 'locomotion')?.clip || 'idle',
    layerOrder: LAYER_ORDER.filter((family) => layers.some((layer) => layer.family === family)),
  };
  const sockets = equipment.equipped.map((item) => ({
    itemId: item.id,
    slot: item.slot,
    socket: item.socket,
    visible: item.visible,
    ready: item.ready,
    poseFamily: item.weaponClass === 'bow' ? 'ranged' : item.weaponClass === 'shield' ? 'guard' : item.handedness === 'none' ? 'utility' : 'melee',
  }));
  const readiness = {
    animationReady: layers.length > 0,
    equipmentReady: equipment.equipped.every((item) => item.ready),
    duplicateSocketCount: equipment.rejected.length,
    missingLayerFamilies: LAYER_ORDER.filter((family) => family === 'locomotion' && !layers.some((layer) => layer.family === family)),
  };
  return freeze({
    version: 'player-animation-equipment-sync-v1',
    animation,
    equipment: {
      equipped: equipment.equipped,
      rejectedItemIds: equipment.rejected,
      totalWeight,
      encumbrance,
      sockets,
    },
    readiness,
    handoff: {
      applyAnimationTo: 'existing-player-animation-owner',
      applyEquipmentTo: 'existing-equipment-socket-owner',
      materialPlacementAuthority: 'src/3d/materials/MaterialAssignmentCore.js + src/3d/world/WorldAssetPlacementPipeline.js',
      editorRuntimeImportForbidden: true,
    },
  });
}

export function validatePlayerAnimationEquipmentSyncSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 'player-animation-equipment-sync-v1') return { valid: false, reason: 'invalid-version' };
  if (!snapshot.animation || !Array.isArray(snapshot.animation.layers)) return { valid: false, reason: 'missing-animation' };
  if (!snapshot.equipment || !Array.isArray(snapshot.equipment.equipped)) return { valid: false, reason: 'missing-equipment' };
  if (snapshot.equipment.encumbrance < 0 || snapshot.equipment.encumbrance > 1) return { valid: false, reason: 'encumbrance-out-of-range' };
  if (!snapshot.handoff?.editorRuntimeImportForbidden) return { valid: false, reason: 'editor-runtime-boundary' };
  return { valid: true, reason: null };
}

export function serializePlayerAnimationEquipmentSyncSnapshot(snapshot) {
  return JSON.stringify(snapshot);
}
