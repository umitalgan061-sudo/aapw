#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NATURAL_GEOLOGY_PLACEMENT_POLICY } from '../src/3d/world/naturalGeologyPlacement.js';
import { VALYRIA_GEOLOGY_POLICY } from '../src/3d/world/valyriaGeology.js';
import { VALYRIA_BARREN_ECOLOGY_POLICY } from '../src/3d/world/valyriaEcology.js';
import { NATURAL_GEOLOGY_RENDER_POLICY } from '../src/3d/world/naturalGeology.js';

const ROOT = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const placementSource = read('src/3d/world/naturalGeologyPlacement.js');
const renderSource = read('src/3d/world/naturalGeology.js');
const adapterSource = read('src/3d/world/PreResolvedInstancedAssetPlacement.js');
const materialCoreSource = read('src/3d/materials/MaterialAssignmentCore.js');
const worldPlacementSource = read('src/3d/world/WorldAssetPlacementPipeline.js');
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

assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.renderOnly, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.geographyAuthorityUnchanged, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.familyScopedProxyBatches, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.physicalProxyRemoval, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.splitProxySuppression, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.transactionalFamilyHydration, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.disposedGroupHydrationGuard, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.pagehideSelfDisposal, true);
assert(NATURAL_GEOLOGY_RENDER_POLICY.hydratedInstanceTintStrength > 0);
assert(NATURAL_GEOLOGY_RENDER_POLICY.hydratedInstanceTintStrength <= 0.25);
assert(NATURAL_GEOLOGY_RENDER_POLICY.id.includes('v5-family-proxy-lifecycle'));

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
  "from './PreResolvedInstancedAssetPlacement.js'",
  'createNaturalGeology',
  'createValyriaVolcanicSurface',
  'upgradeNaturalGeologyAssets',
  'disposeNaturalGeology',
  'createNaturalRockPrototypeGeometry',
  'validateNaturalGeologyAsset',
  'hostedPreflightMinBytes',
  'maximumHydratedSourceBytes',
  'referenceLandscapeRuntimeLoad: false',
  'sharedPlacementManifestRequired: true',
  'transactionalFamilyHydration: true',
  'familyScopedProxyBatches: true',
  'physicalProxyRemoval: true',
  'disposedGroupHydrationGuard: true',
  'pagehideSelfDisposal: true',
  'hydratedInstanceTintStrength',
  'hydratedTintForPlacement',
  'naturalGeologyAssetFamily',
  'removeProxyFamily',
  'hydrationCancelled',
  'naturalGeologyDisposed',
  'bindPagehideDisposal',
  'naturalGeologyPagehideDispose',
  "window.addEventListener('pagehide'",
  "window.removeEventListener('pagehide'",
  'preparePreResolvedInstancedWorldAsset',
  'auditPreResolvedInstancedWorldAsset',
  'attachPreparedPreResolvedInstancedWorldAsset',
  'prepareHydratedBatch',
  'disposeStagedHydratedBatches',
  'assets/models/fbx/rocky_terrain_low_poly.glb',
  'assets/models/fbx/desert_rocks.glb',
  'assets/models/fbx/rugged_mountain_landscape.glb',
]) {
  assert(renderSource.includes(snippet), `renderer contract lost: ${snippet}`);
}
assert(!renderSource.includes('hideProxyInstances('), 'zero-scale proxy suppression returned');
assert(!renderSource.includes('tempScale.set(0, 0, 0)'), 'hydrated proxy instances are still hidden by zero scale');
assert(!renderSource.includes('group.add(...hydrated)'), 'hydrated geology bypassed shared attachment gate');
assert(renderSource.indexOf('preparePreResolvedInstancedWorldAsset') < renderSource.lastIndexOf('removeProxyFamily(group, family)'), 'proxy retirement must occur only after shared preparation');
assert(renderSource.indexOf('attachPreparedPreResolvedInstancedWorldAsset') < renderSource.lastIndexOf('removeProxyFamily(group, family)'), 'proxy retirement must occur only after shared attachment');
assert(renderSource.indexOf('removeProxyFamily(group, family)') < renderSource.indexOf("status: 'active'"), 'family must retire fallback before reporting active');

for (const snippet of [
  "from '../materials/MaterialAssignmentCore.js'",
  "from './WorldAssetPlacementPipeline.js'",
  'createMaterialManifest',
  'validateMaterialAssignment',
  'attachPreparedWorldAsset',
  'PRE_RESOLVED_INSTANCED_ASSET_POLICY',
  'preparePreResolvedInstancedWorldAsset',
  'attachPreparedPreResolvedInstancedWorldAsset',
  'auditPreResolvedInstancedWorldAsset',
  'pre-resolved-instanced',
  'materialReadyForWorld',
  'worldPlacementManifest',
  'authoredMaterialPreserved: true',
  'matricesMutated: false',
  'placement-count-mismatch',
  'non-finite-instance-matrix',
]) {
  assert(adapterSource.includes(snippet), `instanced shared-placement bridge lost: ${snippet}`);
}
assert(materialCoreSource.includes('export function validateMaterialAssignment'));
assert(materialCoreSource.includes('export function createMaterialManifest'));
assert(worldPlacementSource.includes('export function attachPreparedWorldAsset'));

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
  'isValyriaBarrenAtWorldXZ',
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
  assert(!adapterSource.includes(forbidden), `instanced bridge became geography authority: ${forbidden}`);
}
assert(!adapterSource.includes('autoAssignMaterials('), 'pre-resolved bridge must preserve authored materials');
assert(!adapterSource.includes('applyMaterialRecipe('), 'pre-resolved bridge must not replace authored materials');
assert(!adapterSource.includes('object.position.y ='), 'pre-resolved bridge must not re-ground canonical instance matrices');
assert(!adapterSource.includes('setMatrixAt('), 'pre-resolved bridge must never mutate caller-owned instance matrices');

const manifestFiles = new Set(manifest.assets.map((entry) => entry.file));
for (const file of [...NATURAL_GEOLOGY_PLACEMENT_POLICY.directAssetFamilies, ...NATURAL_GEOLOGY_PLACEMENT_POLICY.referenceOnlyAssets]) {
  assert(manifestFiles.has(file), `unregistered geology model: ${file}`);
}
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.knownLfsBytes['assets/models/fbx/rugged_mountain_landscape.glb'] > 40_000_000);
assert(!renderSource.includes('loadModel(NATURAL_GEOLOGY_RENDER_POLICY.referenceLandscapeAsset'), '50MB landscape must remain reference-only');

console.log('[checkNaturalGeologySourceContract] PASS');
console.log(JSON.stringify({
  placementPolicy: NATURAL_GEOLOGY_PLACEMENT_POLICY.id,
  rendererPolicy: NATURAL_GEOLOGY_RENDER_POLICY.id,
  directAssets: NATURAL_GEOLOGY_PLACEMENT_POLICY.directAssetFamilies,
  referenceOnlyAssets: NATURAL_GEOLOGY_PLACEMENT_POLICY.referenceOnlyAssets,
  knownLfsBytes: NATURAL_GEOLOGY_PLACEMENT_POLICY.knownLfsBytes,
  valyriaPolicy: VALYRIA_GEOLOGY_POLICY.id,
  valyriaEcologyPolicy: VALYRIA_BARREN_ECOLOGY_POLICY.id,
  canonicalTerrainIntegration: true,
  naturalVolcanicMorphology: true,
  sharedInstancedHydration: true,
  authoredMaterialsPreserved: true,
  transactionalProxyRetirement: true,
  familyScopedFallback: true,
  hydratedInstanceTint: NATURAL_GEOLOGY_RENDER_POLICY.hydratedInstanceTintStrength,
  disposedGroupHydrationGuard: true,
  pagehideSelfDisposal: true,
}, null, 2));