// @ts-nocheck
/**
 * Versioned save-game repository.
 *
 * Storage is intentionally isolated from gameplay state ownership. Callers provide a JSON-safe
 * snapshot and receive immutable metadata/results. The repository uses localStorage synchronously
 * when requested, with IndexedDB available as an asynchronous durable backend. A canonical serializer
 * and deterministic checksum prevent malformed or stale payloads from being treated as valid saves.
 */

const STORAGE_VERSION = 3;
const DEFAULT_SLOT = 'autosave';
const DEFAULT_NAMESPACE = 'westeros3d';
const MAX_SLOTS = 8;
const MAX_PAYLOAD_BYTES = 768 * 1024;
const MAX_STRING_LENGTH = 200000;

const textEncoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;

function n(value, fallback = 0) { const x = Number(value); return Number.isFinite(x) ? x : fallback; }
function integer(value, fallback = 0) { return Math.round(n(value, fallback)); }
function clamp(value, low, high) { return Math.min(high, Math.max(low, n(value, low))); }
function string(value, fallback = '') { return typeof value === 'string' ? value : fallback; }
function safeJson(value) { try { return JSON.parse(JSON.stringify(value)); } catch { return null; } }

function normalizeSlot(slot) {
  const value = string(slot, DEFAULT_SLOT).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return (value || DEFAULT_SLOT).slice(0, 48);
}
function normalizeNamespace(namespace) {
  const value = string(namespace, DEFAULT_NAMESPACE).trim().replace(/[^a-z0-9_.-]/gi, '-');
  return (value || DEFAULT_NAMESPACE).slice(0, 64);
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = sortObjectKeys(value[key]);
  return output;
}

export function canonicalizeSnapshot(snapshot) {
  const clone = safeJson(snapshot);
  if (clone === null || typeof clone !== 'object') throw new TypeError('save snapshot must be JSON-serializable');
  return sortObjectKeys(clone);
}

export function canonicalStringify(value) {
  return JSON.stringify(sortObjectKeys(value));
}

export function byteLength(value) {
  const text = typeof value === 'string' ? value : canonicalStringify(value);
  if (textEncoder) return textEncoder.encode(text).length;
  return unescape(encodeURIComponent(text)).length;
}

export function checksumString(value) {
  const text = typeof value === 'string' ? value : canonicalStringify(value);
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 0x01000193);
    hashB ^= code + index;
    hashB = Math.imul(hashB, 0x85ebca6b);
  }
  return `${(hashA >>> 0).toString(16).padStart(8, '0')}${(hashB >>> 0).toString(16).padStart(8, '0')}`;
}

export function createSaveEnvelope({ slot = DEFAULT_SLOT, snapshot, timestampMs = 0, namespace = DEFAULT_NAMESPACE, metadata = {} } = {}) {
  const normalizedSlot = normalizeSlot(slot);
  const normalizedNamespace = normalizeNamespace(namespace);
  const payload = canonicalizeSnapshot(snapshot ?? {});
  const payloadText = canonicalStringify(payload);
  const bytes = byteLength(payloadText);
  if (bytes > MAX_PAYLOAD_BYTES) throw new RangeError(`SAVE_PAYLOAD_TOO_LARGE:${bytes}`);
  const safeMetadata = canonicalizeSnapshot(metadata ?? {});
  const envelope = {
    schema: 'aapw.save',
    version: STORAGE_VERSION,
    namespace: normalizedNamespace,
    slot: normalizedSlot,
    createdAtMs: Math.max(0, integer(timestampMs)),
    updatedAtMs: Math.max(0, integer(timestampMs)),
    payloadBytes: bytes,
    metadata: safeMetadata,
    payload,
  };
  const digest = checksumString(canonicalStringify(envelope));
  return Object.freeze({ ...envelope, checksum: digest });
}

export function validateSaveEnvelope(envelope, { namespace = DEFAULT_NAMESPACE, expectedSlot = null, nowMs = Date.now(), maxAgeMs = Number.POSITIVE_INFINITY } = {}) {
  if (!envelope || envelope.schema !== 'aapw.save') return { valid: false, reason: 'SCHEMA' };
  if (envelope.version !== STORAGE_VERSION) return { valid: false, reason: 'VERSION', version: envelope.version };
  if (normalizeNamespace(envelope.namespace) !== normalizeNamespace(namespace)) return { valid: false, reason: 'NAMESPACE' };
  if (expectedSlot !== null && normalizeSlot(envelope.slot) !== normalizeSlot(expectedSlot)) return { valid: false, reason: 'SLOT' };
  if (!Number.isInteger(envelope.createdAtMs) || !Number.isInteger(envelope.updatedAtMs)) return { valid: false, reason: 'TIMESTAMP' };
  if (envelope.createdAtMs < 0 || envelope.updatedAtMs < envelope.createdAtMs) return { valid: false, reason: 'TIMESTAMP_ORDER' };
  if (envelope.payloadBytes > MAX_PAYLOAD_BYTES) return { valid: false, reason: 'SIZE' };
  if (Math.abs(n(nowMs) - envelope.updatedAtMs) > maxAgeMs) return { valid: false, reason: 'STALE' };
  if (canonicalStringify(envelope.payload).length > MAX_STRING_LENGTH) return { valid: false, reason: 'STRING_LIMIT' };
  const copy = { ...envelope };
  delete copy.checksum;
  const expected = checksumString(canonicalStringify(copy));
  if (expected !== envelope.checksum) return { valid: false, reason: 'CHECKSUM', expected, actual: envelope.checksum };
  if (byteLength(envelope.payload) !== envelope.payloadBytes) return { valid: false, reason: 'BYTE_LENGTH' };
  return { valid: true, reason: 'OK', version: envelope.version, slot: envelope.slot };
}

function storageKey(namespace, slot) { return `${normalizeNamespace(namespace)}:save:${normalizeSlot(slot)}`; }
function listKey(namespace) { return `${normalizeNamespace(namespace)}:slots`; }

function getStorage(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

function readStoredEnvelope(storage, namespace, slot) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(namespace, slot));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function readSlotList(storage, namespace) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(listKey(namespace));
    const slots = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(slots)) return [];
    return slots.map(normalizeSlot).filter((slot, index, all) => all.indexOf(slot) === index).slice(0, MAX_SLOTS);
  } catch { return []; }
}

function writeSlotList(storage, namespace, slots) {
  if (!storage) return false;
  try { storage.setItem(listKey(namespace), JSON.stringify(slots.slice(0, MAX_SLOTS))); return true; } catch { return false; }
}

export function createMemorySaveStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
    _data: values,
  };
}

export function saveToStorage({ storage, namespace = DEFAULT_NAMESPACE, slot = DEFAULT_SLOT, snapshot, timestampMs = Date.now(), metadata = {} } = {}) {
  const target = getStorage(storage);
  if (!target) return { ok: false, reason: 'STORAGE_UNAVAILABLE' };
  let envelope;
  try { envelope = createSaveEnvelope({ namespace, slot, snapshot, timestampMs, metadata }); }
  catch (error) { return { ok: false, reason: error?.message ?? 'ENVELOPE_ERROR' }; }
  try {
    const slots = readSlotList(target, namespace);
    const normalizedSlot = normalizeSlot(slot);
    const nextSlots = [normalizedSlot, ...slots.filter((entry) => entry !== normalizedSlot)].slice(0, MAX_SLOTS);
    target.setItem(storageKey(namespace, normalizedSlot), JSON.stringify(envelope));
    writeSlotList(target, namespace, nextSlots);
    return Object.freeze({ ok: true, envelope, bytes: envelope.payloadBytes, key: storageKey(namespace, normalizedSlot) });
  } catch (error) { return { ok: false, reason: error?.message ?? 'WRITE_ERROR' }; }
}

export function loadFromStorage({ storage, namespace = DEFAULT_NAMESPACE, slot = DEFAULT_SLOT, nowMs = Date.now(), maxAgeMs = Number.POSITIVE_INFINITY } = {}) {
  const target = getStorage(storage);
  if (!target) return { ok: false, reason: 'STORAGE_UNAVAILABLE' };
  const envelope = readStoredEnvelope(target, namespace, slot);
  if (!envelope) return { ok: false, reason: 'NOT_FOUND' };
  const validation = validateSaveEnvelope(envelope, { namespace, expectedSlot: slot, nowMs, maxAgeMs });
  if (!validation.valid) return { ok: false, reason: validation.reason, validation };
  return Object.freeze({ ok: true, snapshot: safeJson(envelope.payload), envelope, validation });
}

export function listStorageSlots({ storage, namespace = DEFAULT_NAMESPACE, nowMs = Date.now() } = {}) {
  const target = getStorage(storage);
  if (!target) return [];
  return readSlotList(target, namespace).map((slot) => {
    const envelope = readStoredEnvelope(target, namespace, slot);
    const validation = envelope ? validateSaveEnvelope(envelope, { namespace, expectedSlot: slot, nowMs }) : { valid: false, reason: 'NOT_FOUND' };
    return Object.freeze({ slot, valid: validation.valid, reason: validation.reason, updatedAtMs: envelope?.updatedAtMs ?? 0, bytes: envelope?.payloadBytes ?? 0 });
  });
}

export function deleteStorageSlot({ storage, namespace = DEFAULT_NAMESPACE, slot = DEFAULT_SLOT } = {}) {
  const target = getStorage(storage);
  if (!target) return { ok: false, reason: 'STORAGE_UNAVAILABLE' };
  const normalizedSlot = normalizeSlot(slot);
  try {
    target.removeItem(storageKey(namespace, normalizedSlot));
    const nextSlots = readSlotList(target, namespace).filter((entry) => entry !== normalizedSlot);
    writeSlotList(target, namespace, nextSlots);
    return { ok: true, slot: normalizedSlot };
  } catch (error) { return { ok: false, reason: error?.message ?? 'DELETE_ERROR' }; }
}

export function migrateSaveEnvelope(envelope, { namespace = DEFAULT_NAMESPACE, nowMs = Date.now() } = {}) {
  if (!envelope || typeof envelope !== 'object') return { ok: false, reason: 'INVALID_INPUT' };
  if (envelope.version === STORAGE_VERSION) return { ok: true, migrated: false, envelope };
  if (envelope.version !== 1 && envelope.version !== 2) return { ok: false, reason: 'UNSUPPORTED_VERSION' };
  const snapshot = envelope.payload ?? envelope.snapshot ?? {};
  try {
    const next = createSaveEnvelope({ namespace, slot: envelope.slot ?? DEFAULT_SLOT, snapshot, timestampMs: nowMs, metadata: { migratedFrom: envelope.version, ...(envelope.metadata ?? {}) } });
    return { ok: true, migrated: true, fromVersion: envelope.version, envelope: next };
  } catch (error) { return { ok: false, reason: error?.message ?? 'MIGRATION_ERROR' }; }
}

function openIndexedDb(databaseName, version) {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('INDEXEDDB_UNAVAILABLE'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, version);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('saves')) database.createObjectStore('saves', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_OPEN_ERROR'));
  });
}

async function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_REQUEST_ERROR'));
  });
}

export async function saveToIndexedDb({ namespace = DEFAULT_NAMESPACE, slot = DEFAULT_SLOT, snapshot, timestampMs = Date.now(), metadata = {}, databaseName = 'aapw-save-v3' } = {}) {
  try {
    const envelope = createSaveEnvelope({ namespace, slot, snapshot, timestampMs, metadata });
    const database = await openIndexedDb(databaseName, 1);
    await idbRequest(database.transaction('saves', 'readwrite').objectStore('saves').put({ key: storageKey(namespace, slot), envelope }));
    database.close();
    return Object.freeze({ ok: true, envelope });
  } catch (error) { return { ok: false, reason: error?.message ?? 'INDEXEDDB_WRITE_ERROR' }; }
}

export async function loadFromIndexedDb({ namespace = DEFAULT_NAMESPACE, slot = DEFAULT_SLOT, nowMs = Date.now(), maxAgeMs = Number.POSITIVE_INFINITY, databaseName = 'aapw-save-v3' } = {}) {
  try {
    const database = await openIndexedDb(databaseName, 1);
    const row = await idbRequest(database.transaction('saves', 'readonly').objectStore('saves').get(storageKey(namespace, slot)));
    database.close();
    if (!row?.envelope) return { ok: false, reason: 'NOT_FOUND' };
    const validation = validateSaveEnvelope(row.envelope, { namespace, expectedSlot: slot, nowMs, maxAgeMs });
    if (!validation.valid) return { ok: false, reason: validation.reason, validation };
    return Object.freeze({ ok: true, snapshot: safeJson(row.envelope.payload), envelope: row.envelope, validation });
  } catch (error) { return { ok: false, reason: error?.message ?? 'INDEXEDDB_READ_ERROR' }; }
}

export async function deleteFromIndexedDb({ namespace = DEFAULT_NAMESPACE, slot = DEFAULT_SLOT, databaseName = 'aapw-save-v3' } = {}) {
  try {
    const database = await openIndexedDb(databaseName, 1);
    await idbRequest(database.transaction('saves', 'readwrite').objectStore('saves').delete(storageKey(namespace, slot)));
    database.close();
    return { ok: true, slot: normalizeSlot(slot) };
  } catch (error) { return { ok: false, reason: error?.message ?? 'INDEXEDDB_DELETE_ERROR' }; }
}

export function createSaveRepository({ storage = null, namespace = DEFAULT_NAMESPACE, preferredBackend = 'localStorage', now = () => Date.now() } = {}) {
  const localStorageTarget = getStorage(storage);
  let disposed = false;
  function ensure() { if (disposed) throw new Error('SAVE_REPOSITORY_DISPOSED'); }
  function save(slot, snapshot, metadata = {}) { ensure(); return saveToStorage({ storage: localStorageTarget, namespace, slot, snapshot, timestampMs: now(), metadata }); }
  function load(slot, options = {}) { ensure(); return loadFromStorage({ storage: localStorageTarget, namespace, slot, nowMs: now(), ...options }); }
  function list() { ensure(); return listStorageSlots({ storage: localStorageTarget, namespace, nowMs: now() }); }
  function remove(slot) { ensure(); return deleteStorageSlot({ storage: localStorageTarget, namespace, slot }); }
  async function saveDurable(slot, snapshot, metadata = {}) { ensure(); return saveToIndexedDb({ namespace, slot, snapshot, timestampMs: now(), metadata }); }
  async function loadDurable(slot, options = {}) { ensure(); return loadFromIndexedDb({ namespace, slot, nowMs: now(), ...options }); }
  async function removeDurable(slot) { ensure(); return deleteFromIndexedDb({ namespace, slot }); }
  function dispose() { disposed = true; }
  return Object.freeze({ preferredBackend, save, load, list, remove, saveDurable, loadDurable, removeDurable, dispose });
}

export const SAVE_STORAGE_VERSION = STORAGE_VERSION;
export const SAVE_DEFAULT_SLOT = DEFAULT_SLOT;
export const SAVE_MAX_SLOTS = MAX_SLOTS;
export const SAVE_MAX_PAYLOAD_BYTES = MAX_PAYLOAD_BYTES;
