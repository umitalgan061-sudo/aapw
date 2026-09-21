/**
 * Bounded, deterministic journal for the existing player combat event stream.
 *
 * This module only records caller-owned combat receipts (attack-window,
 * combat-feedback, guard/parry/dodge and equipment condition snapshots). It
 * does not own player state, damage, animation, scene, input or equipment
 * mutation. Consumers can use the immutable journal for replay/debug/HUD/VFX
 * adapters without introducing another combat framework.
 * @module gameplay/playerCombatEventJournal
 */

const JOURNAL_VERSION = '2026-09-17-v1';
const DEFAULT_LIMIT = 96;
const EVENT_KINDS = new Set([
  'attack-window',
  'combat-feedback',
  'defense',
  'equipment-condition',
]);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const freeze = (value) => Object.freeze(value);

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') return freeze({});
  const normalized = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value && typeof value === 'object') {
      normalized[key] = Array.isArray(value)
        ? freeze(value.map((entry) => normalizePayload(entry)))
        : freeze(normalizePayload(value));
    } else if (typeof value === 'number') {
      normalized[key] = Number(value.toFixed(6));
    } else if (typeof value === 'string' || typeof value === 'boolean' || value === null) {
      normalized[key] = value;
    }
  }
  return freeze(normalized);
}

function compareEntries(a, b) {
  return (a.sequence - b.sequence)
    || (a.timestampMs - b.timestampMs)
    || a.kind.localeCompare(b.kind)
    || a.id.localeCompare(b.id);
}

export function createPlayerCombatEventJournal(options = {}) {
  const limit = clamp(Math.floor(finite(options.limit, DEFAULT_LIMIT)), 8, 512);
  let disposed = false;
  let nextId = 1;
  let nextSequence = 1;
  const entries = [];

  function append(kind, payload = {}, metadata = {}) {
    if (disposed || !EVENT_KINDS.has(kind)) return null;
    const sequence = Math.max(nextSequence, Math.floor(finite(metadata.sequence, nextSequence)));
    nextSequence = sequence + 1;
    const timestampMs = Math.max(0, finite(metadata.timestampMs, sequence));
    const entry = freeze({
      version: JOURNAL_VERSION,
      id: `${kind}:${nextId++}`,
      kind,
      sequence,
      timestampMs,
      actorId: typeof metadata.actorId === 'string' ? metadata.actorId : 'player',
      payload: normalizePayload(payload),
    });
    entries.push(entry);
    entries.sort(compareEntries);
    while (entries.length > limit) entries.shift();
    return entry;
  }

  function appendAttackWindow(detail, metadata) { return append('attack-window', detail, metadata); }
  function appendCombatFeedback(detail, metadata) { return append('combat-feedback', detail, metadata); }
  function appendDefense(detail, metadata) { return append('defense', detail, metadata); }
  function appendEquipmentCondition(detail, metadata) { return append('equipment-condition', detail, metadata); }

  function snapshot() {
    return freeze({
      version: JOURNAL_VERSION,
      disposed,
      limit,
      size: entries.length,
      entries: freeze(entries.slice()),
      digest: entries.map((entry) => `${entry.kind}:${entry.sequence}:${entry.id}`).join('|'),
    });
  }

  function since(sequence = 0) {
    const floor = Math.floor(finite(sequence, 0));
    return freeze(entries.filter((entry) => entry.sequence > floor));
  }

  function replayDigest() {
    return entries.map((entry) => JSON.stringify({
      id: entry.id,
      kind: entry.kind,
      sequence: entry.sequence,
      timestampMs: entry.timestampMs,
      actorId: entry.actorId,
      payload: entry.payload,
    })).join('\n');
  }

  function reset() {
    entries.length = 0;
    nextId = 1;
    nextSequence = 1;
  }

  function dispose() {
    disposed = true;
    entries.length = 0;
  }

  return Object.freeze({
    appendAttackWindow,
    appendCombatFeedback,
    appendDefense,
    appendEquipmentCondition,
    snapshot,
    since,
    replayDigest,
    reset,
    dispose,
  });
}

export function validatePlayerCombatEventJournalSnapshot(snapshot) {
  return Boolean(snapshot)
    && snapshot.version === JOURNAL_VERSION
    && Number.isInteger(snapshot.limit)
    && snapshot.limit >= 8
    && snapshot.limit <= 512
    && Number.isInteger(snapshot.size)
    && Array.isArray(snapshot.entries)
    && snapshot.size === snapshot.entries.length
    && snapshot.entries.every((entry) => EVENT_KINDS.has(entry.kind)
      && Number.isInteger(entry.sequence)
      && typeof entry.id === 'string'
      && entry.payload
      && typeof entry.payload === 'object');
}

export { JOURNAL_VERSION };
