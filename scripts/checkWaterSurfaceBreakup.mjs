import assert from 'node:assert/strict';
import { sampleWaterSurfaceBreakup, validateWaterSurfaceBreakup } from '../src/3d/world/waterSurfaceBreakup.js';

const context = { x: 1280.25, z: -744.5, depthMeters: 3.2, shoreDistanceMeters: 1.5, foamMeters: 6, cameraDistanceMeters: 90, seed: 20260908 };
const a = sampleWaterSurfaceBreakup(context);
const b = sampleWaterSurfaceBreakup(context);
assert.deepEqual(a, b, 'water breakup must be deterministic');
assert(validateWaterSurfaceBreakup(a), 'valid sample must pass');
assert.equal(a.tileRisk, 0, 'surface contract must not expose tile risk');
assert(a.shallowWeight > 0 && a.deepWeight > 0, 'mixed depth should blend shallow/deep');
assert(a.foamWeight > 0, 'near shoreline should expose foam response');
assert(a.normalStrength > 0 && a.normalStrength < 1, 'normal response must remain bounded');

const near = sampleWaterSurfaceBreakup({ ...context, cameraDistanceMeters: 10 });
const far = sampleWaterSurfaceBreakup({ ...context, cameraDistanceMeters: 4000 });
assert(near.normalStrength > far.normalStrength, 'distance fade must suppress distant micro-normal energy');

const malformed = sampleWaterSurfaceBreakup({ x: Number.NaN, z: Infinity, depthMeters: Number.NaN, shoreDistanceMeters: Number.NaN });
assert(validateWaterSurfaceBreakup(malformed), 'malformed inputs must fail closed to finite bounded output');
assert.equal(malformed.tileRisk, 0);

const neighbour = sampleWaterSurfaceBreakup({ ...context, x: context.x + 0.01 });
assert(Math.abs(neighbour.breakup - a.breakup) < 0.2, 'world-space breakup must remain continuous for nearby samples');
console.log('WATER_SURFACE_BREAKUP_OK', JSON.stringify({ checksum: JSON.stringify(a), farNormal: far.normalStrength }));
