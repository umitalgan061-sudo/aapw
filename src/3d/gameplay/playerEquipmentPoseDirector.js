/**
 * Deterministic equipment -> pose/socket intent for the existing player runtime.
 * Does not own scene graph, bones, mixers, asset loading or equipment mutation.
 * @module gameplay/playerEquipmentPoseDirector
 */

const MAX_ID = 96;
const MAX_NAME = 80;
const SOCKETS = Object.freeze(['head', 'chest', 'back', 'mainHand', 'offHand']);
const DEFAULT_SOCKET = Object.freeze({
  head: 'head', chest: 'chest', back: 'back', mainHand: 'mainHand', offHand: 'offHand',
});

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const finiteOr = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const normalizeId = (v, fallback) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').slice(0, MAX_ID) || fallback;
const normalizeName = (v, fallback = '') => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) || fallback;

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function normalizeSlot(slot) {
  const raw = String(slot ?? '').trim();
  return SOCKETS.includes(raw) ? raw : null;
}

function normalizeAttachment(item, index) {
  const slot = normalizeSlot(item?.slot) ?? SOCKETS[index % SOCKETS.length];
  const id = normalizeId(item?.id, `item-${index + 1}`);
  const weight = clamp(finiteOr(item?.weight, 0), 0, 100);
  const visible = item?.visible !== false;
  const socket = normalizeName(item?.socket, DEFAULT_SOCKET[slot]);
  const pose = normalizeName(item?.pose, slot === 'back' ? 'back-carry' : slot === 'mainHand' ? 'right-hand-ready' : slot === 'offHand' ? 'left-hand-ready' : 'body-worn');
  return Object.freeze({ id, slot, socket, pose, weight, visible });
}

export function resolvePlayerEquipmentPose(input = {}) {
  const source = Array.isArray(input?.items) ? input.items : [];
  const items = source.slice(0, 32).map(normalizeAttachment).filter((item) => item.visible);
  const occupied = Object.fromEntries(SOCKETS.map((slot) => [slot, null]));
  for (const item of items) {
    if (occupied[item.slot] == null) occupied[item.slot] = item;
  }
  const totalWeight = clamp(items.reduce((sum, item) => sum + item.weight, 0), 0, 1000);
  const locomotionFamily = normalizeName(input?.locomotionFamily, totalWeight >= 70 ? 'heavy' : totalWeight >= 35 ? 'medium' : 'light');
  const combatFamily = normalizeName(input?.combatFamily, occupied.mainHand?.id ? 'armed' : 'unarmed');
  const blockedSlots = SOCKETS.filter((slot) => occupied[slot] == null);
  return freezeDeep({
    version: 1,
    ready: items.length > 0 || input?.allowEmpty === true,
    locomotionFamily,
    combatFamily,
    items,
    occupied,
    occupiedCount: SOCKETS.length - blockedSlots.length,
    blockedSlots,
    totalWeight,
    socketOrder: SOCKETS,
  });
}

export function applyPlayerEquipmentPose(target, projection) {
  if (!target || typeof target !== 'object') return false;
  target.playerEquipmentPose = projection;
  return true;
}

export function serializePlayerEquipmentPose(projection) {
  return JSON.stringify(projection);
}

export const PLAYER_EQUIPMENT_POSE_SOCKETS = SOCKETS;
