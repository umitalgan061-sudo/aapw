import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV66, validateEnvironmentRuntimeV66 } from '../src/3d/world/environmentRuntimeIntegrationV66.js';
import { buildGroundMaterialResponseV66 } from '../src/3d/world/environmentRuntimeGroundResponseV66.js';
import { buildShelterFieldV66 } from '../src/3d/world/environmentRuntimeShelterV66.js';
import { buildVisibilityFieldV66 } from '../src/3d/world/environmentRuntimeVisibilityV66.js';
import { buildWeatherCouplingScenariosV66, deriveWeatherCouplingV66 } from '../src/3d/world/environmentRuntimeWeatherCouplingV66.js';

const base = (overrides = {}) => ({ x: 100, z: 140, elevation: 520, slope: 12, moisture: .62, rainfall: .24, soilDepth: .66, vegetationCover: .72, rockExposure: .14, waterDistance: 78, waterDepth: 0, roadDistance: 96, settlementDistance: 240, confidence: .94, biome: 'forest', ...overrides });
const weather = { precipitation: .34, humidity: .7, wind: .28, cloud: .4, temperature: .34 };
const environments = [
  { id: 'forest-clear', samples: [base(), base({ x: 180, biome: 'grassland', vegetationCover: .5 })], weather: { ...weather, precipitation: .04, cloud: .08 }, season: 'summer', time: 11 },
  { id: 'wetland-storm', samples: [base({ biome: 'wetland', waterDistance: 5, moisture: .9 }), base({ x: 200, biome: 'riverine', waterDistance: 9, moisture: .82 })], weather: { ...weather, precipitation: .9, humidity: .96, wind: .72, cloud: .88 }, season: 'autumn', time: 17 },
  { id: 'alpine-snow', samples: [base({ biome: 'alpine', elevation: 1900, slope: 38, snow: .8, vegetationCover: .16, rockExposure: .7 }), base({ x: 190, elevation: 1750, slope: 31, snow: .65, rockExposure: .58, biome: 'tundra' })], weather: { ...weather, precipitation: .38, humidity: .82, temperature: .12, wind: .58, cloud: .72 }, season: 'winter', time: 8 },
  { id: 'dry-steppe', samples: [base({ biome: 'steppe', moisture: .18, vegetationCover: .25, waterDistance: 180 }), base({ x: 190, biome: 'grassland', moisture: .24, vegetationCover: .3 })], weather: { ...weather, precipitation: .03, humidity: .14, temperature: .86, cloud: .05 }, season: 'summer', time: 15 },
  { id: 'coastal-wind', samples: [base({ biome: 'coastal', waterDistance: 4, wind: .78, vegetationCover: .38 }), base({ x: 200, biome: 'coastal', waterDistance: 14, wind: .7 })], weather: { ...weather, precipitation: .2, humidity: .84, wind: .82, cloud: .56 }, season: 'spring', time: 14 },
];

for (const scenario of environments) {
  const runtime = buildEnvironmentRuntimeV66({ samples: scenario.samples, weather: scenario.weather, season: scenario.season, time: scenario.time, dayOfYear: scenario.season === 'winter' ? 35 : 190, camera: { distance: 1500, mode: 'walk' }, platform: 'desktop' });
  const result = validateEnvironmentRuntimeV66(runtime);
  assert.equal(result.ok, true, `${scenario.id}:${result.errors.join(',')}`);
  assert.equal(runtime.contract.noWorldMutation, true);
  assert.ok(runtime.audit.p0Pass);
  assert.ok(runtime.eventsRuntime.events.length <= 48);
  assert.match(runtime.digest, /^[0-9a-f]{8}$/);
}

const dense = Array.from({ length: 24 }, (_, i) => base({ x: i * 16, z: (i % 4) * 22, biome: ['forest', 'wetland', 'grassland', 'alpine'][i % 4], slope: (i * 5) % 46, moisture: (i % 10) / 10, vegetationCover: .2 + (i % 8) / 10, waterDistance: 6 + (i % 20) * 13 }));
const denseRuntime = buildEnvironmentRuntimeV66({ samples: dense, weather, season: 'autumn', dayOfYear: 274, time: 19, camera: { distance: 2100 }, platform: 'mobile' });
assert.equal(validateEnvironmentRuntimeV66(denseRuntime).ok, true);
assert.equal(denseRuntime.navigation.field.length, dense.length);
assert.equal(denseRuntime.ecology.layers.length, dense.length);

const ground = buildGroundMaterialResponseV66(base({ slope: 44, rockExposure: .72, snow: .52 }), { precipitation: .5, humidity: .84, temperature: .18 }, { distance: 320 });
assert.ok(ground.triplanarEquivalent);
assert.ok(ground.pbr.normalStrength === undefined || ground.pbr.normalStrength >= 0);

const shelters = buildShelterFieldV66({ samples: dense.slice(0, 12), weather });
assert.equal(shelters.length, 12);
assert.ok(shelters.every((item) => item.score >= 0 && item.score <= 1));

const visibility = buildVisibilityFieldV66({ samples: dense.slice(0, 12), weather: { precipitation: .7, fog: .68 } });
assert.equal(visibility.length, 12);
assert.ok(visibility.every((item) => item.visibility >= 0 && item.visibility <= 1));

for (const scenario of buildWeatherCouplingScenariosV66()) {
  const coupling = deriveWeatherCouplingV66(scenario.weather, { wetness: scenario.weather.humidity }, { bankPressure: scenario.weather.precipitation * .4 }, { meanForage: .48, meanCover: .58 });
  assert.ok(coupling.flood >= 0 && coupling.flood <= 1);
  assert.ok(coupling.green >= 0 && coupling.green <= 1);
}

const replayInput = environments[1];
const first = buildEnvironmentRuntimeV66({ ...replayInput, samples: replayInput.samples, camera: { distance: 1100 }, platform: 'desktop' });
const second = buildEnvironmentRuntimeV66({ ...replayInput, samples: replayInput.samples, camera: { distance: 1100 }, platform: 'desktop' });
assert.deepEqual(first, second);
console.log(JSON.stringify({ ok: true, suite: 'v66-acceptance', scenarios: environments.length, denseSamples: dense.length }));
