#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEditorTerrainFoundationGrounder } from '../src/3d/editor/EditorTerrainFoundationGrounder.js';

const events = [];
const flattenPads = [];
const loaded = new Map([['1,0', {}]]);
const chunkManager = {
  loaded,
  flattenPads,
  chunkSizeMeters: 100,
  unloadChunk(x, z) {
    events.push(`unload:${x},${z}`);
    loaded.delete(`${x},${z}`);
  },
  loadChunk(x, z) {
    events.push(`load:${x},${z}`);
    loaded.set(`${x},${z}`, {});
  },
};

function baseHeight(x, z) {
  return 12 + x * 0.03 - z * 0.015;
}

const groundCollider = {
  getGroundHeight(x, z) {
    const raw = baseHeight(x, z);
    for (const pad of flattenPads) {
      const distance = Math.hypot(x - pad.x, z - pad.z);
      if (distance <= pad.innerRadiusMeters) return pad.anchorHeightMeters;
    }
    return raw;
  },
};

const grounder = createEditorTerrainFoundationGrounder({ chunkManager, groundCollider });
const asset = { id: 'batch-house', name: 'Taş Ev', category: 'Bina', src: 'house.glb' };

function house(editorId, x) {
  const object = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 10), new THREE.MeshBasicMaterial());
  object.geometry.translate(0, 3, 0);
  object.userData.editorId = editorId;
  const grounded = grounder.groundObject(object, asset, { x, z: 0 });
  assert.equal(grounded.ok, true, grounded.error);
  return object;
}

const a = house('batch-house-a', 92);
const b = house('batch-house-b', 108);
assert.equal(flattenPads.length, 8, 'two non-degenerate editor structures should own two four-pad clusters');
assert.equal(grounder.getDynamicPads().length, 8);
events.length = 0;

const result = grounder.removeObjectFoundations([a, b]);
assert.equal(result.ok, true);
assert.equal(result.removedCount, 2, 'editor-facing removal count must remain structure-based');
assert.equal(result.removedPadCount, 8, 'cluster implementation detail should remain observable separately');
assert.equal(result.rebuiltChunkCount, 1, 'scene-style multi-delete must rebuild the shared resident chunk once');
assert.deepEqual(events, ['unload:1,0', 'load:1,0']);
assert.equal(flattenPads.length, 0);
assert.equal(grounder.getDynamicPads().length, 0);
assert.equal(a.userData.editorFoundationKey, undefined);
assert.equal(a.userData.editorGroundingMode, undefined);
assert.equal(b.userData.editorFoundationKey, undefined);
assert.equal(b.userData.editorGroundingMode, undefined);

const noStructures = grounder.removeObjectFoundations([{}, null]);
assert.equal(noStructures.ok, true);
assert.equal(noStructures.removedCount, 0);
assert.equal(noStructures.removedPadCount, 0);
assert.equal(noStructures.rebuiltChunkCount, 0);

console.log('[checkEditorTerrainFoundationBatchCleanup] PASS: editor multi-object cleanup removes every clustered foundation from the shared render/physics authority, preserves structure-level API counts, and union-rebuilds overlapping resident terrain once.');
