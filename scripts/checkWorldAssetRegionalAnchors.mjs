#!/usr/bin/env node

/**
 * Regional anchor continuity and dominance checks.
 *
 * A regional policy is useful only when it nudges broad geography rather than painting hard borders.
 * This test walks a normalized reference lattice, checks that anchor influence sums remain interpretable,
 * checks that material biases stay bounded, verifies continuity, and proves that an anchor center
 * actually resolves toward its authored climate/surface values instead of accumulating the neutral 0.5 seed.
 */

import assert from 'node:assert/strict';
import {
  WORLD_ASSET_REGIONAL_ANCHOR_POLICY,
  WORLD_ASSET_REGIONAL_ANCHORS,
  regionalAnchorBlend,
  regionalAnchorDiagnostics,
  regionalAnchorDistance,
  regionalAnchorInfluences,
  regionalAssetMaterialBias,
  sampleRegionalAssetAnchor,
} from '../src/3d/world/worldAssetRegionalAnchors.js';

const FAMILY_NAMES = ['tree', 'vegetation', 'shrub', 'rock', 'snow', 'waterside', 'building', 'settlement'];
const REGION_NAMES = Object.keys(WORLD_ASSET_REGIONAL_ANCHORS);
const EPSILON = 1e-5;

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function assertBounded(value, label, low = 0, high = 1) {
  assert(Number.isFinite(Number(value)), `${label} must be finite`);
  assert(Number(value) >= low - 1e-12 && Number(value) <= high + 1e-12, `${label} must be in [${low},${high}]`);
}

function assertNear(actual, expected, label, tolerance = EPSILON) {
  assert(Math.abs(Number(actual) - Number(expected)) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
}

assert.equal(WORLD_ASSET_REGIONAL_ANCHOR_POLICY.renderOnly, true);
assert.equal(WORLD_ASSET_REGIONAL_ANCHOR_POLICY.distributionOnly, true);
assert.equal(WORLD_ASSET_REGIONAL_ANCHOR_POLICY.newGeographyIntroduced, false);
assert.equal(WORLD_ASSET_REGIONAL_ANCHOR_POLICY.normalizedWeightedBlending, true);
assert(WORLD_ASSET_REGIONAL_ANCHOR_POLICY.regionalInfluenceMax <= 0.34);
assert.equal(REGION_NAMES.length, 9);

for (const [region, anchor] of Object.entries(WORLD_ASSET_REGIONAL_ANCHORS)) {
  assert(anchor.id === region, `${region} anchor id mismatch`);
  assertBounded(anchor.x, `${region}.x`);
  assertBounded(anchor.y, `${region}.y`);
  assert(anchor.radius[0] > 0 && anchor.radius[1] > 0, `${region} radius must be positive`);
  for (const family of FAMILY_NAMES) assertBounded(anchor.assets[family], `${region}.assets.${family}`);
  for (const key of ['cold', 'tundra', 'snow', 'maritime']) assertBounded(anchor.climate[key], `${region}.climate.${key}`);
  for (const key of ['wet', 'shelter', 'exposure', 'lithic']) assertBounded(anchor.surface[key], `${region}.surface.${key}`);
}

for (const [region, anchor] of Object.entries(WORLD_ASSET_REGIONAL_ANCHORS)) {
  const influences = regionalAnchorInfluences(anchor.x, anchor.y);
  const sample = sampleRegionalAssetAnchor(anchor.x, anchor.y, 'tree');
  const dominant = sample.strongestAnchors[0];
  assert.equal(dominant?.id, region, `${region} must be its own dominant anchor at its center`);
  assert(dominant.weight > 0.99, `${region} center influence must remain ~1, got ${dominant.weight}`);
  assertNear(sample.climate.cold, anchor.climate.cold, `${region} center cold`);
  assertNear(sample.climate.tundra, anchor.climate.tundra, `${region} center tundra`);
  assertNear(sample.climate.snow, anchor.climate.snow, `${region} center snow`);
  assertNear(sample.climate.maritime, anchor.climate.maritime, `${region} center maritime`);
  assertNear(sample.surface.wet, anchor.surface.wet, `${region} center wet`);
  assertNear(sample.surface.shelter, anchor.surface.shelter, `${region} center shelter`);
  assertNear(sample.surface.exposure, anchor.surface.exposure, `${region} center exposure`);
  assertNear(sample.surface.lithic, anchor.surface.lithic, `${region} center lithic`);
  assertNear(sample.palette.grassHueBias, anchor.palette.grassHueBias, `${region} center grass bias`);
  assertNear(sample.palette.rockCoolBias, anchor.palette.rockCoolBias, `${region} center rock bias`);
  assert(Object.values(influences).every((value) => Number.isFinite(value)), `${region} influence values must be finite`);
}

let latticeSamples = 0;
let continuitySamples = 0;
let maxResponseStep = 0;
let maxBiasStep = 0;
for (let yi = 0; yi <= 32; yi += 1) {
  for (let xi = 0; xi <= 32; xi += 1) {
    const x = xi / 32;
    const y = yi / 32;
    const influences = regionalAnchorInfluences(x, y);
    const sample = sampleRegionalAssetAnchor(x, y, FAMILY_NAMES[(xi + yi) % FAMILY_NAMES.length]);
    assert.equal(Object.keys(influences).length, REGION_NAMES.length);
    assertBounded(sample.response, `response@${x},${y}`);
    assertBounded(sample.climate.cold, `cold@${x},${y}`);
    assertBounded(sample.climate.tundra, `tundra@${x},${y}`);
    assertBounded(sample.climate.snow, `snow@${x},${y}`);
    assertBounded(sample.climate.maritime, `maritime@${x},${y}`);
    assertBounded(sample.surface.wet, `wet@${x},${y}`);
    assertBounded(sample.surface.shelter, `shelter@${x},${y}`);
    assertBounded(sample.surface.exposure, `exposure@${x},${y}`);
    assertBounded(sample.surface.lithic, `lithic@${x},${y}`);
    const totalInfluence = Object.values(influences).reduce((sum, value) => sum + value, 0);
    assert(Number.isFinite(totalInfluence), 'total regional influence must be finite');
    assert(totalInfluence >= 0 && totalInfluence <= REGION_NAMES.length);
    assert(Number.isFinite(sample.totalInfluence));
    assertNear(sample.dominantInfluence, sample.strongestAnchors[0]?.weight ?? 0, 'dominant influence');
    const bias = regionalAssetMaterialBias(sample);
    assert(Math.abs(bias.grassHueBias) <= 0.12 + 1e-9);
    assert(Math.abs(bias.rockCoolBias) <= 0.12 + 1e-9);
    assert(Math.abs(bias.snowValueBias) <= 0.08 + 1e-9);
    assert(Math.abs(bias.woodWeatheringBias) <= 0.12 + 1e-9);
    latticeSamples += 1;

    if (xi > 0) {
      const previous = sampleRegionalAssetAnchor((xi - 1) / 32, y, FAMILY_NAMES[(xi + yi - 1) % FAMILY_NAMES.length]);
      const step = Math.abs(sample.response - previous.response);
      maxResponseStep = Math.max(maxResponseStep, step);
      assert(step < 0.34, `regional response seam too sharp near ${x},${y}: ${step}`);
      const previousBias = regionalAssetMaterialBias(previous);
      const biasStep = Math.max(
        Math.abs(bias.grassHueBias - previousBias.grassHueBias),
        Math.abs(bias.rockCoolBias - previousBias.rockCoolBias),
        Math.abs(bias.snowValueBias - previousBias.snowValueBias),
        Math.abs(bias.woodWeatheringBias - previousBias.woodWeatheringBias),
      );
      maxBiasStep = Math.max(maxBiasStep, biasStep);
      assert(biasStep < 0.16, `regional material bias seam too sharp near ${x},${y}: ${biasStep}`);
      continuitySamples += 1;
    }
    if (yi > 0) {
      const previous = sampleRegionalAssetAnchor(x, (yi - 1) / 32, FAMILY_NAMES[(xi + yi - 1) % FAMILY_NAMES.length]);
      const step = Math.abs(sample.response - previous.response);
      maxResponseStep = Math.max(maxResponseStep, step);
      assert(step < 0.34, `regional response seam too sharp near ${x},${y}: ${step}`);
      continuitySamples += 1;
    }
  }
}

for (const family of FAMILY_NAMES) {
  const diag = regionalAnchorDiagnostics(
    Array.from({ length: 81 }, (_, index) => ({ x: (index % 9) / 8, y: Math.floor(index / 9) / 8 })),
    family,
  );
  assert.equal(diag.count, 81);
  assert(diag.max >= diag.min);
  assert(diag.range >= 0);
  assert(diag.mean >= diag.min - 1e-12 && diag.mean <= diag.max + 1e-12);
}

for (let i = 0; i < REGION_NAMES.length; i += 1) {
  const a = WORLD_ASSET_REGIONAL_ANCHORS[REGION_NAMES[i]];
  for (let j = i + 1; j < REGION_NAMES.length; j += 1) {
    const b = WORLD_ASSET_REGIONAL_ANCHORS[REGION_NAMES[j]];
    const distance = regionalAnchorDistance(a, b);
    assert(distance >= 0 && Number.isFinite(distance));
    const blended = regionalAnchorBlend(
      { normalizedX: a.x, normalizedY: a.y, response: a.assets.tree, climate: a.climate, surface: a.surface },
      { normalizedX: b.x, normalizedY: b.y, response: b.assets.tree, climate: b.climate, surface: b.surface },
      0.5,
    );
    assertBounded(blended.response, `${a.id}/${b.id} blended response`);
    assertBounded(blended.climate.cold, `${a.id}/${b.id} blended cold`);
    assertBounded(blended.surface.wet, `${a.id}/${b.id} blended wet`);
  }
}

const regionFamilyProbe = {};
for (const region of REGION_NAMES) {
  regionFamilyProbe[region] = {};
  const anchor = WORLD_ASSET_REGIONAL_ANCHORS[region];
  for (const family of FAMILY_NAMES) {
    const sample = sampleRegionalAssetAnchor(anchor.x, anchor.y, family);
    regionFamilyProbe[region][family] = {
      response: Number(finite(sample.response).toFixed(6)),
      strongest: sample.strongestAnchors,
      climate: {
        cold: Number(finite(sample.climate.cold).toFixed(6)),
        tundra: Number(finite(sample.climate.tundra).toFixed(6)),
        snow: Number(finite(sample.climate.snow).toFixed(6)),
        maritime: Number(finite(sample.climate.maritime).toFixed(6)),
      },
    };
  }
}

const dominanceChecks = [];
for (const [region, familyValues] of Object.entries(regionFamilyProbe)) {
  const values = Object.entries(familyValues).sort((a, b) => b[1].response - a[1].response);
  assert(values[0][1].response >= values[values.length - 1][1].response);
  dominanceChecks.push({ region, bestFamily: values[0][0], bestResponse: values[0][1].response });
}

console.log('[checkWorldAssetRegionalAnchors] PASS', JSON.stringify({
  policy: WORLD_ASSET_REGIONAL_ANCHOR_POLICY.id,
  regions: REGION_NAMES.length,
  families: FAMILY_NAMES.length,
  latticeSamples,
  continuitySamples,
  maxResponseStep,
  maxBiasStep,
  dominanceChecks,
}));
