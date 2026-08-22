#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  NORTH_REFERENCE_CRYOSPHERE_POLICY,
  northReferenceCryosphereAtNormalized,
} from '../src/3d/world/northReferenceCryosphere.js';

function sample(x, y) {
  return northReferenceCryosphereAtNormalized(x, y);
}

const alwaysWinterCenter = sample(0.145, 0.115);
const northCenter = sample(0.175, 0.285);
const westTransition = sample(0.145, 0.22);
const sameLatitudeEast = sample(0.60, 0.115);
const sameLatitudeFarEast = sample(0.85, 0.115);
const temperateSouth = sample(0.18, 0.55);

assert(alwaysWinterCenter.winterCore > 0.99,
  'canonical lands-always-winter center must remain full-strength winter core');
assert(alwaysWinterCenter.permanentIce > 0.99,
  'canonical always-winter center must own permanent ice');
assert(alwaysWinterCenter.tundra >= alwaysWinterCenter.permanentIce,
  'tundra climate envelope must include permanent ice');

assert(northCenter.tundra > 0.85,
  'canonical north biome center must remain strongly tundra/cold-ground');
assert(northCenter.permanentIce < northCenter.tundra,
  'canonical north biome must stay colder than temperate ground without collapsing into full permanent ice');

assert(westTransition.permanentIce > 0,
  'always-winter ellipse must have a continuous west-Westeros glacial transition halo');
assert(westTransition.permanentIce < alwaysWinterCenter.permanentIce,
  'glacial transition halo must be weaker than the always-winter core');

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

for (let x = 0; x <= 1; x += 0.025) {
  for (let y = 0; y <= 0.65; y += 0.025) {
    const result = sample(x, y);
    for (const key of ['winterCore', 'winterHalo', 'northCore', 'northHalo', 'permanentIce', 'tundra', 'tundraBand']) {
      assert(Number.isFinite(result[key]), `${key} must remain finite at ${x},${y}`);
      assert(result[key] >= 0 && result[key] <= 1, `${key} must remain normalized at ${x},${y}`);
    }
    assert(result.tundra + 1e-9 >= result.permanentIce,
      `tundra envelope must include permanent ice at ${x},${y}`);
  }
}

assert.equal(NORTH_REFERENCE_CRYOSPHERE_POLICY.renderClimateOnly, true,
  'reference cryosphere field must remain climate/render-only');
assert.equal(NORTH_REFERENCE_CRYOSPHERE_POLICY.heightAuthorityUnchanged, true,
  'reference cryosphere field must never become a second terrain/collider height authority');

console.log('[checkNorthReferenceCryosphere] PASS', JSON.stringify({
  policy: NORTH_REFERENCE_CRYOSPHERE_POLICY.id,
  alwaysWinterPermanentIce: alwaysWinterCenter.permanentIce,
  northTundra: northCenter.tundra,
  westTransitionPermanentIce: westTransition.permanentIce,
  sameLatitudeEastPermanentIce: sameLatitudeEast.permanentIce,
  maxTransitionStep: maxStep,
}));
