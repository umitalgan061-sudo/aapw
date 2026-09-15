#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  TERRAIN_SEDIMENT_POLICY,
  TERRAIN_SEDIMENT_GLSL,
  resolveTerrainSedimentState,
  resolveTerrainSedimentMaterialResponse,
  sedimentRegionSignature,
  sedimentPolicySnapshot,
  installTerrainSediment,
} from '../src/3d/world/terrainSurfaceSediment.js';

const EPS = 1e-9;
const cases = [
  { name: 'lowland basin', x: 240, z: -410, height: 42, slope: 3 },
  { name: 'pasture shoulder', x: 860, z: 615, height: 88, slope: 11 },
  { name: 'rainwash upland', x: -1160, z: 920, height: 230, slope: 21 },
  { name: 'steep runoff', x: 1540, z: -970, height: 315, slope: 35 },
  { name: 'dry bench', x: -1880, z: 1440, height: 180, slope: 8 },
  { name: 'coastal plain', x: 2920, z: -320, height: 14, slope: 2 },
  { name: 'high cool ground', x: -2540, z: 1840, height: 480, slope: 17 },
  { name: 'world seam', x: 499.998, z: -999.998, height: 73, slope: 9 },
];

function assertBounded(state, name) {
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === 'number') assert(value >= -EPS && value <= 1 + EPS, `${name}.${key} out of range: ${value}`);
  }
  for (const key of ['basin','catchment','wash','aggregate','film','crust','pore','sedimentLoad','mineralDeposit','muddyFilm','washBleach','dryCrust','poreRoughness','transient']) {
    assert(state[key] >= -EPS && state[key] <= 1 + EPS, `${name}.${key} must be bounded`);
  }
}

assert.equal(TERRAIN_SEDIMENT_POLICY.renderOnly, true);
assert.equal(TERRAIN_SEDIMENT_POLICY.deterministic, true);
assert.equal(TERRAIN_SEDIMENT_POLICY.canonicalHeightUnchanged, true);
assert.equal(TERRAIN_SEDIMENT_POLICY.canonicalHydrologyUnchanged, true);
assert.equal(TERRAIN_SEDIMENT_POLICY.canonicalCoastlineUnchanged, true);
assert.equal(TERRAIN_SEDIMENT_POLICY.canonicalColliderUnchanged, true);
assert.equal(TERRAIN_SEDIMENT_POLICY.newGeographyIntroduced, false);
assert.equal(TERRAIN_SEDIMENT_POLICY.profileCount, 64);
assert.equal(sedimentPolicySnapshot().id, TERRAIN_SEDIMENT_POLICY.id);
assert.equal(sedimentPolicySnapshot().deterministic, true);
assert.equal(sedimentPolicySnapshot().renderOnly, true);
assert(TERRAIN_SEDIMENT_GLSL.includes('terrainSedimentApplyColor'));
assert(TERRAIN_SEDIMENT_GLSL.includes('terrainSedimentApplyRoughness'));
assert(TERRAIN_SEDIMENT_GLSL.includes('terrainSedimentApplyNormal'));

for (const testCase of cases) {
  const first = resolveTerrainSedimentState({
    worldX: testCase.x,
    worldZ: testCase.z,
    heightMeters: testCase.height,
    slopeDegrees: testCase.slope,
  });
  const second = resolveTerrainSedimentState({
    worldX: testCase.x,
    worldZ: testCase.z,
    heightMeters: testCase.height,
    slopeDegrees: testCase.slope,
  });
  assert.deepEqual(first, second, `${testCase.name} must be deterministic`);
  assertBounded(first, testCase.name);
  const response = resolveTerrainSedimentMaterialResponse({
    state: first,
    baseColor: { r: 0.34, g: 0.40, b: 0.25 },
    baseRoughness: 0.86,
  });
  assert(response.roughness >= 0 && response.roughness <= 1, `${testCase.name} roughness out of bounds`);
  assert(response.normalStrength >= 0 && response.normalStrength <= TERRAIN_SEDIMENT_POLICY.maxNormalStrength + 0.001);
  for (const channel of Object.values(response.color)) assert(channel >= 0 && channel <= 1, `${testCase.name} color out of bounds`);
}

const low = resolveTerrainSedimentState({ worldX: 400, worldZ: 100, heightMeters: 36, slopeDegrees: 2 });
const steep = resolveTerrainSedimentState({ worldX: 400, worldZ: 100, heightMeters: 36, slopeDegrees: 34 });
assert(steep.wash >= low.wash, 'steeper terrain must not reduce rainwash energy at the same world position');
const basin = resolveTerrainSedimentState({ worldX: 710, worldZ: -640, heightMeters: 58, slopeDegrees: 2 });
const cliff = resolveTerrainSedimentState({ worldX: 710, worldZ: -640, heightMeters: 58, slopeDegrees: 42 });
assert(basin.film >= cliff.film, 'gentle basin should retain more transient film than steep terrain');

const signatureA = sedimentRegionSignature(2400.25, -1310.5);
const signatureB = sedimentRegionSignature(2400.25, -1310.5);
assert.deepEqual(signatureA, signatureB, 'regional signature must be deterministic');

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
installTerrainSediment(material);
assert.equal(material.userData.terrainSedimentSurfaceInstalled, true);
assert.equal(material.userData.terrainSedimentRenderOnly, true);
assert(material.customProgramCacheKey().includes(TERRAIN_SEDIMENT_POLICY.materialKey));
assert.equal(material.needsUpdate, true);

const repeatedMaterial = installTerrainSediment(material);
assert.strictEqual(repeatedMaterial, material, 'installer must be idempotent');
console.log(JSON.stringify({
  policyId: TERRAIN_SEDIMENT_POLICY.id,
  profiles: TERRAIN_SEDIMENT_POLICY.profileCount,
  cases: cases.length,
  signature: signatureA,
  pass: true,
}));
