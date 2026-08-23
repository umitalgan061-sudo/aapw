#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TERRAIN_SNOW_SURFACE_TONE_POLICY as P,
  resolveTerrainSnowSurfaceTone,
} from '../src/3d/world/terrainSnowSurfaceTone.js';

const EPSILON = 1e-9;
const source = readFileSync(new URL('../src/3d/world/terrainBiomeShading.js', import.meta.url), 'utf8');

function readPaletteHex(name) {
  const match = source.match(new RegExp(`\\b${name}:\\s*new THREE\\.Color\\(0x([0-9a-fA-F]{6})\\)`));
  assert(match, `${name} palette entry must remain explicit for cryosphere harmony QA`);
  return Number.parseInt(match[1], 16);
}

function rgb(hex) {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  ];
}

function distance(a, b) {
  const ar = rgb(a);
  const br = rgb(b);
  return Math.hypot(ar[0] - br[0], ar[1] - br[1], ar[2] - br[2]);
}

assert.equal(P.renderOnly, true);
assert.equal(P.heightAuthorityUnchanged, true);
assert.equal(P.snowCoverageAuthorityUnchanged, true);
assert(P.packedGlacialFamilyGain >= 0.14 && P.packedGlacialFamilyGain <= 0.2,
  'glacial packed-family bridge should remain visually meaningful but bounded');
assert(P.packedShelteredGlacialGain >= 0.06 && P.packedShelteredGlacialGain <= 0.14,
  'sheltered permanent-ice snow should retain a small bounded cold-family bridge');
assert(P.shelteredGlacialRetentionFloor >= 0.5 && P.shelteredGlacialRetentionFloor <= 0.7,
  'deep shelter must soften, not erase, the far-north glacial-family link');
assert(P.accumulatedPermanentIceScale >= 0.45 && P.accumulatedPermanentIceScale <= 0.6,
  'permanent-ice accumulated snow should stay soft without becoming a warm isolated patch');
assert(P.shelteredGlacialAccumulationCooling >= 0.1 && P.shelteredGlacialAccumulationCooling <= 0.25,
  'deep glacial shelter cooling should be visible but remain a bounded render-only correction');

const packedHex = readPaletteHex('PACKED_SNOW');
const accumulatedHex = readPaletteHex('ACCUMULATED_SNOW');
const glacialHex = readPaletteHex('GLACIAL_ICE');
const coastalHex = readPaletteHex('COASTAL_ICE');
const snowHex = readPaletteHex('SNOW');

const packedToGlacial = distance(packedHex, glacialHex);
const packedToCoastal = distance(packedHex, coastalHex);
const neutralToGlacial = distance(snowHex, glacialHex);
const accumulatedToGlacial = distance(accumulatedHex, glacialHex);

assert(packedToGlacial < 0.03,
  `packed mountain snow should stay in the glacial-ice colour family; distance=${packedToGlacial}`);
assert(packedToCoastal < 0.08,
  `packed mountain snow should visually bridge toward coastal ice; distance=${packedToCoastal}`);
assert(packedToGlacial < neutralToGlacial,
  'packed snow must be closer to glacial ice than generic neutral snow');
assert(accumulatedToGlacial < 0.14,
  'soft accumulated snow may be warmer, but must remain inside a bounded cryosphere family');

const permanentLee = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.82,
  permanentIce: 1,
  tundra: 1,
  leeDeposit: 0.9,
  concavityHold: 0.85,
  gentleSlope: 0.9,
});
const tundraLee = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.82,
  tundra: 1,
  leeDeposit: 0.9,
  concavityHold: 0.85,
  gentleSlope: 0.9,
});
const permanentNeutral = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.82,
  permanentIce: 1,
  tundra: 1,
});
const permanentWindward = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.82,
  permanentIce: 1,
  tundra: 1,
  windwardScour: 0.92,
  ridgeExposure: 0.88,
});
const permanentShallowShelter = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.34,
  permanentIce: 1,
  tundra: 1,
  leeDeposit: 0.7,
  concavityHold: 0.65,
  gentleSlope: 0.8,
});
const tundraShallowShelter = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.34,
  tundra: 1,
  leeDeposit: 0.7,
  concavityHold: 0.65,
  gentleSlope: 0.8,
});
const transitionShelter = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.82,
  permanentIce: 0.5,
  tundra: 1,
  leeDeposit: 0.9,
  concavityHold: 0.85,
  gentleSlope: 0.9,
});

assert(permanentLee.glacialFamilySupport > 0.55,
  'deep far-north shelter should retain enough glacial-family support to avoid cream islands');
assert(permanentLee.shelteredGlacialRetention >= P.shelteredGlacialRetentionFloor - EPSILON,
  'deep shelter must never erase the authored glacial-family retention floor');
assert(permanentLee.shelteredGlacialBridge > 0,
  'deep permanent-ice shelter should keep a direct cold-family bridge');
assert.equal(tundraLee.shelteredGlacialBridge, 0,
  'pure tundra shelter must not inherit the permanent-ice cold bridge');
assert(permanentLee.accumulationGlacialCooling > 0,
  'deep permanent-ice shelter should actively reduce warm accumulated tint through glacial support');
assert.equal(tundraLee.accumulationGlacialCooling, 0,
  'pure tundra shelter must not receive permanent-ice glacial accumulation cooling');
assert(transitionShelter.accumulationGlacialCooling > 0
  && transitionShelter.accumulationGlacialCooling < permanentLee.accumulationGlacialCooling,
  'map-aligned transition shelter should cool smoothly between tundra and permanent ice');
assert(permanentLee.accumulationClimateScale < P.accumulatedPermanentIceScale,
  'deep permanent-ice shelter should cool slightly beyond the broad permanent-ice warm-tint scale');
assert(permanentLee.accumulatedWeight < tundraLee.accumulatedWeight * 0.65,
  'permanent-ice lee snow should be materially less warm-tinted than equivalent tundra drift');
assert(permanentLee.accumulatedWeight > 0.18,
  'far-north lee bowls must still read as visibly accumulated snow after glacial harmony cooling');
assert(permanentLee.packedWeight > 0,
  'far-north sheltered snow should retain a small cold-family contribution');
assert(permanentWindward.packedWeight > permanentNeutral.packedWeight,
  'windward permanent-ice ridges must remain the strongest packed-snow case');
assert(permanentWindward.packedWeight > permanentLee.packedWeight,
  'sheltered snow must remain softer than windward packed snow');
assert(permanentShallowShelter.shelteredGlacialBridge > 0,
  'partially retained far-north shelter should already connect to the glacial family');
assert(permanentShallowShelter.packedWeight > tundraShallowShelter.packedWeight,
  'equally sheltered visible snow should stay colder in permanent ice than in tundra');
assert(permanentShallowShelter.accumulatedWeight < tundraShallowShelter.accumulatedWeight,
  'permanent-ice shallow shelter should remain less warm-tinted than tundra shelter');

for (const sample of [
  permanentLee,
  tundraLee,
  permanentNeutral,
  permanentWindward,
  permanentShallowShelter,
  tundraShallowShelter,
  transitionShelter,
]) {
  for (const key of [
    'packedWeight',
    'accumulatedWeight',
    'glacialFamilySupport',
    'shelteredGlacialRetention',
    'shelteredGlacialBridge',
    'accumulationGlacialCooling',
    'visibleSnow',
  ]) {
    assert(Number.isFinite(sample[key]) && sample[key] >= -EPSILON && sample[key] <= 1 + EPSILON,
      `${key} must remain normalized`);
  }
}

assert.match(source, /PACKED_SNOW/);
assert.match(source, /ACCUMULATED_SNOW/);
assert.match(source, /GLACIAL_ICE/);
assert.match(source, /COASTAL_ICE/);
assert.match(source, /heightAuthorityUnchanged:\s*true/);
assert.doesNotMatch(source, /heightAboveSeaMeters\s*[+\-]=/);

console.log(JSON.stringify({
  policy: P.id,
  packedToGlacial,
  packedToCoastal,
  neutralToGlacial,
  accumulatedToGlacial,
  permanentLeePackedWeight: permanentLee.packedWeight,
  permanentLeeAccumulatedWeight: permanentLee.accumulatedWeight,
  tundraLeeAccumulatedWeight: tundraLee.accumulatedWeight,
  permanentLeeGlacialSupport: permanentLee.glacialFamilySupport,
  permanentLeeShelteredRetention: permanentLee.shelteredGlacialRetention,
  permanentLeeShelteredBridge: permanentLee.shelteredGlacialBridge,
  permanentLeeAccumulationCooling: permanentLee.accumulationGlacialCooling,
  transitionAccumulationCooling: transitionShelter.accumulationGlacialCooling,
  permanentLeeAccumulationScale: permanentLee.accumulationClimateScale,
  shallowShelterPackedDelta: permanentShallowShelter.packedWeight - tundraShallowShelter.packedWeight,
  permanentWindwardPackedWeight: permanentWindward.packedWeight,
  heightAuthorityUnchanged: true,
}, null, 2));
