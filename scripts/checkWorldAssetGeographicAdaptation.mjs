#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import {
  WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY,
  evaluateWorldAssetGeographicEligibility,
  geographicDensityScaleForWorldAsset,
  inferWorldAssetMaterialFamily,
  resolveWorldAssetGeographicProfile,
} from '../src/3d/world/worldAssetGeographicProfile.js';
import {
  WORLD_ASSET_SURFACE_WEATHERING_POLICY,
  applyWorldAssetGeographicWeathering,
  auditWorldAssetGeographicWeathering,
} from '../src/3d/world/worldAssetSurfaceWeathering.js';
import { northReferenceCryosphereAtWorldXZ } from '../src/3d/world/northReferenceCryosphere.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));

function discoverCanonicalClimateTarget(mode) {
  const halfWidth = WORLD_SCALE.WORLD_WIDTH_METERS * 0.5;
  const halfDepth = WORLD_SCALE.WORLD_DEPTH_METERS * 0.5;
  let best = null;
  for (let row = 0; row < 37; row += 1) {
    for (let column = 0; column < 41; column += 1) {
      const x = -halfWidth + (column + 0.5) / 41 * halfWidth * 2;
      const z = -halfDepth + (row + 0.5) / 37 * halfDepth * 2;
      const climate = northReferenceCryosphereAtWorldXZ(x, z) || {};
      const ice = clamp01(Number(climate.permanentIce) || 0);
      const tundra = clamp01(Number(climate.tundra) || 0);
      const score = mode === 'ice'
        ? ice * 2 + tundra * 0.25
        : (1 - ice) * 1.4 + (1 - tundra) * 0.6;
      if (!best || score > best.score) best = { x, z, ice, tundra, score };
    }
  }
  assert(best, `missing canonical ${mode} target`);
  return best;
}

const iceTarget = discoverCanonicalClimateTarget('ice');
const temperateTarget = discoverCanonicalClimateTarget('temperate');
assert(iceTarget.ice > 0.76, `expected permanent-ice target, got ${iceTarget.ice}`);
assert(temperateTarget.ice < iceTarget.ice, 'canonical climate target ordering collapsed');

const coldTree = resolveWorldAssetGeographicProfile({
  worldX: iceTarget.x,
  worldZ: iceTarget.z,
  surface: { height: 84, slopeDegrees: 9, moisture: 0.56, biome: 'tundra' },
  metadata: { category: 'tree', id: 'cold-tree-probe' },
});
const coldTreeEligibility = evaluateWorldAssetGeographicEligibility(coldTree);
assert.equal(coldTree.category, 'tree');
assert.equal(coldTree.autonomous, true);
assert.equal(coldTreeEligibility.ok, false, 'ordinary autonomous tree should not populate permanent ice');
assert(coldTree.suitability.score < coldTree.suitability.threshold);
assert(geographicDensityScaleForWorldAsset(coldTree) < 0.35, 'cold tree density should collapse near ice core');

const coldRock = resolveWorldAssetGeographicProfile({
  worldX: iceTarget.x,
  worldZ: iceTarget.z,
  surface: { height: 190, slopeDegrees: 33, moisture: 0.31, biome: 'alpine-bare' },
  metadata: { category: 'rock', id: 'cold-rock-probe' },
});
assert.equal(evaluateWorldAssetGeographicEligibility(coldRock).ok, true, 'exposed rock remains valid in cryosphere');
assert(coldRock.suitability.score >= WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY.eligibilityThresholds.rock);
assert(coldRock.weathering.frost > 0.55, 'cold rock needs strong frost weathering');
assert(coldRock.weathering.mineral > 0.35, 'cold exposed rock should retain mineral breakup');

const authoredBuilding = resolveWorldAssetGeographicProfile({
  worldX: iceTarget.x,
  worldZ: iceTarget.z,
  surface: { height: 45, slopeDegrees: 6, moisture: 0.48, biome: 'tundra' },
  metadata: { category: 'building', id: 'authored-north-building' },
});
assert.equal(authoredBuilding.structure, true);
assert.equal(authoredBuilding.suitability.score, 1);
assert.equal(evaluateWorldAssetGeographicEligibility(authoredBuilding).ok, true);
assert.equal(geographicDensityScaleForWorldAsset(authoredBuilding), 1, 'authored structures must retain placement density');

const dryRock = resolveWorldAssetGeographicProfile({
  worldX: temperateTarget.x,
  worldZ: temperateTarget.z,
  surface: { height: 150, slopeDegrees: 28, moisture: 0.14, biome: 'dry-upland' },
  metadata: { category: 'rock', id: 'dry-rock-probe' },
});
const wetWood = resolveWorldAssetGeographicProfile({
  worldX: temperateTarget.x,
  worldZ: temperateTarget.z,
  surface: { height: 8, slopeDegrees: 4, moisture: 0.92, biome: 'riparian', waterType: 'ocean', waterDepth: 0.05 },
  metadata: { category: 'waterside', id: 'wet-wood-probe' },
});
assert(dryRock.weathering.dry > dryRock.weathering.wet, 'dry upland should prefer dry weathering');
assert(wetWood.weathering.wet > wetWood.weathering.dry, 'wet waterside surface should prefer damp weathering');
assert(wetWood.weathering.salt > 0.25, 'ocean waterside material should receive salt response');

const repeatColdRock = resolveWorldAssetGeographicProfile({
  worldX: iceTarget.x,
  worldZ: iceTarget.z,
  surface: { height: 190, slopeDegrees: 33, moisture: 0.31, biome: 'alpine-bare' },
  metadata: { category: 'rock', id: 'cold-rock-probe' },
});
assert.deepEqual(repeatColdRock, coldRock, 'geographic profile must be deterministic');

assert.equal(inferWorldAssetMaterialFamily({ category: 'tree', materialName: 'Trunk' }), 'foliage');
assert.equal(inferWorldAssetMaterialFamily({ category: 'building', materialName: 'granite wall' }), 'stone');
assert.equal(inferWorldAssetMaterialFamily({ category: 'building', materialName: 'oak timber beam' }), 'wood');
assert.equal(inferWorldAssetMaterialFamily({ category: 'building', materialName: 'iron plate' }), 'metal');

const sourceTexture = new THREE.DataTexture(new Uint8Array([
  110, 105, 96, 255,
  132, 126, 112, 255,
  96, 91, 84, 255,
  145, 136, 119, 255,
]), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
sourceTexture.needsUpdate = true;
const sourceMaterial = new THREE.MeshStandardMaterial({ map: sourceTexture, roughness: 0.71, metalness: 0 });
sourceMaterial.name = 'granite wall';
sourceMaterial.userData.generatedByTextureFactory = true;
const mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 3), sourceMaterial);
mesh.name = 'weathering-probe-stone';
const root = new THREE.Group();
root.name = 'world-asset-weathering-probe';
root.add(mesh);

const weatheringResult = applyWorldAssetGeographicWeathering(root, coldRock, {
  metadata: { category: 'rock', name: 'canonical cold rock' },
});
assert.equal(weatheringResult.ok, true);
assert.equal(weatheringResult.materialCount, 1);
assert.notEqual(mesh.material, sourceMaterial, 'weathering must clone, never mutate shared source material');
assert.equal(mesh.material.map, sourceTexture, 'authored/generated source texture must be preserved');
assert.equal(mesh.material.userData.generatedByTextureFactory, true, 'shared material provenance must survive cloning');
assert.equal(mesh.material.userData.worldAssetSurfaceWeathering.policyId, WORLD_ASSET_SURFACE_WEATHERING_POLICY.id);
assert(mesh.material.customProgramCacheKey().includes(WORLD_ASSET_SURFACE_WEATHERING_POLICY.id));

const shader = {
  uniforms: {},
  vertexShader: '#include <common>\nvoid main(){\n#include <worldpos_vertex>\n}',
  fragmentShader: '#include <common>\nvoid main(){\n#include <color_fragment>\n#include <normal_fragment_maps>\n#include <roughnessmap_fragment>\n}',
};
mesh.material.onBeforeCompile(shader, null);
for (const marker of [
  'vWorldAssetGeoPosition',
  'worldAssetGeoFbm',
  'worldAssetGeoMacro',
  'worldAssetGeoFrostMask',
  'worldAssetGeoWetMask',
  'worldAssetGeoDryMask',
  'worldAssetGeoOrganicMask',
  'worldAssetGeoSaltMask',
  'worldAssetGeoAbrasionMask',
  'worldAssetGeoNormalMask',
  'worldAssetGeoRoughBreakup',
]) {
  assert(shader.vertexShader.includes(marker) || shader.fragmentShader.includes(marker), `weathering shader lost ${marker}`);
}
for (const uniform of [
  'uWorldAssetGeoFrost', 'uWorldAssetGeoSnowDust', 'uWorldAssetGeoWet', 'uWorldAssetGeoDry',
  'uWorldAssetGeoOrganic', 'uWorldAssetGeoSalt', 'uWorldAssetGeoMineral', 'uWorldAssetGeoAbrasion',
]) assert(uniform in shader.uniforms, `weathering shader lost ${uniform}`);

const weatherAudit = auditWorldAssetGeographicWeathering(root);
assert.equal(weatherAudit.ok, true, weatherAudit.errors.join(','));
assert.equal(weatherAudit.weatheredMaterialCount, 1);

const facadeSource = fs.readFileSync(new URL('../src/3d/world/WorldAssetPlacementPipeline.js', import.meta.url), 'utf8');
const coreSource = fs.readFileSync(new URL('../src/3d/world/WorldAssetPlacementPipelineCore.js', import.meta.url), 'utf8');
assert(facadeSource.includes("export * from './WorldAssetPlacementPipelineCore.js'"));
assert(facadeSource.includes('resolveWorldAssetGeographicProfile'));
assert(facadeSource.includes('evaluateWorldAssetGeographicEligibility'));
assert(facadeSource.includes('applyWorldAssetGeographicWeathering'));
assert(facadeSource.includes('authoredStructurePlacementUnchanged: true'));
assert(coreSource.includes('resolveWorldSurfacePlacement'), 'preserved core lost surface placement implementation');
assert(coreSource.includes('createDisconnectedFoundationIslandProbes'), 'preserved core lost foundation island grounding');
assert(!coreSource.includes('worldAssetGeographicProfile'), 'core must stay geography-neutral behind facade');

mesh.geometry.dispose();
mesh.material.dispose();
sourceMaterial.dispose();
sourceTexture.dispose();

console.log(JSON.stringify({
  policyId: WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY.id,
  weatheringPolicyId: WORLD_ASSET_SURFACE_WEATHERING_POLICY.id,
  canonicalTargets: { ice: iceTarget, temperate: temperateTarget },
  coldTree: { suitability: coldTree.suitability, densityScale: geographicDensityScaleForWorldAsset(coldTree) },
  coldRock: { suitability: coldRock.suitability, weathering: coldRock.weathering },
  dryRock: dryRock.weathering,
  wetWood: wetWood.weathering,
  shader: { cacheKey: mesh.material?.customProgramCacheKey?.() || null },
}, null, 2));
console.log('[checkWorldAssetGeographicAdaptation] PASS: canonical climate suitability + source-preserving world-space asset PBR weathering.');
