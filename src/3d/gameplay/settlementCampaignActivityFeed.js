/**
 * Settlement campaign activity feed.
 * Read-only UX projection over the existing runtime view model/history.
 * No authoritative state, handler, scene, inventory or material ownership.
 */

export const SETTLEMENT_ACTIVITY_FEED_VERSION = 1;
export const SETTLEMENT_ACTIVITY_FEED_LIMITS = Object.freeze({ history: 48, text: 160, items: 24 });

const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_ACTIVITY_FEED_LIMITS.text) : fallback;
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Math.trunc(finite(value, fallback))));
const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

const ACTION_LABELS = Object.freeze({
  enter: 'Yerleşime giriş', exit: 'Yerleşimden çıkış', talk: 'Diyalog', trade: 'Takas',
  buy: 'Satın alma', sell: 'Satış', craft: 'Üretim', equip: 'Kuşanma', acceptQuest: 'Görev kabulü',
  advanceQuest: 'Görev ilerlemesi', travel: 'Seyahat', rest: 'Dinlenme', train: 'Eğitim', save: 'Kayıt',
  open: 'Hizmet açıldı', close: 'Hizmet kapandı', panel: 'Panel değişti', feedback: 'İşlem geri bildirimi',
});

const STATUS = Object.freeze({ ok: 'success', blocked: 'blocked', error: 'error', info: 'info' });

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

function normalizeEntry(raw = {}, index = 0) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const action = text(source.action ?? source.type, 'info');
  const status = Object.values(STATUS).includes(source.status) ? source.status : STATUS.info;
  const label = text(source.label, ACTION_LABELS[action] ?? action);
  const message = text(source.message ?? source.reason, status === STATUS.success ? 'İşlem tamamlandı.' : 'İşlem sonucu güncellendi.');
  return Object.freeze({
    sequence: integer(source.sequence, 0, 999999, index + 1),
    at: finite(source.at, 0),
    action,
    label,
    status,
    code: text(source.code),
    message,
    serviceId: text(source.serviceId),
    nodeId: text(source.nodeId),
    requestId: text(source.requestId),
  });
}

function deriveFromView(view = {}) {
  const source = view && typeof view === 'object' ? view : {};
  const feedback = source.feedback && typeof source.feedback === 'object' ? source.feedback : null;
  const history = Array.isArray(source.history) ? source.history : [];
  const entries = history.map((entry, index) => normalizeEntry(entry, index));
  if (feedback) entries.push(normalizeEntry({
    ...feedback,
    action: feedback.action || 'feedback',
    type: 'feedback',
    at: source.revision,
    sequence: entries.length + 1,
  }, entries.length));
  return entries.slice(-SETTLEMENT_ACTIVITY_FEED_LIMITS.history);
}

export function buildSettlementActivityFeed(viewModel = {}, options = {}) {
  const entries = deriveFromView(viewModel);
  const limit = integer(options.limit, 1, SETTLEMENT_ACTIVITY_FEED_LIMITS.history, 12);
  const visible = entries.slice(-limit).reverse();
  const statusCounts = { success: 0, blocked: 0, error: 0, info: 0 };
  for (const entry of visible) statusCounts[entry.status] += 1;
  const latest = visible[0] ?? null;
  const source = viewModel && typeof viewModel === 'object' ? viewModel : {};
  const explicitUnread = Number.isFinite(Number(options.unread)) ? Math.max(0, Math.trunc(Number(options.unread))) : null;
  const readThroughSequence = Number.isFinite(Number(options.readThroughSequence))
    ? Math.max(0, Math.trunc(Number(options.readThroughSequence)))
    : null;
  const derivedUnread = readThroughSequence == null
    ? 0
    : visible.filter((entry) => entry.sequence > readThroughSequence).length;
  const unread = integer(explicitUnread ?? derivedUnread, 0, visible.length, 0);
  const feed = {
    version: SETTLEMENT_ACTIVITY_FEED_VERSION,
    settlementId: text(source.player?.settlementId, text(source.settlementId, 'settlement')),
    activeService: text(source.activeService),
    panel: text(source.panel, 'overview'),
    latest,
    entries: visible,
    statusCounts,
    unread,
    readThroughSequence: readThroughSequence ?? 0,
  };
  return Object.freeze({ ...feed, digest: digest(feed) });
}

export function acknowledgeSettlementActivityFeed(feed = {}, readThroughSequence = 0) {
  const source = feed && typeof feed === 'object' ? feed : {};
  const entries = Array.isArray(source.entries) ? source.entries : [];
  const maxSequence = entries.reduce((max, entry) => Math.max(max, integer(entry?.sequence, 0, 999999, 0)), 0);
  const acknowledged = integer(readThroughSequence, 0, maxSequence, 0);
  const next = { ...source, unread: entries.filter((entry) => integer(entry?.sequence, 0, 999999, 0) > acknowledged).length, readThroughSequence: acknowledged };
  return Object.freeze({ ...next, digest: digest(next) });
}

export function summarizeSettlementActivityFeed(feed = {}) {
  const source = feed && typeof feed === 'object' ? feed : {};
  const latest = source.latest && typeof source.latest === 'object' ? source.latest : null;
  const entries = Array.isArray(source.entries) ? source.entries : [];
  return Object.freeze({
    digest: text(source.digest),
    count: entries.length,
    unread: integer(source.unread, 0, entries.length, 0),
    readThroughSequence: integer(source.readThroughSequence, 0, 999999, 0),
    latestAction: text(latest?.action),
    latestStatus: text(latest?.status),
    latestMessage: text(latest?.message),
  });
}

export function serializeSettlementActivityFeed(feed = {}) {
  return JSON.stringify(clone(feed));
}
