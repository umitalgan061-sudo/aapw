import assert from 'node:assert/strict';
import { buildVisualSample, validateVisualSample, buildVisualSamplingManifest } from '../src/3d/world/terrainEnvironmentVisualSampling.js';

const snowLowSlope = buildVisualSample({
  worldX: 140, worldZ: -220, heightMeters: 260, heightAboveSeaMeters: 250,
  slopeDegrees: 8, rockWeight: .18, snowWeight: .72, waterWeight: 0,
  moisture: .42, biome: 'tundra', waterDepth: 0, concavityMeters: .1,
});
const snowSteep = buildVisualSample({
  worldX: 140, worldZ: -220, heightMeters: 310, heightAboveSeaMeters: 300,
  slopeDegrees: 48, rockWeight: .72, snowWeight: .75, waterWeight: 0,
  moisture: .28, biome: 'tundra', waterDepth: 0, concavityMeters: -.8,
});
const noSnow = buildVisualSample({
  worldX: 0, worldZ: 0, heightMeters: 24, heightAboveSeaMeters: 16,
  slopeDegrees: 6, rockWeight: .04, snowWeight: 0, waterWeight: .02,
  moisture: .68, biome: 'meadow', waterDepth: 0, concavityMeters: .3,
});

assert.ok(snowLowSlope.snowEdge > 0.55, `expected low-slope snow edge, got ${snowLowSlope.snowEdge}`);
assert.ok(snowSteep.snowEdge > 0.45, `expected steep terrain to retain snow edge, got ${snowSteep.snowEdge}`);
assert.ok(snowLowSlope.snowEdge > snowSteep.snowEdge, 'steep terrain should attenuate the exposed snow edge without deleting it');
assert.ok(snowSteep.snowShelf > 0.50, `expected highland snow shelf, got ${snowSteep.snowShelf}`);
assert.equal(noSnow.snowEdge, 0, 'zero snow input must remain zero');
assert.equal(noSnow.snowShelf, 0, 'zero snow input must remain zero');
assert.equal(validateVisualSample(snowSteep).ok, true);
assert.equal(validateVisualSample(noSnow).ok, true);

const manifest = buildVisualSamplingManifest([snowLowSlope, snowSteep, noSnow]);
assert.equal(manifest.acceptance.ok, true);
assert.equal(manifest.reports.length, 3);
console.log(JSON.stringify({
  ok: true,
  snowEdge: [snowLowSlope.snowEdge, snowSteep.snowEdge, noSnow.snowEdge],
  snowShelf: [snowLowSlope.snowShelf, snowSteep.snowShelf, noSnow.snowShelf],
}));
