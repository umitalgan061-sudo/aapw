#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  TERRAIN_WIND_SNOW_POLICY,
  terrainWindExposureFromNeighbours,
} from '../src/3d/world/terrainWindSnowExposure.js';

const EPSILON = 1e-12;
const planar = terrainWindExposureFromNeighbours(94, 106, 94, 106, 10);
// Same first derivatives as `planar` (E-W=12, S-N=12), but the neighbour-pair sums diverge.
// This isolates second-order fold/saddle structure without changing slope or base aspect.
const folded = terrainWindExposureFromNeighbours(98, 110, 90, 102, 10);

assert.equal(TERRAIN_WIND_SNOW_POLICY.renderOnly, true);
assert.equal(TERRAIN_WIND_SNOW_POLICY.heightAuthorityUnchanged, true);
assert.equal(planar.orographicFoldStrength, 0,
  'planar mountain fixture must remain on baseline channeling');
assert(folded.orographicFoldStrength > 0.99,
  'folded fixture must reach the authored orographic fold response');
assert(Math.abs(planar.slopeDegrees - folded.slopeDegrees) < EPSILON,
  'fold fixture must preserve the same first-derivative slope');
assert(Math.abs(planar.aspectDot - folded.aspectDot) > 0.02,
  'folded relief must alter the effective wind/aspect relationship');
assert(folded.channelingWeight > planar.channelingWeight,
  'folded relief must bend prevailing flow more strongly than a planar face');
assert(folded.channelingWeight <= TERRAIN_WIND_SNOW_POLICY.channelingMaxBlend
  + TERRAIN_WIND_SNOW_POLICY.orographicFoldChannelingBoost + EPSILON,
  'fold channeling must remain inside the authored bounded ceiling');
assert(folded.windward >= planar.windward,
  'same-aspect folded ridge should retain or strengthen its exposed scour signal');
assert(folded.windward <= 1 && folded.lee <= 1,
  'fold exposure weights must remain normalized');

console.log('[checkTerrainWindSnowOrographicFold] PASS', JSON.stringify({
  policy: TERRAIN_WIND_SNOW_POLICY.id,
  planar: {
    slopeDegrees: planar.slopeDegrees,
    aspectDot: planar.aspectDot,
    foldStrength: planar.orographicFoldStrength,
    channelingWeight: planar.channelingWeight,
    windward: planar.windward,
  },
  folded: {
    slopeDegrees: folded.slopeDegrees,
    aspectDot: folded.aspectDot,
    foldGradient: folded.foldGradient,
    foldStrength: folded.orographicFoldStrength,
    channelingWeight: folded.channelingWeight,
    windward: folded.windward,
  },
}));
