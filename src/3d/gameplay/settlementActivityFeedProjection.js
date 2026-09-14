/**
 * Deterministic settlement activity feed over caller-owned runtime events.
 * Presentation remains read-only; event producers and action executors stay authoritative.
 */

export const SETTLEMENT_ACTIVITY_FEED_VERSION = 1;
export const SETTLEMENT_ACTIVITY_FEED_LIMITS = Object.freeze({ history: 32, text: 160, id: 96 });

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_ACTIVITY_FEED_LIMITS.text) : fallback;
};
const id = (value, fallback = '') => text(value, fallback).slice(0, SETTLEMENT_ACTIVITY_FEED_LIMITS.id);
const integer = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Math.trunc(finite(value, fallback))));
const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function digest(value) {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
const EVENT_META = Object.freeze({
  'service-opened': { tone: 'info', title: 'Hizmet açıldı', action: 'open' },
  'service-closed': { tone: 'neutral', title: 'Hizmet kapandı', action: 'close' },
  feedback: { tone: 'status', title: 'İşlem sonucu', action: 'feedback' },
  'quest-advanced': { tone: 'quest', title: 'Görev ilerledi', action: 'quest' },
  'trade-completed': { tone: 'trade', title: 'Takas tamamlandı', action: 'trade' },
  'craft-completed': { tone: 'craft', title: 'Üretim tamamlandı', action: 'craft' },
  'travel-completed': { tone: 'travel', title: 'Seyahat tamamlandı', action: 'travel' },
  'save-completed': { tone: 'save', title: 'Kayıt tamamlandı', action: 'save' },
});

function normalizeEvent(raw, sequence) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const name = id(source.name, 'unknown-event');
  const meta = EVENT_META[name] ?? { tone: 'neutral', title: 'Yerleşim güncellemesi', action: 'event' };
  const payload = source.feedback && typeof source.feedback === 'object' ? source.feedback : source;
  const status = text(payload.status, source.ok === false ? 'error' : 'info');
  const message = text(payload.message, meta.title);
  return {
    id: id(source.id, `${name}-${sequence}`),
    sequence,
    at: finite(source.at, 0),
    name,
    action: meta.action,
    tone: meta.tone,
    title: meta.title,
    status,
    message,
    serviceId: id(source.serviceId ?? source.service?.id),
    panel: id(source.panel),
    requestId: id(source.requestId),
  };
}

export function createSettlementActivityFeedProjection(options = {}) {
  const historyLimit = integer(options.historyLimit, 1, SETTLEMENT_ACTIVITY_FEED_LIMITS.history, SETTLEMENT_ACTIVITY_FEED_LIMITS.history);
  const settlementId = id(options.settlementId, 'settlement');
  let sequence = 0;
  let disposed = false;
  let history = [];
  const snapshot = () => {
    const events = history.slice(-historyLimit);
    const byTone = events.reduce((acc, item) => ({ ...acc, [item.tone]: (acc[item.tone] ?? 0) + 1 }), {});
    return Object.freeze({
      version: SETTLEMENT_ACTIVITY_FEED_VERSION,
      settlementId,
      disposed,
      total: events.length,
      events: Object.freeze(events.map((event) => Object.freeze({ ...event }))),
      unread: events.filter((event) => event.status === 'error' || event.status === 'blocked').length,
      byTone: Object.freeze(byTone),
      fingerprint: digest({ settlementId, disposed, events }),
    });
  };
  const ingest = (event) => {
    if (disposed) return snapshot();
    const normalized = normalizeEvent(event, ++sequence);
    history = [...history, normalized].slice(-historyLimit);
    return snapshot();
  };
  const ingestMany = (events = []) => {
    for (const event of Array.isArray(events) ? events.slice(0, historyLimit * 2) : []) ingest(event);
    return snapshot();
  };
  const clear = () => { history = []; return snapshot(); };
  const dispose = () => { disposed = true; history = []; return snapshot(); };
  return Object.freeze({ ingest, ingestMany, read: snapshot, clear, dispose });
}

export function validateSettlementActivityFeedSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return { ok: false, reason: 'snapshot-required' };
  if (!Number.isInteger(snapshot.total) || snapshot.total < 0 || snapshot.total > SETTLEMENT_ACTIVITY_FEED_LIMITS.history) return { ok: false, reason: 'invalid-total' };
  if (!Array.isArray(snapshot.events) || snapshot.events.length !== snapshot.total) return { ok: false, reason: 'invalid-events' };
  if (snapshot.events.some((event) => !event.id || !event.name || !Number.isFinite(event.at))) return { ok: false, reason: 'invalid-event' };
  return { ok: true, reason: '' };
}
