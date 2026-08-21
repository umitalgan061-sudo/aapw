#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
  TERRAIN_BIOME_PALETTE,
  TERRAIN_BIOME_SHADING_POLICY,
  northClimateWeightsAtWorldZ,
  resolveTerrainBiomeColor,
} from '../src/3d/world/terrainBiomeShading.js';

function worldZForNormalizedMapY(normalizedY) {
  const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
  const mapY = normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
  return (mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
}

function sample({ normalizedY, height = 0.5, slope = 2, worldX = 480, rockWeight = 0, snowWeight = 0 }) {
  return resolveTerrainBiomeColor(new THREE.Color(), {
    heightAboveSeaMeters: height,
    slopeDegrees: slope,
    rockWeight,
    snowWeight,
    worldX,
    worldZ: worldZForNormalizedMapY(normalizedY),
  });
}

function distance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function rgbDelta(a, b) {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

function luminance(color) {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

function saturation(color) {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  return max === 0 ? 0 : (max - min) / max;
}

const P = TERRAIN_BIOME_SHADING_POLICY;
assert.equal(P.heightAuthorityUnchanged, true, 'shoreline treatment must stay render-only');
assert.match(P.id, /shoreline|climate|snowline/, 'terrain policy id should identify the geographic climate policy');

// 1) Latitude continuity: scan through permanent ice, transition, tundra and temperate coast with a
// much denser step than the general palette test. No single latitude sample may create a visible
// stripe or a sudden return of warm sand.
let previous = null;
let previousColdPreference = null;
let maxRgbStep = 0;
let maxPreferenceStep = 0;
let sawIce = false;
let sawTundraOnly = false;
let sawTemperate = false;
const latitudeSamples = [];

for (let i = 0; i <= 420; i += 1) {
  const normalizedY = 0.02 + i * 0.001;
  const color = sample({ normalizedY, height: 0.5, slope: 2, worldX: 480 });
  const climate = northClimateWeightsAtWorldZ(worldZForNormalizedMapY(normalizedY));
  const coldPreference = distance(color, TERRAIN_BIOME_PALETTE.SHORE_SAND)
    - distance(color, TERRAIN_BIOME_PALETTE.FROZEN_SHORE);

  if (climate.permanentIce > 0.05) sawIce = true;
  if (climate.permanentIce === 0 && climate.tundra > 0.05) sawTundraOnly = true;
  if (climate.permanentIce === 0 && climate.tundra === 0) sawTemperate = true;

  if (previous) {
    const step = rgbDelta(previous, color);
    maxRgbStep = Math.max(maxRgbStep, step);
    assert(step < 0.035,
      `frozen shoreline must not form a latitude colour seam; RGB step=${step} at y=${normalizedY.toFixed(3)}`);
  }
  if (previousColdPreference !== null) {
    const preferenceStep = Math.abs(coldPreference - previousColdPreference);
    maxPreferenceStep = Math.max(maxPreferenceStep, preferenceStep);
    assert(preferenceStep < 0.055,
      `cold/warm shoreline preference must change smoothly; step=${preferenceStep} at y=${normalizedY.toFixed(3)}`);
  }

  if (i % 35 === 0) {
    latitudeSamples.push({
      normalizedY: Number(normalizedY.toFixed(3)),
      permanentIce: Number(climate.permanentIce.toFixed(4)),
      tundra: Number(climate.tundra.toFixed(4)),
      color: color.getHexString(),
      coldPreference: Number(coldPreference.toFixed(4)),
    });
  }
  previous = color.clone();
  previousColdPreference = coldPreference;
}

assert(sawIce, 'latitude sweep must include permanent-ice coast');
assert(sawTundraOnly, 'latitude sweep must include tundra-only coast');
assert(sawTemperate, 'latitude sweep must reach temperate coast');

const farNorthShore = sample({ normalizedY: 0.06, height: 0.5, slope: 2 });
const tundraShore = sample({ normalizedY: 0.33, height: 0.5, slope: 2 });
const temperateShore = sample({ normalizedY: 0.55, height: 0.5, slope: 2 });
assert(distance(farNorthShore, TERRAIN_BIOME_PALETTE.GLACIAL_SHORE)
    < distance(farNorthShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'permanent-ice coast must stay glacial rather than sandy');
assert(distance(tundraShore, TERRAIN_BIOME_PALETTE.FROZEN_SHORE)
    < distance(tundraShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'tundra coast must stay closer to frozen shore than warm sand');
assert(distance(temperateShore, TERRAIN_BIOME_PALETTE.SHORE_SAND)
    < distance(temperateShore, TERRAIN_BIOME_PALETTE.FROZEN_SHORE),
  'temperate coast must preserve warm natural sand');

// 2) Elevation continuity around sea level. The coast is allowed to change perceptually at the actual
// waterline, but the frozen north must not create a one-vertex cyan/white ring. We sample both sides
// of sea level and the first 6 metres of land at centimetre-scale resolution.
for (const normalizedY of [0.06, 0.22, 0.33, 0.55]) {
  let previousElevation = null;
  let maxStep = 0;
  for (let i = 0; i <= 180; i += 1) {
    const height = -3 + i * 0.05;
    const color = sample({ normalizedY, height, slope: 2, worldX: 915 });
    if (previousElevation) {
      const step = rgbDelta(previousElevation, color);
      maxStep = Math.max(maxStep, step);
      // The canonical sea/land boundary may be sharper than climate transitions, so use a generous
      // bound that catches single-sample spikes without outlawing a legitimate shoreline edge.
      assert(step < 0.18,
        `shore elevation treatment must not spike; RGB step=${step} at y=${normalizedY}, h=${height.toFixed(2)}`);
    }
    previousElevation = color.clone();
  }
  assert(maxStep > 0.001, 'elevation sweep fixture must actually traverse a visible shoreline change');
}

// 3) Slope behaviour: a frozen coast may tint flat coves, but steep headlands must remain believable
// rock. This protects against painting vertical cliffs as smooth blue glacier simply because they are
// geographically north.
const flatNorth = sample({ normalizedY: 0.06, height: 0.8, slope: 2, worldX: 1320 });
const midSlopeNorth = sample({ normalizedY: 0.06, height: 0.8, slope: 26, worldX: 1320 });
const cliffNorth = sample({ normalizedY: 0.06, height: 0.8, slope: 58, worldX: 1320, rockWeight: 0.85 });
assert(distance(cliffNorth, TERRAIN_BIOME_PALETTE.ROCK_COOL)
    < distance(flatNorth, TERRAIN_BIOME_PALETTE.ROCK_COOL),
  'steep northern headland should move toward cool rock relative to a flat frozen cove');
assert(distance(cliffNorth, flatNorth) > 0.025,
  'flat frozen coast and steep rocky headland must not collapse to one colour');
assert(distance(midSlopeNorth, TERRAIN_BIOME_PALETTE.SHORE_SAND)
    > distance(temperateShore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
  'moderately sloped far-north coast must not reveal a warm sand ring');

// 4) Submerged shallows should cool progressively toward the north. The southern seabed remains the
// original map-derived green-grey; tundra and ice shallows become colder without a latitude seam.
const southSeabed = sample({ normalizedY: 0.55, height: -1.5, slope: 2, worldX: 370 });
const tundraSeabed = sample({ normalizedY: 0.33, height: -1.5, slope: 2, worldX: 370 });
const iceSeabed = sample({ normalizedY: 0.06, height: -1.5, slope: 2, worldX: 370 });
assert(distance(iceSeabed, TERRAIN_BIOME_PALETTE.NORTH_SEABED)
    < distance(southSeabed, TERRAIN_BIOME_PALETTE.NORTH_SEABED),
  'permanent-ice shallows should move toward NORTH_SEABED palette');
assert(distance(tundraSeabed, southSeabed) > 0.008,
  'tundra shallows should begin cooling before permanent ice');
assert(saturation(iceSeabed) < 0.55,
  'northern shallow water must stay restrained rather than becoming saturated cyan');

// 5) Spatial deterministic variation: same inputs must be byte-for-byte stable, while distant X
// samples may vary subtly through the existing terrain mottle. Variance must remain smaller than the
// climate signal, otherwise coastline geography would look noisy instead of frozen.
for (const normalizedY of [0.06, 0.22, 0.33]) {
  const first = sample({ normalizedY, height: 0.7, slope: 3, worldX: 744 });
  const repeat = sample({ normalizedY, height: 0.7, slope: 3, worldX: 744 });
  assert.equal(first.getHex(), repeat.getHex(), 'identical shoreline inputs must be deterministic');

  let minLuma = Infinity;
  let maxLuma = -Infinity;
  for (let x = -2400; x <= 2400; x += 160) {
    const color = sample({ normalizedY, height: 0.7, slope: 3, worldX: x });
    const luma = luminance(color);
    minLuma = Math.min(minLuma, luma);
    maxLuma = Math.max(maxLuma, luma);
  }
  assert(maxLuma - minLuma < 0.16,
    `coastal mottle must stay subordinate to climate signal; luma range=${maxLuma - minLuma}`);
}

// 6) Canonical authored snow/rock still wins. Coastal climate is a rendering supplement, not a new
// semantic authority that can erase Pindex snow or rock weights.
const authoredSnow = sample({ normalizedY: 0.33, height: 2.2, slope: 4, snowWeight: 1, worldX: 550 });
const authoredRock = sample({ normalizedY: 0.33, height: 2.2, slope: 52, rockWeight: 1, worldX: 550 });
assert(distance(authoredSnow, TERRAIN_BIOME_PALETTE.SNOW)
    < distance(tundraShore, TERRAIN_BIOME_PALETTE.SNOW),
  'canonical snow weight must remain visible above frozen-shore tint');
assert(distance(authoredRock, TERRAIN_BIOME_PALETTE.ROCK_COOL)
    < distance(tundraShore, TERRAIN_BIOME_PALETTE.ROCK_COOL),
  'canonical rock weight must remain visible on coastal cliffs');

for (const [label, color] of Object.entries({
  farNorthShore,
  tundraShore,
  temperateShore,
  flatNorth,
  midSlopeNorth,
  cliffNorth,
  southSeabed,
  tundraSeabed,
  iceSeabed,
  authoredSnow,
  authoredRock,
})) {
  assert(Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b), `${label} must be finite`);
  assert(color.r >= 0 && color.r <= 1 && color.g >= 0 && color.g <= 1 && color.b >= 0 && color.b <= 1,
    `${label} must remain inside linear RGB display bounds`);
}

console.log('[checkNorthCoastalShoreContinuity] PASS', JSON.stringify({
  policy: P.id,
  latitudeSamples: 421,
  maxRgbStep,
  maxPreferenceStep,
  farNorthShore: farNorthShore.getHexString(),
  tundraShore: tundraShore.getHexString(),
  temperateShore: temperateShore.getHexString(),
  cliffNorth: cliffNorth.getHexString(),
  iceSeabed: iceSeabed.getHexString(),
  sampleDiagnostics: latitudeSamples,
}));
