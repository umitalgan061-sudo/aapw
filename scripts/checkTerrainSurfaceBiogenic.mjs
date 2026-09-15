#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  TERRAIN_BIOGENIC_POLICY,
  TERRAIN_BIOGENIC_GLSL,
  TERRAIN_BIOGENIC_CANONICAL_INVARIANTS,
  resolveTerrainBiogenicState,
  resolveTerrainBiogenicMaterialResponse,
  installTerrainBiogenic,
} from '../src/3d/world/terrainSurfaceBiogenic.js';

const tests = [
  { x: 120, z: -70, h: 32, s: 4, m: 0.72, color: { r: 0.23, g: 0.36, b: 0.17 } },
  { x: 480, z: 260, h: 88, s: 9, m: 0.58, color: { r: 0.30, g: 0.42, b: 0.22 } },
  { x: -710, z: 440, h: 155, s: 14, m: 0.41, color: { r: 0.34, g: 0.39, b: 0.20 } },
  { x: 860, z: -940, h: 265, s: 20, m: 0.30, color: { r: 0.36, g: 0.34, b: 0.19 } },
  { x: -1440, z: 1220, h: 64, s: 7, m: 0.86, color: { r: 0.24, g: 0.37, b: 0.15 } },
  { x: 2200, z: -1320, h: 410, s: 12, m: 0.50, color: { r: 0.41, g: 0.41, b: 0.38 } },
];

assert.equal(TERRAIN_BIOGENIC_POLICY.id, 'terrain-surface-biogenic-2026-09-15-v1-organic-litter-biocrust');
assert.equal(TERRAIN_BIOGENIC_POLICY.renderOnly, true);
assert.equal(TERRAIN_BIOGENIC_POLICY.deterministic, true);
assert.equal(TERRAIN_BIOGENIC_POLICY.canonicalHeightUnchanged, true);
assert.equal(TERRAIN_BIOGENIC_POLICY.canonicalHydrologyUnchanged, true);
assert.equal(TERRAIN_BIOGENIC_POLICY.canonicalCoastlineUnchanged, true);
assert.equal(TERRAIN_BIOGENIC_POLICY.canonicalColliderUnchanged, true);
assert.equal(TERRAIN_BIOGENIC_POLICY.canonicalVegetationPlacementUnchanged, true);
assert.equal(TERRAIN_BIOGENIC_POLICY.newGeographyIntroduced, false);
assert.deepEqual(TERRAIN_BIOGENIC_CANONICAL_INVARIANTS, [
  'canonicalHeightUnchanged', 'canonicalHydrologyUnchanged', 'canonicalCoastlineUnchanged',
  'canonicalColliderUnchanged', 'canonicalVegetationPlacementUnchanged', 'newGeographyIntroduced:false',
]);
assert(TERRAIN_BIOGENIC_GLSL.includes('terrainBiogenicApplyColor'));
assert(TERRAIN_BIOGENIC_GLSL.includes('terrainBiogenicApplyRoughness'));
assert(TERRAIN_BIOGENIC_GLSL.includes('terrainBiogenicApplyNormal'));

for (const sample of tests) {
  const a = resolveTerrainBiogenicState({
    worldX: sample.x, worldZ: sample.z, heightMeters: sample.h, slopeDegrees: sample.s,
    moisture: sample.m, baseColor: sample.color,
  });
  const b = resolveTerrainBiogenicState({
    worldX: sample.x, worldZ: sample.z, heightMeters: sample.h, slopeDegrees: sample.s,
    moisture: sample.m, baseColor: sample.color,
  });
  assert.deepEqual(a, b, 'biogenic state must be deterministic');
  for (const key of ['organicDomain','decomposition','moistureField','vegetation','snow','gentle','lowland','forestBand','heathBand','litterBroad','litterFine','litterMicro','humusBroad','humusFine','biocrustBroad','biocrustFine','pore','litterHabitat','litter','humus','moss','dryCrust','mineralExposure','decompositionAge','poreStructure','effectiveOrganic']) {
    assert(a[key] >= 0 && a[key] <= 1, `${key} out of bounds: ${a[key]}`);
  }
  const response = resolveTerrainBiogenicMaterialResponse({ state: a, baseColor: sample.color, baseRoughness: 0.87 });
  for (const channel of Object.values(response.color)) assert(channel >= 0 && channel <= 1, 'biogenic color out of bounds');
  assert(response.roughness >= 0 && response.roughness <= 1, 'biogenic roughness out of bounds');
  assert(response.normalStrength >= 0 && response.normalStrength <= TERRAIN_BIOGENIC_POLICY.maxNormalStrength + 0.001);
}

const moist = resolveTerrainBiogenicState({ worldX: 640, worldZ: 320, heightMeters: 74, slopeDegrees: 7, moisture: 0.82, baseColor: { r: 0.24, g: 0.37, b: 0.16 } });
const dry = resolveTerrainBiogenicState({ worldX: 640, worldZ: 320, heightMeters: 74, slopeDegrees: 7, moisture: 0.18, baseColor: { r: 0.24, g: 0.37, b: 0.16 } });
assert(moist.humus >= dry.humus, 'moist conditions should retain at least as much humus');
assert(moist.moss >= dry.moss, 'moist conditions should retain more biocrust/moss response');

const steep = resolveTerrainBiogenicState({ worldX: 640, worldZ: 320, heightMeters: 74, slopeDegrees: 28, moisture: 0.72, baseColor: { r: 0.24, g: 0.37, b: 0.16 } });
assert(steep.litter <= moist.litter + 0.05, 'steep slopes should not create unbounded litter mats');

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
installTerrainBiogenic(material);
assert.equal(material.userData.terrainBiogenicSurfaceInstalled, true);
assert.equal(material.userData.terrainBiogenicCanonicalHeightUnchanged, true);
assert(material.customProgramCacheKey().includes(TERRAIN_BIOGENIC_POLICY.materialKey));
assert.strictEqual(installTerrainBiogenic(material), material, 'biogenic installer must be idempotent');

console.log(JSON.stringify({ policyId: TERRAIN_BIOGENIC_POLICY.id, cases: tests.length, pass: true }));
