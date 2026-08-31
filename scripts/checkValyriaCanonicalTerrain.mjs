#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../src/3d/config.js';
import {
  CURRENT_TERRAIN_POLICY,
  createHeightSampler,
} from '../src/3d/world/terrain.js';
import {
  VALYRIA_GEOLOGY_POLICY,
  valyriaCanonicalDryGate01,
  valyriaInfluence01,
} from '../src/3d/world/valyriaGeology.js';

const P = VALYRIA_GEOLOGY_POLICY;
const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);

assert.equal(CURRENT_TERRAIN_POLICY.valyriaGeologyPolicyId, P.id);
assert.equal(CURRENT_TERRAIN_POLICY.canonicalWaterClassificationPreserved, true);
assert.equal(CURRENT_TERRAIN_POLICY.mapDerivedHeight, true);
assert(CURRENT_TERRAIN_POLICY.id.includes('valyria-geology'));

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

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length);
}

const influenced = [];
const dryUplifts = [];
const dryHeights = [];
const wetSamples = [];
const transitionSamples = [];
let deterministicChecks = 0;
let outsideChecks = 0;

// Walk beyond the exact ellipse bounds so this test proves both the inside and outside paths. The grid
// is intentionally denser than the 96x64 owner surface classification; it exercises interpolation and
// shoreline transition samples rather than only cell centres.
for (let iy = 0; iy <= 56; iy += 1) {
  const ny = 0.60 + (iy / 56) * 0.24;
  for (let ix = 0; ix <= 56; ix += 1) {
    const nx = 0.35 + (ix / 56) * 0.20;
    const influence = valyriaInfluence01(nx, ny);
    const world = worldFromNormalized(nx, ny);
    const surface = { rockWeight: 0, snowWeight: 0, waterWeight: 0, valyriaUpliftMeters: 0 };
    const h = sampleHeightMeters(world.x, world.z, 24, surface);
    const repeatSurface = { rockWeight: 0, snowWeight: 0, waterWeight: 0, valyriaUpliftMeters: 0 };
    const repeat = sampleHeightMeters(world.x, world.z, 24, repeatSurface);

    assert.equal(repeat, h, 'canonical Valyria height lost determinism');
    assert.equal(repeatSurface.waterWeight, surface.waterWeight, 'surface waterWeight lost determinism');
    assert.equal(repeatSurface.valyriaUpliftMeters, surface.valyriaUpliftMeters, 'Valyria uplift telemetry lost determinism');
    deterministicChecks += 1;

    if (influence <= 0) {
      assert.equal(surface.valyriaUpliftMeters, 0, 'outside-Valyria point received volcanic uplift');
      outsideChecks += 1;
      continue;
    }

    influenced.push({ nx, ny, h, influence, ...surface });
    const dryGate = valyriaCanonicalDryGate01(surface.waterWeight, Math.max(0, h - sea));

    if (surface.waterWeight >= P.canonicalDryWaterWeightZeroAtOrAbove) {
      assert.equal(surface.valyriaUpliftMeters, 0, `wet owner-map sample received volcanic uplift at ${nx},${ny}`);
      wetSamples.push({ nx, ny, h, waterWeight: surface.waterWeight });
      continue;
    }

    if (surface.waterWeight > P.canonicalDryWaterWeightFullAtOrBelow) {
      assert(dryGate >= 0 && dryGate < 1, 'shore transition dry gate escaped [0,1)');
      transitionSamples.push({ nx, ny, uplift: surface.valyriaUpliftMeters, waterWeight: surface.waterWeight });
    }

    if (surface.waterWeight <= P.canonicalDryWaterWeightFullAtOrBelow && surface.valyriaUpliftMeters > 1) {
      dryUplifts.push(surface.valyriaUpliftMeters);
      dryHeights.push(h - sea);
    }
  }
}

assert(influenced.length > 180, `too few Valyria samples: ${influenced.length}`);
assert(wetSamples.length > 10, `test did not exercise enough Smoking Sea samples: ${wetSamples.length}`);
assert(dryUplifts.length > 8, `test did not find enough dry volcanic samples: ${dryUplifts.length}`);
assert(outsideChecks > 200, `outside authority path under-sampled: ${outsideChecks}`);
assert(deterministicChecks > 2500, `determinism grid unexpectedly small: ${deterministicChecks}`);

const maxUplift = Math.max(...dryUplifts);
const meanUplift = mean(dryUplifts);
const heightSd = standardDeviation(dryHeights);
assert(maxUplift > 80, `Valyria canonical uplift too weak: ${maxUplift.toFixed(2)}m`);
assert(maxUplift <= P.upliftMeters + P.faultAmplitudeMeters + 1e-9, `Valyria uplift exceeded bounded envelope: ${maxUplift}`);
assert(meanUplift > 18, `Valyria mean dry uplift too weak: ${meanUplift.toFixed(2)}m`);
assert(heightSd > 12, `Valyria dry terrain became too uniform: sd=${heightSd.toFixed(2)}m`);

// Core radial variation guards the especially artificial failure mode where canonical integration
// accidentally turns the whole province into one mathematically perfect cone.
const radialHeights = [];
for (let i = 0; i < 36; i += 1) {
  const angle = i / 36 * Math.PI * 2;
  const nx = P.coreCenter.nx + Math.cos(angle) * P.coreRadius.nx * 0.54;
  const ny = P.coreCenter.ny + Math.sin(angle) * P.coreRadius.ny * 0.54;
  const world = worldFromNormalized(nx, ny);
  const surface = {};
  const h = sampleHeightMeters(world.x, world.z, 24, surface);
  if ((surface.waterWeight ?? 1) <= P.canonicalDryWaterWeightFullAtOrBelow) radialHeights.push(h);
}
assert(radialHeights.length >= 6, `not enough dry equal-radius terrain samples: ${radialHeights.length}`);
const radialRange = Math.max(...radialHeights) - Math.min(...radialHeights);
assert(radialRange > 14, `canonical Valyria became an artificial radial cone: range=${radialRange.toFixed(2)}m`);

console.log('[checkValyriaCanonicalTerrain] PASS');
console.log(JSON.stringify({
  terrainPolicyId: CURRENT_TERRAIN_POLICY.id,
  geologyPolicyId: P.id,
  influencedSamples: influenced.length,
  wetSamples: wetSamples.length,
  transitionSamples: transitionSamples.length,
  dryUpliftSamples: dryUplifts.length,
  maxDryUpliftMeters: Number(maxUplift.toFixed(3)),
  meanDryUpliftMeters: Number(meanUplift.toFixed(3)),
  dryHeightStdDevMeters: Number(heightSd.toFixed(3)),
  equalRadiusHeightRangeMeters: Number(radialRange.toFixed(3)),
  deterministicChecks,
  outsideChecks,
}, null, 2));
