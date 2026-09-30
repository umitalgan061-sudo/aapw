/**
 * Persistence boundary for settlement campaign UX.
 * Serializes only the runtime presentation session; authoritative game state
 * remains owned by the existing save/load system supplied by callers.
 */
import { SETTLEMENT_CONTENT_VERSION } from './settlementCampaignContent.js';
import { SETTLEMENT_CAMPAIGN_RUNTIME_VERSION } from './settlementCampaignRuntime.js';

export const SETTLEMENT_CAMPAIGN_SAVE_VERSION = 1;
export const SETTLEMENT_CAMPAIGN_SAVE_LIMITS = Object.freeze({
  bytes: 32768,
  history: 64,
  route: 24,
  requestIds: 64,
});

const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 160) : fallback;
};
const boundedArray = (value, limit) => Array.isArray(value) ? clone(value).slice(-limit) : [];

export function createSettlementCampaignSavePayload(runtime, metadata = {}) {
  if (!runtime || typeof runtime.exportState !== 'function') throw new TypeError('Runtime exportState() is required.');
  const state = runtime.exportState();
  const payload = {
    schema: SETTLEMENT_CAMPAIGN_SAVE_VERSION,
    runtimeVersion: SETTLEMENT_CAMPAIGN_RUNTIME_VERSION,
    contentVersion: SETTLEMENT_CONTENT_VERSION,
    savedAt: text(metadata.savedAt, 'runtime'),
    slot: text(metadata.slot, 'default'),
    session: {
      panel: text(state.panel, 'overview'),
      activeService: text(state.activeService),
      route: boundedArray(state.route, SETTLEMENT_CAMPAIGN_SAVE_LIMITS.route),
      history: boundedArray(state.history, SETTLEMENT_CAMPAIGN_SAVE_LIMITS.history),
      requestIds: boundedArray(state.requestIds, SETTLEMENT_CAMPAIGN_SAVE_LIMITS.requestIds),
      lastAction: text(state.lastAction),
      revision: Number.isInteger(state.revision) ? state.revision : 0,
    },
  };
  const serialized = JSON.stringify(payload);
  if (serialized.length > SETTLEMENT_CAMPAIGN_SAVE_LIMITS.bytes) return { ok: false, reason: 'save-payload-too-large' };
  return { ok: true, payload, bytes: serialized.length };
}

export function validateSettlementCampaignSavePayload(raw) {
  const payload = raw && typeof raw === 'object' ? raw : null;
  const errors = [];
  if (!payload) errors.push('payload');
  if (payload?.schema !== SETTLEMENT_CAMPAIGN_SAVE_VERSION) errors.push('schema');
  if (payload?.runtimeVersion !== SETTLEMENT_CAMPAIGN_RUNTIME_VERSION) errors.push('runtime-version');
  if (payload?.contentVersion !== SETTLEMENT_CONTENT_VERSION) errors.push('content-version');
  if (!payload?.session || typeof payload.session !== 'object') errors.push('session');
  if ((payload?.session?.route?.length ?? 0) > SETTLEMENT_CAMPAIGN_SAVE_LIMITS.route) errors.push('route-limit');
  if ((payload?.session?.history?.length ?? 0) > SETTLEMENT_CAMPAIGN_SAVE_LIMITS.history) errors.push('history-limit');
  if ((payload?.session?.requestIds?.length ?? 0) > SETTLEMENT_CAMPAIGN_SAVE_LIMITS.requestIds) errors.push('request-limit');
  return { ok: errors.length === 0, errors };
}

export function restoreSettlementCampaignSavePayload(runtime, raw) {
  const validation = validateSettlementCampaignSavePayload(raw);
  if (!validation.ok) return validation;
  const session = raw.session;
  const result = runtime.importState({
    version: 1,
    runtimeVersion: SETTLEMENT_CAMPAIGN_RUNTIME_VERSION,
    contentVersion: SETTLEMENT_CONTENT_VERSION,
    panel: session.panel,
    activeService: session.activeService,
    route: session.route,
    history: session.history,
    requestIds: session.requestIds,
    lastAction: session.lastAction,
    revision: session.revision,
  });
  return result?.ok ? { ok: true, state: result.state } : { ok: false, reason: result?.reason ?? 'restore-failed' };
}

export function migrateSettlementCampaignSave(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  if (source.schema === SETTLEMENT_CAMPAIGN_SAVE_VERSION) return { ok: true, migrated: false, payload: clone(source) };
  if (source.schema == null || source.schema === 0) {
    return { ok: true, migrated: true, payload: {
      schema: 1,
      runtimeVersion: SETTLEMENT_CAMPAIGN_RUNTIME_VERSION,
      contentVersion: SETTLEMENT_CONTENT_VERSION,
      savedAt: text(source.savedAt, 'legacy'),
      slot: text(source.slot, 'default'),
      session: {
        panel: text(source.panel, 'overview'),
        activeService: text(source.activeService),
        route: boundedArray(source.route, SETTLEMENT_CAMPAIGN_SAVE_LIMITS.route),
        history: boundedArray(source.history, SETTLEMENT_CAMPAIGN_SAVE_LIMITS.history),
        requestIds: [], lastAction: text(source.lastAction), revision: 0,
      },
    }};
  }
  return { ok: false, reason: 'unsupported-save-schema' };
}

export function summarizeSettlementCampaignSave(raw) {
  const validation = validateSettlementCampaignSavePayload(raw);
  if (!validation.ok) return validation;
  return {
    ok: true,
    slot: text(raw.slot, 'default'),
    activeService: text(raw.session.activeService),
    panel: text(raw.session.panel, 'overview'),
    routeDepth: raw.session.route.length,
    historyDepth: raw.session.history.length,
    requestDepth: raw.session.requestIds.length,
    revision: raw.session.revision,
  };
}
