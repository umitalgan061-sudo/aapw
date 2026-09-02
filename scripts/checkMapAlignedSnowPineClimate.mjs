#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import {
  VEGETATION_NORTH_CLIMATE_POLICY,
  VEGETATION_SPATIAL_PATTERN_POLICY,
  pickSpeciesIndex,
  pickSpeciesIndexForWorldXZ,
  vegetationSpeciesId,
} from '../src/3d/world/vegetation.js';

function worldAt(x, y) {
  return normalizedReferenceToWorldXZ(
    x,
    y,
    WORLD_SCALE.MAP_BOUNDS,
    WORLD_SCALE.METERS_PER_MAP_UNIT,
  );
}

function speciesAt(roll, x, y) {
  const world = worldAt(x, y);
  return vegetationSpeciesId(pickSpeciesIndexForWorldXZ(roll, world.x, world.z));
}

const alwaysWinter = speciesAt(0.99, 0.145, 0.115);
const sameLatitudeEast = speciesAt(0.99, 0.60, 0.115);
const sameLatitudeFarEast = speciesAt(0.99, 0.85, 0.115);
const canonicalNorthLowRoll = speciesAt(0.10, 0.175, 0.285);
const canonicalNorthHighRoll = speciesAt(0.95, 0.175, 0.285);
const temperateSouth = speciesAt(0.95, 0.18, 0.55);

assert.equal(alwaysWinter, 'snow-pine',
  'canonical lands-always-winter must resolve to snow pine even for a high species roll');
assert.equal(sameLatitudeEast, 'round',
  'same-latitude eastern reference space must retain temperate species instead of false snow pine');
assert.equal(sameLatitudeFarEast, 'round',
  'far-east same-latitude space must remain outside Westeros winter species ownership');
assert.equal(canonicalNorthLowRoll, 'snow-pine',
  'canonical North tundra must retain a deterministic snow-pine share');
assert.equal(canonicalNorthHighRoll, 'pine',
  'canonical North tundra must suppress broadleaf while allowing dark pine above snow chance');
assert.equal(temperateSouth, 'round',
  'temperate direct climate picker must preserve the historic weighted fallback when no site habitat is supplied');
assert.equal(vegetationSpeciesId(pickSpeciesIndex(0.95)), 'round',
  'historic public temperate picker distribution must remain unchanged');

assert.equal(VEGETATION_NORTH_CLIMATE_POLICY.climateAuthority, 'northReferenceCryosphereAtWorldXZ',
  'live winter species policy must identify the canonical X+Z cryosphere authority');
assert.equal(VEGETATION_SPATIAL_PATTERN_POLICY.temperateSpeciesCompositionAuthority,
  'terrainBiomeShading.resolveTerrainForestSuitability',
  'temperate live scatter must identify the same visible terrain forest field as species-composition authority');

const source = fs.readFileSync(new URL('../src/3d/world/vegetation.js', import.meta.url), 'utf8');
assert(source.includes('pickSpeciesIndexForClimate(rng(), climate, habitat)'),
  'base live scatter must combine X+Z map climate with the already-resolved temperate habitat');
assert(source.includes('pickSpeciesIndexForClimate(clusterRng(), climate, habitat)'),
  'settlement woodland scatter must combine X+Z map climate with local terrain habitat');
assert(source.includes('const climate = northReferenceCryosphereAtWorldXZ(x, z)'),
  'live species composition must keep canonical X+Z cryosphere ownership');
assert(source.includes('mapAligned: true'),
  'runtime vegetation telemetry must expose map-aligned climate ownership');
assert(source.includes('temperateSpeciesCompositionAuthority'),
  'runtime telemetry must expose temperate habitat composition ownership');

console.log('[checkMapAlignedSnowPineClimate] PASS', JSON.stringify({
  policy: VEGETATION_NORTH_CLIMATE_POLICY.id,
  habitatPolicy: VEGETATION_SPATIAL_PATTERN_POLICY.id,
  alwaysWinter,
  sameLatitudeEast,
  sameLatitudeFarEast,
  canonicalNorthLowRoll,
  canonicalNorthHighRoll,
  temperateSouth,
}));