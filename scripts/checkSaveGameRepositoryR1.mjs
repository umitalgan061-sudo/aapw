#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  canonicalStringify,
  checksumString,
  createMemorySaveStorage,
  createSaveEnvelope,
  createSaveRepository,
  deleteStorageSlot,
  listStorageSlots,
  loadFromStorage,
  migrateSaveEnvelope,
  saveToStorage,
  validateSaveEnvelope,
} from '../src/3d/persistence/saveGameRepository.js';

function runCanonicalContract() {
  const a = canonicalStringify({ z: 1, a: { y: 2, x: 3 }, list: [{ b: 2, a: 1 }] });
  const b = canonicalStringify({ list: [{ a: 1, b: 2 }], a: { x: 3, y: 2 }, z: 1 });
  assert.equal(a, b);
  assert.equal(checksumString(a), checksumString(b));
}

function runEnvelopeContract() {
  const envelope = createSaveEnvelope({ slot: 'Primary Save', namespace: 'world', timestampMs: 123, snapshot: { player: { hp: 80 }, quests: ['north'] }, metadata: { seed: 42 } });
  assert.equal(envelope.slot, 'primary-save');
  assert.equal(envelope.version, 3);
  assert.equal(validateSaveEnvelope(envelope, { namespace: 'world', expectedSlot: 'primary-save', nowMs: 123 }).valid, true);
  const tampered = { ...envelope, payload: { ...envelope.payload, player: { hp: 1 } } };
  assert.equal(validateSaveEnvelope(tampered, { namespace: 'world', nowMs: 123 }).reason, 'CHECKSUM');
  assert.equal(validateSaveEnvelope(envelope, { namespace: 'other', nowMs: 123 }).reason, 'NAMESPACE');
}

function runStorageCrud() {
  const storage = createMemorySaveStorage();
  const snapshot = { player: { x: 10, z: -20, hp: 90 }, world: { day: 4 }, inventory: ['iron', 'wood'] };
  const saved = saveToStorage({ storage, namespace: 'aapw', slot: 'slot-a', snapshot, timestampMs: 1000 });
  assert.equal(saved.ok, true);
  const loaded = loadFromStorage({ storage, namespace: 'aapw', slot: 'slot-a', nowMs: 1000 });
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.snapshot, snapshot);
  const listed = listStorageSlots({ storage, namespace: 'aapw', nowMs: 1000 });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].valid, true);
  assert.equal(deleteStorageSlot({ storage, namespace: 'aapw', slot: 'slot-a' }).ok, true);
  assert.equal(loadFromStorage({ storage, namespace: 'aapw', slot: 'slot-a', nowMs: 1000 }).reason, 'NOT_FOUND');
}

function runAgeAndNamespaceGuards() {
  const storage = createMemorySaveStorage();
  saveToStorage({ storage, namespace: 'safe', slot: 'slot', snapshot: { value: 1 }, timestampMs: 100 });
  const envelope = JSON.parse(storage.getItem('safe:save:slot'));
  assert.equal(validateSaveEnvelope(envelope, { namespace: 'wrong', nowMs: 100 }).reason, 'NAMESPACE');
  assert.equal(loadFromStorage({ storage, namespace: 'safe', slot: 'slot', nowMs: 1000, maxAgeMs: 100 }).reason, 'STALE');
}

function runMigrationContract() {
  const legacy = { schema: 'aapw.save', version: 2, namespace: 'old', slot: 'slot', createdAtMs: 10, updatedAtMs: 10, payload: { player: { hp: 50 } }, metadata: { old: true } };
  const migrated = migrateSaveEnvelope(legacy, { namespace: 'old', nowMs: 20 });
  assert.equal(migrated.ok, true);
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.envelope.version, 3);
  assert.deepEqual(migrated.envelope.payload, legacy.payload);
}

function runRepositoryFacade() {
  const storage = createMemorySaveStorage();
  const repository = createSaveRepository({ storage, namespace: 'facade', now: () => 77 });
  const save = repository.save('auto', { location: { x: 1, z: 2 } });
  assert.equal(save.ok, true);
  assert.equal(repository.load('auto').ok, true);
  assert.equal(repository.list()[0].slot, 'auto');
  repository.dispose();
  assert.throws(() => repository.list(), /SAVE_REPOSITORY_DISPOSED/);
}

runCanonicalContract();
runEnvelopeContract();
runStorageCrud();
runAgeAndNamespaceGuards();
runMigrationContract();
runRepositoryFacade();
console.log('Save game repository R1 acceptance passed.');
