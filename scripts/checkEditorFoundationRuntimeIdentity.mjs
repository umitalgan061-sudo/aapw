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
assert.equal(flattenPads.length, 8, 'two clones with one editor/catalog identity must retain two independent four-pad clusters');
assert.equal(grounder.getDynamicPads().length, 8);

assert.equal(firstHouse.userData.editorFoundationKey, 'asset:duplicate-editor-placement-id',
  'legacy editor metadata remains stable for persistence compatibility');
assert.equal(secondHouse.userData.editorFoundationKey, 'asset:duplicate-editor-placement-id');
assert.equal(firstHouse.userData.terrainFoundationKey, `object:${firstHouse.uuid}`,
  'first clone must address terrain through runtime Object3D identity');
assert.equal(secondHouse.userData.terrainFoundationKey, `object:${secondHouse.uuid}`,
  'second clone must address terrain through its independent runtime Object3D identity');
assert.notEqual(firstHouse.userData.terrainFoundationKey, secondHouse.userData.terrainFoundationKey);

const firstPads = flattenPads.filter((pad) => pad.foundationKey === firstHouse.userData.terrainFoundationKey);
const secondPads = flattenPads.filter((pad) => pad.foundationKey === secondHouse.userData.terrainFoundationKey);
assert.equal(firstPads.length, 4, 'first runtime foundation cluster is incomplete');
assert.equal(secondPads.length, 4, 'second runtime foundation cluster is incomplete');
assert(firstPads.every((pad) => pad.foundationClusterSize === 4));
assert(secondPads.every((pad) => pad.foundationClusterSize === 4));
assert(firstPads.every((pad) => !secondPads.includes(pad)), 'clone clusters must not share physical pad objects');

const firstAnchorBeforeMove = firstPads[0].anchorHeightMeters;
const secondAnchorBeforeMove = secondPads[0].anchorHeightMeters;
const moved = grounder.groundObject(firstHouse, sharedAsset, { x: 18, z: -5 });
assert.equal(moved.ok, true, moved.error);
assert.equal(flattenPads.length, 8, 'moving one clone must replace its own cluster without duplicating/removing its sibling');
const movedFirstPads = flattenPads.filter((pad) => pad.foundationKey === firstHouse.userData.terrainFoundationKey);
const survivingSecondPads = flattenPads.filter((pad) => pad.foundationKey === secondHouse.userData.terrainFoundationKey);
assert.equal(movedFirstPads.length, 4);
assert.equal(survivingSecondPads.length, 4);
assert(firstPads.every((pad) => !flattenPads.includes(pad)),
  'moving a clone must retire every pad from its former physical footprint cluster');
assert.deepEqual(survivingSecondPads, secondPads,
  'moving the first clone must preserve the sibling clone cluster object-for-object');
assert(secondPads.every((pad) => pad.anchorHeightMeters === secondAnchorBeforeMove),
  'moving one clone must not rewrite a sibling foundation cluster that shares editor/catalog ids');
assert(Math.abs(moved.footprint.targetGroundHeight - expectedUnderlyingMax(moved.footprint.bounds)) < 1e-9,
  're-grounding must exclude the moving clone runtime cluster while sampling underlying terrain');
assert(Math.abs(moved.footprint.targetGroundHeight - firstAnchorBeforeMove) > 1e-4,
  'old self-foundation height must not feed back into the moved clone');
assert(movedFirstPads.every((pad) => pad.anchorHeightMeters === moved.footprint.targetGroundHeight),
  'replacement clone cluster must share the newly sampled target height');

const removedFirst = grounder.removeObjectFoundation(firstHouse);
assert.equal(removedFirst.ok, true, removedFirst.error);
assert.equal(removedFirst.removedCount, 1, 'editor-facing removal count must stay structure-based');
assert.equal(removedFirst.removedPadCount, 4, 'first clone removal must retire all four physical pads');
assert.equal(flattenPads.length, 4, 'removing one clone must preserve the sibling four-pad foundation cluster');
assert.deepEqual(flattenPads, secondPads);
assert.equal(firstHouse.userData.terrainFoundationKey, undefined);
assert.equal(firstHouse.userData.editorFoundationKey, undefined);
assert.equal(secondHouse.userData.terrainFoundationKey, `object:${secondHouse.uuid}`);
assert.equal(secondHouse.userData.editorFoundationKey, 'asset:duplicate-editor-placement-id');

const rebuiltBeforeFinalRemoval = rebuilds;
const removedSecond = grounder.removeObjectFoundations([secondHouse]);
assert.equal(removedSecond.ok, true);
assert.equal(removedSecond.removedCount, 1, 'batch API must still report one removed structure');
assert.equal(removedSecond.removedPadCount, 4, 'batch API must expose four retired physical pads separately');
assert.equal(flattenPads.length, 0);
assert.equal(grounder.getDynamicPads().length, 0);
assert.equal(secondHouse.userData.terrainFoundationKey, undefined);
assert.equal(secondHouse.userData.editorFoundationKey, undefined);
assert(rebuilds > rebuiltBeforeFinalRemoval, 'removing the final live cluster must rebuild intersecting resident terrain');

console.log('[checkEditorFoundationRuntimeIdentity] PASS: cloned editor placements sharing authored ids keep independent runtime-object four-pad foundation clusters, self-excluding re-grounding, sibling-safe replacement, and structure-vs-pad-aware cleanup.');