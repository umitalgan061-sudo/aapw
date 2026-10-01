/**
 * Deterministic, read-only save/resume projection over the existing settlement slice.
 * The authoritative slice/runtime still owns persistence and mutation.
 */

export const SETTLEMENT_SAVE_RESUME_CHECKPOINT_VERSION = 1;
const text = (value, fallback = '') => typeof value === 'string' ? value.trim().slice(0, 160) : fallback;
const id = (value, fallback = '') => text(value, fallback).replace(/[^a-zA-Z0-9._:-]/g, '_');
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value, min, max, fallback) => Math.min(max, Math.max(min, Math.trunc(finite(value, fallback))));
const freeze = (value) => Object.freeze(value);
const stable = (value) => JSON.stringify(value, Object.keys(value).sort());
const digest = (value) => { let hash = 2166136261; for (const char of stable(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); };

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-24).map((entry, index) => freeze({
    sequence: integer(entry?.sequence, 0, 999999999, index + 1),
    action: id(entry?.action, 'unknown'),
    nodeId: id(entry?.nodeId),
    result: id(entry?.result, 'unknown'),
    message: text(entry?.message),
  }));
}

export function buildSettlementSaveResumeCheckpoint(input = {}) {
  const snapshot = input.snapshot && typeof input.snapshot === 'object' ? input.snapshot : {};
  const runtime = input.runtime && typeof input.runtime === 'object' ? input.runtime : {};
  const history = normalizeHistory(snapshot.history || runtime.history);
  const currentNodeId = id(snapshot.currentNodeId || runtime.currentNodeId || runtime.nodeId);
  const visited = [...new Set((Array.isArray(snapshot.visited) ? snapshot.visited : runtime.visited || []).map(id).filter(Boolean))].sort().slice(-64);
  const settlementId = id(input.settlementId || runtime.settlementId);
  const canSave = input.saveEnabled !== false && runtime.defeated !== true && finite(runtime.health, 1) > 0;
  const resume = currentNodeId ? 'resume-node' : 'resume-entry';
  const body = {
    version: SETTLEMENT_SAVE_RESUME_CHECKPOINT_VERSION,
    settlementId,
    sliceId: id(input.sliceId || runtime.sliceId),
    currentNodeId,
    visited,
    history,
    canSave,
    resume,
    historyLength: history.length,
    lastAction: history.length ? history[history.length - 1].action : '',
    lastResult: history.length ? history[history.length - 1].result : '',
    checkpoint: canSave ? 'available' : 'blocked',
  };
  return freeze({ ...body, fingerprint: digest(body) });
}

export function validateSettlementSaveResumeCheckpoint(checkpoint) {
  const errors = [];
  if (!checkpoint || typeof checkpoint !== 'object') errors.push('missing-checkpoint');
  if (checkpoint?.version !== SETTLEMENT_SAVE_RESUME_CHECKPOINT_VERSION) errors.push('unsupported-version');
  if (!id(checkpoint?.settlementId)) errors.push('missing-settlement-id');
  if (!['available', 'blocked'].includes(checkpoint?.checkpoint)) errors.push('invalid-checkpoint-state');
  if (!['resume-node', 'resume-entry'].includes(checkpoint?.resume)) errors.push('invalid-resume-target');
  if (!Array.isArray(checkpoint?.visited) || checkpoint.visited.length > 64) errors.push('invalid-visited');
  if (!Array.isArray(checkpoint?.history) || checkpoint.history.length > 24) errors.push('invalid-history');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), fingerprint: checkpoint?.fingerprint || '' });
}

export function serializeSettlementSaveResumeCheckpoint(checkpoint) {
  return stable(checkpoint && typeof checkpoint === 'object' ? checkpoint : {});
}
