import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV66 } from '../src/3d/world/environmentRuntimeIntegrationV66.js';
import { buildNavigationFieldV66 } from '../src/3d/world/environmentRuntimeNavigationV66.js';
import { buildDailyWeatherEnvelopeV66, buildClimateBiomeModifierV66 } from '../src/3d/world/environmentRuntimeClimateV66.js';
import { createV66VisualAcceptanceMatrix, auditEnvironmentV66 } from '../src/3d/world/environmentRuntimeV66Audit.js';

const biomes = ['forest', 'taiga', 'wetland', 'riverine', 'coastal', 'alpine', 'tundra', 'steppe', 'grassland', 'desert'];
const samples = Array.from({ length: 72 }, (_, i) => ({
  x: (i % 12) * 45,
  z: Math.floor(i / 12) * 45,
  elevation: (i % 10) * 190 + 120,
  slope: 3 + (i * 7) % 50,
  moisture: ((i * 13) % 100) / 100,
  rainfall: ((i * 17) % 100) / 100,
  soilDepth: 0.2 + ((i * 11) % 80) / 100,
  vegetationCover: ((i * 19) % 100) / 100,
  rockExposure: ((i * 23) % 70) / 100,
  waterDistance: 2 + (i % 24) * 20,
  waterDepth: i % 17 === 0 ? 0.5 : 0,
  roadDistance: 20 + (i % 15) * 30,
  settlementDistance: 70 + (i % 21) * 35,
  confidence: 0.55 + ((i * 3) % 44) / 100,
  biome: biomes[i % biomes.length],
}));

const runtime = buildEnvironmentRuntimeV66({ samples, weather: { precipitation: 0.58, humidity: 0.74, wind: 0.51, cloud: 0.62, temperature: 0.3 }, season: 'autumn', dayOfYear: 286, time: 17, camera: { distance: 2400, mode: 'walk' }, platform: 'desktop' });

assert.equal(runtime.contract.noWorldMutation, true);
assert.equal(runtime.deterministic, true);
assert.equal(runtime.navigation.field.length, samples.length);
assert.equal(runtime.ecology.layers.length, samples.length);
assert.ok(runtime.eventsRuntime.events.length <= 48);
assert.equal(auditEnvironmentV66(runtime).pass, true);

const navSprint = buildNavigationFieldV66({ samples, mode: 'sprint' });
assert.equal(navSprint.length, samples.length);
assert.ok(navSprint.some((item) => item.traversal.blocked));

const weather = buildDailyWeatherEnvelopeV66({ input: { dayOfYear: 350, latitude: 41, baselineTemperature: 0.4, baselineMoisture: 0.65, elevation: 1000, biome: 'taiga' }, forecast: 14, seed: 66 });
assert.equal(weather.entries.length, 15);
assert.ok(weather.entries.every((entry) => entry.precipitation >= 0 && entry.precipitation <= 1));

for (const biome of biomes) {
  const modifier = buildClimateBiomeModifierV66({ biome, dayOfYear: 180, baselineTemperature: 0.52, baselineMoisture: 0.55 });
  assert.ok(modifier.canopy >= 0);
  assert.ok(modifier.grass >= 0);
  assert.ok(modifier.moss >= 0);
}

const matrix = createV66VisualAcceptanceMatrix();
assert.equal(matrix.length, 6);
console.log(JSON.stringify({ ok: true, suite: 'v66-spatial-stress', samples: samples.length, eventCount: runtime.eventsRuntime.events.length, visualCases: matrix.length }));
