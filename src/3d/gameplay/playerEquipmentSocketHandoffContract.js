const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

const SLOT_SOCKET = Object.freeze({ mainHand: 'mixamorigRightHand', offHand: 'mixamorigLeftHand', back: 'mixamorigSpine2', head: 'mixamorigHead' });

export function buildPlayerEquipmentSocketHandoff(input = {}) {
  const rows = Array.isArray(input.items) ? input.items : [];
  const occupied = new Map();
  const rejected = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const slot = text(row.slot, `slot-${index}`);
    const socket = text(row.socket, SLOT_SOCKET[slot] || 'root');
    const item = { id: text(row.id, `${slot}-${index}`), slot, socket, visible: row.visible !== false, ready: row.ready !== false, scale: clamp(row.scale, 0.5, 1.5), poseFamily: text(row.poseFamily, slot === 'offHand' ? 'guard' : slot === 'mainHand' ? 'melee' : 'utility') };
    const current = occupied.get(socket);
    if (!current || (item.ready && !current.ready) || (item.ready === current.ready && item.id < current.id)) {
      if (current) rejected.push(current.id);
      occupied.set(socket, item);
    } else rejected.push(item.id);
  }
  const equipped = [...occupied.values()].sort((a, b) => a.socket.localeCompare(b.socket) || a.id.localeCompare(b.id));
  return freeze({ version: 'player-equipment-socket-handoff-v1', equipped, rejectedItemIds: rejected.sort(), occupiedSocketCount: equipped.length, duplicateSocketCount: rejected.length, materialPlacementAuthority: 'src/3d/materials/MaterialAssignmentCore.js + src/3d/world/WorldAssetPlacementPipeline.js', editorRuntimeImportForbidden: true });
}

export function validatePlayerEquipmentSocketHandoff(value) {
  if (!value || value.version !== 'player-equipment-socket-handoff-v1') return { valid: false, reason: 'invalid-version' };
  if (!Array.isArray(value.equipped) || !Array.isArray(value.rejectedItemIds)) return { valid: false, reason: 'invalid-shape' };
  if (!value.editorRuntimeImportForbidden) return { valid: false, reason: 'editor-runtime-boundary' };
  return { valid: true, reason: null };
}

export function serializePlayerEquipmentSocketHandoff(value) { return JSON.stringify(value); }
