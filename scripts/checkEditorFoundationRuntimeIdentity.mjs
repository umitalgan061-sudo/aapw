#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEditorTerrainFoundationGrounder } from '../src/3d/editor/EditorTerrainFoundationGrounder.js';

const flattenPads = [];
const loaded = new Map([
  ['0,0', {}],
  ['1,0', {}],
]);
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
    loaded.set(`${x},${z}`, {});
  },
};

function baseHeight(x, z) {
  return 18 + x * 0.055 - z * 0.021;
}

function flattenWeight(distance, inner, outer) {
  if (distance <= inner) return 1;
  if (distance >= outer) return 0;
  const t = 1 - (distance - inner) / (outer - inner);
  return t * t * (3 - 2 * t);
}

const groundCollider = {
  getGroundHeight(x, z) {
    const raw = baseHeight(x, z);
    let strongestWeight = 0;
    let anchorHeight = raw;
    for (const pad of flattenPads) {
      const weight = flattenWeight(
        Math.hypot(x - pad.x, z - pad.z),
        pad.innerRadiusMeters,
        pad.outerRadiusMeters,
      );
      if (weight > strongestWeight) {
        strongestWeight = weight;
        anchorHeight = pad.anchorHeightMeters;
      }
    }
    return strongestWeight > 0
      ? raw + (anchorHeight - raw) * strongestWeight
      : raw;
  },
};

function footprintProbePoints(bounds) {
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
  return [
    [centerX, centerZ],
    [bounds.minX, bounds.minZ],
    [bounds.maxX, bounds.minZ],
    [bounds.minX, bounds.maxZ],
    [bounds.maxX, bounds.maxZ],
    [centerX, bounds.minZ],
    [centerX, bounds.maxZ],
    [bounds.minX, centerZ],
    [bounds.maxX, centerZ],
  ];
}

function expectedUnderlyingMax(bounds) {
  return Math.max(...footprintProbePoints(bounds).map(([x, z]) => baseHeight(x, z)));
}

function makeHouse(sharedEditorId) {
  const object = new THREE.Mesh(
    new THREE.BoxGeometry(14, 7, 10),
    new THREE.MeshBasicMaterial(),
  );
  object.geometry.translate(0, 3.5, 0);
  object.userData.editorId = sharedEditorId;
  return object;
}

const grounder = createEditorTerrainFoundationGrounder({ chunkManager, groundCollider });
const sharedAsset = {
  id: 'catalog-house-shared',
  name: 'Shared Catalog House',
  category: 'building',
  src: 'assets/models/shared-house.glb',
};

// Deliberately duplicate every authored/catalog identity. Only Object3D runtime identity may distinguish
// the two placed instances after terrainFoundationConformer switched to runtime-object-first keys.
const firstHouse = makeHouse('duplicate-editor-placement-id');
const secondHouse = makeHouse('duplicate-editor-placement-id');
assert.notEqual(firstHouse.uuid, secondHouse.uuid);

const first = grounder.groundObject(firstHouse, sharedAsset, { x: 14, z: -8 });
const second = grounder.groundObject(secondHouse, sharedAsset, { x: 122, z: 6 });
assert.equal(first.ok, true, first.error);
assert.equal(second.ok, true, second.error);
assert.equal(flattenPads.length, 2, 'two clones with one editor/catalog identity must retain two foundations');
assert.equal(grounder.getDynamicPads().length, 2);

assert.equal(firstHouse.userData.editorFoundationKey, 'asset:duplicate-editor-placement-id',
  'legacy editor metadata remains stable for persistence compatibility');
assert.equal(secondHouse.userData.editorFoundationKey, 'asset:duplicate-editor-placement-id');
assert.equal(firstHouse.userData.terrainFoundationKey, `object:${firstHouse.uuid}`,
  'first clone must address terrain through runtime Object3D identity');
assert.equal(secondHouse.userData.terrainFoundationKey, `object:${secondHouse.uuid}`,
  'second clone must address terrain through its independent runtime Object3D identity');
assert.notEqual(firstHouse.userData.terrainFoundationKey, secondHouse.userData.terrainFoundationKey);

const firstPad = flattenPads.find((pad) => pad.foundationKey === firstHouse.userData.terrainFoundationKey);
const secondPad = flattenPads.find((pad) => pad.foundationKey === secondHouse.userData.terrainFoundationKey);
assert(firstPad, 'first runtime foundation pad missing');
assert(secondPad, 'second runtime foundation pad missing');
assert.notEqual(firstPad, secondPad);

const firstAnchorBeforeMove = firstPad.anchorHeightMeters;
const secondAnchorBeforeMove = secondPad.anchorHeightMeters;
const moved = grounder.groundObject(firstHouse, sharedAsset, { x: 18, z: -5 });
assert.equal(moved.ok, true, moved.error);
assert.equal(flattenPads.length, 2, 'moving one clone must mutate its own pad without duplicating/removing its sibling');
assert.equal(flattenPads.find((pad) => pad.foundationKey === firstHouse.userData.terrainFoundationKey), firstPad,
  'moving a clone must preserve its installed pad object identity');
assert.equal(flattenPads.find((pad) => pad.foundationKey === secondHouse.userData.terrainFoundationKey), secondPad,
  'moving the first clone must preserve the second clone pad');
assert.equal(secondPad.anchorHeightMeters, secondAnchorBeforeMove,
  'moving one clone must not rewrite a sibling foundation that shares editor/catalog ids');
assert(Math.abs(moved.footprint.targetGroundHeight - expectedUnderlyingMax(moved.footprint.bounds)) < 1e-9,
  're-grounding must exclude the moving clone runtime pad while sampling underlying terrain');
assert(Math.abs(moved.footprint.targetGroundHeight - firstAnchorBeforeMove) > 1e-4,
  'old self-foundation height must not feed back into the moved clone');

const removedFirst = grounder.removeObjectFoundation(firstHouse);
assert.equal(removedFirst.ok, true, removedFirst.error);
assert.equal(flattenPads.length, 1, 'removing one clone must preserve the sibling foundation');
assert.equal(flattenPads[0], secondPad);
assert.equal(firstHouse.userData.terrainFoundationKey, undefined);
assert.equal(firstHouse.userData.editorFoundationKey, undefined);
assert.equal(secondHouse.userData.terrainFoundationKey, `object:${secondHouse.uuid}`);
assert.equal(secondHouse.userData.editorFoundationKey, 'asset:duplicate-editor-placement-id');

const rebuiltBeforeFinalRemoval = rebuilds;
const removedSecond = grounder.removeObjectFoundations([secondHouse]);
assert.equal(removedSecond.ok, true);
assert.equal(removedSecond.removedCount, 1);
assert.equal(flattenPads.length, 0);
assert.equal(grounder.getDynamicPads().length, 0);
assert.equal(secondHouse.userData.terrainFoundationKey, undefined);
assert.equal(secondHouse.userData.editorFoundationKey, undefined);
assert(rebuilds > rebuiltBeforeFinalRemoval, 'removing the final live pad must rebuild intersecting resident terrain');

console.log('[checkEditorFoundationRuntimeIdentity] PASS: cloned editor placements sharing authored ids keep independent runtime-object foundations, self-excluding re-grounding, and independent cleanup.');
