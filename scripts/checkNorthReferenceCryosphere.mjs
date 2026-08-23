#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_SCALE } from '../src/3d/config.js';
import {
  NORTH_REFERENCE_CRYOSPHERE_POLICY,
  northReferenceCryosphereAtNormalized,
  northReferenceCryosphereAtWorldXZ,
} from '../src/3d/world/northReferenceCryosphere.js';

function sample(x, y) {
  return northReferenceCryosphereAtNormalized(x, y);
}

const alwaysWinterCenter = sample(0.145, 0.115);
const northCenter = sample(0.175, 0.285);
const westTransition = sample(0.145, 0.22);
const overlapTransition = sample(0.16, 0.205);
const sameLatitudeEast = sample(0.60, 0.115);
const sameLatitudeFarEast = sample(0.85, 0.115);
const temperateSouth = sample(0.18, 0.55);

assert(alwaysWinterCenter.winterCore > 0.99,
  'canonical lands-always-winter center must remain full-strength winter core');
assert(alwaysWinterCenter.permanentIce > 0.99,
  'canonical always-winter center must own permanent ice');
assert(alwaysWinterCenter.tundra >= alwaysWinterCenter.permanentIce,
  'tundra climate envelope must include permanent ice');
assert(alwaysWinterCenter.winterHaloExtension < 1e-9,
  'full winter core must not spend extra transition-halo strength at its center');

assert(northCenter.tundra > 0.85,
  'canonical north biome center must remain strongly tundra/cold-ground');
assert(northCenter.permanentIce < northCenter.tundra,
  'canonical north biome must stay colder than temperate ground without collapsing into full permanent ice');

assert(westTransition.permanentIce > 0,
  'always-winter ellipse must have a continuous west-Westeros glacial transition halo');
assert(westTransition.permanentIce < alwaysWinterCenter.permanentIce,
  'glacial transition halo must be weaker than the always-winter core');
assert(westTransition.winterHaloExtension >= 0,
  'glacial transition must expose only non-negative halo extension beyond the authored core');
assert(westTransition.permanentIce + 1e-9 >= westTransition.winterCore,
  'transition halo must never weaken authored permanent-ice core influence');
assert(westTransition.permanentIce <= westTransition.winterCore
    + westTransition.winterHaloExtension * NORTH_REFERENCE_CRYOSPHERE_POLICY.iceHaloGain + 1e-9,
  'transition halo must remain bounded by the authored halo gain');

const overlapContributions = [
  overlapTransition.northCore * NORTH_REFERENCE_CRYOSPHERE_POLICY.northTundraGain,
  overlapTransition.northHalo * NORTH_REFERENCE_CRYOSPHERE_POLICY.northTundraGain,
  overlapTransition.winterHalo * NORTH_REFERENCE_CRYOSPHERE_POLICY.winterHaloGain,
];
assert(overlapTransition.tundraUnion + 1e-9 >= Math.max(...overlapContributions),
  'overlapping authored tundra envelopes should combine rather than discard the weaker field');
assert(overlapTransition.tundra >= overlapTransition.tundraUnion - 1e-9,
  'final tundra envelope must preserve the smooth overlap union');

assert.equal(sameLatitudeEast.permanentIce, 0,
  'map-aligned permanent ice must not freeze unrelated eastern land/sea merely because map Y matches the far north');
assert.equal(sameLatitudeFarEast.permanentIce, 0,
  'far-eastern same-latitude reference space must stay outside Westeros permanent ice');
assert.equal(temperateSouth.permanentIce, 0,
  'temperate southern Westeros must remain outside permanent ice');
assert(temperateSouth.tundra < 0.01,
  'temperate southern Westeros must remain outside the north tundra envelope');

let previous = sample(0.145, 0.115).permanentIce;
let maxStep = 0;
for (let y = 0.12; y <= 0.30; y += 0.005) {
  const current = sample(0.145, y).permanentIce;
  maxStep = Math.max(maxStep, Math.abs(current - previous));
  assert(current <= previous + 1e-9,
    `permanent ice should not strengthen while moving south through the canonical winter ellipse near y=${y.toFixed(3)}`);
  previous = current;
}
assert(maxStep < 0.11,
  `canonical winter-to-tundra transition must stay smooth; max step=${maxStep}`);

let previousTundra = sample(0.145, 0.115).tundra;
let maxTundraStep = 0;
for (let i = 1; i <= 48; i += 1) {
  const t = i / 48;
  const x = 0.145 + (0.22 - 0.145) * t;
  const y = 0.115 + (0.52 - 0.115) * t;
  const current = sample(x, y).tundra;
  maxTundraStep = Math.max(maxTundraStep, Math.abs(current - previousTundra));
  assert(Math.abs(current - previousTundra) < 0.12,
    `combined tundra overlap must stay locally continuous along canonical north-to-south path at step ${i}`);
  previousTundra = current;
}

for (let x = 0; x <= 1; x += 0.025) {
  for (let y = 0; y <= 0.65; y += 0.025) {
    const result = sample(x, y);
    for (const key of [
      'winterCore', 'winterHalo', 'winterHaloExtension', 'northCore', 'northHalo',
      'tundraUnion', 'permanentIce', 'tundra', 'tundraBand',
    ]) {
      assert(Number.isFinite(result[key]), `${key} must remain finite at ${x},${y}`);
      assert(result[key] >= 0 && result[key] <= 1, `${key} must remain normalized at ${x},${y}`);
    }
    assert(result.tundra + 1e-9 >= result.permanentIce,
      `tundra envelope must include permanent ice at ${x},${y}`);
    assert(result.winterHaloExtension <= result.winterHalo + 1e-9,
      `winter halo extension must remain bounded by sampled halo influence at ${x},${y}`);
  }
}

const halfWidth = WORLD_SCALE.WORLD_WIDTH_METERS * 0.5;
const halfDepth = WORLD_SCALE.WORLD_DEPTH_METERS * 0.5;
const outsideSamples = [
  northReferenceCryosphereAtWorldXZ(halfWidth + 1, 0),
  northReferenceCryosphereAtWorldXZ(-halfWidth - 1, 0),
  northReferenceCryosphereAtWorldXZ(0, halfDepth + 1),
  northReferenceCryosphereAtWorldXZ(0, -halfDepth - 1),
  northReferenceCryosphereAtWorldXZ(halfWidth + 800, -halfDepth - 800),
];
for (const outside of outsideSamples) {
  assert.equal(outside.outsideReference, true,
    'scatter candidates outside the owner map must be marked outside-reference instead of throwing');
  assert.equal(outside.permanentIce, 0,
    'outside-reference scatter candidates must not inherit permanent ice');
  assert.equal(outside.tundra, 0,
    'outside-reference scatter candidates must not inherit tundra');
  assert.equal(outside.winterHaloExtension, 0,
    'outside-reference scatter candidates must not retain transition-halo telemetry');
  assert.equal(outside.tundraUnion, 0,
    'outside-reference scatter candidates must not retain tundra-overlap telemetry');
}

assert.equal(NORTH_REFERENCE_CRYOSPHERE_POLICY.renderClimateOnly, true,
  'reference cryosphere field must remain climate/render-only');
assert.equal(NORTH_REFERENCE_CRYOSPHERE_POLICY.heightAuthorityUnchanged, true,
  'reference cryosphere field must never become a second terrain/collider height authority');
assert.equal(NORTH_REFERENCE_CRYOSPHERE_POLICY.outsideReferenceIsTemperate, true,
  'world-edge scatter must remain safe and climate-neutral beyond the owner map');
assert.equal(NORTH_REFERENCE_CRYOSPHERE_POLICY.corePreservingIceHalo, true,
  'permanent-ice transition must preserve authored core strength while blending the outer halo');
assert.equal(NORTH_REFERENCE_CRYOSPHERE_POLICY.tundraUnionBlend, true,
  'overlapping North and always-winter tundra envelopes must use bounded union blending');

console.log('[checkNorthReferenceCryosphere] PASS', JSON.stringify({
  policy: NORTH_REFERENCE_CRYOSPHERE_POLICY.id,
  alwaysWinterPermanentIce: alwaysWinterCenter.permanentIce,
  northTundra: northCenter.tundra,
  westTransitionPermanentIce: westTransition.permanentIce,
  overlapTundraUnion: overlapTransition.tundraUnion,
  sameLatitudeEastPermanentIce: sameLatitudeEast.permanentIce,
  maxTransitionStep: maxStep,
  maxTundraStep,
  outsideReferenceSamples: outsideSamples.length,
}));
