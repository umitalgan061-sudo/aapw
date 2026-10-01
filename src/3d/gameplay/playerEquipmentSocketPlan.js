/**
 * Deterministic, renderer-agnostic equipment socket plan for the shipped player.
 *
 * This module consumes the existing playerEquipmentCombatProfile output and a caller-owned
 * skeleton inventory. It does not mutate Object3D nodes, own loaders, or duplicate material
 * assignment. The returned plan is a frozen contract for the existing animation/equipment
 * adapters to resolve against the real Mixamo skeleton.
 *
 * @module gameplay/playerEquipmentSocketPlan
 */

const MAX_ID_LENGTH = 96;
const MAX_LABEL_LENGTH = 80;
const MAX_SLOTS = 8;
const SLOT_ORDER = Object.freeze(['head', 'chest', 'back', 'mainHand', 'offHand']);
const SOCKET_CANDIDATES = Object.freeze({
  head: ['Head', 'head', 'mixamorigHead', 'mixamorig:Head'],
  chest: ['Chest', 'chest', 'Spine2', 'mixamorigSpine2', 'mixamorig:Spine2'],
  back: ['Back', 'back', 'Spine', 'mixamorigSpine', 'mixamorig:Spine'],
  mainHand: ['RightHand', 'rightHand', 'mixamorigRightHand', 'mixamorig:RightHand'],
  offHand: ['LeftHand', 'leftHand', 'mixamorigLeftHand', 'mixamorig:LeftHand'],
});

const clamp01 = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
};

const normalizeId = (value, fallback) => {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').slice(0, MAX_ID_LENGTH);
  return normalized || fallback;
};

const normalizeLabel = (value, fallback = '') => {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL_LENGTH);
  return normalized || fallback;
};

const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
};

const asArray = (value) => Array.isArray(value) ? value : [];

function normalizeSkeletonNodes(nodes) {
  const list = asArray(nodes).slice(0, 512).map((node) => {
    if (typeof node === 'string') return normalizeLabel(node);
    if (!node || typeof node !== 'object') return '';
    return normalizeLabel(node.name ?? node.id ?? node.boneName);
  }).filter(Boolean);
  return [...new Set(list)];
}

function resolveSocket(slot, skeletonNodes, requestedSocket) {
  const requested = normalizeLabel(requestedSocket);
  if (requested && skeletonNodes.includes(requested)) return { name: requested, source: 'requested', confidence: 1 };
  const candidates = SOCKET_CANDIDATES[slot] ?? [];
  const matched = candidates.find((candidate) => skeletonNodes.includes(candidate));
  if (matched) return { name: matched, source: 'candidate', confidence: 0.92 };
  return { name: candidates[0] ?? slot, source: 'fallback', confidence: 0.25 };
}

function normalizeEquipmentEntries(profile, equipment) {
  const entries = [];
  const candidate = equipment && typeof equipment === 'object' ? equipment : {};
  const profileSockets = profile && typeof profile === 'object' && profile.sockets && typeof profile.sockets === 'object'
    ? profile.sockets : {};
  const profileParts = profile && typeof profile === 'object' && profile.equipment && typeof profile.equipment === 'object'
    ? profile.equipment : {};

  for (const slot of SLOT_ORDER) {
    const raw = candidate[slot] ?? profileSockets[slot] ?? profileParts[slot];
    if (!raw) continue;
    const data = typeof raw === 'string' ? { id: raw } : raw;
    if (!data || typeof data !== 'object') continue;
    entries.push({
      slot,
      id: normalizeId(data.id ?? data.assetId ?? data.itemId, `empty-${slot}`),
      assetUrl: normalizeLabel(data.assetUrl ?? data.url),
      requestedSocket: normalizeLabel(data.socket ?? data.bone ?? data.boneName),
      enabled: data.enabled !== false,
      scale: clamp01(data.scale, 1),
      materialFamily: normalizeId(data.materialFamily ?? data.surface ?? 'default', 'default'),
    });
  }
  return entries.slice(0, MAX_SLOTS);
}

export function buildPlayerEquipmentSocketPlan({ profile = {}, equipment = {}, skeletonNodes = [] } = {}) {
  const nodes = normalizeSkeletonNodes(skeletonNodes);
  const entries = normalizeEquipmentEntries(profile, equipment);
  const placements = entries.map((entry) => ({
    ...entry,
    socket: resolveSocket(entry.slot, nodes, entry.requestedSocket),
    attachMode: entry.enabled ? 'bone-child' : 'disabled',
    materialContract: {
      source: 'shared-material-assignment-core',
      family: entry.materialFamily,
      requiresValidation: true,
      editorUiImport: false,
    },
  }));

  const unresolved = placements.filter((placement) => placement.socket.source === 'fallback').map((placement) => placement.slot);
  return freezeDeep({
    version: 1,
    slots: SLOT_ORDER,
    skeleton: {
      nodeCount: nodes.length,
      matchedNodeCount: placements.filter((placement) => placement.socket.source !== 'fallback').length,
      unresolvedSlots: unresolved,
    },
    placements,
    validation: {
      missingAssetCount: placements.filter((placement) => !placement.assetUrl && placement.enabled).length,
      placeholderGeometryAllowed: false,
      editorMaterialStudioImported: false,
    },
  });
}

export function serializePlayerEquipmentSocketPlan(plan) {
  return JSON.stringify(plan ?? null);
}

export const PLAYER_EQUIPMENT_SOCKET_ORDER = SLOT_ORDER;
