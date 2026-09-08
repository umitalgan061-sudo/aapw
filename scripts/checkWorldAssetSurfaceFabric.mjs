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

assert.equal(WORLD_ASSET_SURFACE_FABRIC_REVISION, 'v2-world-space-organic-material-fabric-micro-normal-uniform-context');
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
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.multiscaleNormalVariation, true);
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.worldSpaceNormalVariation, true);
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.independentNormalDomain, true);
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.dynamicSurfaceContextUniforms, true);
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.cacheKeyExcludesDynamicSurfaceContext, true);
assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.worldToViewNormalConversion, true);
assert(WORLD_ASSET_SURFACE_FABRIC_POLICY.macroScaleMeters > WORLD_ASSET_SURFACE_FABRIC_POLICY.mesoScaleMeters);
assert(WORLD_ASSET_SURFACE_FABRIC_POLICY.mesoScaleMeters > WORLD_ASSET_SURFACE_FABRIC_POLICY.patchScaleMeters);
assert(WORLD_ASSET_SURFACE_FABRIC_POLICY.patchScaleMeters > WORLD_ASSET_SURFACE_FABRIC_POLICY.fineScaleMeters);
assert(WORLD_ASSET_SURFACE_FABRIC_POLICY.fineScaleMeters > WORLD_ASSET_SURFACE_FABRIC_POLICY.grainScaleMeters);
assert(WORLD_ASSET_SURFACE_FABRIC_POLICY.maximumColorDeviation > 0);
assert(WORLD_ASSET_SURFACE_FABRIC_POLICY.maximumRoughnessDeviation > 0);
assert(WORLD_ASSET_SURFACE_FABRIC_POLICY.maximumNormalDeviation > 0);
assert(WORLD_ASSET_SURFACE_FABRIC_POLICY.normalDetailStepMeters > 0);

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
  assert(constantsA.normalEnergy >= 0 && constantsA.normalEnergy <= 1);
  assert(constantsA.maximumNormalDeviation > 0);
  assert(constantsA.normalDetailStepMeters >= 0.85);
  assert(constantsA.normalMacroScale > constantsA.normalMesoScale);
  assert(constantsA.normalMesoScale > constantsA.normalFineScale);
}

const warmContext = {
  ...surfaceContext,
  moisture: 0.12,
  dry: 0.88,
  wet: 0.10,
  snow: 0.02,
  coast: 0.04,
  roadDust: 0.78,
  exposure: 0.82,
  ecology: {
    ...surfaceContext.ecology,
    moisture: 0.12,
    aridity: 0.88,
    frost: 0.03,
    coastal: 0.04,
    moss: 0.06,
    lichen: 0.22,
    sedimentFabric: 0.18,
    weathering: 0.31,
    exposure: 0.82,
    normalFine: 0.26,
  },
};
const coolConstants = worldAssetSurfaceFabricConstants(surfaceContext, 'rock');
const warmConstants = worldAssetSurfaceFabricConstants(warmContext, 'rock');
assert.notEqual(coolConstants.moisture, warmConstants.moisture);
assert.notEqual(coolConstants.frost, warmConstants.frost);
assert.notEqual(coolConstants.normalEnergy, warmConstants.normalEnergy);

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
assert.equal(material.userData.worldAssetSurfaceFabric.maximumNormalDeviation, WORLD_ASSET_SURFACE_FABRIC_POLICY.maximumNormalDeviation);
assert.equal(material.userData.worldAssetSurfaceFabric.normalDetailStepMeters, WORLD_ASSET_SURFACE_FABRIC_POLICY.normalDetailStepMeters);
assert.equal(material.userData.worldAssetSurfaceFabric.normalEnergy, 0.73);
assert.equal(material.userData.worldAssetSurfaceFabric.dynamicSurfaceContextUniforms, true);
assert.equal(material.userData.worldAssetSurfaceFabric.cacheKeyExcludesDynamicSurfaceContext, true);
assert.equal(material.userData.worldAssetSurfaceFabric.worldToViewNormalConversion, true);
assert.deepEqual(material.userData.worldAssetSurfaceFabric.dynamicUniformNames, [
  'worldAssetSurfaceFabricNormalEnergy',
  'worldAssetSurfaceFabricMoisture',
  'worldAssetSurfaceFabricDryness',
  'worldAssetSurfaceFabricFrost',
  'worldAssetSurfaceFabricSalt',
  'worldAssetSurfaceFabricDamp',
  'worldAssetSurfaceFabricDust',
  'worldAssetSurfaceFabricMoss',
  'worldAssetSurfaceFabricLichen',
  'worldAssetSurfaceFabricSediment',
  'worldAssetSurfaceFabricWeathering',
  'worldAssetSurfaceFabricWind',
]);
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
  'worldAssetSurfaceFabricNormalCenter',
  'worldAssetSurfaceFabricNormalMeso',
  'worldAssetSurfaceFabricNormalFine',
  'worldAssetSurfaceFabricNormalDirectional',
  'worldAssetSurfaceFabricNormalGradientX',
  'worldAssetSurfaceFabricNormalGradientZ',
  'worldAssetSurfaceFabricNormalAmplitude',
  'worldAssetSurfaceFabricMicroEdgeWorld',
  'normal = normalize(normal +',
  'roughnessFactor',
]) {
  assert(shader.vertexShader.includes(marker) || shader.fragmentShader.includes(marker), `shader lost ${marker}`);
}

for (const uniformName of material.userData.worldAssetSurfaceFabric.dynamicUniformNames) {
  assert.equal(Object.prototype.hasOwnProperty.call(shader.uniforms, uniformName), true, `shader missing dynamic uniform ${uniformName}`);
  assert.equal(typeof shader.uniforms[uniformName].value, 'number', `dynamic uniform ${uniformName} must be numeric`);
}
assert.equal(shader.uniforms.worldAssetSurfaceFabricMoisture.value, coolConstants.moisture);
assert.equal(shader.uniforms.worldAssetSurfaceFabricFrost.value, coolConstants.frost);
assert.equal(shader.uniforms.worldAssetSurfaceFabricNormalEnergy.value, coolConstants.normalEnergy);
assert(shader.fragmentShader.includes('uniform float worldAssetSurfaceFabricMoisture'));
assert(shader.fragmentShader.includes('uniform float worldAssetSurfaceFabricNormalEnergy'));
assert(!shader.fragmentShader.includes(`float worldAssetSurfaceFabricMoisture = ${coolConstants.moisture.toFixed(6)}`),
  'dynamic moisture must not be embedded as a compile-time float');
assert(!shader.fragmentShader.includes(`float worldAssetSurfaceFabricFrost = ${coolConstants.frost.toFixed(6)}`),
  'dynamic frost must not be embedded as a compile-time float');
assert(shader.fragmentShader.includes('mat3(viewMatrix)\n  *'), 'world-space normal response must use the view rotation, not normalMatrix');
assert(!shader.fragmentShader.includes('normalMatrix\n  * (worldAssetSurfaceFabricNormalGradientWorld'),
  'world-space perturbation must not be transformed with the object normal matrix');

const cacheKeyBefore = material.customProgramCacheKey();
const cacheProbe = new THREE.MeshStandardMaterial();
const warmInstallation = installWorldAssetSurfaceFabric(cacheProbe, warmContext, {
  family: 'rock',
  customProgramSuffix: 'qa-rock-riverbank',
});
assert.equal(warmInstallation.ok, true);
assert.equal(cacheProbe.customProgramCacheKey(), cacheKeyBefore, 'dynamic environmental context must not fragment shader program cache keys');
const warmShader = { vertexShader, fragmentShader, uniforms: {} };
cacheProbe.onBeforeCompile(warmShader, null);
assert.equal(warmShader.uniforms.worldAssetSurfaceFabricMoisture.value, warmConstants.moisture);
assert.equal(warmShader.uniforms.worldAssetSurfaceFabricFrost.value, warmConstants.frost);
assert.notEqual(warmShader.uniforms.worldAssetSurfaceFabricMoisture.value, shader.uniforms.worldAssetSurfaceFabricMoisture.value);
assert.notEqual(warmShader.uniforms.worldAssetSurfaceFabricFrost.value, shader.uniforms.worldAssetSurfaceFabricFrost.value);
assert.equal(warmShader.fragmentShader, shader.fragmentShader, 'same structural variant should share identical shader source while uniforms vary');

assert(shader.vertexShader.includes('#ifdef USE_INSTANCING'), 'instanced meshes need instance-space world coordinates');
assert(shader.vertexShader.includes('instanceMatrix'), 'asset fabric must account for instanced transforms');
assert(shader.fragmentShader.includes('worldAssetSurfaceFabricNormalFamilyGain'), 'normal detail must use family-specific gain');
assert(shader.fragmentShader.includes('worldAssetSurfaceFabricNormalMaterialBias'), 'normal detail must respond to environment/material stress');
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
cacheProbe.dispose();

console.log('[checkWorldAssetSurfaceFabric] PASS: authored asset materials use deterministic world-space multiscale fabric with dynamic environmental uniforms, stable structural cache keys and correct world-to-view normal conversion while preserving source maps/UVs.');