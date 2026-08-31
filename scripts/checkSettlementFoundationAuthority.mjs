#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CASTLE_MODEL_ASSIGNMENTS,
  KINGDOM_SEATS,
  computeSettlementFlattenPads,
} from '../src/3d/world/settlements.js';
import { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } from '../src/3d/config.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';
import { createGroundCollider } from '../src/3d/physics.js';

const source = readFileSync(new URL('../src/3d/world/settlements.js', import.meta.url), 'utf8');
const fallbackMatch = source.match(/const REAL_CASTLE_FOOTPRINT_METERS\s*=\s*([0-9.]+)/);
assert(fallbackMatch, 'settlement source must keep an explicit real-castle default footprint');
const realCastleFallbackFootprint = Number(fallbackMatch[1]);
assert(Number.isFinite(realCastleFallbackFootprint) && realCastleFallbackFootprint > 0);

const rawHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
const pads = computeSettlementFlattenPads({
  sampleHeightMeters: rawHeight,
  seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
  minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
  mapBounds: WORLD_SCALE.MAP_BOUNDS,
  metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
});
const renderedHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
const collider = createGroundCollider(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);

assert.equal(pads.length, KINGDOM_SEATS.length,
  'every kingdom seat must own one shared settlement flatten pad');
assert.equal(pads.length, 14, 'canonical kingdom-seat count must remain covered by foundations');

const proceduralRequiredRadius = Math.hypot(
  SETTLEMENT_CONFIG.TOWER_CORNER_OFFSET_METERS,
  SETTLEMENT_CONFIG.TOWER_CORNER_OFFSET_METERS,
) + SETTLEMENT_CONFIG.TOWER_RADIUS_BOTTOM_METERS;
const largestRealFootprint = Math.max(
  realCastleFallbackFootprint,
  ...CASTLE_MODEL_ASSIGNMENTS.map((assignment) => assignment.footprintMeters ?? realCastleFallbackFootprint),
);
const realRequiredCornerRadius = largestRealFootprint * Math.SQRT1_2;
const requiredFlatRadius = Math.max(proceduralRequiredRadius, realRequiredCornerRadius);

let minimumInnerRadius = Infinity;
let maximumAuthorityDelta = 0;
for (const pad of pads) {
  minimumInnerRadius = Math.min(minimumInnerRadius, pad.innerRadiusMeters);
  assert(pad.innerRadiusMeters >= requiredFlatRadius,
    `castle footprint must fit entirely inside the full-flat foundation; inner=${pad.innerRadiusMeters}, required=${requiredFlatRadius}`);
  assert(pad.outerRadiusMeters > pad.innerRadiusMeters,
    'settlement foundation must retain a non-zero natural-terrain feather');
  assert(Number.isFinite(pad.anchorHeightMeters), 'settlement foundation anchor must be finite');

  const sampleRadius = Math.min(requiredFlatRadius, pad.innerRadiusMeters - 0.01);
  const probes = [
    [0, 0],
    [sampleRadius, 0], [-sampleRadius, 0], [0, sampleRadius], [0, -sampleRadius],
    [sampleRadius * Math.SQRT1_2, sampleRadius * Math.SQRT1_2],
    [-sampleRadius * Math.SQRT1_2, sampleRadius * Math.SQRT1_2],
    [sampleRadius * Math.SQRT1_2, -sampleRadius * Math.SQRT1_2],
    [-sampleRadius * Math.SQRT1_2, -sampleRadius * Math.SQRT1_2],
  ];

  for (const [dx, dz] of probes) {
    const x = pad.x + dx;
    const z = pad.z + dz;
    const renderY = renderedHeight(x, z);
    const colliderY = collider.getGroundHeight(x, z);
    const authorityDelta = Math.abs(renderY - colliderY);
    maximumAuthorityDelta = Math.max(maximumAuthorityDelta, authorityDelta);
    assert(authorityDelta < 1e-9,
      `render terrain and ground collider must consume the same settlement pad authority; delta=${authorityDelta}`);
    assert(Math.abs(renderY - pad.anchorHeightMeters) < 1e-6,
      `complete castle footprint must sit on the authored flat anchor; delta=${Math.abs(renderY - pad.anchorHeightMeters)}`);
  }
}

assert(minimumInnerRadius > proceduralRequiredRadius,
  'full-flat settlement pad must clear procedural corner tower outer edges');
assert(minimumInnerRadius > realRequiredCornerRadius,
  'full-flat settlement pad must clear the largest rotated real-castle square footprint');

console.log(JSON.stringify({
  seatCount: pads.length,
  realCastleFallbackFootprint,
  largestRealFootprint,
  proceduralRequiredRadius,
  realRequiredCornerRadius,
  minimumInnerRadius,
  maximumAuthorityDelta,
  renderPhysicsAuthorityShared: true,
  fullFootprintFlat: true,
}, null, 2));
