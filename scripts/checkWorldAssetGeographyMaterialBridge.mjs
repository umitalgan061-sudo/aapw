#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY,
  createWorldAssetGeographyMaterialVariant,
  materialFamilyForWorldAsset,
  sampleWorldAssetGeographyMaterialResponse,
} from '../src/3d/world/worldAssetGeographyMaterialBridge.js';

const inland = {
  x: 100,
  z: 200,
  height: 50,
  slopeDegrees: 8,
  moisture: 0.46,
  biome: 'meadow',
  snow: 0,
  lithic: 0.24,
  erosion: 0.30,
  shelter: 0.62,
  coastDistance: 600,
  riverDistance: 500,
  lakeDistance: 500,
  roadDistance: 90,
  settlementDistance: 100,
  normalizedX: 0.34,
  normalizedY: 0.52,
};

function bounded(value, label) {
  assert.ok(Number.isFinite(value), `${label} should be finite`);
  assert.ok(value >= 0 && value <= 1, `${label} should be bounded`);
}

const coast = {
  ...inland,
  x: 120,
  z: 220,
  moisture: 0.72,
  biome: 'coastal grass',
  lithic: 0.58,
  erosion: 0.62,
  coastDistance: 8,
};

const river = {
  ...inland,
  x: 130,
  z: 230,
  moisture: 0.86,
  biome: 'riparian meadow',
  riverDistance: 5,
};

const dry = {
  ...inland,
  x: 500,
  z: 300,
  moisture: 0.12,
  biome: 'dry heath',
  shelter: 0.20,
  slopeDegrees: 18,
};

const frost = {
  ...inland,
  x: -180,
  z: -220,
  moisture: 0.48,
  biome: 'alpine ridge',
  snow: 0.64,
  lithic: 0.86,
  erosion: 0.72,
  shelter: 0.16,
  slopeDegrees: 46,
};

for (const [label, fixture] of Object.entries({ inland, coast, river, dry, frost })) {
  for (const materialName of ['stone wall', 'wood timber', 'plaster render', 'iron metal', 'leaf foliage', 'thatch roof', 'unknown prop']) {
    const result = sampleWorldAssetGeographyMaterialResponse({ surface: fixture, metadata: { family: 'vegetation' }, materialName });
    assert.equal(result.policyId, WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.id);
    assert.ok(result.profile, `${label}/${materialName} should produce a profile`);
    assert.ok(result.validation.ok, `${label}/${materialName} profile should validate`);
    for (const [key, value] of Object.entries(result.weights)) bounded(value, `${label}/${materialName}.weights.${key}`);
    for (const [key, value] of Object.entries(result.response)) {
      if (key === 'color') continue;
      assert.ok(Number.isFinite(value), `${label}/${materialName}.response.${key} should be finite`);
    }
    assert.equal(result.regional.enabled, true, `${label}/${materialName} should see explicit regional coordinates`);
    assert.equal(result.transition.policyId.length > 0, true);
  }
}

const stoneInland = sampleWorldAssetGeographyMaterialResponse({ surface: inland, materialName: 'stone wall' });
const stoneCoast = sampleWorldAssetGeographyMaterialResponse({ surface: coast, materialName: 'stone wall' });
const woodInland = sampleWorldAssetGeographyMaterialResponse({ surface: inland, materialName: 'wood timber' });
const woodRiver = sampleWorldAssetGeographyMaterialResponse({ surface: river, materialName: 'wood timber' });
const foliageDry = sampleWorldAssetGeographyMaterialResponse({ surface: dry, materialName: 'leaf foliage' });
const foliageInland = sampleWorldAssetGeographyMaterialResponse({ surface: inland, materialName: 'leaf foliage' });
const rockFrost = sampleWorldAssetGeographyMaterialResponse({ surface: frost, materialName: 'rock stone' });
const rockInland = sampleWorldAssetGeographyMaterialResponse({ surface: inland, materialName: 'rock stone' });

assert.ok(stoneCoast.weights.salt > stoneInland.weights.salt, 'coastal stone should receive stronger salt response');
assert.ok(woodRiver.weights.damp > woodInland.weights.damp, 'river wood should receive stronger damp response');
assert.ok(foliageDry.weights.dry > foliageInland.weights.dry, 'dry heath foliage should receive stronger dry response');
assert.ok(rockFrost.weights.frost > rockInland.weights.frost, 'frost rock should receive stronger frost response');

const source = new THREE.MeshStandardMaterial({
  name: 'stone wall',
  color: new THREE.Color(0.6, 0.58, 0.52),
  roughness: 0.72,
  metalness: 0.02,
});
const map = new THREE.Texture();
const normal = new THREE.Texture();
source.map = map;
source.normalMap = normal;
source.normalScale.set(0.8, 0.8);

const variantResult = createWorldAssetGeographyMaterialVariant(source, {
  surface: coast,
  metadata: { family: 'rock' },
  materialName: 'stone wall',
});
assert.equal(variantResult.ok, true);
assert.notEqual(variantResult.material, source, 'default bridge should clone source material');
assert.equal(variantResult.preserved.map, true, 'authored map must be preserved');
assert.equal(variantResult.preserved.normalMap, true, 'authored normal map must be preserved');
assert.equal(variantResult.preserved.sourceUvsUntouched, true);
assert.ok(Math.abs(variantResult.material.roughness - source.roughness) <= WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.maximumRoughnessDelta);
assert.ok(Math.abs(variantResult.material.metalness - source.metalness) <= WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.maximumMetalnessDelta);
assert.ok(Math.abs(variantResult.material.normalScale.x - source.normalScale.x) <= WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.maximumNormalScaleDelta);
assert.ok(Math.abs(variantResult.material.opacity - source.opacity) <= WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.maximumOpacityDelta);

assert.equal(materialFamilyForWorldAsset('stone wall'), 'stone');
assert.equal(materialFamilyForWorldAsset('timber beam'), 'wood');
assert.equal(materialFamilyForWorldAsset('foliage canopy'), 'foliage');
assert.equal(materialFamilyForWorldAsset('unknown mesh'), 'generic');

const noRegion = sampleWorldAssetGeographyMaterialResponse({
  surface: { ...inland, normalizedX: undefined, normalizedY: undefined },
  materialName: 'stone wall',
});
assert.equal(noRegion.regional.enabled, false, 'regional palette must stay disabled without explicit normalized coordinates');
assert.equal(noRegion.regional.weight, 0);

console.log(JSON.stringify({
  ok: true,
  policyId: WORLD_ASSET_GEOGRAPHY_MATERIAL_BRIDGE_POLICY.id,
  stoneCoastSalt: stoneCoast.weights.salt,
  woodRiverDamp: woodRiver.weights.damp,
  dryFoliage: foliageDry.weights.dry,
  frostRock: rockFrost.weights.frost,
  preservedMaps: variantResult.preserved,
}, null, 2));
