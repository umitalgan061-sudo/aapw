#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import {
  VEGETATION_NORTH_CLIMATE_POLICY,
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
  'canonical lands-always-winter species resolver must remain snow pine even though ecological scatter rejects its ice core');
assert.equal(sameLatitudeEast, 'round',
  'same-latitude eastern reference space must retain temperate species instead of false snow pine');
assert.equal(sameLatitudeFarEast, 'round',
  'far-east same-latitude space must remain outside Westeros winter species ownership');
assert.equal(canonicalNorthLowRoll, 'snow-pine',
  'canonical North tundra must retain a deterministic snow-pine share');
assert.equal(canonicalNorthHighRoll, 'pine',
  'canonical North tundra must suppress broadleaf while allowing dark pine above snow chance');
assert.equal(temperateSouth, 'round',
  'temperate south must preserve the historic weighted picker');
assert.equal(vegetationSpeciesId(pickSpeciesIndex(0.95)), 'round',
  'temperate picker distribution must remain unchanged');

assert.equal(VEGETATION_NORTH_CLIMATE_POLICY.climateAuthority, 'northReferenceCryosphereAtWorldXZ',
  'live winter species policy must identify the canonical X+Z cryosphere authority');

const source = fs.readFileSync(new URL('../src/3d/world/vegetation.js', import.meta.url), 'utf8');
assert(source.includes('vegetationEcologicalSuitabilityAtWorldXZ(x, z'),
  'live scatter must evaluate the canonical X+Z ecological/climate field before species selection');
const climateReuseCalls = source.match(/pickSpeciesIndexForClimate\((?:rng|clusterRng)\(\), ecology\.climate\)/g) ?? [];
assert.equal(climateReuseCalls.length, 2,
  'base and seat-cluster scatter must reuse the same map-aligned climate sample used by ecological acceptance');
assert(source.includes('mapAligned: true'),
  'runtime vegetation telemetry must expose map-aligned climate ownership');

console.log('[checkMapAlignedSnowPineClimate] PASS', JSON.stringify({
  policy: VEGETATION_NORTH_CLIMATE_POLICY.id,
  alwaysWinter,
  sameLatitudeEast,
  sameLatitudeFarEast,
  canonicalNorthLowRoll,
  canonicalNorthHighRoll,
  temperateSouth,
  liveClimateReuseCalls: climateReuseCalls.length,
}));