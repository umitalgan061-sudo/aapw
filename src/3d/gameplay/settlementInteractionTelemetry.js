/**
 * Read-only telemetry projection for the existing settlement UI/runtime.
 * It does not execute actions or mutate quest, economy, inventory, crafting,
 * travel, persistence, NPC, scene, terrain or material-placement state.
 */
export const SETTLEMENT_INTERACTION_TELEMETRY_VERSION = 1;
const MAX_EVENTS = 32;
const text = (value, fallback = '') => String(value ?? '').trim().slice(0, 160) || fallback;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const freeze = (value) => Object.freeze(value);
const hash = (value) => {
  let result = 2166136261;
  for (const char of String(value)) { result ^= char.charCodeAt(0); result = Math.imul(result, 16777619); }
  return (result >>> 0).toString(16).padStart(8, '0');
};

function normalizeEvent(event, index) {
  const raw = event && typeof event === 'object' ? event : {};
  return {
    sequence: finite(raw.sequence, index + 1),
    action: text(raw.action, 'interact'),
    nodeId: text(raw.nodeId),
    result: text(raw.result, 'unknown'),
    reason: text(raw.reason),
    message: text(raw.message),
  };
}

export function createSettlementInteractionTelemetry(source) {
  if (!source || typeof source.build !== 'function') throw new TypeError('Settlement interaction telemetry requires a build() source.');
  function build() {
    const view = source.build() ?? {};
    const authored = Array.isArray(view.history) ? view.history : Array.isArray(view.events) ? view.events : [];
    const events = authored.slice(-MAX_EVENTS).map(normalizeEvent);
    const counts = events.reduce((summary, event) => {
      summary.total += 1;
      summary[event.result] = (summary[event.result] || 0) + 1;
      summary.byAction[event.action] = (summary.byAction[event.action] || 0) + 1;
      return summary;
    }, { total: 0, ok: 0, failed: 0, blocked: 0, byAction: {} });
    const last = events[events.length - 1] || null;
    const body = {
      version: SETTLEMENT_INTERACTION_TELEMETRY_VERSION,
      sourceVersion: finite(view.version, 0),
      revision: finite(view.revision, 0),
      context: freeze({
        settlementId: text(view.settlementId || view.context?.settlementId),
        nodeId: text(view.nodeId || view.currentNodeId),
        serviceId: text(view.service?.id || view.context?.serviceId),
        location: text(view.header?.location || view.context?.location),
      }),
      counts: freeze({ ...counts, byAction: freeze({ ...counts.byAction }) }),
      lastEvent: last ? freeze({ ...last }) : null,
      events: freeze(events.map((event) => freeze(event))),
    };
    return freeze({ ...body, fingerprint: hash(JSON.stringify(body)) });
  }
  return freeze({ build, serialize: () => JSON.stringify(build()) });
}
