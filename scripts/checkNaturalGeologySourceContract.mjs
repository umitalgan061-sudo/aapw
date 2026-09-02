#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import {
  NATURAL_GEOLOGY_RENDER_POLICY,
  prepareNaturalGeologyHydratedMaterial,
} from '../src/3d/world/naturalGeology.js';
import { NATURAL_GEOLOGY_PLACEMENT_POLICY } from '../src/3d/world/naturalGeologyPlacement.js';
import { VALYRIA_GEOLOGY_POLICY } from '../src/3d/world/valyriaGeology.js';
import { VALYRIA_BARREN_ECOLOGY_POLICY } from '../src/3d/world/valyriaEcology.js';

const ROOT = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const placementSource = read('src/3d/world/naturalGeologyPlacement.js');
const renderSource = read('src/3d/world/naturalGeology.js');
const valyriaSource = read('src/3d/world/valyriaGeology.js');
const ecologySource = read('src/3d/world/valyriaEcology.js');
const terrainSource = read('src/3d/world/terrain.js');
const sceneSource = read('src/3d/sceneManager.js');
const manifest = JSON.parse(read('assets_manifest.json'));

assert.equal(NATURAL_GEOLOGY_PLACEMENT_POLICY.renderOnly, true);
assert.equal(NATURAL_GEOLOGY_PLACEMENT_POLICY.geographyAuthorityUnchanged, true);
assert.equal(NATURAL_GEOLOGY_PLACEMENT_POLICY.heightAuthority, 'world/terrain.js');
assert.equal(NATURAL_GEOLOGY_PLACEMENT_POLICY.deterministic, true);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.minimumNearestNeighborMeters >= 20);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.settlementReserveMeters >= 120);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.roadReserveMeters >= 18);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.shorelineReserveMeters >= 8);

assert.equal(VALYRIA_GEOLOGY_POLICY.canonicalCoastlinePreserved, true);
assert.equal(VALYRIA_GEOLOGY_POLICY.canonicalWaterClassificationPreserved, true);
assert(VALYRIA_GEOLOGY_POLICY.id.includes('v4-natural-volcanic-morphology'));
assert(VALYRIA_GEOLOGY_POLICY.faultScarpAcrossFrequency > VALYRIA_GEOLOGY_POLICY.faultScarpAlongFrequency * 2);
assert(VALYRIA_GEOLOGY_POLICY.lavaDrainageIncisionMeters > 0);
assert(VALYRIA_GEOLOGY_POLICY.erosionGullyCutMeters > 0);
assert.equal(VALYRIA_BARREN_ECOLOGY_POLICY.geologyPolicyId, VALYRIA_GEOLOGY_POLICY.id);
assert.equal(VALYRIA_BARREN_ECOLOGY_POLICY.placementOnly, true);
assert.equal(VALYRIA_BARREN_ECOLOGY_POLICY.terrainHeightAuthorityUnchanged, true);
assert.equal(VALYRIA_BARREN_ECOLOGY_POLICY.colliderAuthorityUnchanged, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.legacyFbxMaterialPbrNormalization, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.legacyFbxDiffuseAndNormalMapsPreserved, true);

const legacyAlbedo = new THREE.Texture();
const legacyNormal = new THREE.Texture();
const legacyFbxMaterial = new THREE.MeshPhongMaterial({
  color: 0x786f64,
  map: legacyAlbedo,
  normalMap: legacyNormal,
  shininess: 72,
  opacity: 0.82,
  transparent: true,
  side: THREE.DoubleSide,
});
legacyFbxMaterial.name = 'legacy-fbx-rock-material';
const normalizedFbxMaterial = prepareNaturalGeologyHydratedMaterial(legacyFbxMaterial, { maxAnisotropy: 16 });
assert.equal(normalizedFbxMaterial.isMeshStandardMaterial, true, 'legacy FBX rock must use dielectric PBR');
assert.equal(normalizedFbxMaterial.map, legacyAlbedo, 'legacy FBX diffuse texture identity must be retained');
assert.equal(normalizedFbxMaterial.normalMap, legacyNormal, 'legacy FBX normal texture identity must be retained');
assert.equal(normalizedFbxMaterial.opacity, legacyFbxMaterial.opacity);
assert.equal(normalizedFbxMaterial.transparent, true);
assert.equal(normalizedFbxMaterial.side, THREE.DoubleSide);
assert.equal(normalizedFbxMaterial.metalness, 0);
assert(normalizedFbxMaterial.roughness >= NATURAL_GEOLOGY_RENDER_POLICY.hydratedRoughnessFloor);
assert.equal(normalizedFbxMaterial.userData.naturalGeologyLegacySourceMaterialType, 'MeshPhongMaterial');
assert.equal(normalizedFbxMaterial.userData.naturalGeologyLegacyPbrNormalized, true);
assert.equal(normalizedFbxMaterial.userData.naturalGeologyPbrMaterial, true);
assert.equal(normalizedFbxMaterial.userData.naturalGeologyWorldWeathering?.includes('correct-normal-space'), true);
assert.equal(legacyAlbedo.colorSpace, THREE.SRGBColorSpace);
assert.equal(legacyNormal.colorSpace, THREE.NoColorSpace);
assert.equal(legacyAlbedo.anisotropy, NATURAL_GEOLOGY_RENDER_POLICY.hydratedMaximumAnisotropy);
normalizedFbxMaterial.dispose();
legacyFbxMaterial.dispose();
legacyAlbedo.dispose();
legacyNormal.dispose();

for (const snippet of [
  'generateNaturalGeologyPlacements',
  'sampleTerrainFrame',
  'minimumDistanceToRoadMeters',
  'minimumDistanceToSeatMeters',
  'regionalStrataAngle',
  'minimumNearestNeighborMeters',
  "kind === 'asset-proxy'",
  'valyriaInfluenceAtWorldXZ',
]) {
  assert(placementSource.includes(snippet), `placement contract lost: ${snippet}`);
}
for (const snippet of [
  "from '../assetLoader.js'",
  'createNaturalGeology',
  'createValyriaVolcanicSurface',
  'upgradeNaturalGeologyAssets',
  'createNaturalRockPrototypeGeometry',
  'validateNaturalGeologyAsset',
  'hostedPreflightMinBytes',
  'maximumHydratedSourceBytes',
  'referenceLandscapeRuntimeLoad: false',
  'assets/models/fbx/rocky_terrain_low_poly.glb',
  'assets/models/fbx/desert_rocks.glb',
  'assets/models/fbx/rugged_mountain_landscape.glb',
]) {
  assert(renderSource.includes(snippet), `renderer contract lost: ${snippet}`);
}
for (const snippet of [
  'v4-natural-volcanic-morphology',
  'coreCenter',
  'neckCenter',
  'canonicalCoastlinePreserved: true',
  'canonicalWaterClassificationPreserved: true',
  'canonicalDryWaterWeightFullAtOrBelow',
  'canonicalDryWaterWeightZeroAtOrAbove',
  'faultStrikeRadians',
  'faultScarpAcrossFrequency',
  'faultScarpAlongFrequency',
  'lavaDrainageIncisionMeters',
  'erosionGullyCutMeters',
  'valyriaCanonicalDryGate01',
  'valyriaInfluence01',
  'valyriaMorphologySignals',
  'valyriaUpliftMeters',
  'valyriaSurfaceWeights',
  'applyValyriaSurfaceColorAtWorldXZ',
  'isValyriaBarrenAtWorldXZ',
  'valyriaGeologyClassAtWorldXZ',
]) {
  assert(valyriaSource.includes(snippet), `Valyria contract lost: ${snippet}`);
}
for (const snippet of [
  'placementOnly: true',
  'terrainHeightAuthorityUnchanged: true',
  'colliderAuthorityUnchanged: true',
  'vegetation-tree-scatter',
  'procedural-villages',
  'wind-grass-ground-cover',
  'createValyriaBarrenEcologyPlacementProbe',
  'isOrdinaryEcologyAllowedAtWorldXZ',
  'valyriaEcologyProfileAtWorldXZ',
  'v2-feathered-refugia',
]) {
  assert(ecologySource.includes(snippet), `Valyria ecology contract lost: ${snippet}`);
}

for (const snippet of [
  "from './valyriaGeology.js'",
  'valyriaGeologyPolicyId: VALYRIA_GEOLOGY_POLICY.id',
  'valyriaUpliftMeters(nx, ny, dryRelativeBase, waterWeight)',
  'const dryRelative = dryRelativeBase + valyriaMeters',
  'outSurface.valyriaUpliftMeters = valyriaMeters',
  'applyValyriaSurfaceColorAtWorldXZ(blended',
  'canonicalHeightIntegrated: true',
  'canonicalWaterClassificationPreserved: true',
]) {
  assert(terrainSource.includes(snippet), `canonical terrain Valyria wiring lost: ${snippet}`);
}

for (const snippet of [
  "from './world/valyriaEcology.js'",
  'createValyriaBarrenEcologyPlacementProbe',
  'sampleHeightMeters: groundCollider.getGroundHeight',
  'sampleHeightMeters: valyriaEcologyPlacement.sampleHeightMeters',
  'state.valyriaEcologyPlacement.sampleHeightMeters',
  'naturalGeology: naturalGeologyResult.group',
  'valyriaEcologyPlacement,',
]) {
  assert(sceneSource.includes(snippet), `scene Valyria runtime wiring lost: ${snippet}`);
}
assert(sceneSource.indexOf('const naturalGeologyResult = createNaturalGeology') < sceneSource.indexOf('const vegetationResult = createVegetation'), 'geology must remain visually primary before vegetation');
assert(sceneSource.indexOf('const roadsResult = buildRoadNetwork') < sceneSource.indexOf('const naturalGeologyResult = createNaturalGeology'), 'geology placement must know road corridors');

assert(!valyriaSource.includes("from 'three'"), 'Valyria authority must remain renderer-independent');
assert(!valyriaSource.includes('Math.random()'), 'Valyria geology must remain deterministic');
assert(!ecologySource.includes("from 'three'"), 'Valyria ecology adapter must remain renderer-independent');
assert(!ecologySource.includes('Math.random()'), 'Valyria ecology adapter must remain deterministic');
for (const forbidden of ['Math.random()', 'setTerrainHeight', 'writeHeight', 'flattenPads.push', 'WORLD_REFERENCE_BASE_SURFACE_MASK =', 'createHeightSampler(']) {
  assert(!placementSource.includes(forbidden), `placement became geography authority: ${forbidden}`);
  assert(!renderSource.includes(forbidden), `render layer became geography authority: ${forbidden}`);
}

const manifestFiles = new Set(manifest.assets.map((entry) => entry.file));
for (const file of [...NATURAL_GEOLOGY_PLACEMENT_POLICY.directAssetFamilies, ...NATURAL_GEOLOGY_PLACEMENT_POLICY.referenceOnlyAssets]) {
  assert(manifestFiles.has(file), `unregistered geology model: ${file}`);
}
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.knownLfsBytes['assets/models/fbx/rugged_mountain_landscape.glb'] > 40_000_000);
assert(!renderSource.includes('loadModel(NATURAL_GEOLOGY_RENDER_POLICY.referenceLandscapeAsset'), '50MB landscape must remain reference-only');

console.log('[checkNaturalGeologySourceContract] PASS');
console.log(JSON.stringify({
  policyId: NATURAL_GEOLOGY_PLACEMENT_POLICY.id,
  directAssets: NATURAL_GEOLOGY_PLACEMENT_POLICY.directAssetFamilies,
  referenceOnlyAssets: NATURAL_GEOLOGY_PLACEMENT_POLICY.referenceOnlyAssets,
  knownLfsBytes: NATURAL_GEOLOGY_PLACEMENT_POLICY.knownLfsBytes,
  valyriaPolicy: VALYRIA_GEOLOGY_POLICY.id,
  valyriaEcologyPolicy: VALYRIA_BARREN_ECOLOGY_POLICY.id,
  canonicalTerrainIntegration: true,
  naturalVolcanicMorphology: true,
}, null, 2));

