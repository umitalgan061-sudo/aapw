#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TERRAIN_SNOW_SURFACE_TONE_POLICY as P,
  resolveTerrainSnowSurfaceTone,
} from '../src/3d/world/terrainSnowSurfaceTone.js';

const EPSILON = 1e-9;
const shadingSource = readFileSync(new URL('../src/3d/world/terrainBiomeShading.js', import.meta.url), 'utf8');

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function readPaletteHex(name) {
  const match = shadingSource.match(new RegExp(`\\b${name}:\\s*new THREE\\.Color\\(0x([0-9a-fA-F]{6})\\)`));
  assert(match, `${name} palette entry must remain explicit for accumulated snow harmony QA`);
  return Number.parseInt(match[1], 16);
}

function rgb(hex) {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  ];
}

function lerpColor(a, b, t) {
  const amount = clamp01(t);
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function effectiveSnowColor(sample, accumulatedWeight = sample.accumulatedWeight) {
  const neutral = rgb(readPaletteHex('SNOW'));
  const packed = rgb(readPaletteHex('PACKED_SNOW'));
  const accumulated = rgb(readPaletteHex('ACCUMULATED_SNOW'));
  return lerpColor(lerpColor(neutral, packed, sample.packedWeight), accumulated, accumulatedWeight);
}

function sample({ snowAmount = 0.9, permanentIce = 0, tundra = 1 } = {}) {
  return resolveTerrainSnowSurfaceTone({
    snowAmount,
    permanentIce,
    tundra,
    leeDeposit: 0.88,
    concavityHold: 0.82,
    gentleSlope: 0.9,
  });
}

assert.equal(P.renderOnly, true, 'accumulated palette retention must remain render-only');
assert.equal(P.heightAuthorityUnchanged, true,
  'accumulated palette retention must not become terrain/collider height authority');
assert.equal(P.snowCoverageAuthorityUnchanged, true,
  'accumulated palette retention must not alter authoritative snow coverage');
assert.equal(P.glacialAccumulatedPaletteRetention, true,
  'glacial accumulated palette retention policy flag must remain enabled');
assert(P.accumulatedGlacialPaletteRetentionFloor >= 0.65
  && P.accumulatedGlacialPaletteRetentionFloor <= 0.82,
  'glacial accumulated retention floor must remain a bounded soft-snow correction');

const tundraDeep = sample({ snowAmount: 0.94, permanentIce: 0, tundra: 1 });
const transitionDeep = sample({ snowAmount: 0.94, permanentIce: 0.5, tundra: 1 });
const permanentDeep = sample({ snowAmount: 0.94, permanentIce: 1, tundra: 1 });
const permanentShallow = sample({ snowAmount: 0.34, permanentIce: 1, tundra: 1 });
const permanentThin = sample({ snowAmount: 0.18, permanentIce: 1, tundra: 1 });

assert.equal(tundraDeep.accumulatedGlacialPaletteRetention, 1,
  'pure tundra accumulated snow must retain the authored warm palette unchanged');
assert(transitionDeep.accumulatedGlacialPaletteRetention < 1,
  'mixed cryosphere deep accumulation should begin reducing warm palette influence');
assert(permanentDeep.accumulatedGlacialPaletteRetention < transitionDeep.accumulatedGlacialPaletteRetention,
  'permanent-ice deep accumulation should retain less warm palette than transition snow');
assert(permanentDeep.accumulatedGlacialPaletteRetention >= P.accumulatedGlacialPaletteRetentionFloor - EPSILON,
  'deep permanent-ice accumulation must not exceed the authored cold-retention floor');
assert(permanentShallow.accumulatedGlacialPaletteRetention > permanentDeep.accumulatedGlacialPaletteRetention,
  'shallow permanent-ice snow should stay closer to neutral accumulated palette than deep retained snow');
assert.equal(permanentThin.accumulatedGlacialPaletteRetention, 1,
  'snow below the accumulated-snow depth threshold must not receive deep-palette retention');

assert(permanentDeep.accumulatedWeight > 0.12,
  'deep permanent-ice lee snow must keep a visible soft accumulated component');
assert(permanentDeep.accumulatedWeight < tundraDeep.accumulatedWeight,
  'deep permanent-ice lee snow must remain less warm-tinted than equivalent tundra accumulation');
assert(permanentDeep.packedWeight > 0,
  'deep permanent-ice lee snow must retain a cold packed-family component');

// Reconstruct the pre-retention accumulated weight by dividing out only the newly authored factor.
// This compares the exact same snow amount, climate and terrain-form telemetry before/after the new
// colour-only correction without needing a second legacy implementation or touching snow coverage.
const reconstructedLegacyAccumulatedWeight = Math.min(
  P.maximumAccumulatedWeight,
  permanentDeep.accumulatedWeight / permanentDeep.accumulatedGlacialPaletteRetention,
);
const currentColor = effectiveSnowColor(permanentDeep);
const reconstructedLegacyColor = effectiveSnowColor(permanentDeep, reconstructedLegacyAccumulatedWeight);
const tundraColor = effectiveSnowColor(tundraDeep);
const glacial = rgb(readPaletteHex('GLACIAL_ICE'));
const coastal = rgb(readPaletteHex('COASTAL_ICE'));
const accumulated = rgb(readPaletteHex('ACCUMULATED_SNOW'));

const currentToGlacial = distance(currentColor, glacial);
const legacyToGlacial = distance(reconstructedLegacyColor, glacial);
const currentToCoastal = distance(currentColor, coastal);
const legacyToCoastal = distance(reconstructedLegacyColor, coastal);

assert(currentToGlacial + 0.002 < legacyToGlacial,
  `retention must measurably pull deep far-north accumulated snow toward GLACIAL_ICE; current=${currentToGlacial} legacy=${legacyToGlacial}`);
assert(currentToCoastal + 0.002 < legacyToCoastal,
  `retention must measurably pull deep far-north accumulated snow toward COASTAL_ICE; current=${currentToCoastal} legacy=${legacyToCoastal}`);
assert(distance(currentColor, accumulated) < 0.18,
  'deep lee snow must remain recognisably inside the soft accumulated-snow family');
assert(currentToGlacial < distance(tundraColor, glacial),
  'permanent-ice lee snow should remain more glacial than equally deep tundra accumulation');

for (const [label, value] of Object.entries({
  tundraRetention: tundraDeep.accumulatedGlacialPaletteRetention,
  transitionRetention: transitionDeep.accumulatedGlacialPaletteRetention,
  permanentRetention: permanentDeep.accumulatedGlacialPaletteRetention,
  shallowRetention: permanentShallow.accumulatedGlacialPaletteRetention,
  currentToGlacial,
  legacyToGlacial,
  currentToCoastal,
  legacyToCoastal,
})) {
  assert(Number.isFinite(value), `${label} must remain finite`);
}

assert.match(shadingSource, /PACKED_SNOW/);
assert.match(shadingSource, /ACCUMULATED_SNOW/);
assert.match(shadingSource, /GLACIAL_ICE/);
assert.match(shadingSource, /COASTAL_ICE/);
assert.doesNotMatch(shadingSource, /heightAboveSeaMeters\s*[+\-]=/,
  'render palette code must not mutate terrain height');

console.log(JSON.stringify({
  policyId: P.id,
  tundraRetention: tundraDeep.accumulatedGlacialPaletteRetention,
  transitionRetention: transitionDeep.accumulatedGlacialPaletteRetention,
  permanentRetention: permanentDeep.accumulatedGlacialPaletteRetention,
  shallowRetention: permanentShallow.accumulatedGlacialPaletteRetention,
  currentAccumulatedWeight: permanentDeep.accumulatedWeight,
  reconstructedLegacyAccumulatedWeight,
  currentToGlacial,
  legacyToGlacial,
  currentToCoastal,
  legacyToCoastal,
  heightAuthorityUnchanged: P.heightAuthorityUnchanged,
  snowCoverageAuthorityUnchanged: P.snowCoverageAuthorityUnchanged,
}, null, 2));
