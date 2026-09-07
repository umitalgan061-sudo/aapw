#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY,
  WORLD_ASSET_MATERIAL_ACCLIMATION_REVISION,
  sampleWorldAssetMaterialAcclimation,
  worldAssetMaterialAcclimationBoundsPass,
  worldAssetMaterialAcclimationContract,
  worldAssetMaterialAcclimationDeterminismProbe,
  worldAssetMaterialAcclimationDistanceSweep,
  worldAssetMaterialAcclimationEdgeProfile,
  worldAssetMaterialAcclimationEnvironmentalSignature,
  worldAssetMaterialAcclimationFamilyGain,
  worldAssetMaterialAcclimationFamilyMatrix,
  worldAssetMaterialAcclimationFamilyBias,
  worldAssetMaterialAcclimationInteraction,
  worldAssetMaterialAcclimationPhysicalStory,
  worldAssetMaterialAcclimationResponse,
  worldAssetMaterialAcclimationSummarize,
  worldAssetMaterialAcclimationVariance,
} from '../src/3d/materials/worldAssetMaterialAcclimation.js';

const surface = {
  x: 1180.5,
  z: -740.25,
  elevationMeters: 412,
  slopeDegrees: 19,
  aspectRadians: 1.34,
  moisture: 0.72,
  shelter: 0.39,
  exposure: 0.67,
  erosion: 0.63,
  deposition: 0.57,
  lithic: 0.74,
  snow: 0.28,
  woodland: 0.21,
  disturbance: 0.08,
  saltStress: 0.0,
  roadBearingRadians: 0.88,
  sedimentAngle: 1.20,
  coastDistance: 41,
  riverDistance: 16,
  lakeDistance: 92,
  roadDistance: 19,
  settlementDistance: 74,
};

assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_REVISION, 'v1-deterministic-habitat-material-acclimation');
assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.renderOnly, true);
assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.deterministic, true);
assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.worldSpace, true);
assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.geometryUnchanged, true);
assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.placementUnchanged, true);
assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.sourceMapsPreserved, true);
assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.sourceUvsPreserved, true);
assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.canonicalTerrainReadOnly, true);
assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.canonicalHydrologyReadOnly, true);
assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.canonicalRoadReadOnly, true);
assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.canonicalSettlementReadOnly, true);
assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.canonicalColliderReadOnly, true);
assert.equal(WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.newGeographyIntroduced, false);

const families = ['rock', 'masonry', 'soil', 'wood', 'foliage', 'metal', 'roof', 'cryosphere', 'generic'];
for (const family of families) {
  const detailA = sampleWorldAssetMaterialAcclimation(surface, family);
  const detailB = sampleWorldAssetMaterialAcclimation(surface, family);
  assert.deepEqual(detailA, detailB, `${family} must be deterministic`);
  assert.equal(detailA.policyId, WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.id);
  assert.equal(detailA.revision, WORLD_ASSET_MATERIAL_ACCLIMATION_REVISION);
  assert.equal(worldAssetMaterialAcclimationBoundsPass(detailA), true, `${family} response must stay in channel budgets`);
  assert(detailA.response.saltBloom >= 0 && detailA.response.saltBloom <= WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.channelBudgets.albedo + 1e-6);
  assert(detailA.response.wetDarkening >= 0 && detailA.response.wetDarkening <= 1);
  assert(detailA.response.freezeThaw >= 0 && detailA.response.freezeThaw <= 1);
  assert(detailA.response.organicPatina >= 0 && detailA.response.organicPatina <= 1);
  assert(detailA.response.sedimentStain >= 0 && detailA.response.sedimentStain <= 1);
  assert(detailA.response.windScour >= 0 && detailA.response.windScour <= 1);
  assert(detailA.response.metalnessReduction >= 0);
  assert(detailA.response.microOcclusion >= 0);
  assert(detailA.response.microOcclusion <= WORLD_ASSET_MATERIAL_ACCLIMATION_POLICY.channelBudgets.microOcclusion + 1e-6);
}

const detail = sampleWorldAssetMaterialAcclimation(surface, 'rock');
for (const bandName of ['coast', 'river', 'lake', 'road', 'settlement']) {
  const band = detail.bands[bandName];
  for (const key of ['core', 'transition', 'fringe', 'total']) {
    assert(band[key] >= 0 && band[key] <= 1, `${bandName}.${key} must be bounded`);
  }
}

for (const key of [
  'moisture', 'shelter', 'exposure', 'slope', 'cold', 'maritime', 'riparian', 'dryland',
  'alpine', 'woodland', 'settlement', 'windScour', 'freezeThaw', 'wetting', 'drying',
  'saltStress', 'abrasion', 'sedimentFilm', 'organicFilm', 'dust', 'biofilm', 'mineralExposure',
]) {
  assert(detail.climate[key] >= 0 && detail.climate[key] <= 1, `${key} climate signal must be bounded`);
}

for (const key of [
  'flowAlignment', 'roadAlignment', 'marineFacing', 'windFacing', 'downslope',
  'drainageStreak', 'roadWearDirection', 'saltFacing', 'frostFace', 'rainShadow',
]) {
  assert(detail.directional[key] >= 0 && detail.directional[key] <= 1, `${key} directional signal must be bounded`);
}

for (const key of [
  'wetSaltCycle', 'dryAbrasionCycle', 'weatheringAxis', 'edgeComplexity',
  'patinaPotential', 'crustPotential', 'scourPotential', 'stainingPotential',
]) {
  assert(detail.interaction[key] >= 0 && detail.interaction[key] <= 1, `${key} interaction signal must be bounded`);
}

const contract = worldAssetMaterialAcclimationContract(surface);
assert.equal(contract.renderOnly, true);
assert.equal(contract.deterministic, true);
assert.equal(contract.worldSpace, true);
assert.equal(contract.canonicalTerrainReadOnly, true);
assert.equal(contract.canonicalHydrologyReadOnly, true);
assert.equal(contract.canonicalRoadReadOnly, true);
assert.equal(contract.canonicalSettlementReadOnly, true);
assert.equal(contract.canonicalColliderReadOnly, true);
assert.equal(contract.newGeographyIntroduced, false);
assert.equal(contract.coordinateAware, true);

const probe = worldAssetMaterialAcclimationDeterminismProbe(
  [
    surface,
    { ...surface, x: surface.x + 73, z: surface.z + 41 },
    { ...surface, x: surface.x - 138, z: surface.z + 92, moisture: 0.34, exposure: 0.88 },
    { ...surface, x: -415, z: 930, coastDistance: 5, riverDistance: 120, snow: 0.81 },
  ],
  'rock',
);
assert.equal(probe.deterministic, true);
assert.equal(probe.sampleCount, 4);

const edgeProfile = worldAssetMaterialAcclimationEdgeProfile(surface);
assert(edgeProfile.edgeComplexity >= 0 && edgeProfile.edgeComplexity <= 1);
assert(edgeProfile.stainingPotential >= 0 && edgeProfile.stainingPotential <= 1);
assert(edgeProfile.patinaPotential >= 0 && edgeProfile.patinaPotential <= 1);
assert(edgeProfile.crustPotential >= 0 && edgeProfile.crustPotential <= 1);
assert(edgeProfile.scourPotential >= 0 && edgeProfile.scourPotential <= 1);

const signatureA = worldAssetMaterialAcclimationEnvironmentalSignature(surface);
const signatureB = worldAssetMaterialAcclimationEnvironmentalSignature(surface);
assert.equal(signatureA, signatureB);
assert.notEqual(signatureA, worldAssetMaterialAcclimationEnvironmentalSignature({ ...surface, x: surface.x + 0.01, z: surface.z + 0.01 }), 'world-space context should produce distinct environmental fingerprints when coordinates change');

for (const family of families) {
  const gain = worldAssetMaterialAcclimationFamilyGain(family);
  assert(gain >= 0.70 && gain <= 1.10, `${family} gain should remain restrained`);
  const bias = worldAssetMaterialAcclimationFamilyBias(family);
  for (const value of Object.values(bias)) assert(value > 0 && value <= 1.25, `${family} material bias must remain bounded`);
}

const matrix = worldAssetMaterialAcclimationFamilyMatrix(surface);
assert.deepEqual(Object.keys(matrix), families);
for (const family of families) {
  assert.equal(matrix[family].family, family === 'generic' ? 'generic' : family === 'masonry' ? 'masonry' : family);
  assert(worldAssetMaterialAcclimationBoundsPass({ response: matrix[family] }), `${family} matrix entry must respect channel bounds`);
}

const variance = worldAssetMaterialAcclimationVariance(
  [
    surface,
    { ...surface, moisture: 0.46, exposure: 0.31, erosion: 0.42 },
    { ...surface, moisture: 0.82, exposure: 0.76, erosion: 0.77 },
    { ...surface, snow: 0.90, coastDistance: 260, riverDistance: 150 },
    { ...surface, snow: 0.03, coastDistance: 8, riverDistance: 5 },
  ],
  'wood',
);
assert.equal(variance.family, 'wood');
assert.equal(variance.sampleCount, 5);
for (const value of Object.values(variance.variance)) assert(Number.isFinite(value) && value >= 0);

const sweep = worldAssetMaterialAcclimationDistanceSweep({
  surface,
  family: 'rock',
  distanceKey: 'riverDistance',
  distances: [0, 4, 8, 12, 18, 26, 40, 64, 90, 120],
});
assert.equal(sweep.length, 10);
for (let index = 1; index < sweep.length; index += 1) {
  assert.equal(sweep[index].distance > sweep[index - 1].distance, true);
  assert(sweep[index].bands.river.total <= sweep[index - 1].bands.river.total + 1e-8, 'river proximity must remain distance-monotone');
}

const story = worldAssetMaterialAcclimationPhysicalStory(surface, 'rock');
assert(Array.isArray(story));
assert(story.every((entry) => typeof entry === 'string' && entry.length > 0));

const interaction = worldAssetMaterialAcclimationInteraction(surface);
assert.equal(interaction.edgeComplexity, detail.interaction.edgeComplexity);
assert.equal(interaction.stainingPotential, detail.interaction.stainingPotential);

const summary = worldAssetMaterialAcclimationSummarize(detail);
assert.equal(summary.available, true);
assert.equal(summary.policyId, detail.policyId);
assert.equal(summary.revision, detail.revision);
assert.equal(summary.coordinateAware, true);
assert(Number.isFinite(summary.saltStress));
assert(Number.isFinite(summary.freezeThaw));
assert(Number.isFinite(summary.roughnessShift) || summary.roughnessShift === undefined);

const noCoordinates = sampleWorldAssetMaterialAcclimation({
  ...surface,
  x: undefined,
  z: undefined,
}, 'rock');
assert.equal(noCoordinates.coordinateAware, false);
assert.equal(worldAssetMaterialAcclimationContract({ ...surface, x: undefined, z: undefined }).coordinateAware, false);

const climates = [
  { name: 'maritime', patch: { coastDistance: 8, moisture: 0.73, exposure: 0.79, snow: 0.12 } },
  { name: 'riparian', patch: { riverDistance: 4, lakeDistance: 14, moisture: 0.86, deposition: 0.79 } },
  { name: 'alpine', patch: { elevationMeters: 920, slopeDegrees: 42, snow: 0.84, lithic: 0.88 } },
  { name: 'dryland', patch: { moisture: 0.18, exposure: 0.73, shelter: 0.18, coastDistance: 350 } },
  { name: 'settlement', patch: { settlementDistance: 3, roadDistance: 2, disturbance: 0.68, moisture: 0.44 } },
];
for (const climateCase of climates) {
  const caseDetail = sampleWorldAssetMaterialAcclimation({ ...surface, ...climateCase.patch }, 'rock');
  assert.equal(worldAssetMaterialAcclimationBoundsPass(caseDetail), true, `${climateCase.name} must remain bounded`);
  assert(caseDetail.response.saltBloom >= 0);
  assert(caseDetail.response.abrasion >= 0);
  assert(caseDetail.response.freezeThaw >= 0);
  assert(caseDetail.response.settlementWear >= 0);
}

console.log('[checkWorldAssetMaterialAcclimation] PASS: habitat-aware asset aging remains deterministic, bounded, world-space, canonical-read-only and family-specific.');
