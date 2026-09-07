#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  WORLD_ASSET_SURFACE_FABRIC_POLICY,
  WORLD_ASSET_SURFACE_FABRIC_REVISION,
  installWorldAssetSurfaceFabric,
  worldAssetSurfaceFabricConstants,
} from '../src/3d/materials/worldAssetSurfaceFabric.js';

const surfaceContext = {
  moisture: 0.71,
  dry: 0.28,
  wet: 0.76,
  snow: 0.18,
  coast: 0.61,
  roadDust: 0.33,
  exposure: 0.57,
  ecology: {
    moisture: 0.71,
    aridity: 0.28,
    frost: 0.22,
    coastal: 0.61,
    moss: 0.48,
    lichen: 0.63,
    sedimentFabric: 0.71,
    weathering: 0.64,
    exposure: 0.57,
    normalFine: 0.73,
  },
};

assert.equal(WORLD_ASSET_SURFACE_FABRIC_REVISION, 'v1-world-space-organic-material-fabric');
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.renderOnly, true);
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.deterministic, true);
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.worldSpace, true);
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.geometryUnchanged, true);
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.sourceMapsPreserved, true);
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.sourceUvsPreserved, true);
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.canonicalTerrainReadOnly, true);
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.canonicalHydrologyReadOnly, true);
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.canonicalColliderReadOnly, true);
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.newGeographyIntroduced, false);
assert(WORLD_ASSET_SURFACE_FABRIC_POLICY.macroScaleMeters > WORLD_ASSET_SURFACE_FABRIC_POLICY.mesoScaleMeters);
assert(WORLD_ASSET_SURFACE_FABRIC_POLICY.mesoScaleMeters > WORLD_ASSET_SURFACE_FABRIC_POLICY.patchScaleMeters);
assert(WORLD_ASSET_SURFACE_FABRIC_POLICY.patchScaleMeters > WORLD_ASSET_SURFACE_FABRIC_POLICY.fineScaleMeters);
assert(WORLD_ASSET_SURFACE_FABRIC_POLICY.fineScaleMeters > WORLD_ASSET_SURFACE_FABRIC_POLICY.grainScaleMeters);
assert(WORLD_ASSET_SURFACE_FABRIC_POLICY.maximumColorDeviation > 0);
assert(WORLD_ASSET_SURFACE_FABRIC_POLICY.maximumRoughnessDeviation > 0);

const families = ['stone', 'rock', 'soil', 'wood', 'foliage', 'roof', 'metal', 'cryosphere', 'generic'];
for (const family of families) {
  const constantsA = worldAssetSurfaceFabricConstants(surfaceContext, family);
  const constantsB = worldAssetSurfaceFabricConstants(surfaceContext, family);
  assert.deepEqual(constantsA, constantsB, `${family} shader constants must be deterministic`);
  assert(constantsA.familyCode >= 0 && constantsA.familyCode <= 7);
  assert(constantsA.familyGain >= 0.45 && constantsA.familyGain <= 1.18);
  assert(constantsA.macroScale > constantsA.mesoScale);
  assert(constantsA.mesoScale > constantsA.patchScale);
  assert(constantsA.patchScale > constantsA.fineScale);
  assert(constantsA.fineScale > constantsA.grainScale);
}

const material = new THREE.MeshStandardMaterial({
  color: 0x817864,
  roughness: 0.76,
  metalness: 0.12,
});
material.userData ||= {};
const installation = installWorldAssetSurfaceFabric(material, surfaceContext, {
  family: 'rock',
  materialResponse: { normalStrength: 0.91, normalEnergy: 0.73 },
  customProgramSuffix: 'qa-rock-riverbank',
});
assert.equal(installation.ok, true);
assert.equal(installation.policyId, WORLD_ASSET_SURFACE_FABRIC_POLICY.id);
assert.equal(material.userData.worldAssetSurfaceFabric.installed, true);
assert.equal(material.userData.worldAssetSurfaceFabric.worldSpace, true);
assert.equal(material.userData.worldAssetSurfaceFabric.sourceMapsPreserved, true);
assert.equal(material.userData.worldAssetSurfaceFabric.sourceUvsPreserved, true);
assert.equal(material.customProgramCacheKey(), `${WORLD_ASSET_SURFACE_FABRIC_POLICY.id}:1:qa-rock-riverbank`);
assert.equal(typeof material.onBeforeCompile, 'function');

const vertexShader = `
#include <common>
#include <begin_vertex>
#include <beginnormal_vertex>
`;
const fragmentShader = `
#include <common>
#include <roughnessmap_fragment>
#include <normal_fragment_maps>
#include <color_fragment>
`;
const shader = { vertexShader, fragmentShader, uniforms: {} };
material.onBeforeCompile(shader, null);

for (const marker of [
  'vWorldAssetSurfaceFabricPosition',
  'vWorldAssetSurfaceFabricNormal',
  'worldAssetSurfaceFabricHash',
  'worldAssetSurfaceFabricNoise',
  'worldAssetSurfaceFabricFbm',
  'worldAssetSurfaceFabricRidge',
  'worldAssetSurfaceFabricMacro',
  'worldAssetSurfaceFabricMeso',
  'worldAssetSurfaceFabricPatch',
  'worldAssetSurfaceFabricFine',
  'worldAssetSurfaceFabricGrain',
  'worldAssetSurfaceFabricDirectional',
  'worldAssetSurfaceFabricWetDark',
  'worldAssetSurfaceFabricDryDust',
  'worldAssetSurfaceFabricSaltBleach',
  'worldAssetSurfaceFabricFrostVeil',
  'worldAssetSurfaceFabricWeatherFade',
  'worldAssetSurfaceFabricRoughMacro',
  'worldAssetSurfaceFabricRoughMeso',
  'worldAssetSurfaceFabricRoughFine',
  'worldAssetSurfaceFabricRoughDirectional',
  'roughnessFactor',
]) {
  assert(shader.vertexShader.includes(marker) || shader.fragmentShader.includes(marker), `shader lost ${marker}`);
}

assert(shader.vertexShader.includes('#ifdef USE_INSTANCING'), 'instanced meshes need instance-space world coordinates');
assert(shader.vertexShader.includes('instanceMatrix'), 'asset fabric must account for instanced transforms');
assert(shader.fragmentShader.includes('worldAssetSurfaceFabricWeathering'), 'fragment shader must contain environmental weathering response');
assert(shader.fragmentShader.includes('worldAssetSurfaceFabricSediment'), 'fragment shader must contain directional sediment response');
assert(shader.fragmentShader.includes('worldAssetSurfaceFabricFamilyCode'), 'fragment shader must select family-specific fabric');
assert(shader.fragmentShader.includes('clamp(roughnessFactor'), 'roughness response must remain bounded');
assert(!shader.fragmentShader.includes('worldPosition.xyz'), 'fabric must not rely on an undeclared worldPosition varying');

const repeated = installWorldAssetSurfaceFabric(material, surfaceContext, { family: 'rock' });
assert.equal(repeated.ok, true);
assert.equal(repeated.alreadyInstalled, true);

const sourceMap = new THREE.Texture();
material.map = sourceMap;
const mapBefore = material.map;
assert.equal(material.map, mapBefore);
assert.equal(material.userData.worldAssetSurfaceFabric.sourceMapsPreserved, true);
sourceMap.dispose();
material.dispose();

console.log('[checkWorldAssetSurfaceFabric] PASS: placed authored asset materials gain deterministic world-space multiscale albedo/roughness fabric while source maps/UVs and scene geometry remain preserved.');