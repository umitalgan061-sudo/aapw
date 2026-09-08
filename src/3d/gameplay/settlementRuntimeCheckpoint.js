/**
 * Save/load-safe checkpoint adapter for the existing settlement vertical slice.
 *
 * It does not persist authoritative game state itself. Instead it validates and
 * serializes the slice's public snapshot plus caller-owned journey metadata so
 * a save system can resume the same interaction rail without inventing a new
 * settlement, quest, inventory or persistence framework.
 */

export const SETTLEMENT_CHECKPOINT_VERSION = 1;
export const SETTLEMENT_CHECKPOINT_LIMITS = Object.freeze({
  id: 96,
  text: 160,
  visited: 24,
  history: 32,
  metadata: 16,
});

function normalizeText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_CHECKPOINT_LIMITS.text) : fallback;
}

function normalizeId(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_CHECKPOINT_LIMITS.id) : fallback;
}

function finiteInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function sortedIds(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((entry) => normalizeId(entry)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, SETTLEMENT_CHECKPOINT_LIMITS.visited);
}

function safeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [key, raw] of Object.entries(value).slice(0, SETTLEMENT_CHECKPOINT_LIMITS.metadata)) {
    const normalizedKey = normalizeId(key);
    if (!normalizedKey) continue;
    if (typeof raw === 'string') output[normalizedKey] = normalizeText(raw);
    else if (typeof raw === 'number' && Number.isFinite(raw)) output[normalizedKey] = raw;
    else if (typeof raw === 'boolean') output[normalizedKey] = raw;
  }
  return output;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hash(value) {
  let result = 2166136261;
  const input = String(value);
  for (let index = 0; index < input.length; index += 1) {
    result ^= input.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

export function createSettlementCheckpoint(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const snapshot = source.snapshot && typeof source.snapshot === 'object' ? source.snapshot : {};
  const history = Array.isArray(source.history) ? source.history.slice(-SETTLEMENT_CHECKPOINT_LIMITS.history) : [];
  const payload = {
    version: SETTLEMENT_CHECKPOINT_VERSION,
    settlementId: normalizeId(source.settlementId || snapshot.settlementId, 'settlement'),
    sliceId: normalizeId(source.sliceId || snapshot.sliceId, 'settlement-vertical-slice'),
    nodeId: normalizeId(source.nodeId || snapshot.nodeId),
    visited: sortedIds(source.visited || snapshot.visited),
    historyLength: Math.max(0, finiteInteger(source.historyLength ?? snapshot.historyLength, history.length)),
    history: history.map((event) => ({
      sequence: Math.max(0, finiteInteger(event?.sequence, 0)),
      action: normalizeId(event?.action, 'unknown'),
      nodeId: normalizeId(event?.nodeId),
      result: normalizeId(event?.result, 'unknown'),
      message: normalizeText(event?.message),
    })),
    metadata: safeMetadata(source.metadata),
  };
  return Object.freeze({
    ...payload,
    fingerprint: hash(stableStringify(payload)),
  });
}

export function serializeSettlementCheckpoint(checkpoint) {
  const normalized = createSettlementCheckpoint(checkpoint);
  return JSON.stringify(normalized);
}

export function restoreSettlementCheckpoint(serialized, expected = {}) {
  let parsed;
  try {
    parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  } catch {
    return Object.freeze({ ok: false, reason: 'invalid-json' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return Object.freeze({ ok: false, reason: 'invalid-checkpoint' });
  }
  if (finiteInteger(parsed.version, -1) !== SETTLEMENT_CHECKPOINT_VERSION) {
    return Object.freeze({ ok: false, reason: 'unsupported-version' });
  }
  const checkpoint = createSettlementCheckpoint(parsed);
  if (expected.settlementId && checkpoint.settlementId !== normalizeId(expected.settlementId)) {
    return Object.freeze({ ok: false, reason: 'settlement-mismatch' });
  }
  if (expected.sliceId && checkpoint.sliceId !== normalizeId(expected.sliceId)) {
    return Object.freeze({ ok: false, reason: 'slice-mismatch' });
  }
  return Object.freeze({ ok: true, checkpoint });
}
