#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createTerrainFoundationConformer } from '../src/3d/world/terrainFoundationConformer.js';

const events = [];
const flattenPads = [];
const chunkManager = {
  chunkSizeMeters: 100,
  flattenPads,
  loaded: new Map([
    ['0,0', {}],
    ['1,0', {}],
    ['3,0', {}],
  ]),
  unloadChunk(x, z) {
    events.push(`unload:${x},${z}`);
    this.loaded.delete(`${x},${z}`);
  },
  loadChunk(x, z) {
    events.push(`load:${x},${z}`);
    this.loaded.set(`${x},${z}`, {});
  },
};

const conformer = createTerrainFoundationConformer({
  flattenPads,
  chunkManager,
  chunkSizeMeters: 100,
  featherMeters: 8,
});

function install(id, object, centerX, height) {
  const result = conformer.conformTerrain({
    metadata: { id, category: 'building' },
    object,
    bounds: {
      minX: centerX - 8,
      maxX: centerX + 8,
      minZ: -8,
      maxZ: 8,
    },
    targetHeight: height,
  });
  assert.equal(result.ok, true, result.error);
  return result;
}

const keepA = { uuid: 'batch-a', userData: {} };
const keepB = { uuid: 'batch-b', userData: {} };
const keepFar = { uuid: 'batch-far', userData: {} };

install('batch-a', keepA, 92, 30);
install('batch-b', keepB, 108, 32);
install('batch-far', keepFar, 300, 40);
assert.equal(flattenPads.length, 3);
assert.equal(conformer.getDynamicPads().length, 3);
events.length = 0;

// A and B overlap the same resident terrain chunk. Removing them as a batch must mutate the shared
// render/physics pad authority first, then rebuild the union exactly once rather than once per object.
const batch = conformer.removeFoundations([keepA, keepB]);
assert.equal(batch.ok, true);
assert.equal(batch.removedCount, 2);
assert.equal(batch.missingKeys.length, 0);
assert.equal(batch.rebuiltChunkCount, 1, 'overlapping removed foundations must rebuild one resident chunk once');
assert.deepEqual(events, ['unload:1,0', 'load:1,0']);
assert.equal(flattenPads.length, 1, 'batch removal must leave unrelated foundations installed');
assert.equal(flattenPads[0].foundationKey, 'asset:batch-far');
assert.equal(keepA.userData.terrainFoundationKey, undefined);
assert.equal(keepB.userData.terrainFoundationKey, undefined);
assert.equal(keepFar.userData.terrainFoundationKey, 'asset:batch-far');

events.length = 0;
const duplicateInput = conformer.removeFoundations([keepFar, keepFar]);
assert.equal(duplicateInput.ok, true);
assert.equal(duplicateInput.removedCount, 1, 'duplicate object inputs must not remove/rebuild twice');
assert.equal(duplicateInput.rebuiltChunkCount, 1);
assert.deepEqual(events, ['unload:3,0', 'load:3,0']);
assert.equal(flattenPads.length, 0);
assert.equal(conformer.getDynamicPads().length, 0);
assert.equal(keepFar.userData.terrainFoundationKey, undefined);

// Missing keys are reported without turning already-valid removals into duplicate terrain work.
events.length = 0;
const missing = conformer.removeFoundations(['asset:not-installed', 'asset:not-installed']);
assert.equal(missing.ok, false);
assert.equal(missing.removedCount, 0);
assert.deepEqual(missing.missingKeys, ['asset:not-installed']);
assert.equal(missing.rebuiltChunkCount, 0);
assert.deepEqual(events, []);

assert.equal(conformer.policy.batchRemovalMode, 'mutate-all-then-union-rebuild');
console.log('[checkTerrainFoundationBatchRemoval] PASS: multi-structure cleanup mutates the shared pad authority first, deduplicates object/key inputs, preserves unrelated foundations, and rebuilds each affected resident terrain chunk at most once.');
