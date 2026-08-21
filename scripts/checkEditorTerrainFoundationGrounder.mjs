#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEditorTerrainFoundationGrounder, isEditorStructureAsset } from '../src/3d/editor/EditorTerrainFoundationGrounder.js';

const flattenPads = [];
const loaded = new Map([['0,0', { name: 'terrain-0-0' }]]);
let rebuilds = 0;
const chunkManager = {
  loaded,
  flattenPads,
  chunkSizeMeters: 100,
  unloadChunk(x, z) {
    loaded.delete(`${x},${z}`);
    rebuilds += 1;
  },
  loadChunk(x, z) {
    const mesh = { name: `terrain-${x}-${z}-rebuilt` };
    loaded.set(`${x},${z}`, mesh);
    return mesh;
  },
};

function flattenWeight(distance, inner, outer) {
  if (distance <= inner) return 1;
  if (distance >= outer) return 0;
  const t = 1 - (distance - inner) / (outer - inner);
  return t * t * (3 - 2 * t);
}

function baseHeight(x, z) {
  return 20 + x * 0.08 - z * 0.035;
}

const groundCollider = {
  getGroundHeight(x, z) {
    const raw = baseHeight(x, z);
    let strongest = 0;
    let anchor = raw;
    for (const pad of flattenPads) {
      const weight = flattenWeight(Math.hypot(x - pad.x, z - pad.z), pad.innerRadiusMeters, pad.outerRadiusMeters);
      if (weight > strongest) {
        strongest = weight;
        anchor = pad.anchorHeightMeters;
      }
    }
    return strongest > 0 ? raw + (anchor - raw) * strongest : raw;
  },
};

const grounder = createEditorTerrainFoundationGrounder({ chunkManager, groundCollider });
const castleAsset = { id: 'castle-test', name: 'Northern Keep', category: 'castle', src: 'keep.glb' };
assert.equal(isEditorStructureAsset(castleAsset), true);
assert.equal(isEditorStructureAsset({ id: 'tree-test', primitive: 'tree', category: 'vegetation' }), false);

const castle = new THREE.Mesh(new THREE.BoxGeometry(12, 8, 10), new THREE.MeshBasicMaterial());
castle.geometry.translate(0, 4, 0);
castle.rotation.y = Math.PI / 7;
castle.userData.editorId = 'castle-test-placed-0001';
const first = grounder.groundObject(castle, castleAsset, { x: 8, z: -6 });
assert.equal(first.ok, true, first.error);
assert.equal(first.mode, 'terrain-conform');
assert.equal(first.footprint?.samples?.length, 9);
assert.equal(flattenPads.length, 1, 'first structural placement must register exactly one terrain pad');
assert.equal(castle.userData.editorFoundationKey, 'asset:castle-test-placed-0001');
assert(rebuilds >= 1, 'resident terrain intersecting the pad must rebuild');

const pad = flattenPads[0];
for (const sample of first.footprint.samples) {
  assert(
    Math.abs(groundCollider.getGroundHeight(sample.x ?? 8, sample.z ?? -6) - pad.anchorHeightMeters) < 1e-6,
    'shared collider must read the newly installed foundation plane inside the footprint',
  );
}

const beforeRepeat = flattenPads.length;
const second = grounder.groundObject(castle, castleAsset, { x: 9, z: -5 });
assert.equal(second.ok, true, second.error);
assert.equal(flattenPads.length, beforeRepeat, 're-grounding the same editor id must update, not duplicate, its pad');

const tree = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), new THREE.MeshBasicMaterial());
tree.geometry.translate(0, 2, 0);
tree.userData.editorId = 'tree-placed-0001';
const treeResult = grounder.groundObject(tree, { id: 'tree', primitive: 'tree', category: 'vegetation' }, { x: 40, z: 30 });
assert.equal(treeResult.ok, true, treeResult.error);
assert.equal(treeResult.mode, 'center-base');
assert.equal(flattenPads.length, beforeRepeat, 'non-structures must never deform terrain');
tree.updateMatrixWorld(true);
const treeBox = new THREE.Box3().setFromObject(tree);
assert(Math.abs(treeBox.min.y - groundCollider.getGroundHeight(40, 30)) < 1e-6);

const removed = grounder.removeObjectFoundation(castle);
assert.equal(removed.ok, true, removed.error);
assert.equal(flattenPads.length, 0, 'removing a structure foundation must restore the shared pad authority');

console.log('[checkEditorTerrainFoundationGrounder] PASS: editor structures conform shared render/physics terrain, repeated grounding is idempotent, props stay center-grounded, and foundations can be removed.');
