#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveWorldSurfacePlacement } from '../src/3d/world/WorldAssetPlacementPipeline.js';
import { createTerrainFoundationConformer } from '../src/3d/world/terrainFoundationConformer.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';
import { resolveStructureSurfaceProfile } from '../src/3d/world/structureGroundingPolicy.js';

const EPSILON = 1e-6;

function makeStructure(index) {
  const root = new THREE.Group();
  root.position.set(110 + index * 85, 80, -120 + index * 60);
  root.rotation.y = Math.PI * (0.13 + index * 0.07);
  root.scale.set(1 + index * 0.08, 1, 0.82 + index * 0.06);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(26 + index * 3, 12, 14 + index * 2),
    new THREE.MeshBasicMaterial(),
  );
  body.geometry.translate(0, 6, 0);
  body.position.set(index % 2 ? 3 : -2, 0, index % 2 ? -1.5 : 2);
  body.rotation.y = index * 0.05;
  root.add(body);
  root.updateMatrixWorld(true);
  return root;
}

function sourceSurface(x, z) {
  return {
    height: 31 + x * 0.018 - z * 0.013,
    slopeDegrees: 6,
    waterDepth: 0,
    roadDistance: 12,
    settlementDistance: 24,
    moisture: 0.42,
    biome: 'settlement',
    waterType: 'none',
  };
}

function runCase(metadata, index, fallbackMetadata = null) {
  const object = makeStructure(index);
  if (fallbackMetadata) object.userData = { ...fallbackMetadata };
  const flattenPads = [];
  const conformer = createTerrainFoundationConformer({
    flattenPads,
    featherMeters: 8,
  });
  let queryCount = 0;
  const result = resolveWorldSurfacePlacement(object, {
    metadata,
    surfaceQuery(x, z) {
      queryCount += 1;
      return sourceSurface(x, z);
    },
    requireSurfaceContext: true,
    footprintGrounding: 'auto',
    conformTerrain: conformer.conformTerrain,
  });

  assert.equal(result.ok, true, `${metadata.id || fallbackMetadata?.editorId}: ${result.error}`);
  assert.equal(queryCount, 9, 'extended structures must use the canonical nine-probe footprint');
  assert.equal(result.footprint?.groundingMode, 'terrain-conform');
  assert.equal(result.footprint?.samples?.length, 9);
  assert(result.footprint?.orientedFootprint, 'transformed structure must expose an oriented footprint');
  assert.equal(flattenPads.length, 4, 'runtime structure foundation must stay within the four-pad budget');
  assert(flattenPads.every((pad) => pad.shape === 'oriented-rectangle'), 'all dynamic structure pads must use oriented rectangles');
  assert(flattenPads.every((pad) => pad.foundationKey === `object:${object.uuid}`), 'foundation identity must remain runtime-object-first');

  const targetHeight = result.footprint.targetGroundHeight;
  const sharedHeight = createHeightSampler(1337, undefined, flattenPads);
  for (const pad of flattenPads) {
    assert(Math.abs(sharedHeight(pad.x, pad.z) - targetHeight) <= EPSILON,
      `${metadata.id || fallbackMetadata?.editorId}: shared physics sampler must read the conformed foundation plane`);
  }

  const dynamicPads = conformer.getDynamicPads();
  assert.equal(dynamicPads.length, 4);
  const removed = conformer.removeFoundation(object);
  assert.equal(removed.ok, true);
  assert.equal(removed.removedCount, 4);
  assert.equal(flattenPads.length, 0, 'foundation lifecycle removal must retire every pad in the cluster');
  assert.equal(object.userData.terrainFoundationKey, undefined, 'foundation lifecycle removal must clear runtime identity');

  return {
    id: metadata.id || fallbackMetadata?.editorId,
    profile: resolveStructureSurfaceProfile(metadata, fallbackMetadata),
    targetHeight: Number(targetHeight.toFixed(3)),
    padCount: dynamicPads.length,
  };
}

const cases = [
  [{ id: 'guardhouse-runtime', category: 'guardhouse' }, 'building'],
  [{ id: 'mine-runtime', category: 'mine-entrance' }, 'building'],
  [{ id: 'customs-runtime', category: 'customs-house' }, 'waterside'],
  [{ id: 'localized-tunnel-runtime', category: 'Tünel' }, 'building'],
];

const evidence = [];
for (let index = 0; index < cases.length; index += 1) {
  const [metadata, expectedProfile] = cases[index];
  assert.equal(resolveStructureSurfaceProfile(metadata), expectedProfile);
  evidence.push(runCase(metadata, index));
}

const fallbackMetadata = {
  editorId: 'rehydrated-observatory-runtime',
  category: 'Prop',
  assetType: 'observatory',
};
assert.equal(resolveStructureSurfaceProfile({}, fallbackMetadata), 'building');
evidence.push(runCase({}, cases.length, fallbackMetadata));

console.log('EXTENDED_STRUCTURE_FOUNDATION_CONFORM_OK', JSON.stringify({
  cases: evidence,
  sharedMutableFlattenPadAuthority: true,
  orientedRectanglePads: true,
  lifecycleRemovalCovered: true,
}));
