/**
 * Deterministic, read-only journal projection for the authored settlement slice.
 *
 * The existing vertical-slice event bridge remains authoritative for execution and persistence.
 * This module turns caller-owned event/result observations into a bounded UX/save summary without
 * mutating quests, inventory, economy, crafting, travel, NPCs, scene nodes, or material placement.
 */

export const SETTLEMENT_INTERACTION_JOURNAL_VERSION = 1;

const MAX_ENTRIES = 32;
const MAX_TEXT = 120;
const ACTION_ORDER = Object.freeze({
  enter: 0,
  interact: 1,
  talk: 2,
  trade: 3,
  craft: 4,
  travel: 5,
  acceptQuest: 6,
  advanceQuest: 7,
  save: 8,
  exit: 9,
});

function text(value, fallback = '') {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, MAX_TEXT) : fallback;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function bool(value) {
  return value === true;
}

function normalizeEvent(entry, index) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const action = text(source.action, 'unknown');
  const sequence = Math.max(0, Math.floor(finite(source.sequence, index)));
  return {
    sequence,
    action,
    ok: bool(source.ok),
    reason: text(source.reason),
    nodeId: text(source.nodeId),
    settlementId: text(source.settlementId),
    requestId: text(source.requestId),
    message: text(source.message),
    rewardCopper: clamp(Math.floor(finite(source.rewardCopper, 0)), -100000, 100000),
    rewardXp: clamp(Math.floor(finite(source.rewardXp, 0)), 0, 100000),
    questId: text(source.questId),
  };
}

function eventKey(entry) {
  return [entry.sequence, entry.action, entry.nodeId, entry.requestId, entry.reason].join(':');
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function digest(value) {
  let hash = 2166136261;
  for (const char of stableSerialize(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildSettlementInteractionJournal({ events = [], maxEntries = MAX_ENTRIES } = {}) {
  const boundedMax = clamp(Math.floor(finite(maxEntries, MAX_ENTRIES)), 1, MAX_ENTRIES);
  const normalized = Array.isArray(events) ? events.map(normalizeEvent) : [];
  const deduped = [];
  const seen = new Set();
  for (const entry of normalized) {
    const key = eventKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  deduped.sort((a, b) => a.sequence - b.sequence || (ACTION_ORDER[a.action] ?? 99) - (ACTION_ORDER[b.action] ?? 99) || eventKey(a).localeCompare(eventKey(b)));
  const entries = deduped.slice(-boundedMax);
  const successfulActions = entries.filter((entry) => entry.ok).map((entry) => entry.action);
  const failedActions = entries.filter((entry) => !entry.ok && entry.action !== 'unknown').map((entry) => entry.action);
  const last = entries.at(-1) || null;
  const quests = [...new Set(entries.map((entry) => entry.questId).filter(Boolean))].slice(0, 12);
  const summary = {
    entryCount: entries.length,
    successfulCount: successfulActions.length,
    failedCount: failedActions.length,
    lastAction: last?.action || '',
    lastNodeId: last?.nodeId || '',
    lastReason: last?.reason || '',
    rewardCopper: entries.reduce((total, entry) => total + entry.rewardCopper, 0),
    rewardXp: entries.reduce((total, entry) => total + entry.rewardXp, 0),
    questIds: quests,
  };
  const result = {
    version: SETTLEMENT_INTERACTION_JOURNAL_VERSION,
    entries,
    summary,
    stableDigest: digest({ entries, summary }),
  };
  return freezeDeep(result);
}

export function serializeSettlementInteractionJournal(journal) {
  return stableSerialize(journal && typeof journal === 'object' ? journal : buildSettlementInteractionJournal());
}

export function settlementInteractionJournalIsEmpty(journal) {
  return !journal || !Array.isArray(journal.entries) || journal.entries.length === 0;
}

export function validateSettlementInteractionJournal(journal) {
  const value = journal && typeof journal === 'object' ? journal : {};
  const errors = [];
  if (value.version !== SETTLEMENT_INTERACTION_JOURNAL_VERSION) errors.push('version');
  if (!Array.isArray(value.entries)) errors.push('entries');
  if (!value.summary || typeof value.summary !== 'object') errors.push('summary');
  if (typeof value.stableDigest !== 'string' || !value.stableDigest) errors.push('stable-digest');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
