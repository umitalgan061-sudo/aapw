/**
 * Settlement campaign EventBus adapter.
 * Request/response names are deliberately distinct to avoid event re-entry.
 */
import { createSettlementCampaignRuntime } from './settlementCampaignRuntime.js';

export const SETTLEMENT_CAMPAIGN_EVENT_VERSION = 1;
export const SETTLEMENT_CAMPAIGN_EVENT_NAMES = Object.freeze({
  request: 'aapw:settlement-campaign:request',
  response: 'aapw:settlement-campaign:response',
  opened: 'aapw:settlement-campaign:opened',
  action: 'aapw:settlement-campaign:action',
  feedback: 'aapw:settlement-campaign:feedback',
  closed: 'aapw:settlement-campaign:closed',
  restored: 'aapw:settlement-campaign:restored',
});
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 160) : fallback;
};
const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
function normalizeRequest(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    version: Number.isInteger(source.version) ? source.version : 1,
    requestId: text(source.requestId), type: text(source.type), action: text(source.action),
    serviceId: text(source.serviceId), panel: text(source.panel, 'overview'), input: clone(source.input ?? {}),
  };
}
function response(ok, request, code = '', data = null) {
  return { version: SETTLEMENT_CAMPAIGN_EVENT_VERSION, ok, requestId: request.requestId, type: request.type, action: request.action, code: text(code), data: clone(data) };
}
export function createSettlementCampaignRequest(type, input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return normalizeRequest({ version: 1, requestId: text(source.requestId), type, action: source.action, serviceId: source.serviceId, panel: source.panel, input: source.input });
}
export function createSettlementCampaignEventBridge(options = {}) {
  const bus = options.bus;
  if (!bus || typeof bus.on !== 'function' || typeof bus.emit !== 'function') throw new TypeError('Settlement campaign EventBus requires on/emit.');
  const runtime = options.runtime ?? createSettlementCampaignRuntime(options);
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const seen = new Set(); const order = [];
  const limit = Math.max(1, Math.min(64, Math.trunc(Number(options.requestLimit) || 64)));
  let disposed = false; let unsubscribe = null;
  const remember = (requestId) => {
    if (!requestId) return false;
    if (seen.has(requestId)) return true;
    seen.add(requestId); order.push(requestId);
    while (order.length > limit) seen.delete(order.shift());
    return false;
  };
  const emitResponse = (request, result) => {
    const payload = { ...response(Boolean(result?.ok), request, result?.code ?? result?.reason, result), at: now() };
    bus.emit(SETTLEMENT_CAMPAIGN_EVENT_NAMES.response, payload); return payload;
  };
  const handle = async (rawRequest) => {
    if (disposed) return response(false, normalizeRequest(rawRequest), 'disposed');
    const request = normalizeRequest(rawRequest);
    if (request.version !== 1) return response(false, request, 'unsupported-version');
    if (!request.requestId) return response(false, request, 'missing-request-id');
    if (remember(request.requestId)) return response(false, request, 'duplicate-request');
    try {
      let result;
      if (request.type === 'open') result = { ok: true, data: runtime.open(request.serviceId, request.panel) };
      else if (request.type === 'panel') result = { ok: true, data: runtime.setPanel(request.panel) };
      else if (request.type === 'execute') result = await runtime.execute(request.action, { ...request.input, requestId: request.requestId });
      else if (request.type === 'close') result = { ok: true, data: runtime.close() };
      else if (request.type === 'save') result = await runtime.save({ ...request.input, requestId: request.requestId });
      else if (request.type === 'reset') result = { ok: true, data: runtime.reset() };
      else if (request.type === 'state') result = { ok: true, data: runtime.getViewModel() };
      else if (request.type === 'manifest') result = { ok: true, data: runtime.manifest() };
      else if (request.type === 'dialogue') result = { ok: true, data: runtime.evaluateDialogue(request.input?.conditions ?? []) };
      else if (request.type === 'objective') result = { ok: true, data: runtime.getObjective(request.input?.objectiveId) };
      else if (request.type === 'restore') result = runtime.importState(request.input?.state ?? {});
      else result = { ok: false, reason: 'unknown-request-type' };
      const emitted = emitResponse(request, result);
      if (result?.ok) {
        const name = request.type === 'open' ? SETTLEMENT_CAMPAIGN_EVENT_NAMES.opened : request.type === 'close' ? SETTLEMENT_CAMPAIGN_EVENT_NAMES.closed : request.type === 'restore' ? SETTLEMENT_CAMPAIGN_EVENT_NAMES.restored : SETTLEMENT_CAMPAIGN_EVENT_NAMES.action;
        bus.emit(name, { requestId: request.requestId, action: request.action, result: clone(result) });
      } else bus.emit(SETTLEMENT_CAMPAIGN_EVENT_NAMES.feedback, emitted);
      return emitted;
    } catch (error) {
      const failed = response(false, request, 'handler-threw', { message: text(error?.message, 'İşlem sırasında hata oluştu.') });
      bus.emit(SETTLEMENT_CAMPAIGN_EVENT_NAMES.feedback, failed); return failed;
    }
  };
  const listener = (payload) => { void handle(payload); };
  unsubscribe = bus.on(SETTLEMENT_CAMPAIGN_EVENT_NAMES.request, listener);
  return Object.freeze({
    runtime, handle,
    dispose() { if (disposed) return { ok: true }; disposed = true; if (typeof unsubscribe === 'function') unsubscribe(); unsubscribe = null; runtime.dispose(); return { ok: true }; },
    isDisposed: () => disposed,
  });
}
