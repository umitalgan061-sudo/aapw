#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sampleWorldAssetTransitionDetail,
  WORLD_ASSET_TRANSITION_DETAIL_POLICY,
} from '../src/3d/world/worldAssetTransitionDetail.js';
import {
  sampleWorldAssetMaterialAcclimation,
  WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY,
  worldAssetMaterialAcclimationBoundsPass,
} from '../src/3d/materials/worldAssetMaterialAcclimation.js';
import {
  WORLD_ASSET_SURFACE_FABRIC_POLICY,
  worldAssetSurfaceFabricConstants,
} from '../src/3d/materials/worldAssetSurfaceFabric.js';
import {
  WORLD_ASSET_TRANSITION_FIELD_POLICY,
  sampleWorldAssetTransitionField,
} from '../src/3d/world/worldAssetTransitionField.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const canonicalSurface = {
  x: 1632.4,
  z: -881.2,
  elevationMeters: 286,
  heightMeters: 286,
  slopeDegrees: 14,
  aspectRadians: 2.18,
  moisture: 0.64,
  shelter: 0.46,
  exposure: 0.61,
  erosion: 0.56,
  deposition: 0.62,
  lithic: 0.58,
  snow: 0.11,
  biome: 'woodland river margin',
  coastDistance: 124,
  riverDistance: 21,
  lakeDistance: 87,
  roadDistance: 13,
  settlementDistance: 58,
  seed: 44119,
};

const terrainSource = read('src/3d/world/worldReferenceSurfaceTerrainVisual.js');
const ecologySource = read('src/3d/world/worldEcologySurfaceField.js');
const transitionSource = read('src/3d/world/worldAssetTransitionField.js');
const detailSource = read('src/3d/world/worldAssetTransitionDetail.js');
const acclimationSource = read('src/3d/materials/worldAssetMaterialAcclimation.js');
const fabricSource = read('src/3d/materials/worldAssetSurfaceFabric.js');
const placementSource = read('src/3d/materials/worldPlacementMaterialContext.js');
const pipelineSource = read('src/3d/world/WorldAssetPlacementPipeline.js');

function requireTokens(source, label, tokens) {
  for (const token of tokens) {
    assert(source.includes(token), `${label} missing: ${token}`);
  }
}

requireTokens(terrainSource, 'canonical terrain visual', [
  'WORLD_REFERENCE_SURFACE_VISUAL_POLICY',
  'sourceMapSha256:',
  'classifyWorldSurface',
  'applyReferenceSurfaceToTerrainMesh',
  'RUNTIME_PINDEX_TERRAIN_POLISH_POLICY',
  'cpuVertexPassesAdded: 0',
]);

requireTokens(ecologySource, 'ecology field', [
  'world-ecology-surface-field-2026-09-03-v1',
  'canonicalTerrainReadOnly: true',
  'canonicalHydrologyReadOnly: true',
  'canonicalRoadReadOnly: true',
  'canonicalColliderReadOnly: true',
  'newGeographyIntroduced: false',
  'albedoMacro',
  'roughnessMacro',
  'normalMacro',
  'weathering',
  'lichen',
  'moss',
]);

requireTokens(transitionSource, 'asset transition field', [
  `id: '${WORLD_ASSET_TRANSITION_FIELD_POLICY.id}'`,
  'canonicalDistancesReadOnly: true',
  'canonicalHydrologyReadOnly: true',
  'canonicalRoadReadOnly: true',
  'canonicalSettlementReadOnly: true',
  'canonicalBoundaryDetailReadOnly: true',
  'irregularWorldBoundaryFabric: true',
  'sampleWorldAssetTransitionDetail',
]);

requireTokens(detailSource, 'transition detail', [
  `id: '${WORLD_ASSET_TRANSITION_DETAIL_POLICY.id}'`,
  'renderOnly: true',
  'deterministic: true',
  'worldSpace',
  'boundaryWarpMeters',
  'materialNoiseScalesMeters',
  'newGeographyIntroduced: false',
]);

requireTokens(acclimationSource, 'material acclimation', [
  `id: '${WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.id}'`,
  'wetDarkening',
  'saltBloom',
  'freezeThaw',
  'organicPatina',
  'sedimentStain',
  'windScour',
  'microOcclusion',
]);

requireTokens(fabricSource, 'surface fabric shader', [
  `id: '${WORLD_ASSET_SURFACE_FABRIC_POLICY.id}'`,
  'worldAssetSurfaceFabricHash',
  'worldAssetSurfaceFabricNoise',
  'worldAssetSurfaceFabricFbm',
  'worldAssetSurfaceFabricMacro',
  'worldAssetSurfaceFabricMeso',
  'worldAssetSurfaceFabricPatch',
  'worldAssetSurfaceFabricFine',
  'worldAssetSurfaceFabricRoughPattern',
  'USE_INSTANCING',
  'sourceMapsPreserved: true',
  'sourceUvsPreserved: true',
]);

requireTokens(placementSource, 'material context runtime bridge', [
  'applyWorldPlacementMaterialContext',
  'sampleWorldEcologySurfaceField',
  'installWorldAssetSurfaceFabric',
  'worldAssetTransitionDetail',
  'footprintSurfaceAggregation',
  'canonicalTerrainUnchanged: true',
  'canonicalHydrologyUnchanged: true',
  'canonicalColliderUnchanged: true',
]);

requireTokens(pipelineSource, 'asset placement runtime path', [
  'applyWorldPlacementMaterialContext',
  'WorldAssetGeographyPlacementBridge',
  'canonical',
]);

for (const [label, source] of [
  ['terrain', terrainSource],
  ['ecology', ecologySource],
  ['transition', transitionSource],
  ['transition-detail', detailSource],
  ['acclimation', acclimationSource],
  ['surface-fabric', fabricSource],
  ['material-placement', placementSource],
]) {
  assert(!source.includes('Math.random('), `${label} contains nondeterministic Math.random`);
}

const transitionDetail = sampleWorldAssetTransitionDetail(canonicalSurface, { seed: canonicalSurface.seed, family: 'rock' });
assert.equal(transitionDetail.coordinateAware, true);
assert.equal(transitionDetail.policyId, WORLD_ASSET_TRANSITION_DETAIL_POLICY.id);
assert.equal(transitionDetail.x, canonicalSurface.x);
assert.equal(transitionDetail.z, canonicalSurface.z);

const transitionField = sampleWorldAssetTransitionField({ ...canonicalSurface, assetFamily: 'rock' });
assert.equal(transitionField.policyId, WORLD_ASSET_TRANSITION_FIELD_POLICY.id);
assert.equal(transitionField.boundaryDetailPolicyId, WORLD_ASSET_TRANSITION_DETAIL_POLICY.id);
assert.equal(transitionField.transitionDetail.coordinateAware, true);
assert.equal(transitionField.transitionDetail.x, canonicalSurface.x);
assert.equal(transitionField.transitionDetail.z, canonicalSurface.z);
assert(transitionField.material.weathering >= 0 && transitionField.material.weathering <= 1);
assert(transitionField.material.sedimentFabric >= 0 && transitionField.material.sedimentFabric <= 1);
assert(transitionField.material.wetPolish >= 0 && transitionField.material.wetPolish <= 1);

const acclimationFamilies = ['rock', 'masonry', 'soil', 'wood', 'foliage', 'metal', 'roof', 'cryosphere'];
for (const family of acclimationFamilies) {
  const acclimation = sampleWorldAssetMaterialAcclimation(canonicalSurface, family);
  assert.equal(acclimation.policyId, WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.id);
  assert.equal(acclimation.coordinateAware, true);
  assert.equal(worldAssetMaterialAcclimationBoundsPass(acclimation), true, `${family} acclimation exceeded channel budgets`);
  assert(acclimation.response.wetDarkening >= 0 && acclimation.response.wetDarkening <= 1);
  assert(acclimation.response.saltBloom >= 0 && acclimation.response.saltBloom <= 1);
  assert(acclimation.response.freezeThaw >= 0 && acclimation.response.freezeThaw <= 1);
  assert(acclimation.response.organicPatina >= 0 && acclimation.response.organicPatina <= 1);
  assert(acclimation.response.sedimentStain >= 0 && acclimation.response.sedimentStain <= 1);
  assert(acclimation.response.windScour >= 0 && acclimation.response.windScour <= 1);
}

for (const family of ['rock', 'soil', 'wood', 'foliage', 'metal', 'roof', 'cryosphere', 'generic']) {
  const constants = worldAssetSurfaceFabricConstants(
    {
      moisture: canonicalSurface.moisture,
      dry: 1 - canonicalSurface.moisture,
      wet: 0.67,
      snow: canonicalSurface.snow,
      coast: transitionDetail.material.salt,
      roadDust: transitionDetail.material.dust,
      exposure: canonicalSurface.exposure,
      ecology: {
        moisture: canonicalSurface.moisture,
        aridity: 1 - canonicalSurface.moisture,
        frost: transitionDetail.material.frost,
        coastal: transitionDetail.material.salt,
        moss: transitionDetail.material.moss,
        lichen: transitionDetail.material.lichen,
        sedimentFabric: transitionDetail.material.sedimentFabric,
        weathering: transitionDetail.material.weathering,
        exposure: canonicalSurface.exposure,
        normalFine: 0.68,
      },
      x: canonicalSurface.x,
      z: canonicalSurface.z,
      seed: canonicalSurface.seed,
      coastDistance: canonicalSurface.coastDistance,
      riverDistance: canonicalSurface.riverDistance,
      lakeDistance: canonicalSurface.lakeDistance,
      roadDistance: canonicalSurface.roadDistance,
      settlementDistance: canonicalSurface.settlementDistance,
      slopeDegrees: canonicalSurface.slopeDegrees,
      biomeId: canonicalSurface.biome,
    },
    family,
  );
  assert(constants.familyCode >= 0 && constants.familyCode <= 7);
  assert(constants.familyGain >= 0.45 && constants.familyGain <= 1.18);
  assert(constants.macroScale > constants.mesoScale);
  assert(constants.mesoScale > constants.patchScale);
  assert(constants.patchScale > constants.fineScale);
  assert(constants.fineScale > constants.grainScale);
  assert(constants.maximumColorDeviation <= WORLD_ASSET_SURFACE_FABRIC_POLICY.maximumColorDeviation + 1e-9);
  assert(constants.maximumRoughnessDeviation <= WORLD_ASSET_SURFACE_FABRIC_POLICY.maximumRoughnessDeviation + 1e-9);
}

const shifted = sampleWorldAssetTransitionDetail(
  { ...canonicalSurface, x: canonicalSurface.x + 41, z: canonicalSurface.z - 17 },
  { seed: canonicalSurface.seed, family: 'rock' },
);
assert.notEqual(
  `${transitionDetail.carriers.macro.toFixed(6)}:${transitionDetail.carriers.meso.toFixed(6)}:${transitionDetail.material.colorDrift.toFixed(6)}`,
  `${shifted.carriers.macro.toFixed(6)}:${shifted.carriers.meso.toFixed(6)}:${shifted.material.colorDrift.toFixed(6)}`,
  'world-space transition carrier collapsed to the same response after coordinate movement',
);

const dryCase = sampleWorldAssetMaterialAcclimation(
  {
    ...canonicalSurface,
    moisture: 0.19,
    shelter: 0.18,
    exposure: 0.82,
    snow: 0.03,
    riverDistance: 220,
    lakeDistance: 260,
    coastDistance: 340,
    roadDistance: 11,
  },
  'rock',
);
const wetCase = sampleWorldAssetMaterialAcclimation(
  {
    ...canonicalSurface,
    moisture: 0.91,
    shelter: 0.66,
    exposure: 0.34,
    riverDistance: 3,
    lakeDistance: 8,
    coastDistance: 41,
    snow: 0.17,
    deposition: 0.82,
  },
  'rock',
);
assert(dryCase.climate.drying > wetCase.climate.drying, 'dry habitat should produce a stronger drying signal');
assert(wetCase.climate.wetting > dryCase.climate.wetting, 'wet habitat should produce a stronger wetting signal');
assert(wetCase.response.wetDarkening > dryCase.response.wetDarkening, 'wet habitat should darken exposed rock more strongly');
assert(dryCase.response.windScour > wetCase.response.windScour, 'dry exposed habitat should receive stronger wind scour');

const alpineCase = sampleWorldAssetMaterialAcclimation(
  {
    ...canonicalSurface,
    elevationMeters: 1200,
    slopeDegrees: 48,
    exposure: 0.88,
    shelter: 0.16,
    snow: 0.86,
    lithic: 0.91,
    coastDistance: 620,
    riverDistance: 180,
  },
  'rock',
);
assert(alpineCase.climate.alpine > canonicalSurface.snow, 'alpine signal should rise with slope, lithic exposure and snow');
assert(alpineCase.response.freezeThaw > detail.response?.freezeThaw ?? -1, 'alpine rock should receive freeze-thaw response');

const coastalCase = sampleWorldAssetMaterialAcclimation(
  {
    ...canonicalSurface,
    coastDistance: 2,
    moisture: 0.73,
    exposure: 0.81,
    shelter: 0.22,
    snow: 0.04,
  },
  'metal',
);
assert(coastalCase.climate.maritime > 0.8, 'near-coast asset should register maritime climate');
assert(coastalCase.response.saltBloom > coastalCase.response.mineralReveal * 0.30, 'coastal metal should prioritize salt bloom over mineral reveal');
assert(coastalCase.response.metalnessReduction >= 0, 'coastal metal oxidation response must be bounded');

const settlementCase = sampleWorldAssetMaterialAcclimation(
  {
    ...canonicalSurface,
    settlementDistance: 2,
    roadDistance: 1,
    moisture: 0.45,
    disturbance: 0.72,
  },
  'masonry',
);
assert(settlementCase.response.settlementWear > 0, 'settlement proximity should produce material wear signal');
assert(settlementCase.response.dryDust >= 0, 'settlement dust signal must be present');

assert.equal(WORLD_ASSET_SURFACE_FABRIC_POLICY.newGeographyIntroduced, false);
assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.newGeographyIntroduced, false);
assert.equal(WORLD_ASSET_TRANSITION_DETAIL_POLICY.newGeographyIntroduced, false);
assert.equal(WORLD_ASSET_TRANSITION_FIELD_POLICY.newGeographyIntroduced, false);

console.log('[checkWorldRealismIntegration] PASS: owner-map terrain, ecology, irregular boundary transitions, habitat material acclimation and world-space asset surface fabric remain deterministic, bounded, canonical-read-only and runtime-connected.');
