/**
 * Deterministic settlement progression checkpoint over existing runtime owners.
 * This module only projects caller-owned quest/service/persistence state for UX.
 */
export const SETTLEMENT_PROGRESSION_CHECKPOINT_VERSION = 1;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 120) : fallback;
};
const bool = (value, fallback = false) => typeof value === 'boolean' ? value : fallback;
const clone = (value) => JSON.parse(JSON.stringify(value));

const STAGE_ORDER = ['arrival', 'dialogue', 'trade', 'craft', 'travel', 'rest', 'departure'];
const ACTION_BY_STAGE = Object.freeze({
  arrival: 'interact', dialogue: 'talk', trade: 'trade', craft: 'craft',
  travel: 'travel', rest: 'rest', departure: 'save',
});

function stageRank(stage) {
  const index = STAGE_ORDER.indexOf(stage);
  return index < 0 ? 0 : index;
}

function normalizeStage(stage) {
  const normalized = text(stage, 'arrival').toLowerCase();
  return STAGE_ORDER.includes(normalized) ? normalized : 'arrival';
}

function hasCompletion(state, stage) {
  const completed = state?.completedStages;
  if (Array.isArray(completed) && completed.includes(stage)) return true;
  const receipt = state?.completionReceipt;
  if (receipt && (receipt.stage === stage || receipt.completedStage === stage)) return true;
  return false;
}

function stageRows(state) {
  const current = normalizeStage(state?.currentStage);
  return STAGE_ORDER.map((stage, index) => {
    const complete = hasCompletion(state, stage);
    const prior = STAGE_ORDER.slice(0, index).every(item => hasCompletion(state, item));
    const active = stage === current;
    const blockedBy = !prior && !complete ? STAGE_ORDER.slice(0, index).find(item => !hasCompletion(state, item)) : null;
    return {
      id: stage,
      order: index,
      action: ACTION_BY_STAGE[stage],
      active,
      complete,
      available: complete || prior,
      blockedBy,
      label: stage[0].toUpperCase() + stage.slice(1),
    };
  });
}

export function buildSettlementProgressionCheckpoint(input = {}) {
  const insideSettlement = bool(input.insideSettlement, false);
  const defeated = bool(input.defeated, false);
  const saveAvailable = bool(input.saveAvailable, true);
  const state = input.state && typeof input.state === 'object' ? input.state : {};
  const rows = stageRows(state);
  const active = rows.find(row => row.active) ?? rows[0];
  const gated = !insideSettlement ? 'outside-settlement' : defeated ? 'defeated' : null;
  const available = gated ? [] : rows.filter(row => row.available && !row.complete);
  const next = available[0] ?? null;
  const completedCount = rows.filter(row => row.complete).length;
  const progress = rows.length ? completedCount / rows.length : 0;
  return Object.freeze({
    version: SETTLEMENT_PROGRESSION_CHECKPOINT_VERSION,
    settlementId: text(input.settlementId, 'unknown-settlement'),
    insideSettlement,
    defeated,
    gated,
    currentStage: active.id,
    nextAction: gated ? null : (next?.action ?? (saveAvailable ? 'save' : null)),
    completedCount,
    totalStages: rows.length,
    progress: Math.max(0, Math.min(1, progress)),
    stages: rows.map(row => Object.freeze({ ...row })),
    saveAvailable,
  });
}

export function stableSettlementProgressionDigest(checkpoint) {
  const value = checkpoint && typeof checkpoint === 'object' ? checkpoint : {};
  return JSON.stringify({
    version: value.version ?? SETTLEMENT_PROGRESSION_CHECKPOINT_VERSION,
    settlementId: text(value.settlementId),
    insideSettlement: bool(value.insideSettlement),
    defeated: bool(value.defeated),
    gated: text(value.gated, ''),
    currentStage: normalizeStage(value.currentStage),
    nextAction: text(value.nextAction, ''),
    completedCount: finite(value.completedCount),
    totalStages: finite(value.totalStages),
    progress: finite(value.progress),
    saveAvailable: bool(value.saveAvailable),
    stages: Array.isArray(value.stages) ? value.stages.map(stage => ({
      id: text(stage.id), order: finite(stage.order), action: text(stage.action),
      active: bool(stage.active), complete: bool(stage.complete), available: bool(stage.available),
      blockedBy: text(stage.blockedBy, ''),
    })) : [],
  });
}

export function validateSettlementProgressionCheckpoint(checkpoint) {
  const errors = [];
  if (checkpoint?.version !== SETTLEMENT_PROGRESSION_CHECKPOINT_VERSION) errors.push('version');
  if (!Array.isArray(checkpoint?.stages) || checkpoint.stages.length !== STAGE_ORDER.length) errors.push('stages');
  if (checkpoint?.progress < 0 || checkpoint?.progress > 1) errors.push('progress');
  if (checkpoint?.gated == null && checkpoint?.insideSettlement !== true) errors.push('gate');
  return { ok: errors.length === 0, errors };
}

export function applySettlementProgressionCheckpoint(target, checkpoint) {
  if (!target || typeof target !== 'object') return { applied: false, reason: 'missing-target' };
  const snapshot = clone(checkpoint ?? {});
  if (typeof target.setProgressionCheckpoint === 'function') {
    target.setProgressionCheckpoint(snapshot);
    return { applied: true, mode: 'owner-setter', snapshot };
  }
  if (typeof target.emit === 'function') {
    target.emit('settlement:progression-checkpoint', snapshot);
    return { applied: true, mode: 'owner-event', snapshot };
  }
  return { applied: false, reason: 'no-owner-hook', snapshot };
}
