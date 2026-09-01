#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NATURAL_GEOLOGY_PLACEMENT_POLICY } from '../src/3d/world/naturalGeologyPlacement.js';
import { NATURAL_GEOLOGY_RENDER_POLICY } from '../src/3d/world/naturalGeology.js';
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
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.id.includes('v3-r2-morphology-blue-noise'));
assert.equal(NATURAL_GEOLOGY_PLACEMENT_POLICY.candidateDistribution, 'r2-low-discrepancy-cranley-patterson');
assert.equal(NATURAL_GEOLOGY_PLACEMENT_POLICY.candidateGridOwnsCoordinates, false);
assert.equal(NATURAL_GEOLOGY_PLACEMENT_POLICY.lowDiscrepancySequence, true);
assert.equal(NATURAL_GEOLOGY_PLACEMENT_POLICY.cranleyPattersonScramble, true);
assert.equal(NATURAL_GEOLOGY_PLACEMENT_POLICY.valyriaMorphologyAligned, true);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.valyriaClusterCandidateTrials >= 4);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.valyriaMorphologyScoreBoost > 0);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.minimumNearestNeighborMeters >= 20);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.settlementReserveMeters >= 120);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.roadReserveMeters >= 18);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.shorelineReserveMeters >= 8);

assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.renderOnly, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.geographyAuthorityUnchanged, true);
assert(NATURAL_GEOLOGY_RENDER_POLICY.id.includes('v8-hydrated-texture-fidelity'));
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.multiMaterialHydrationSupported, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.hydratedTextureColorSpaceContract, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.sourceUvAndTextureTransformPreserved, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.referenceLandscapeRuntimeLoad, false);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.instanceScaleCompensatedWorldNormal, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.cameraStableRockWeathering, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.hydratedRegionalTint, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.canonicalTerrainOwnsValyriaSurface, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.legacyValyriaSurfaceOverlayEnabled, false);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.geographicAssetRouting, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.fbxHydrationSupported, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.snowAssetRestrictedToColdHighland, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.valyriaNeverUsesSnowAsset, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.platonicFallbackGeometry, false);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.fallbackGeometryFamily, 'stratified-faceted-geologic-ledges');
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.directAssetUrls.length, 4);
assert(NATURAL_GEOLOGY_RENDER_POLICY.hydratedRegionalTintStrength > 0.20);
assert(NATURAL_GEOLOGY_RENDER_POLICY.hydratedRegionalTintStrength < 0.50);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.knownDirectAssetBytes[NATURAL_GEOLOGY_RENDER_POLICY.smallRockAsset], 74044);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.knownDirectAssetBytes[NATURAL_GEOLOGY_RENDER_POLICY.snowRockAsset], 5180716);

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
  'normalizedOwnerMapAtWorldXZ',
  'valyriaInfluenceAtWorldXZ',
  'valyriaMorphologySignals',
  'valyriaClusterMode',
  'valyriaMorphologyAligned: true',
  'valyriaMorphologyDominant',
  'faultDominates',
  'morphologyDrainage * 0.10',
  'naturalGeologyCandidateUv',
  'naturalGeologyCandidateWorld',
  "candidateDistribution: 'r2-low-discrepancy-cranley-patterson'",
  'candidateGridOwnsCoordinates: false',
  'PLASTIC_CONSTANT',
  'R2_ALPHA_X',
  'R2_ALPHA_Z',
]) {
  assert(placementSource.includes(snippet), `placement contract lost: ${snippet}`);
}
assert(!placementSource.includes('const radial = Math.sqrt(geologyHash01(seed, index, 202, 0))'),
  'Valyria cluster centers regressed to the legacy radial-only distribution');
assert(!placementSource.includes('+ (column + 0.12 + geologyHash01'),
  'generic geology candidate coordinates regressed to one-jittered-point-per-cell placement');
assert(!placementSource.includes('+ (row + 0.12 + geologyHash01'),
  'generic geology candidate Z coordinates regressed to one-jittered-point-per-cell placement');

for (const snippet of [
  "from '../assetLoader.js'",
  'createNaturalGeology',
  'createValyriaVolcanicSurface',
  'upgradeNaturalGeologyAssets',
  'createNaturalRockPrototypeGeometry',
  'createStratifiedRockGeometry',
  'resolveNaturalGeologyAssetFamily',
  'validateNaturalGeologyAsset',
  'loadNaturalGeologySource',
  'loadFBXModel',
  'hostedPreflightMinBytes',
  'maximumHydratedSourceBytes',
  'referenceLandscapeRuntimeLoad: false',
  'canonicalTerrainOwnsValyriaSurface: true',
  'legacyValyriaSurfaceOverlayEnabled: false',
  'instanceScaleCompensatedWorldNormal: true',
  'cameraStableRockWeathering: true',
  'hydratedRegionalTintStrength',
  'hydratedTintForPlacement',
  'instances.setColorAt(index, hydratedTintForPlacement(placements[index]))',
  'sourceMaterialPreserved: true',
  "if (placement.volcanic) return 'rocky-terrain'",
  "return 'snow-terrain'",
  "return 'free-rock'",
  'assets/models/fbx/rocky_terrain_low_poly.glb',
  'assets/models/fbx/desert_rocks.glb',
  'assets/models/fbx/Free_rock_Rock_1.fbx',
  'assets/models/fbx/snow_terrain_low_poly.glb',
  'assets/models/fbx/rugged_mountain_landscape.glb',
]) {
  assert(renderSource.includes(snippet), `renderer contract lost: ${snippet}`);
}
for (const forbidden of [
  'new THREE.IcosahedronGeometry',
  'new THREE.DodecahedronGeometry',
  'new THREE.TetrahedronGeometry',
]) {
  assert(!renderSource.includes(forbidden), `Platonic geology fallback returned: ${forbidden}`);
}
assert(!renderSource.includes('group.add(valyriaSurface)'),
  'production natural geology reintroduced a second opaque Valyria terrain surface');
assert(renderSource.includes("valyriaSurfaceAuthority: 'canonical-terrain'"),
  'natural geology metadata lost canonical Valyria surface authority');
assert(!renderSource.includes('vNaturalRockWorldNormal = normalize(mat3(modelMatrix) * transformedNormal)'),
  'rock shader regressed to treating Three view/instance transformedNormal as a world normal');
assert(renderSource.indexOf("if (placement.volcanic) return 'rocky-terrain'")
  < renderSource.indexOf("return 'snow-terrain'"), 'Valyria routing must win before snow/highland routing');

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
assert(
  sceneSource.indexOf('const naturalGeologyResult = createNaturalGeology')
    < sceneSource.indexOf('const vegetationResult = createVegetation'),
  'geology must remain visually primary before vegetation',
);
assert(
  sceneSource.indexOf('const roadsResult = buildRoadNetwork')
    < sceneSource.indexOf('const naturalGeologyResult = createNaturalGeology'),
  'geology placement must know road corridors',
);

assert(!valyriaSource.includes("from 'three'"), 'Valyria authority must remain renderer-independent');
assert(!valyriaSource.includes('Math.random()'), 'Valyria geology must remain deterministic');
assert(!ecologySource.includes("from 'three'"), 'Valyria ecology adapter must remain renderer-independent');
assert(!ecologySource.includes('Math.random()'), 'Valyria ecology adapter must remain deterministic');
for (const forbidden of [
  'Math.random()',
  'setTerrainHeight',
  'writeHeight',
  'flattenPads.push',
  'WORLD_REFERENCE_BASE_SURFACE_MASK =',
  'createHeightSampler(',
]) {
  assert(!placementSource.includes(forbidden), `placement became geography authority: ${forbidden}`);
  assert(!renderSource.includes(forbidden), `render layer became geography authority: ${forbidden}`);
}

const manifestFiles = new Set(manifest.assets.map((entry) => entry.file));
for (const file of [
  ...NATURAL_GEOLOGY_RENDER_POLICY.directAssetUrls,
  ...NATURAL_GEOLOGY_PLACEMENT_POLICY.referenceOnlyAssets,
]) {
  assert(manifestFiles.has(file), `unregistered geology model: ${file}`);
}
for (const [file, bytes] of Object.entries(NATURAL_GEOLOGY_RENDER_POLICY.knownDirectAssetBytes)) {
  assert(manifestFiles.has(file), `direct geology asset missing from manifest: ${file}`);
  assert(bytes >= NATURAL_GEOLOGY_RENDER_POLICY.hostedPreflightMinBytes, `invalid direct asset byte budget: ${file}`);
  assert(bytes <= NATURAL_GEOLOGY_RENDER_POLICY.maximumHydratedSourceBytes, `direct asset exceeds hydration cap: ${file}`);
}
assert(
  NATURAL_GEOLOGY_PLACEMENT_POLICY.knownLfsBytes['assets/models/fbx/rugged_mountain_landscape.glb'] > 40_000_000,
);
assert(!renderSource.includes('loadModel(NATURAL_GEOLOGY_RENDER_POLICY.referenceLandscapeAsset'),
  '50MB landscape must remain reference-only');

console.log('[checkNaturalGeologySourceContract] PASS');
console.log(JSON.stringify({
  placementPolicyId: NATURAL_GEOLOGY_PLACEMENT_POLICY.id,
  renderPolicyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
  candidateDistribution: NATURAL_GEOLOGY_PLACEMENT_POLICY.candidateDistribution,
  directAssets: NATURAL_GEOLOGY_RENDER_POLICY.directAssetUrls,
  directAssetBytes: NATURAL_GEOLOGY_RENDER_POLICY.knownDirectAssetBytes,
  referenceOnlyAssets: NATURAL_GEOLOGY_PLACEMENT_POLICY.referenceOnlyAssets,
  hydratedRegionalTintStrength: NATURAL_GEOLOGY_RENDER_POLICY.hydratedRegionalTintStrength,
  fallbackGeometryFamily: NATURAL_GEOLOGY_RENDER_POLICY.fallbackGeometryFamily,
  valyriaPolicy: VALYRIA_GEOLOGY_POLICY.id,
  valyriaEcologyPolicy: VALYRIA_BARREN_ECOLOGY_POLICY.id,
  canonicalTerrainIntegration: true,
  naturalVolcanicMorphology: true,
  morphologyAlignedOutcropPlacement: true,
  lowDiscrepancyGeologyCandidates: true,
  geographicAssetRouting: true,
  fbxHydration: true,
  facetedNonPlatonicFallback: true,
  canonicalValyriaSurfaceOnly: true,
  instanceCorrectWorldNormals: true,
}, null, 2));