/**
 * Read-only notification policy for settlement gameplay feedback.
 * Existing runtime/quest/economy owners remain authoritative; this module only
 * turns action outcomes and activity entries into bounded UX notifications.
 */

const MAX_TEXT = 160;
const MAX_NOTIFICATIONS = 24;
const MAX_ACTIONS = 48;
const ALLOWED_STATUS = new Set(['success', 'blocked', 'error', 'info']);

const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, MAX_TEXT) : fallback;
};

const integer = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
};

const status = (value) => (ALLOWED_STATUS.has(value) ? value : 'info');

const clone = (value) => {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
};

const stable = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};

const digest = (value) => {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const defaultLabel = (action, resultStatus) => {
  const labels = {
    buy: 'Satın alma', sell: 'Satış', trade: 'Takas', craft: 'Üretim',
    travel: 'Seyahat', talk: 'Diyalog', rest: 'Dinlenme', save: 'Kayıt',
  };
  return `${labels[action] ?? 'Yerleşim işlemi'}: ${resultStatus === 'success' ? 'tamamlandı' : resultStatus === 'blocked' ? 'engellendi' : resultStatus === 'error' ? 'hata' : 'bilgi'}`;
};

function normalizeAction(raw, sequence) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const action = text(source.action, 'unknown');
  const resultStatus = status(source.status ?? (source.ok === true ? 'success' : source.ok === false ? 'blocked' : 'info'));
  return {
    sequence: Math.max(0, integer(source.sequence, sequence)),
    action,
    status: resultStatus,
    code: text(source.code ?? source.reason),
    label: text(source.label, defaultLabel(action, resultStatus)),
    message: text(source.message, resultStatus === 'success' ? 'İşlem tamamlandı.' : resultStatus === 'blocked' ? 'Bu işlem şu anda kullanılamıyor.' : 'Yerleşim durumu güncellendi.'),
    serviceId: text(source.serviceId),
    nodeId: text(source.nodeId),
    requestId: text(source.requestId),
    at: Math.max(0, integer(source.at, 0)),
  };
}

function normalizeInput(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const actions = Array.isArray(source.actions) ? source.actions.slice(-MAX_ACTIONS) : [];
  const activity = Array.isArray(source.activity) ? source.activity.slice(-MAX_NOTIFICATIONS) : [];
  return { actions, activity, readThroughSequence: Math.max(0, integer(source.readThroughSequence, 0)) };
}

export function buildSettlementNotificationPolicy(input = {}) {
  const { actions, activity, readThroughSequence } = normalizeInput(input);
  const normalizedActions = actions.map((item, index) => normalizeAction(item, index + 1));
  const normalizedActivity = activity.map((item, index) => normalizeAction(item, index + 1));
  const merged = [...normalizedActivity, ...normalizedActions]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-MAX_NOTIFICATIONS);
  const visible = merged.filter((item) => item.sequence > readThroughSequence);
  const counts = visible.reduce((result, item) => {
    result[item.status] += 1;
    return result;
  }, { success: 0, blocked: 0, error: 0, info: 0 });
  const latest = visible.length ? visible[visible.length - 1] : null;
  const policy = {
    version: 1,
    notifications: visible.map((item) => ({ ...item })),
    latest: latest ? { ...latest } : null,
    counts,
    unreadCount: visible.length,
    hasBlockingFeedback: counts.blocked > 0 || counts.error > 0,
    digest: digest({ visible, counts, readThroughSequence }),
  };
  return Object.freeze({
    ...policy,
    notifications: Object.freeze(policy.notifications.map((item) => Object.freeze(item))),
    latest: policy.latest ? Object.freeze(policy.latest) : null,
    counts: Object.freeze(policy.counts),
  });
}

export function serializeSettlementNotificationPolicy(policy) {
  const value = policy && typeof policy === 'object' ? policy : buildSettlementNotificationPolicy();
  return JSON.stringify({
    version: integer(value.version, 1), notifications: clone(value.notifications) ?? [],
    latest: clone(value.latest), counts: clone(value.counts) ?? { success: 0, blocked: 0, error: 0, info: 0 },
    unreadCount: Math.max(0, integer(value.unreadCount, 0)), hasBlockingFeedback: value.hasBlockingFeedback === true,
    digest: text(value.digest),
  });
}
