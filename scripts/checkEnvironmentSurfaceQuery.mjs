import assert from 'node:assert/strict';
import {
  queryEnvironmentSurface,
  serializeEnvironmentSurfaceQuery,
  ENVIRONMENT_SURFACE_QUERY_VERSION,
} from '../src/3d/world/environmentSurfaceQuery.js';

const base = {
  worldX: 120.25,
  worldZ: -44.5,
  height: 86,
  slope: 0.68,
  moisture: 0.62,
  temperature: 0.18,
  waterDistance: 7,
  waterConfidence: 0.45,
  roadDistance: 64,
  settlementDistance: 180,
  biome: 'alpine',
  seed: 20260908,
};

const a = queryEnvironmentSurface(base);
const b = queryEnvironmentSurface(base);
assert.equal(a.version, ENVIRONMENT_SURFACE_QUERY_VERSION);
assert.equal(JSON.stringify(a), JSON.stringify(b), 'query must be deterministic');
assert.equal(a.canonicalMutation, false);
assert.equal(a.placement.mustStayGrounded, true);
assert.equal(a.waterBodyClass, 'shore');
assert.ok(a.materialWeights.wetEdge > 0);
assert.ok(a.breakup.antiTiling >= 0.65 && a.breakup.antiTiling <= 1);
assert.ok(a.placement.vegetationAllowance > 0);

const alpine = queryEnvironmentSurface({ ...base, slope: 0.97, temperature: 0.02, height: 140, waterDistance: 240, waterConfidence: 0 });
assert.ok(alpine.materialWeights.rock > a.materialWeights.rock);
assert.ok(alpine.materialWeights.scree > 0);
assert.ok(alpine.materialWeights.snow > 0);
assert.equal(alpine.placement.rejectIfSteep, true);

const water = queryEnvironmentSurface({ ...base, waterDistance: 0, waterConfidence: 1, roadDistance: 0, settlementDistance: 0 });
assert.equal(water.waterBodyClass, 'water');
assert.equal(water.placement.rejectIfWater, true);
assert.equal(water.placement.vegetationAllowance, 0);

const malformed = queryEnvironmentSurface({ slope: 'bad', height: NaN, waterDistance: null, biome: '' });
for (const value of Object.values(malformed.materialWeights)) assert.ok(Number.isFinite(value));
for (const value of Object.values(malformed.breakup)) assert.ok(Number.isFinite(value));
assert.equal(malformed.placement.mustStayGrounded, true);
assert.equal(serializeEnvironmentSurfaceQuery(base), serializeEnvironmentSurfaceQuery(base));

console.log('Environment surface query contract PASS');
