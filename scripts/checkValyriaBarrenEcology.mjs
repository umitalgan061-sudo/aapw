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

// Exercise the whole falloff, not only the centre. The boundary should contain both banned and allowed
// points and the transition must be controlled by the shared geology influence threshold.
let banned = 0;
let allowed = 0;
let mismatches = 0;
for (let iy = 0; iy <= 64; iy += 1) {
  const ny = 0.60 + iy / 64 * 0.24;
  for (let ix = 0; ix <= 64; ix += 1) {
    const nx = 0.35 + ix / 64 * 0.20;
    const world = worldFromNormalized(nx, ny);
    const influence = valyriaInfluenceAtWorldXZ(world.x, world.z);
    const shouldAllow = influence < E.exclusionInfluence;
    const actualAllow = isOrdinaryEcologyAllowedAtWorldXZ(world.x, world.z);
    if (actualAllow) allowed += 1;
    else banned += 1;
    if (actualAllow !== shouldAllow) mismatches += 1;
  }
}
assert.equal(mismatches, 0, 'ecology boundary diverged from shared Valyria geology influence');
assert(banned > 100, `barren region unexpectedly tiny: ${banned}`);
assert(allowed > 1000, `falloff/outer region unexpectedly over-blocked: ${allowed}`);

// Determinism: repeated profile answers are structural equals at representative points.
for (const point of [core, neck, outside, worldFromNormalized(0.39, 0.70), worldFromNormalized(0.50, 0.75)]) {
  assert.deepEqual(valyriaEcologyProfileAtWorldXZ(point.x, point.z), valyriaEcologyProfileAtWorldXZ(point.x, point.z));
}

console.log('[checkValyriaBarrenEcology] PASS');
console.log(JSON.stringify({
  ecologyPolicyId: E.id,
  geologyPolicyId: P.id,
  bannedGridSamples: banned,
  allowedGridSamples: allowed,
  canonicalDelegationCalls: canonicalCalls,
  corePlacementHeight,
  outsidePlacementHeight,
}, null, 2));
