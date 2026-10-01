/**
 * Read-only dialogue-condition preflight for the authored settlement campaign.
 * Existing settlementCampaignRuntime remains authoritative for execution and mutation.
 */

const MAX_LINES = 12;
const MAX_TEXT = 96;
const CONDITION_TYPES = Object.freeze(['flag', 'reputation', 'quest', 'item', 'skill']);

const clean = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, MAX_TEXT) : fallback;
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const stable = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const digest = (value) => {
  let hash = 2166136261;
  const text = stable(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
};
const list = (value) => Array.isArray(value) ? value.slice(0, MAX_LINES) : [];
const conditionId = (value) => clean(value).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
const normalizeCondition = (condition = {}) => {
  const type = clean(condition.type);
  return {
    id: conditionId(condition.id || `${type}:${condition.target}`),
    type: CONDITION_TYPES.includes(type) ? type : '',
    target: clean(condition.target),
    operator: clean(condition.operator, type === 'reputation' || type === 'skill' ? '>=' : '=='),
    value: finite(condition.value),
  };
};

function evaluate(condition, snapshot) {
  const actual = {
    flag: snapshot.flags?.[condition.target] === true ? 1 : 0,
    reputation: finite(snapshot.reputation?.[condition.target]),
    quest: snapshot.quests?.[condition.target] === true ? 1 : 0,
    item: finite(snapshot.items?.[condition.target]),
    skill: finite(snapshot.skills?.[condition.target]),
  }[condition.type];
  if (!condition.type || !condition.target) return { ok: false, reason: 'invalid-condition', actual: 0 };
  if (condition.type === 'flag' || condition.type === 'quest') return { ok: actual === condition.value || (condition.value === 0 && actual === 1), reason: actual ? 'present' : 'missing', actual };
  if (condition.operator === '>=') return { ok: actual >= condition.value, reason: actual >= condition.value ? 'met' : 'below-threshold', actual };
  if (condition.operator === '>') return { ok: actual > condition.value, reason: actual > condition.value ? 'met' : 'below-threshold', actual };
  if (condition.operator === '<=') return { ok: actual <= condition.value, reason: actual <= condition.value ? 'met' : 'above-threshold', actual };
  if (condition.operator === '<') return { ok: actual < condition.value, reason: actual < condition.value ? 'met' : 'above-threshold', actual };
  return { ok: actual === condition.value, reason: actual === condition.value ? 'met' : 'mismatch', actual };
}

export function buildSettlementDialoguePreflight(line = {}, snapshot = {}) {
  const conditions = list(line.conditions).map(normalizeCondition).filter((entry) => entry.type && entry.target);
  const checks = conditions.map((condition) => Object.freeze({ ...condition, ...evaluate(condition, snapshot) }));
  const failed = checks.filter((entry) => !entry.ok);
  const result = {
    version: 1,
    lineId: clean(line.id, 'settlement-dialogue-line'),
    speakerId: clean(line.speakerId, 'settlement-npc'),
    text: clean(line.text, '...'),
    conditions: Object.freeze(checks),
    available: failed.length === 0,
    failedCount: failed.length,
    blockedReason: failed[0]?.reason || '',
    nextAction: failed.length ? 'showBlockedDialogue' : 'presentDialogue',
    fingerprint: '',
  };
  result.fingerprint = digest({ ...result, fingerprint: undefined });
  return freeze(result);
}

export function buildSettlementDialogueBatch(lines = [], snapshot = {}) {
  const rows = list(lines).map((line) => buildSettlementDialoguePreflight(line, snapshot));
  const available = rows.filter((row) => row.available);
  return freeze({
    version: 1,
    rows: Object.freeze(rows),
    availableCount: available.length,
    blockedCount: rows.length - available.length,
    firstAvailable: available[0]?.lineId || '',
    fingerprint: digest(rows),
  });
}

export function serializeSettlementDialoguePreflight(value) { return stable(value); }
