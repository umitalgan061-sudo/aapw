import {
  buildPlayerAnimationEquipmentSyncSnapshot,
  validatePlayerAnimationEquipmentSyncSnapshot,
} from './playerAnimationEquipmentSyncDirector.js';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;

function createNoopReceipt(reason = 'not-applied') {
  return Object.freeze({ applied: false, reason, animationCalls: 0, equipmentCalls: 0 });
}

function resolveOwnerMethod(owner, names) {
  if (!owner || typeof owner !== 'object') return null;
  for (const name of names) {
    if (typeof owner[name] === 'function') return owner[name].bind(owner);
  }
  return null;
}

export function applyPlayerAnimationEquipmentSyncSnapshot(snapshot, owners = {}) {
  const validation = validatePlayerAnimationEquipmentSyncSnapshot(snapshot);
  if (!validation.valid) return createNoopReceipt(validation.reason);

  const animationOwner = owners.animationOwner;
  const equipmentOwner = owners.equipmentOwner;
  const setLayer = resolveOwnerMethod(animationOwner, ['setLayerWeight', 'setAnimationLayerWeight', 'applyLayerWeight']);
  const setCrossFade = resolveOwnerMethod(animationOwner, ['setCrossFadeSeconds', 'setCrossFadeDuration']);
  const setUpperBodyLock = resolveOwnerMethod(animationOwner, ['setUpperBodyLock', 'setCombatUpperBodyLock']);
  const attachEquipment = resolveOwnerMethod(equipmentOwner, ['applySocketPose', 'attachEquipmentPose', 'setEquipmentPose']);

  let animationCalls = 0;
  let equipmentCalls = 0;
  if (setLayer) {
    for (const layer of snapshot.animation.layers) {
      setLayer(layer.family, clamp(layer.weight, 0, 1), {
        clip: text(layer.clip, 'idle'),
        additive: Boolean(layer.additive),
        enabled: layer.enabled !== false,
      });
      animationCalls += 1;
    }
  }
  if (setCrossFade) {
    setCrossFade(clamp(snapshot.animation.crossFadeSeconds, 0, 0.35));
    animationCalls += 1;
  }
  if (setUpperBodyLock) {
    setUpperBodyLock(Boolean(snapshot.animation.upperBodyLock));
    animationCalls += 1;
  }
  if (attachEquipment) {
    for (const socket of snapshot.equipment.sockets) {
      attachEquipment(socket.socket, socket.itemId, {
        slot: socket.slot,
        poseFamily: socket.poseFamily,
        visible: socket.visible !== false,
        ready: socket.ready !== false,
      });
      equipmentCalls += 1;
    }
  }
  return Object.freeze({
    applied: animationCalls > 0 || equipmentCalls > 0,
    reason: animationCalls > 0 || equipmentCalls > 0 ? null : 'owner-methods-unavailable',
    animationCalls,
    equipmentCalls,
  });
}

export function buildAndApplyPlayerAnimationEquipmentSync(input = {}, owners = {}) {
  const snapshot = buildPlayerAnimationEquipmentSyncSnapshot(input);
  return Object.freeze({
    snapshot,
    receipt: applyPlayerAnimationEquipmentSyncSnapshot(snapshot, owners),
  });
}
