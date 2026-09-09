/**
 * Deterministic, read-only receipt projection for settlement actions.
 *
 * The authoritative handler remains caller-owned. This module turns a
 * committed action result into a bounded UI/event receipt without mutating
 * quest, inventory, economy, crafting, travel, persistence or scene state.
 */

const MAX_HISTORY = 12;
const ALLOWED_STATUS = new Set(['success', 'blocked', 'error', 'info']);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function normalizeDelta(delta = {}) {
  const source = delta && typeof delta === 'object' ? delta : {};
  return Object.freeze({
    copper: Math.trunc(finite(source.copper)),
    xp: Math.trunc(finite(source.xp)),
    fatigue: Math.trunc(finite(source.fatigue)),
    reputation: Math.trunc(finite(source.reputation)),
  });
}

function normalizeEntry(entry = {}, index = 0) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const status = ALLOWED_STATUS.has(source.status) ? source.status : 'info';
  const action = text(source.action, 'unknown');
  const service = text(source.service, 'settlement');
  const message = text(source.message, status === 'success' ? 'İşlem tamamlandı.' : 'İşlem sonucu hazır.');
  const delta = normalizeDelta(source.delta);
  return Object.freeze({
    id: text(source.id, `${service}:${action}:${index}`),
    status,
    action,
    service,
    message,
    delta,
    actionable: status === 'success' || status === 'info',
  });
}

export function projectSettlementActionReceipt(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const entries = Array.isArray(source.entries) ? source.entries : [];
  const receipt = normalizeEntry(source.receipt || entries[entries.length - 1], entries.length);
  const history = entries.slice(-MAX_HISTORY).map((entry, index) => normalizeEntry(entry, index));
  const totals = history.reduce((sum, item) => ({
    copper: sum.copper + item.delta.copper,
    xp: sum.xp + item.delta.xp,
    fatigue: sum.fatigue + item.delta.fatigue,
    reputation: sum.reputation + item.delta.reputation,
  }), { copper: 0, xp: 0, fatigue: 0, reputation: 0 });
  const statusCounts = history.reduce((acc, item) => {
    acc[item.status] += 1;
    return acc;
  }, { success: 0, blocked: 0, error: 0, info: 0 });
  const output = {
    version: 1,
    latest: receipt,
    history,
    totals: Object.freeze(totals),
    statusCounts: Object.freeze(statusCounts),
    hasBlockingResult: statusCounts.blocked > 0 || statusCounts.error > 0,
    digest: `${receipt.service}|${receipt.action}|${receipt.status}|${history.length}|${totals.copper}|${totals.xp}`,
  };
  return deepFreeze(output);
}

export function acknowledgeSettlementActionReceipt(receipt, entryId = '') {
  const source = receipt && typeof receipt === 'object' ? receipt : projectSettlementActionReceipt();
  const acknowledged = text(entryId);
  const history = source.history.map((entry) => Object.freeze({
    ...entry,
    acknowledged: acknowledged ? entry.id === acknowledged : true,
  }));
  return deepFreeze({ ...source, history });
}

export function serializeSettlementActionReceipt(receipt) {
  const source = receipt && typeof receipt === 'object' ? receipt : projectSettlementActionReceipt();
  return JSON.stringify(source);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
