/**
 * Versioned persistence ledger for browser-safe game state.
 *
 * The ledger is storage-agnostic: localStorage, IndexedDB, OPFS or a server adapter can implement
 * the tiny read/write/remove contract. It provides schema versions, migrations, checksums, journal
 * sequencing, corruption quarantine and atomic-ish two-slot writes without owning application data.
 */

import { finiteOr, integerOr, stableStringify, clamp } from './modernRuntimeContract.js';

const LEDGER_VERSION = 1;
const DEFAULT_SLOT_A = 'aapw.save.a';
const DEFAULT_SLOT_B = 'aapw.save.b';

function fnv1a(input) {
  let hash = 0x811c9dc5;
  const text = String(input);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function safeClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizeEnvelope(envelope) {
  return {
    ledgerVersion: integerOr(envelope?.ledgerVersion, LEDGER_VERSION),
    schemaVersion: integerOr(envelope?.schemaVersion, 1),
    revision: Math.max(0, integerOr(envelope?.revision, 0)),
    tick: Math.max(0, integerOr(envelope?.tick, 0)),
    timestampMs: Math.max(0, finiteOr(envelope?.timestampMs, 0)),
    checksum: String(envelope?.checksum || ''),
    payload: envelope?.payload ?? null,
  };
}

function validateEnvelope(envelope) {
  const problems = [];
  if (envelope?.ledgerVersion !== LEDGER_VERSION) problems.push('unsupported ledger version');
  if (!Number.isInteger(envelope?.schemaVersion) || envelope.schemaVersion < 1) problems.push('invalid schema version');
  if (!Number.isInteger(envelope?.revision) || envelope.revision < 0) problems.push('invalid revision');
  if (!Number.isInteger(envelope?.tick) || envelope.tick < 0) problems.push('invalid tick');
  if (!envelope?.checksum) problems.push('missing checksum');
  return Object.freeze({ valid: problems.length === 0, problems });
}

export function createMemoryPersistenceAdapter(seed = {}) {
  const store = new Map(Object.entries(seed));
  return Object.freeze({
    async read(key) { return store.has(key) ? store.get(key) : null; },
    async write(key, value) { store.set(String(key), String(value)); },
    async remove(key) { store.delete(String(key)); },
    async keys() { return [...store.keys()]; },
  });
}

export function createVersionedPersistenceLedger(options = {}) {
  const adapter = options.adapter || createMemoryPersistenceAdapter();
  const slotA = String(options.slotA || DEFAULT_SLOT_A);
  const slotB = String(options.slotB || DEFAULT_SLOT_B);
  const currentSchema = Math.max(1, integerOr(options.schemaVersion, 1));
  const migrations = new Map();
  let revision = 0;
  let activeSlot = null;
  let dirty = false;
  let corruptions = 0;
  let writes = 0;
  let reads = 0;

  function registerMigration(fromVersion, migrate) {
    const from = Math.max(1, integerOr(fromVersion, 1));
    if (typeof migrate !== 'function') throw new TypeError('Migration must be a function.');
    migrations.set(from, migrate);
    return ledger;
  }

  async function parseSlot(key) {
    if (!key) return null;
    reads += 1;
    const raw = await adapter.read(key);
    if (!raw) return null;
    try {
      const envelope = normalizeEnvelope(JSON.parse(raw));
      const validation = validateEnvelope(envelope);
      if (!validation.valid) throw new Error(validation.problems.join(', '));
      const expected = fnv1a(stableStringify({
        ledgerVersion: envelope.ledgerVersion,
        schemaVersion: envelope.schemaVersion,
        revision: envelope.revision,
        tick: envelope.tick,
        payload: envelope.payload,
      }));
      if (expected !== envelope.checksum) throw new Error('checksum mismatch');
      return envelope;
    } catch (error) {
      corruptions += 1;
      return { corrupt: true, key, error: String(error?.message || error) };
    }
  }

  async function recoverCandidates() {
    const candidates = await Promise.all([parseSlot(slotA), parseSlot(slotB)]);
    return candidates.filter((candidate) => candidate && !candidate.corrupt).sort((a, b) => b.revision - a.revision);
  }

  async function load() {
    const candidates = await recoverCandidates();
    if (!candidates.length) {
      activeSlot = null;
      revision = 0;
      return Object.freeze({ found: false, migrated: false, payload: null, revision: 0, tick: 0, source: null });
    }
    const winner = candidates[0];
    activeSlot = winner.revision === candidates[0].revision && (await parseSlot(slotA))?.revision === winner.revision ? slotA : slotB;
    let payload = safeClone(winner.payload);
    let version = winner.schemaVersion;
    let migrated = false;
    while (version < currentSchema) {
      const migration = migrations.get(version);
      if (!migration) throw new Error(`Missing migration ${version} -> ${version + 1}`);
      payload = await migration(safeClone(payload), { fromVersion: version, toVersion: version + 1 });
      version += 1;
      migrated = true;
    }
    revision = winner.revision;
    dirty = migrated;
    return Object.freeze({ found: true, migrated, payload, revision, tick: winner.tick, source: activeSlot, schemaVersion: version });
  }

  async function save(payload, metadata = {}) {
    const nextRevision = revision + 1;
    const envelope = {
      ledgerVersion: LEDGER_VERSION,
      schemaVersion: currentSchema,
      revision: nextRevision,
      tick: Math.max(0, integerOr(metadata.tick, 0)),
      timestampMs: Math.max(0, finiteOr(metadata.timestampMs, 0)),
      payload: safeClone(payload),
    };
    envelope.checksum = fnv1a(stableStringify(envelope));
    const nextSlot = activeSlot === slotA ? slotB : slotA;
    await adapter.write(nextSlot, JSON.stringify(envelope));
    const verified = await parseSlot(nextSlot);
    if (!verified || verified.corrupt || verified.revision !== nextRevision) {
      throw new Error('Persistence write verification failed.');
    }
    if (activeSlot) await adapter.remove(activeSlot);
    activeSlot = nextSlot;
    revision = nextRevision;
    dirty = false;
    writes += 1;
    return Object.freeze({ revision, tick: envelope.tick, slot: activeSlot, checksum: envelope.checksum });
  }

  async function clear() {
    await adapter.remove(slotA);
    await adapter.remove(slotB);
    activeSlot = null;
    revision = 0;
    dirty = false;
  }

  async function inspect() {
    const [a, b] = await Promise.all([parseSlot(slotA), parseSlot(slotB)]);
    return Object.freeze({
      ledgerVersion: LEDGER_VERSION,
      schemaVersion: currentSchema,
      revision,
      activeSlot,
      dirty,
      writes,
      reads,
      corruptions,
      slots: Object.freeze({ a: a?.corrupt ? 'corrupt' : a ? a.revision : 'empty', b: b?.corrupt ? 'corrupt' : b ? b.revision : 'empty' }),
    });
  }

  const ledger = {
    registerMigration,
    load,
    save,
    clear,
    inspect,
    get revision() { return revision; },
    get dirty() { return dirty; },
  };
  return Object.freeze(ledger);
}

export function createLocalStorageAdapter(storage = globalThis?.localStorage) {
  if (!storage) return createMemoryPersistenceAdapter();
  return Object.freeze({
    async read(key) { return storage.getItem(String(key)); },
    async write(key, value) { storage.setItem(String(key), String(value)); },
    async remove(key) { storage.removeItem(String(key)); },
    async keys() { return Object.keys(storage); },
  });
}

export function createSaveThrottler(save, options = {}) {
  if (typeof save !== 'function') throw new TypeError('save must be a function');
  const intervalMs = clamp(finiteOr(options.intervalMs, 5000), 250, 600000);
  let pending = null;
  let lastSaveMs = -Infinity;
  let saving = false;

  async function request(payload, nowMs = 0, force = false) {
    const time = Math.max(0, finiteOr(nowMs, 0));
    pending = payload;
    if (!force && time - lastSaveMs < intervalMs) return Object.freeze({ saved: false, queued: true });
    if (saving) return Object.freeze({ saved: false, queued: true });
    saving = true;
    const nextPayload = pending;
    pending = null;
    try {
      await save(nextPayload);
      lastSaveMs = time;
      return Object.freeze({ saved: true, queued: Boolean(pending) });
    } finally {
      saving = false;
    }
  }

  return Object.freeze({ request, get pending() { return pending; }, get saving() { return saving; } });
}

export function validatePersistedPayload(payload, validator) {
  if (typeof validator !== 'function') return Object.freeze({ valid: true, problems: [] });
  try {
    const result = validator(payload);
    if (result === true) return Object.freeze({ valid: true, problems: [] });
    if (result && typeof result === 'object') return Object.freeze({ valid: Boolean(result.valid), problems: result.problems || [] });
    return Object.freeze({ valid: Boolean(result), problems: result ? [] : ['validator rejected payload'] });
  } catch (error) {
    return Object.freeze({ valid: false, problems: [String(error?.message || error)] });
  }
}
