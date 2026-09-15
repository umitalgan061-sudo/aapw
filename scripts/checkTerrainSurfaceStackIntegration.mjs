#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installTerrainSediment, TERRAIN_SEDIMENT_POLICY } from '../src/3d/world/terrainSurfaceSediment.js';
import { TERRAIN_BIOGENIC_POLICY } from '../src/3d/world/terrainSurfaceBiogenic.js';
import { TERRAIN_RUNOFF_PATH_POLICY } from '../src/3d/world/terrainSurfaceRunoffPaths.js';
import { TERRAIN_SOIL_STRUCTURE_POLICY } from '../src/3d/world/terrainSurfaceSoilStructure.js';
import { TERRAIN_SEASONAL_POLICY } from '../src/3d/world/terrainSurfaceSeasonality.js';

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
const installed = installTerrainSediment(material);
assert.strictEqual(installed, material);
assert.equal(material.userData.terrainSedimentSurfaceInstalled, true);
assert.equal(material.userData.terrainSedimentRenderOnly, true);
assert.equal(material.userData.terrainSedimentCanonicalHeightUnchanged, true);
assert.equal(material.userData.terrainSedimentCanonicalHydrologyUnchanged, true);
assert.equal(material.userData.terrainSedimentCanonicalColliderUnchanged, true);
assert.equal(material.userData.terrainSedimentCanonicalVegetationPlacementUnchanged, true);
assert.equal(material.userData.terrainBiogenicPolicyId, TERRAIN_BIOGENIC_POLICY.id);
assert.equal(material.userData.terrainRunoffPolicyId, TERRAIN_RUNOFF_PATH_POLICY.id);
assert.equal(material.userData.terrainSoilStructurePolicyId, TERRAIN_SOIL_STRUCTURE_POLICY.id);
assert.equal(material.userData.terrainSeasonalPolicyId, TERRAIN_SEASONAL_POLICY.id);
const key = material.customProgramCacheKey();
for (const suffix of [TERRAIN_SEDIMENT_POLICY.materialKey, TERRAIN_BIOGENIC_POLICY.materialKey, TERRAIN_RUNOFF_PATH_POLICY.materialKey, TERRAIN_SOIL_STRUCTURE_POLICY.materialKey, TERRAIN_SEASONAL_POLICY.materialKey]) {
  assert(key.includes(suffix), `shader cache key lost ${suffix}`);
}
assert(key.split('|').length >= 6, 'composited terrain surface stack must preserve each material program layer');
assert.equal(installTerrainSediment(material), material, 'stack installer must remain idempotent');
console.log(JSON.stringify({ policyId: TERRAIN_SEDIMENT_POLICY.id, stack: ['sediment','biogenic','runoff','soil','seasonal'], cacheKeySegments: key.split('|').length, pass: true }));
