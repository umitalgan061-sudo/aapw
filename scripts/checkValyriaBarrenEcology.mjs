#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_SCALE } from '../src/3d/config.js';
import {
  VALYRIA_GEOLOGY_POLICY,
  valyriaInfluenceAtWorldXZ,
} from '../src/3d/world/valyriaGeology.js';
import {
  VALYRIA_BARREN_ECOLOGY_POLICY,
  createValyriaBarrenEcologyPlacementProbe,
  isOrdinaryEcologyAllowedAtWorldXZ,
  valyriaEcologyProfileAtWorldXZ,
} from '../src/3d/world/valyriaEcology.js';

const P = VALYRIA_GEOLOGY_POLICY;
const E = VALYRIA_BARREN_ECOLOGY_POLICY;
assert.equal(E.geologyPolicyId, P.id);
assert.equal(E.placementOnly, true);
assert.equal(E.terrainHeightAuthorityUnchanged, true);
assert.equal(E.colliderAuthorityUnchanged, true);
assert.equal(E.canonicalWaterAuthorityUnchanged, true);
assert(E.id.includes('v2-feathered-refugia'));
assert(Number.isFinite(E.transitionWidth) && E.transitionWidth > 0);
const configuredTransitionStart = Math.max(0, E.exclusionInfluence - E.transitionWidth);
assert(configuredTransitionStart >= 0 && configuredTransitionStart < E.exclusionInfluence);
assert(E.excludedOrdinarySystems.includes('vegetation-tree-scatter'));
assert(E.excludedOrdinarySystems.includes('procedural-villages'));
assert(E.excludedOrdinarySystems.includes('wind-grass-ground-cover'));
assert(E.preservedSystems.includes('natural-geology'));
assert(E.preservedSystems.includes('terrain-collider'));

function worldFromNormalized(nx, ny) {
  const bounds = WORLD_SCALE.MAP_BOUNDS;
  const mapX = bounds.minX + nx * (bounds.maxX - bounds.minX);
  const mapY = bounds.minY + ny * (bounds.maxY - bounds.minY);
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerY = (bounds.minY + bounds.maxY) * 0.5;
  return {
    x: (mapX - centerX) * WORLD_SCALE.METERS_PER_MAP_UNIT,
    z: (mapY - centerY) * WORLD_SCALE.METERS_PER_MAP_UNIT,
  };
}

const core = worldFromNormalized(P.coreCenter.nx, P.coreCenter.ny);
const neck = worldFromNormalized(P.neckCenter.nx, P.neckCenter.ny);
const outside = worldFromNormalized(0.20, 0.28);

assert(valyriaInfluenceAtWorldXZ(core.x, core.z) > 0.999);
assert(valyriaInfluenceAtWorldXZ(neck.x, neck.z) > 0.999);
assert.equal(valyriaInfluenceAtWorldXZ(outside.x, outside.z), 0);
assert.equal(isOrdinaryEcologyAllowedAtWorldXZ(core.x, core.z), false);
assert.equal(isOrdinaryEcologyAllowedAtWorldXZ(neck.x, neck.z), false);
assert.equal(isOrdinaryEcologyAllowedAtWorldXZ(outside.x, outside.z), true);

const coreProfile = valyriaEcologyProfileAtWorldXZ(core.x, core.z);
assert.equal(coreProfile.barren, true);
assert.equal(coreProfile.ordinaryTreeDensity, 0);
assert.equal(coreProfile.ordinaryGrassDensity, 0);
assert.equal(coreProfile.proceduralVillageAllowed, false);
const outsideProfile = valyriaEcologyProfileAtWorldXZ(outside.x, outside.z);
assert.equal(outsideProfile.barren, false);
assert.equal(outsideProfile.ordinaryTreeDensity, 1);
assert.equal(outsideProfile.ordinaryGrassDensity, 1);
assert.equal(outsideProfile.proceduralVillageAllowed, true);

let canonicalCalls = 0;
const canonicalSurface = { touched: 0 };
const canonicalSampler = (x, z, maxHeight, outSurface) => {
  canonicalCalls += 1;
  if (outSurface && typeof outSurface === 'object') {
    outSurface.canonicalDelegated = true;
    canonicalSurface.touched += 1;
  }
  return 73.25 + x * 0.00001 - z * 0.00001 + (Number.isFinite(maxHeight) ? 0 : 0);
};
const seaLevelMeters = 6;
const probe = createValyriaBarrenEcologyPlacementProbe({
  sampleHeightMeters: canonicalSampler,
  seaLevelMeters,
});
assert.equal(probe.policyId, E.id);
assert.equal(probe.geologyPolicyId, P.id);
assert.equal(probe.terrainHeightAuthorityUnchanged, true);
assert.equal(probe.colliderAuthorityUnchanged, true);
assert.equal(probe.rejectionHeightMeters, seaLevelMeters - E.rejectionDepthBelowSeaMeters);

const barrenOut = {};
const corePlacementHeight = probe.sampleHeightMeters(core.x, core.z, 24, barrenOut);
assert.equal(corePlacementHeight, probe.rejectionHeightMeters);
assert.equal(barrenOut.valyriaBarrenPlacementRejected, true);
assert.equal(canonicalCalls, 0, 'barren adapter must not call canonical sampler for rejected Doom placement');

const neckPlacementHeight = probe.sampleHeightMeters(neck.x, neck.z);
assert.equal(neckPlacementHeight, probe.rejectionHeightMeters);
assert.equal(canonicalCalls, 0);

const outsideOut = {};
const outsidePlacementHeight = probe.sampleHeightMeters(outside.x, outside.z, 24, outsideOut);
const expectedOutside = 73.25 + outside.x * 0.00001 - outside.z * 0.00001;
assert.equal(outsidePlacementHeight, expectedOutside);
assert.equal(outsideOut.canonicalDelegated, true);
assert.equal(canonicalCalls, 1);
assert.equal(canonicalSurface.touched, 1);

// Exercise the whole falloff. V2 intentionally feathers the pre-Doom transition with deterministic
// refugia instead of drawing a perfect binary ring. The configured width may be broader than the hard
// barren threshold; production deliberately clamps transitionStart to zero in that case so the outermost
// zero-influence world remains untouched while the full non-zero influence falloff can feather naturally.
// Hard-barren points must always be rejected; zero-influence points must always survive; the transition
// should contain both survivors and rejected pockets, which avoids a visible vegetation contour around
// the volcanic province.
let hardBarren = 0;
let hardBarrenViolations = 0;
let outerWorld = 0;
let outerWorldViolations = 0;
let transitionSamples = 0;
let transitionAllowed = 0;
let transitionRejected = 0;
let transitionDensityMin = 1;
let transitionDensityMax = 0;
for (let iy = 0; iy <= 64; iy += 1) {
  const ny = 0.60 + iy / 64 * 0.24;
  for (let ix = 0; ix <= 64; ix += 1) {
    const nx = 0.35 + ix / 64 * 0.20;
    const world = worldFromNormalized(nx, ny);
    const influence = valyriaInfluenceAtWorldXZ(world.x, world.z);
    const profile = valyriaEcologyProfileAtWorldXZ(world.x, world.z);
    const actualAllow = isOrdinaryEcologyAllowedAtWorldXZ(world.x, world.z);
    assert.equal(profile.influence, influence);
    assert(profile.refugia >= 0 && profile.refugia <= 1);
    assert(profile.ordinaryTreeDensity >= 0 && profile.ordinaryTreeDensity <= 1);
    assert(profile.ordinaryGrassDensity >= 0 && profile.ordinaryGrassDensity <= 1);

    if (influence >= E.exclusionInfluence) {
      hardBarren += 1;
      if (actualAllow || !profile.barren || profile.ordinaryTreeDensity !== 0 || profile.ordinaryGrassDensity !== 0) {
        hardBarrenViolations += 1;
      }
      continue;
    }

    const transitionStart = Math.max(0, E.exclusionInfluence - E.transitionWidth);
    if (influence <= transitionStart + 1e-12) {
      outerWorld += 1;
      if (!actualAllow || profile.barren || profile.ordinaryTreeDensity < 0.999999 || profile.ordinaryGrassDensity < 0.999999) {
        outerWorldViolations += 1;
      }
      continue;
    }

    transitionSamples += 1;
    if (actualAllow) transitionAllowed += 1;
    else transitionRejected += 1;
    transitionDensityMin = Math.min(transitionDensityMin, profile.ordinaryGrassDensity);
    transitionDensityMax = Math.max(transitionDensityMax, profile.ordinaryGrassDensity);
    assert.equal(profile.barren, false, 'pre-threshold feather must not claim hard-barren authority');
  }
}
assert.equal(hardBarrenViolations, 0, 'hard Valyria core leaked ordinary ecology');
assert.equal(outerWorldViolations, 0, 'zero/low-pressure outer world lost ordinary ecology');
assert(hardBarren > 100, `barren region unexpectedly tiny: ${hardBarren}`);
assert(outerWorld > 1000, `outer world unexpectedly small: ${outerWorld}`);
assert(transitionSamples > 20, `ecology feather band was not sampled: ${transitionSamples}`);
assert(transitionAllowed > 0, 'feather band lost all ecological refugia');
assert(transitionRejected > 0, 'feather band became a hard all-allowed ring');
assert(transitionDensityMin < 0.95 && transitionDensityMax > transitionDensityMin + 0.05, 'feather band lost density variation');

// Determinism: repeated profile and acceptance answers must remain stable at representative points.
for (const point of [core, neck, outside, worldFromNormalized(0.39, 0.70), worldFromNormalized(0.50, 0.75)]) {
  assert.deepEqual(valyriaEcologyProfileAtWorldXZ(point.x, point.z), valyriaEcologyProfileAtWorldXZ(point.x, point.z));
  assert.equal(isOrdinaryEcologyAllowedAtWorldXZ(point.x, point.z), isOrdinaryEcologyAllowedAtWorldXZ(point.x, point.z));
}

console.log('[checkValyriaBarrenEcology] PASS');
console.log(JSON.stringify({
  ecologyPolicyId: E.id,
  geologyPolicyId: P.id,
  configuredTransitionStart,
  hardBarrenGridSamples: hardBarren,
  outerWorldGridSamples: outerWorld,
  transitionSamples,
  transitionAllowed,
  transitionRejected,
  transitionDensityRange: [transitionDensityMin, transitionDensityMax],
  canonicalDelegationCalls: canonicalCalls,
  corePlacementHeight,
  outsidePlacementHeight,
}, null, 2));
