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
  assert.equal(result.pads.length, 4);
  return result;
}

const keepA = { uuid: 'batch-a', userData: {} };
const keepB = { uuid: 'batch-b', userData: {} };
const keepFar = { uuid: 'batch-far', userData: {} };

install('batch-a', keepA, 92, 30);
install('batch-b', keepB, 108, 32);
install('batch-far', keepFar, 300, 40);
assert.equal(flattenPads.length, 12);
assert.equal(conformer.getDynamicPads().length, 12);
assert.equal(keepA.userData.terrainFoundationKey, 'object:batch-a');
assert.equal(keepB.userData.terrainFoundationKey, 'object:batch-b');
assert.equal(keepFar.userData.terrainFoundationKey, 'object:batch-far');
events.length = 0;

// A and B overlap the same resident terrain chunk. Removing them as a batch must mutate all eight
// cluster pads first, then rebuild the union exactly once rather than once per object or per pad.
const batch = conformer.removeFoundations([keepA, keepB]);
assert.equal(batch.ok, true);
assert.equal(batch.removedCount, 8);
assert.equal(batch.missingKeys.length, 0);
assert.equal(batch.rebuiltChunkCount, 1, 'overlapping removed foundation clusters must rebuild one resident chunk once');
assert.deepEqual(events, ['unload:1,0', 'load:1,0']);
assert.equal(flattenPads.length, 4, 'batch removal must leave unrelated foundation cluster installed');
assert(flattenPads.every((pad) => pad.foundationKey === 'object:batch-far'));
assert.equal(keepA.userData.terrainFoundationKey, undefined);
assert.equal(keepB.userData.terrainFoundationKey, undefined);
assert.equal(keepFar.userData.terrainFoundationKey, 'object:batch-far');

events.length = 0;
const duplicateInput = conformer.removeFoundations([keepFar, keepFar]);
assert.equal(duplicateInput.ok, true);
assert.equal(duplicateInput.removedCount, 4, 'duplicate object inputs must remove one cluster exactly once');
assert.equal(duplicateInput.rebuiltChunkCount, 1);
assert.deepEqual(events, ['unload:3,0', 'load:3,0']);
assert.equal(flattenPads.length, 0);
assert.equal(conformer.getDynamicPads().length, 0);
assert.equal(keepFar.userData.terrainFoundationKey, undefined);

events.length = 0;
const missing = conformer.removeFoundations(['asset:not-installed', 'asset:not-installed']);
assert.equal(missing.ok, false);
assert.equal(missing.removedCount, 0);
assert.deepEqual(missing.missingKeys, ['asset:not-installed']);
assert.equal(missing.rebuiltChunkCount, 0);
assert.deepEqual(events, []);

const shutdownA = { uuid: 'shutdown-a', userData: {} };
const shutdownB = { uuid: 'shutdown-b', userData: {} };
install('shutdown-a', shutdownA, 92, 31);
install('shutdown-b', shutdownB, 108, 33);
assert.equal(flattenPads.length, 8);
events.length = 0;
const shutdown = conformer.removeFoundations([shutdownA, shutdownB], { rebuild: false });
assert.equal(shutdown.ok, true);
assert.equal(shutdown.removedCount, 8);
assert.equal(shutdown.rebuiltChunkCount, 0, 'teardown cleanup must not rebuild terrain chunks');
assert.equal(shutdown.rebuildSkipped, true);
assert.deepEqual(events, [], 'teardown cleanup must not unload/load resident terrain');
assert.equal(flattenPads.length, 0, 'teardown cleanup must still mutate the shared render/physics pad authority');
assert.equal(conformer.getDynamicPads().length, 0);
assert.equal(shutdownA.userData.terrainFoundationKey, undefined);
assert.equal(shutdownB.userData.terrainFoundationKey, undefined);

assert.equal(conformer.policy.batchRemovalMode, 'mutate-all-then-union-rebuild');
assert.equal(conformer.policy.shutdownRemovalMode, 'mutate-without-rebuild');
console.log('[checkTerrainFoundationBatchRemoval] PASS: clustered multi-structure cleanup mutates the shared render/physics pad authority first, deduplicates object/key inputs, preserves unrelated clusters, rebuilds each affected resident terrain chunk at most once, and supports rebuild-free teardown cleanup.');
