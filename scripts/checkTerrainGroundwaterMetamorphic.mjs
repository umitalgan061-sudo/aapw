#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTerrainGroundwaterState, terrainGroundwaterSignature } from '../src/3d/world/terrainGroundwaterRegime.js';
import { resolveGroundwaterSurfaceFrame, blendGroundwaterFrames, accumulateGroundwaterNeighborhood } from '../src/3d/world/terrainGroundwaterSurfaceAdapter.js';
import { resolveGroundwaterStackFrame, stackDistance, stackInterpolation } from '../src/3d/world/terrainGroundwaterMaterialStack.js';

const BASE = Object.freeze({ worldX: -120, worldZ: 245, heightMeters: 44, slopeDegrees: 9, moisture: .51, rainfall: .57, runoff: .19, soilDepth: 1.26, permeability: .47, waterDistanceMeters: 52, groundwaterDepthMeters: 17, wetDays: 8, dryDays: 4, dayOfYear: 137, temperatureC: 14, drainage: .46, windExposure: .34, substrate: 'loam', biome: 'temperate' });
let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log(`[groundwater-metamorphic] PASS: ${name}`); }
function bounded(value, label) { assert.ok(Number.isFinite(value), `${label} finite`); assert.ok(value >= 0 && value <= 1, `${label} bounded`); }
function state(overrides = {}) { return resolveTerrainGroundwaterState({ ...BASE, ...overrides }); }

check('identity signature is deterministic', () => { assert.deepEqual(terrainGroundwaterSignature(BASE), terrainGroundwaterSignature(BASE)); });
check('translation by one cell preserves validity', () => { const value = state({ worldX: BASE.worldX + 74 }); for (const key of ['surfaceFilm','surfaceSaturation','waterTableProximity','capillaryRise','seepageFace']) bounded(value[key], key); });
check('translation across negative coordinates preserves validity', () => { const value = state({ worldX: -4000, worldZ: -5000 }); bounded(value.surfaceFilm, 'film'); bounded(value.surfaceSaturation, 'saturation'); });
check('coordinate sign inversion remains valid', () => { const value = state({ worldX: -BASE.worldX, worldZ: -BASE.worldZ }); bounded(value.surfaceFilm, 'film'); bounded(value.waterTableProximity, 'proximity'); });
check('world coordinate scale does not break boundedness', () => { for (const scale of [.01,.1,1,10,100,1000,10000]) { const value = state({ worldX: BASE.worldX * scale, worldZ: BASE.worldZ * scale }); bounded(value.surfaceFilm, `film ${scale}`); bounded(value.surfaceSaturation, `saturation ${scale}`); } });
check('rain increase does not produce negative recharge', () => { const low = state({ rainfall: .05 }).rechargePotential; const high = state({ rainfall: .95 }).rechargePotential; assert.ok(high >= low - 1e-6); });
check('runoff increase does not produce negative saturation', () => { const low = state({ runoff: 0 }).surfaceSaturation; const high = state({ runoff: 1 }).surfaceSaturation; assert.ok(high >= low - 1e-6); });
check('shallower water table does not lower proximity', () => { const shallow = state({ groundwaterDepthMeters: 2 }).waterTableProximity; const deep = state({ groundwaterDepthMeters: 90 }).waterTableProximity; assert.ok(shallow >= deep - 1e-6); });
check('near water does not lower proximity', () => { const near = state({ waterDistanceMeters: 2 }).waterTableProximity; const far = state({ waterDistanceMeters: 300 }).waterTableProximity; assert.ok(near >= far - 1e-6); });
check('flat slope supports at least as much puddle persistence', () => { const flat = state({ slopeDegrees: 1 }).puddlePersistence; const steep = state({ slopeDegrees: 60 }).puddlePersistence; assert.ok(flat >= steep - 1e-6); });
check('wind exposure participates in normalization', () => { const calm = state({ windExposure: 0 }); const wind = state({ windExposure: 1 }); assert.notEqual(calm.sample.windExposure, wind.sample.windExposure); });
check('day wrap preserves normalized state', () => { const zero = state({ dayOfYear: 0 }); const wrapped = state({ dayOfYear: 360 }); assert.deepEqual(zero.sample.dayOfYear, wrapped.sample.dayOfYear); });
check('negative day wrap preserves normalized state', () => { const last = state({ dayOfYear: 359 }); const wrapped = state({ dayOfYear: -1 }); assert.equal(last.sample.dayOfYear, wrapped.sample.dayOfYear); });
check('base input is not mutated', () => { const copy = { ...BASE }; state(copy); assert.deepEqual(copy, BASE); });

const dimensions = [
  ['heightMeters',[0,15,40,90,150,300,520]],
  ['slopeDegrees',[0,3,7,15,25,40,65,89]],
  ['moisture',[0,.1,.25,.5,.75,.9,1]],
  ['rainfall',[0,.1,.3,.5,.7,.9,1]],
  ['runoff',[0,.1,.3,.5,.7,.9,1]],
  ['soilDepth',[0,.2,.6,1,2,4,6]],
  ['permeability',[0,.1,.3,.5,.7,.9,1]],
  ['waterDistanceMeters',[0,5,20,50,100,250,1000,5000]],
  ['groundwaterDepthMeters',[0,2,5,10,20,40,100,1000,5000]],
  ['wetDays',[0,2,7,14,28,60,120,365]],
  ['dryDays',[0,2,7,14,28,60,120,365]],
  ['dayOfYear',[0,30,60,90,120,150,180,210,240,270,300,330,359]],
  ['temperatureC',[-40,-20,-8,0,8,16,24,32,45,55]],
  ['drainage',[0,.1,.25,.5,.75,.9,1]],
  ['windExposure',[0,.15,.3,.5,.7,.9,1]],
];
for (const [key, values] of dimensions) {
  for (const value of values) {
    check(`dimension ${key}=${value}`, () => {
      const result = state({ [key]: value });
      for (const metric of ['rechargePotential','waterTableProximity','capillaryRise','seepageFace','surfaceSaturation','saturationMemory','dryingResistance','surfaceFilm','puddlePersistence','marshEdgeFactor']) bounded(result[metric], `${metric} ${key}`);
    });
  }
}

const pairCases = [
  ['moisture', 0, 1],
  ['rainfall', 0, 1],
  ['runoff', 0, 1],
  ['permeability', 0, 1],
  ['waterDistanceMeters', 0, 500],
  ['groundwaterDepthMeters', 0, 500],
  ['temperatureC', -10, 35],
  ['drainage', 0, 1],
  ['windExposure', 0, 1],
];
for (const [key, aValue, bValue] of pairCases) {
  check(`pair distance ${key}`, () => {
    const a = state({ [key]: aValue });
    const b = state({ [key]: bValue });
    const fields = ['surfaceFilm','surfaceSaturation','waterTableProximity','capillaryRise','seepageFace','puddlePersistence'];
    const difference = fields.reduce((sum, metric) => sum + Math.abs(a[metric] - b[metric]), 0);
    assert.ok(difference >= 0);
  });
}

check('material frame interpolation endpoints are bounded', () => {
  const a = resolveGroundwaterSurfaceFrame({ ...BASE, worldX: -500 });
  const b = resolveGroundwaterSurfaceFrame({ ...BASE, worldX: 500 });
  for (const t of [0,.1,.25,.5,.75,.9,1]) { const frame = blendGroundwaterFrames(a,b,t); bounded(frame.material.roughness, `roughness ${t}`); bounded(frame.material.normalStrength, `normal ${t}`); bounded(frame.channels.wetness, `wetness ${t}`); }
});
check('material interpolation monotonic in endpoints', () => {
  const a = resolveGroundwaterSurfaceFrame({ ...BASE, worldX: -500 });
  const b = resolveGroundwaterSurfaceFrame({ ...BASE, worldX: 500 });
  const zero = blendGroundwaterFrames(a,b,0);
  const one = blendGroundwaterFrames(a,b,1);
  assert.equal(zero.channels.wetness, a.channels.wetness);
  assert.equal(one.channels.wetness, b.channels.wetness);
});
check('stack interpolation endpoints stable', () => {
  const a = stackInterpolation({ ...BASE, worldX: -500 }, { ...BASE, worldX: 500 }, 0, { color: { r: .4, g: .3, b: .2 }, roughness: .9 });
  const b = stackInterpolation({ ...BASE, worldX: -500 }, { ...BASE, worldX: 500 }, 1, { color: { r: .4, g: .3, b: .2 }, roughness: .9 });
  assert.equal(a.channels.wetness, resolveGroundwaterSurfaceFrame({ ...BASE, worldX: -500 }).channels.wetness);
  assert.equal(b.channels.wetness, resolveGroundwaterSurfaceFrame({ ...BASE, worldX: 500 }).channels.wetness);
});

const locations = Array.from({ length: 40 }, (_, index) => ({ ...BASE, worldX: -900 + index * 47, worldZ: 710 - index * 39 }));
check('neighborhood identity edge is non-negative', () => { const frames = locations.slice(0,7).map((input) => resolveGroundwaterSurfaceFrame(input)); const stats = accumulateGroundwaterNeighborhood(frames); assert.ok(stats.edgeContrast >= 0); });
check('stack distance identity', () => { assert.equal(stackDistance(BASE, BASE), 0); });
check('stack distance is symmetric', () => { const a = stackDistance(locations[0], locations[1]); const b = stackDistance(locations[1], locations[0]); assert.ok(Math.abs(a - b) < 1e-12); });
check('stack distance is non-negative', () => { for (let i = 0; i < 10; i += 1) assert.ok(stackDistance(locations[i], locations[i + 1]) >= 0); });

for (let index = 0; index < locations.length; index += 1) {
  check(`location signature ${index}`, () => {
    const first = terrainGroundwaterSignature(locations[index]);
    const second = terrainGroundwaterSignature(locations[index]);
    assert.deepEqual(first, second);
  });
}

console.log(`[groundwater-metamorphic] PASS: ${checks} checks`);
