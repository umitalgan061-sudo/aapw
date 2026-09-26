/** Observation-only receipt for the existing player equipment/combat frame owner. */
import {
  composePlayerEquipmentCombatFrame,
  isPlayerEquipmentCombatPhase,
} from './playerEquipmentCombatRuntime.ts';

export const PLAYER_COMBAT_FRAME_RECEIPT_VERSION = '2026-09-25-r11';
const RECEIPT_PHASES = Object.freeze(['idle', 'windup', 'active', 'recovery', 'defense', 'dodge', 'hit-stagger']);

const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const text = (value) => String(value ?? '').trim();

function normalizeMaterialAudit(audit) {
  if (audit == null) return null;
  if (typeof audit !== 'object' || Array.isArray(audit)) return Object.freeze({ invalid: true });
  const normalized = Object.fromEntries(
    Object.entries(audit)
      .filter(([key]) => typeof key === 'string')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, String(value)]),
  );
  return Object.freeze(normalized);
}

function materialAuditSignature(audit) {
  if (audit == null) return 'none';
  if (typeof audit !== 'object') return 'invalid';
  return Object.entries(audit)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(';');
}

export function createPlayerCombatFrameReceipt({
  playerObject,
  equipment = {},
  motion = {},
  attack = {},
  outcome = null,
  timestamp = 0,
  revision = 0,
} = {}) {
  if (!playerObject) throw new TypeError('createPlayerCombatFrameReceipt requires playerObject');
  const frame = composePlayerEquipmentCombatFrame({ playerObject, equipment, motion, attack, outcome, timestamp, revision });
  const phase = text(frame.phase) || 'idle';
  const attackKind = text(frame.attack?.kind) || 'none';
  const comboStep = Math.max(0, Math.floor(finite(frame.attack?.comboStep, 0)));
  const equipmentSnapshot = Object.freeze({
    mainHandId: text(frame.equipment?.mainHandId),
    offHandId: text(frame.equipment?.offHandId),
    chestId: text(frame.equipment?.chestId),
    headId: text(frame.equipment?.headId),
  });
  const socketCount = Array.isArray(frame.sockets) ? frame.sockets.length : 0;
  const materialAudit = normalizeMaterialAudit(frame.audit);
  const receipt = {
    version: PLAYER_COMBAT_FRAME_RECEIPT_VERSION,
    revision: Math.max(0, Math.floor(finite(frame.revision, revision))),
    phase,
    phaseValid: isPlayerEquipmentCombatPhase(phase) && RECEIPT_PHASES.includes(phase),
    attackKind,
    comboStep,
    grounded: Boolean(frame.movement?.grounded),
    staminaRatio: Math.max(0, Math.min(1, finite(frame.movement?.staminaRatio, 1))),
    poiseRatio: Math.max(0, Math.min(1, finite(frame.movement?.poiseRatio, 1))),
    equipment: equipmentSnapshot,
    socketCount,
    materialAudit,
  };
  receipt.signature = [
    receipt.revision,
    receipt.phase,
    receipt.attackKind,
    receipt.comboStep,
    receipt.grounded ? 1 : 0,
    receipt.staminaRatio.toFixed(4),
    receipt.poiseRatio.toFixed(4),
    receipt.socketCount,
    materialAuditSignature(receipt.materialAudit),
    receipt.equipment.mainHandId,
    receipt.equipment.offHandId,
    receipt.equipment.chestId,
    receipt.equipment.headId,
  ].join('|');
  return Object.freeze(receipt);
}

export function validatePlayerCombatFrameReceipt(receipt) {
  const value = receipt ?? {};
  const phaseOk = Boolean(value.phaseValid) && RECEIPT_PHASES.includes(value.phase);
  const ratiosOk = [value.staminaRatio, value.poiseRatio].every((ratio) => Number.isFinite(ratio) && ratio >= 0 && ratio <= 1);
  const signatureOk = typeof value.signature === 'string' && value.signature.length > 0;
  const materialOk = value.materialAudit == null || typeof value.materialAudit === 'object';
  const equipmentOk = value.equipment != null && typeof value.equipment === 'object'
    && ['mainHandId', 'offHandId', 'chestId', 'headId'].every((key) => typeof value.equipment[key] === 'string');
  const socketOk = Number.isInteger(value.socketCount) && value.socketCount >= 0;
  return Object.freeze({ ok: phaseOk && ratiosOk && signatureOk && materialOk && equipmentOk && socketOk, phaseOk, ratiosOk, signatureOk, materialOk, equipmentOk, socketOk });
}

export function auditPlayerCombatFrameReceipt(input = {}) {
  const receipt = createPlayerCombatFrameReceipt(input);
  const validation = validatePlayerCombatFrameReceipt(receipt);
  return Object.freeze({
    version: PLAYER_COMBAT_FRAME_RECEIPT_VERSION,
    valid: validation.ok,
    validation,
    signature: receipt.signature,
    phase: receipt.phase,
    attackKind: receipt.attackKind,
    comboStep: receipt.comboStep,
    grounded: receipt.grounded,
    socketCount: receipt.socketCount,
    materialAuditPresent: receipt.materialAudit !== null,
  });
}