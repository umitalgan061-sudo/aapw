import assert from 'node:assert/strict';
import { buildMicroErosionFieldV66 } from '../src/3d/world/environmentRuntimeErosionV66.js';
import { buildRiverCorridorV66 } from '../src/3d/world/environmentRuntimeWaterDynamicsV66.js';
import { buildWildlifeCorridorV66 } from '../src/3d/world/environmentRuntimeWildlifeV66.js';
import { buildEnvironmentRuntimeV66 } from '../src/3d/world/environmentRuntimeIntegrationV66.js';

const sample = (i) => ({ x: (i % 40) * 18, z: Math.floor(i / 40) * 18, elevation: 200 + (i % 9) * 70, slope: 4 + (i % 28), moisture: 0.35 + (i % 20) / 30, rainfall: 0.12 + (i % 8) / 20, soilDepth: 0.35 + (i % 5) / 10, vegetationCover: 0.35 + (i % 7) / 10, rockExposure: (i % 8) / 20, waterDistance: 15 + (i % 16) * 12, roadDistance: 40 + (i % 12) * 18, settlementDistance: 90 + (i % 18) * 28, confidence: 0.82 + (i % 10) / 50, biome: ['forest', 'grassland', 'wetland', 'taiga', 'alpine'][i % 5] });
const samples = Array.from({ length: 180 }, (_, i) => sample(i));
const weather = { precipitation: 0.36, humidity: 0.68, wind: 0.34, cloud: 0.46, temperature: 0.32 };

const start = Date.now();
const erosion = buildMicroErosionFieldV66({ samples, weather, seed: 66 });
const erosionMs = Date.now() - start;
const riverStart = Date.now();
const river = buildRiverCorridorV66({ samples: samples.slice(0, 80), weather, seed: 66 });
const riverMs = Date.now() - riverStart;
const wildlifeStart = Date.now();
const wildlife = buildWildlifeCorridorV66({ samples: samples.slice(0, 100), weather, time: 20, seed: 66 });
const wildlifeMs = Date.now() - wildlifeStart;
const runtimeStart = Date.now();
const runtime = buildEnvironmentRuntimeV66({ samples: samples.slice(0, 36), weather, season: 'autumn', dayOfYear: 270, time: 18, camera: { distance: 1600 }, platform: 'desktop' });
const runtimeMs = Date.now() - runtimeStart;

assert.equal(erosion.count, 180);
assert.equal(river.corridor.length, 80);
assert.ok(wildlife.corridors.length >= 0);
assert.match(runtime.digest, /^[0-9a-f]{8}$/);
assert.ok(erosionMs < 3000, `erosion-ms:${erosionMs}`);
assert.ok(riverMs < 2500, `river-ms:${riverMs}`);
assert.ok(wildlifeMs < 2500, `wildlife-ms:${wildlifeMs}`);
assert.ok(runtimeMs < 3000, `runtime-ms:${runtimeMs}`);

console.log(JSON.stringify({ ok: true, suite: 'v66-performance', samples: samples.length, timings: { erosionMs, riverMs, wildlifeMs, runtimeMs } }));
