#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  WORLD_ASSET_TRANSITION_DETAIL_POLICY,
  WORLD_ASSET_TRANSITION_DETAIL_REVISION,
  sampleWorldAssetTransitionDetail,
  sampleTransitionFamilyMaterial,
  transitionDetailBoundaryVariance,
  transitionDetailCompactContract,
  transitionDetailDeterminismProbe,
  transitionDetailMonotoneDistanceResponse,
  transitionDetailSurfaceFingerprint,
  transitionDetailVisualLanguage,
} from '../src/3d/world/worldAssetTransitionDetail.js';

const clamp = (value, min, max) => value >= min && value <= max;
const canonicalSurface = {
  x: 1250,
  z: -920,
  coastDistance: 36,
  riverDistance: 18,
  lakeDistance: 64,
  roadDistance: 8,
  settlementDistance: 42,
  moisture: 0.63,
  shelter: 0.42,
  exposure: 0.58,
  erosion: 0.61,
  deposition: 0.56,
  lithic: 0.49,
  slopeDegrees: 12,
  snow: 0.18,
  biome: 'riverbank meadow',
  seed: 90317,
};

assert.equal(WORLD_ASSET_TRANSITION_DETAIL_REVISION, 'v1-world-space-irregular-boundary-fabric');
assert.equal(WORLD_ASSET_TRANSITION_DETAIL_POLICY.renderOnly, true);
assert.equal(WORLD_ASSET_TRANSITION_DETAIL_POLICY.deterministic, true);
assert.equal(WORLD_ASSET_TRANSITION_DETAIL_POLICY.canonicalDistanceReadOnly, true);
assert.equal(WORLD_ASSET_TRANSITION_DETAIL_POLICY.canonicalHydrologyReadOnly, true);
assert.equal(WORLD_ASSET_TRANSITION_DETAIL_POLICY.canonicalRoadReadOnly, true);
assert.equal(WORLD_ASSET_TRANSITION_DETAIL_POLICY.canonicalSettlementReadOnly, true);
assert.equal(WORLD_ASSET_TRANSITION_DETAIL_POLICY.newGeographyIntroduced, false);
assert(WORLD_ASSET_TRANSITION_DETAIL_POLICY.boundaryWarpMeters.coast > 0);
assert(WORLD_ASSET_TRANSITION_DETAIL_POLICY.boundaryWarpMeters.river > 0);
assert(WORLD_ASSET_TRANSITION_DETAIL_POLICY.boundaryWarpScalesMeters.macro > WORLD_ASSET_TRANSITION_DETAIL_POLICY.boundaryWarpScalesMeters.meso);
assert(WORLD_ASSET_TRANSITION_DETAIL_POLICY.boundaryWarpScalesMeters.meso > WORLD_ASSET_TRANSITION_DETAIL_POLICY.boundaryWarpScalesMeters.fine);

const first = sampleWorldAssetTransitionDetail(canonicalSurface, { seed: 91, family: 'vegetation' });
const second = sampleWorldAssetTransitionDetail(canonicalSurface, { seed: 91, family: 'vegetation' });
assert.deepEqual(first, second, 'same world coordinate and seed must be deterministic');
assert.equal(first.coordinateAware, true);
assert.equal(first.revision, WORLD_ASSET_TRANSITION_DETAIL_REVISION);
assert.equal(first.policyId, WORLD_ASSET_TRANSITION_DETAIL_POLICY.id);
assert.equal(first.x, canonicalSurface.x);
assert.equal(first.z, canonicalSurface.z);

for (const key of ['macro', 'meso', 'patch', 'fine', 'ridge', 'linear', 'cross', 'anisotropic']) {
  assert(clamp(first.carriers[key], 0, 1), `${key} carrier must be bounded`);
}
for (const key of ['coast', 'river', 'lake', 'road', 'settlement']) {
  const band = first.bands[key];
  assert(clamp(band.inner, 0, 1), `${key}.inner must be bounded`);
  assert(clamp(band.middle, 0, 1), `${key}.middle must be bounded`);
  assert(clamp(band.outer, 0, 1), `${key}.outer must be bounded`);
  assert(clamp(band.total, 0, 1), `${key}.total must be bounded`);
}
for (const key of [
  'trampling', 'saltStress', 'freshwaterDamp', 'riparianSediment', 'intertidalDebris',
  'frostStress', 'windShear', 'moss', 'lichen', 'dust', 'weathering', 'sedimentFabric',
  'wetPolish', 'granularRoughness', 'normalEnergy',
]) {
  assert(clamp(first.local[key], 0, 1), `${key} local signal must be bounded`);
}
for (const key of ['colorDrift', 'roughnessDelta', 'normalDelta', 'opacityDelta']) {
  assert(clamp(first.material[key], -1, 1), `${key} material signal must be signed and bounded`);
}

const sameDistanceDifferentCoordinates = [
  { ...canonicalSurface, x: 820, z: -1200 },
  { ...canonicalSurface, x: 1015, z: -1105 },
  { ...canonicalSurface, x: 1430, z: -760 },
  { ...canonicalSurface, x: 1725, z: -1010 },
  { ...canonicalSurface, x: 1510, z: -510 },
].map((surface) => sampleWorldAssetTransitionDetail(surface, { seed: 91, family: 'vegetation' }));
const irregularSignature = sameDistanceDifferentCoordinates
  .map((sample) => [sample.bands.coast.total, sample.bands.river.total, sample.material.colorDrift].map((value) => value.toFixed(6)).join(':'))
  .join('|');
const uniqueSignatures = new Set(irregularSignature.split('|'));
assert(uniqueSignatures.size >= 2, 'identical canonical distances must not collapse to one concentric boundary response');

const families = ['tree', 'vegetation', 'shrub', 'rock', 'snow', 'building', 'settlement', 'waterside'];
for (const family of families) {
  const material = sampleTransitionFamilyMaterial(canonicalSurface, family, { seed: 91 });
  for (const key of ['colorDrift', 'roughnessDelta', 'normalDelta', 'opacityDelta']) {
    assert(clamp(material[key], -1, 1), `${family}.${key} must remain bounded`);
  }
}

const variance = transitionDetailBoundaryVariance(
  sameDistanceDifferentCoordinates.map(({ bands, local }) => ({
    ...canonicalSurface,
    coastDistance: 36,
    riverDistance: 18,
    lakeDistance: 64,
    roadDistance: 8,
    settlementDistance: 42,
    moisture: 0.63,
    shelter: local.windShear < 0.5 ? 0.55 : 0.35,
  })),
  'rock',
  { seed: 91 },
);
assert.equal(variance.family, 'rock');
assert.equal(variance.sampleCount, sameDistanceDifferentCoordinates.length);
assert(Number.isFinite(variance.roughnessVariance));
assert(Number.isFinite(variance.colorVariance));

const probes = transitionDetailDeterminismProbe(
  sameDistanceDifferentCoordinates.map((sample) => ({
    x: sample.x,
    z: sample.z,
    coastDistance: 36,
    riverDistance: 18,
    lakeDistance: 64,
  })),
  { seed: 77, family: 'rock' },
);
assert.equal(probes.deterministic, true);
assert.equal(probes.first.length, probes.second.length);

const monotone = transitionDetailMonotoneDistanceResponse({
  surface: { ...canonicalSurface, x: 1250, z: -920 },
  family: 'vegetation',
  distanceKey: 'riverDistance',
  distances: [0, 4, 8, 12, 18, 26, 40, 64, 90, 120],
  seed: 91,
});
for (let index = 1; index < monotone.length; index += 1) {
  const previous = monotone[index - 1].detail.bands.river.total;
  const current = monotone[index].detail.bands.river.total;
  assert(current <= previous + 1e-8, `river band must remain distance-monotone (${previous} -> ${current})`);
}

const contract = transitionDetailCompactContract(canonicalSurface);
assert.equal(contract.canonicalDistanceReadOnly, true);
assert.equal(contract.canonicalHydrologyReadOnly, true);
assert.equal(contract.canonicalRoadReadOnly, true);
assert.equal(contract.canonicalSettlementReadOnly, true);
assert.equal(contract.newGeographyIntroduced, false);

const fingerprintA = transitionDetailSurfaceFingerprint(canonicalSurface, 91);
const fingerprintB = transitionDetailSurfaceFingerprint(canonicalSurface, 91);
const fingerprintC = transitionDetailSurfaceFingerprint({ ...canonicalSurface, x: canonicalSurface.x + 0.5 }, 91);
assert.equal(fingerprintA, fingerprintB);
assert.notEqual(fingerprintA, fingerprintC, 'world-space fingerprint must change with coordinate');

const language = transitionDetailVisualLanguage(canonicalSurface);
assert(Array.isArray(language));
assert(language.every((entry) => typeof entry === 'string' && entry.length > 0));

const noCoordinates = sampleWorldAssetTransitionDetail({ ...canonicalSurface, x: undefined, z: undefined }, { seed: 91 });
assert.equal(noCoordinates.coordinateAware, false);
assert.equal(noCoordinates.bands.river.total, sampleWorldAssetTransitionDetail({ ...canonicalSurface, x: undefined, z: undefined }, { seed: 91 }).bands.river.total);

console.log('[checkWorldAssetTransitionDetail] PASS: canonical boundary distances remain authoritative while world-space deterministic transition fabric breaks concentric halos and exposes bounded material weathering.');