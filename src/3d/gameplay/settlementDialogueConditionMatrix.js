/**
 * Read-only dialogue condition matrix for settlement UX.
 * Existing QuestSystem/dialogue runtime remains authoritative for execution.
 */
export const SETTLEMENT_DIALOGUE_CONDITION_MATRIX_VERSION = 1;
export const SETTLEMENT_DIALOGUE_MATRIX_LIMITS = Object.freeze({ rows: 48, conditions: 8, text: 160 });

const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_DIALOGUE_MATRIX_LIMITS.text) : fallback;
};
const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
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
function normalizeRecord(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const quests = {};
  const flags = {};
  const inventory = {};
  const skills = {};
  for (const [key, value] of Object.entries(source.quests ?? {}).slice(0, 64)) {
    const item = value && typeof value === 'object' ? value : {};
    quests[text(key)] = { state: text(item.state, 'unknown'), completed: Boolean(item.completed), step: integer(item.step, 0, 999, 0) };
  }
  for (const [key, value] of Object.entries(source.flags ?? {}).slice(0, 64)) flags[text(key)] = Boolean(value);
  for (const [key, value] of Object.entries(source.inventory ?? {}).slice(0, 96)) inventory[text(key)] = integer(value, 0, 9999, 0);
  for (const [key, value] of Object.entries(source.skills ?? {}).slice(0, 24)) skills[text(key)] = integer(value, 0, 999, 0);
  return {
    reputation: Math.max(-9999, Math.min(9999, finite(source.reputation, 0))),
    copper: integer(source.copper, 0, 999999, 0),
    health: Math.max(0, Math.min(100, finite(source.health, 100))),
    alive: source.alive !== false,
    insideSettlement: source.insideSettlement !== false,
    settlementId: text(source.settlementId, 'settlement'),
    quests, flags, inventory, skills,
  };
}
function evaluateCondition(condition, record) {
  const target = text(condition?.target);
  const threshold = finite(condition?.threshold, 1);
  switch (text(condition?.type)) {
    case 'flag': return record.flags[target] === true ? { ok: true, reason: '' } : { ok: false, reason: 'flag-required' };
    case 'quest': {
      const quest = record.quests[target];
      return quest?.completed || quest?.state === 'completed' ? { ok: true, reason: '' } : { ok: false, reason: 'quest-required' };
    }
    case 'item': return (record.inventory[target] || 0) >= threshold ? { ok: true, reason: '' } : { ok: false, reason: 'item-required' };
    case 'skill': return (record.skills[target] || 0) >= threshold ? { ok: true, reason: '' } : { ok: false, reason: 'skill-required' };
    case 'reputation': return record.reputation >= threshold ? { ok: true, reason: '' } : { ok: false, reason: 'reputation-too-low' };
    case 'copper': return record.copper >= threshold ? { ok: true, reason: '' } : { ok: false, reason: 'insufficient-copper' };
    default: return { ok: false, reason: 'unknown-condition' };
  }
}
function normalizeCondition(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return { type: text(source.type, 'unknown'), target: text(source.target), threshold: finite(source.threshold, 1) };
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

export function createSettlementDialogueConditionMatrix(options = {}) {
  const record = normalizeRecord(options.record);
  const rows = Array.isArray(options.dialogues) ? options.dialogues.slice(0, SETTLEMENT_DIALOGUE_MATRIX_LIMITS.rows) : [];
  const matrix = rows.map((raw, index) => {
    const source = raw && typeof raw === 'object' ? raw : {};
    const conditions = Array.isArray(source.conditions) ? source.conditions.slice(0, SETTLEMENT_DIALOGUE_MATRIX_LIMITS.conditions).map(normalizeCondition) : [];
    const results = conditions.map((condition) => evaluateCondition(condition, record));
    const baseOk = record.alive && record.insideSettlement;
    const ok = baseOk && results.every((item) => item.ok);
    const reason = !record.alive ? 'defeated' : !record.insideSettlement ? 'outside-settlement' : (results.find((item) => !item.ok)?.reason ?? '');
    return {
      id: text(source.id, `dialogue-${index + 1}`),
      speakerId: text(source.speakerId, 'settlement-npc'),
      label: text(source.label, 'Diyalog seçeneği'),
      priority: integer(source.priority, 0, 999, 0),
      state: ok ? 'available' : 'blocked',
      reason,
      conditions,
      passed: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
    };
  }).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  const output = {
    version: SETTLEMENT_DIALOGUE_CONDITION_MATRIX_VERSION,
    settlementId: record.settlementId,
    rows,
    summary: {
      total: rows.length,
      available: rows.filter((row) => row.state === 'available').length,
      blocked: rows.filter((row) => row.state === 'blocked').length,
      primaryDialogueId: rows.find((row) => row.state === 'available')?.id ?? rows[0]?.id ?? null,
    },
    digest: '',
  };
  output.digest = digest(output);
  return freeze(output);
}

export function serializeSettlementDialogueConditionMatrix(value) { return stable(value); }
export function applySettlementDialogueConditionMatrix(target, value) {
  if (!target || typeof target !== 'object') return target;
  target.settlementDialogueConditionMatrix = clone(value);
  return target;
}
