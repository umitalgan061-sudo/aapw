#!/usr/bin/env node

/**
 * Deterministic stress sweep for the asset geography layer.
 *
 * The sweep deliberately walks a synthetic world-space raster instead of testing only hand-picked
 * anchors. This catches discontinuities in domain scoring, unstable cohort ranking, impossible
 * material contexts and accidental edge effects around coast/water/climate transitions.
 */

import assert from 'node:assert/strict';
import {
  WORLD_ASSET_GEOGRAPHY_FAMILIES,
  assetGeographyPlacementDecision,
  deterministicAssetCohortOffset,
  deterministicAssetScale,
  deterministicAssetYaw,
  sampleWorldAssetGeographyProfile,
} from '../src/3d/world/worldAssetGeographyProfile.js';
import {
  WORLD_ASSET_REGIONAL_ANCHORS,
  regionalAnchorDiagnostics,
  regionalAnchorInfluences,
  regionalAssetMaterialBias,
  sampleRegionalAssetAnchor,
} from '../src/3d/world/worldAssetRegionalAnchors.js';

const FAMILY_NAMES = Object.keys(WORLD_ASSET_GEOGRAPHY_FAMILIES);
const DOMAIN_NAMES = ['woodland', 'meadow', 'heath', 'wetland', 'riparian', 'coast', 'alpine', 'scree', 'snowfield', 'volcanic'];
const REGION_NAMES = Object.keys(WORLD_ASSET_REGIONAL_ANCHORS);

function clamp01(n) {
  return Math.max(0, Math.min(1, Number.isFinite(Number(n)) ? Number(n) : 0));
}

function fixture(x, z, index) {
  const northSouth = (Math.sin(z / 1830) + 1) * 0.5;
  const eastWest = (Math.cos(x / 2110) + 1) * 0.5;
  const ridge = (Math.sin((x + z) / 470) + 1) * 0.5;
  const wet = clamp01(0.28 + northSouth * 0.30 + ridge * 0.28 + eastWest * 0.08);
  const height = Math.max(0, 15 + northSouth * 280 + ridge * 180 + Math.sin(index * 0.77) * 12);
  const slope = clamp01(0.04 + ridge * 0.76) * 58;
  const snow = clamp01((northSouth - 0.70) * 2.4 + (height - 250) / 450);
  const biome = snow > 0.62
    ? 'snowfield'
    : ridge > 0.80 && height > 250
      ? 'scree mountain'
      : wet > 0.76
        ? 'wetland meadow'
        : wet < 0.34
          ? 'heath upland'
          : index % 5 === 0
            ? 'forest'
            : 'meadow';
  return {
    x,
    z,
    height,
    slopeDegrees: slope,
    aspectRadians: (Math.sin(x / 720) + Math.cos(z / 910)) * Math.PI,
    moisture: wet,
    snow,
    waterDepth: biome.includes('wetland') ? 0 : 0,
    riverDistance: 14 + Math.abs(Math.sin(x / 240)) * 160,
    lakeDistance: 20 + Math.abs(Math.cos(z / 310)) * 180,
    coastDistance: 35 + Math.abs(Math.sin((x + z) / 660)) * 280,
    roadDistance: 8 + Math.abs(Math.cos(x / 420)) * 120,
    settlementDistance: 22 + Math.abs(Math.sin(z / 530)) * 220,
    biome,
    concavity: Math.sin((x - z) / 380) * 0.72,
    erosion: clamp01(0.16 + ridge * 0.74),
    deposition: clamp01(0.68 - ridge * 0.42),
    shelter: clamp01(0.20 + (1 - ridge) * 0.68),
    lithic: clamp01(0.22 + ridge * 0.68),
  };
}

function keyFor(x, z) {
  return `${Number(x).toFixed(3)}:${Number(z).toFixed(3)}`;
}

const samples = [];
for (let row = 0; row < 28; row += 1) {
  for (let column = 0; column < 28; column += 1) {
    const x = -5400 + column * 395.5 + Math.sin(row * 0.71) * 41;
    const z = -4200 + row * 305.25 + Math.cos(column * 0.49) * 33;
    samples.push(fixture(x, z, row * 28 + column));
  }
}

assert.equal(samples.length, 784, 'stress raster cardinality must be stable');

const allProfiles = new Map();
for (const family of FAMILY_NAMES) {
  const familyProfiles = [];
  for (const sample of samples) {
    const p = sampleWorldAssetGeographyProfile(sample, { family });
    familyProfiles.push(p);
    assert(p.placementScore >= 0 && p.placementScore <= 1, `${family} score must remain bounded`);
    assert.equal(p.family, family);
    for (const domain of DOMAIN_NAMES) {
      assert(p.domains[domain] >= 0 && p.domains[domain] <= 1, `${family}/${domain} domain score must be bounded`);
    }
    assert(Number.isFinite(p.preferredRotationRadians), `${family} rotation must remain finite`);
    assert(p.material.dampness >= 0 && p.material.dampness <= 1, `${family} dampness must be bounded`);
    assert(p.material.dryness >= 0 && p.material.dryness <= 1, `${family} dryness must be bounded`);
    assert(p.material.mineral >= 0 && p.material.mineral <= 1, `${family} mineral must be bounded`);
    assert(p.material.weathering >= 0 && p.material.weathering <= 1, `${family} weathering must be bounded`);
    const decision = assetGeographyPlacementDecision(p, { rejectPoor: false });
    assert.equal(decision.accept, true, 'relaxed geographic decision must be structurally safe');
  }
  allProfiles.set(family, familyProfiles);
}

let deterministicChecks = 0;
for (const sample of samples.slice(0, 120)) {
  for (const family of FAMILY_NAMES.slice(0, 6)) {
    const a = sampleWorldAssetGeographyProfile(sample, { family });
    const b = sampleWorldAssetGeographyProfile(sample, { family });
    assert.deepEqual(a, b, `profile determinism failed for ${family}/${keyFor(sample.x, sample.z)}`);
    assert.equal(deterministicAssetCohortOffset(sample.x, sample.z, family), deterministicAssetCohortOffset(sample.x, sample.z, family));
    assert.equal(deterministicAssetScale(a, sample.x, sample.z), deterministicAssetScale(b, sample.x, sample.z));
    assert.equal(deterministicAssetYaw(a, sample.x, sample.z), deterministicAssetYaw(b, sample.x, sample.z));
    deterministicChecks += 1;
  }
}

let continuityChecks = 0;
for (let row = 0; row < 27; row += 1) {
  for (let column = 0; column < 27; column += 1) {
    const a = samples[row * 28 + column];
    const b = samples[row * 28 + column + 1];
    for (const family of FAMILY_NAMES) {
      const pa = sampleWorldAssetGeographyProfile(a, { family });
      const pb = sampleWorldAssetGeographyProfile(b, { family });
      assert(Math.abs(pa.placementScore - pb.placementScore) < 0.90, `large score discontinuity ${family}/${row}/${column}`);
      continuityChecks += 1;
    }
  }
}

let regionalChecks = 0;
for (let yi = 0; yi <= 20; yi += 1) {
  for (let xi = 0; xi <= 20; xi += 1) {
    const x = xi / 20;
    const y = yi / 20;
    const influences = regionalAnchorInfluences(x, y);
    const sample = sampleRegionalAssetAnchor(x, y, xi % 2 === 0 ? 'tree' : 'rock');
    assert.equal(Object.keys(influences).length, REGION_NAMES.length);
    assert(sample.response >= 0 && sample.response <= 1);
    assert(sample.climate.cold >= 0 && sample.climate.cold <= 1);
    assert(sample.climate.tundra >= 0 && sample.climate.tundra <= 1);
    assert(sample.climate.snow >= 0 && sample.climate.snow <= 1);
    assert(sample.surface.wet >= 0 && sample.surface.wet <= 1);
    assert(sample.surface.lithic >= 0 && sample.surface.lithic <= 1);
    const bias = regionalAssetMaterialBias(sample);
    assert(Math.abs(bias.grassHueBias) <= 0.12);
    assert(Math.abs(bias.rockCoolBias) <= 0.12);
    regionalChecks += 1;
  }
}

const regionalDiag = regionalAnchorDiagnostics(
  Array.from({ length: 64 }, (_, index) => ({
    x: (index % 8) / 7,
    y: Math.floor(index / 8) / 7,
  })),
  'tree',
);
assert.equal(regionalDiag.count, 64);
assert(regionalDiag.max >= regionalDiag.min);
assert(regionalDiag.range >= 0);

const familyExtremes = {};
for (const family of FAMILY_NAMES) {
  const profiles = allProfiles.get(family);
  const scores = profiles.map((item) => item.placementScore);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  familyExtremes[family] = { min, max, mean, range: max - min };
  assert(max >= min);
  assert(mean >= min && mean <= max);
}

const specialPairMatrix = [
  ['tree', 'snowfield'],
  ['tree', 'scree'],
  ['rock', 'scree'],
  ['rock', 'volcanic'],
  ['snow', 'permanentIce'],
  ['waterside', 'marsh'],
  ['waterside', 'coast'],
  ['settlement', 'meadow'],
];

for (const [family, environmentKey] of specialPairMatrix) {
  const mapping = {
    snowfield: samples.find((sample) => sample.biome === 'snowfield'),
    scree: samples.find((sample) => sample.biome.includes('scree')),
    volcanic: fixture(1300, 900, 9001),
    permanentIce: fixture(-1300, -2600, 9002),
    marsh: samples.find((sample) => sample.biome.includes('wetland')),
    coast: fixture(3500, 1700, 9003),
    meadow: samples.find((sample) => sample.biome === 'meadow'),
  };
  const sample = mapping[environmentKey];
  assert(sample, `${family}/${environmentKey} special fixture must exist`);
  const p = sampleWorldAssetGeographyProfile(sample, { family });
  assert(p.placementScore >= 0 && p.placementScore <= 1);
}

for (const family of FAMILY_NAMES) {
  const profileSamples = allProfiles.get(family);
  const first = profileSamples[0];
  const last = profileSamples[profileSamples.length - 1];
  const yawA = deterministicAssetYaw(first, samples[0].x, samples[0].z);
  const yawB = deterministicAssetYaw(last, samples[samples.length - 1].x, samples[samples.length - 1].z);
  const scaleA = deterministicAssetScale(first, samples[0].x, samples[0].z);
  const scaleB = deterministicAssetScale(last, samples[samples.length - 1].x, samples[samples.length - 1].z);
  assert(Number.isFinite(yawA) && Number.isFinite(yawB));
  assert(scaleA > 0 && scaleB > 0);
}

const regionMaterialBiases = Object.fromEntries(REGION_NAMES.map((region, index) => {
  const anchor = sampleRegionalAssetAnchor((index + 1) / (REGION_NAMES.length + 1), 0.34 + index * 0.051, FAMILY_NAMES[index % FAMILY_NAMES.length]);
  return [region, regionalAssetMaterialBias(anchor)];
}));

for (const [region, bias] of Object.entries(regionMaterialBiases)) {
  assert(Number.isFinite(bias.grassHueBias), `${region} grass hue bias must be finite`);
  assert(Number.isFinite(bias.rockCoolBias), `${region} rock bias must be finite`);
  assert(Number.isFinite(bias.snowValueBias), `${region} snow value bias must be finite`);
  assert(Number.isFinite(bias.woodWeatheringBias), `${region} wood weathering bias must be finite`);
}

console.log('[checkWorldAssetGeographyStress] PASS', JSON.stringify({
  policy: 'world-asset-geography-profile-2026-09-07-v1',
  sampleCount: samples.length,
  familyCount: FAMILY_NAMES.length,
  domainCount: DOMAIN_NAMES.length,
  deterministicChecks,
  continuityChecks,
  regionalChecks,
  regionalAnchorCount: REGION_NAMES.length,
  regionalDiagnostics: regionalDiag,
  familyExtremes,
  regionMaterialBiases,
}));
