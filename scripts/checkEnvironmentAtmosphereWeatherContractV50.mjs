import assert from 'node:assert/strict';
import {
  createEnvironmentAtmosphereWeatherContract,
  applyEnvironmentAtmosphereWeatherContract,
  ENVIRONMENT_ATMOSPHERE_WEATHER_CONTRACT_V50,
} from '../src/3d/world/environmentAtmosphereWeatherContractV50.js';

const samples = [
  { id: 'center', position: { x: 0, y: 12, z: 0 }, elevation: 12, moisture: 0.55, snow: 0, waterDistance: 640, biome: 'temperate-forest', distance: 32, horizonOcclusion: 0.1, weather: { cloud: 0.42, precipitation: 0.12, wind: 0.38, temperatureC: 14 } },
  { id: 'northwest', position: { x: -120, y: 820, z: -90 }, elevation: 820, moisture: 0.72, snow: 0.9, waterDistance: 1800, biome: 'alpine', distance: 9800, horizonOcclusion: 0.36, weather: { cloud: 0.8, precipitation: 0.7, wind: 0.76, temperatureC: -6 } },
  { id: 'shore', position: { x: 240, y: 4, z: 50 }, elevation: 4, moisture: 0.86, snow: 0, waterDistance: 12, biome: 'wetland', distance: 460, horizonOcclusion: 0.08, weather: { cloud: 0.62, precipitation: 0.28, wind: 0.58, temperatureC: 11 } },
];

const first = createEnvironmentAtmosphereWeatherContract({ seed: 99, samples, framePressure: 0.2 });
const second = createEnvironmentAtmosphereWeatherContract({ seed: 99, samples, framePressure: 0.2 });
assert.deepEqual(first, second, 'contract output must be deterministic');
assert.equal(first.camera.width, 1536);
assert.equal(first.camera.height, 1024);
assert.equal(first.sky.cameraRelative, true);
assert.equal(first.sky.blackBackgroundGuard, true);
assert.equal(first.weather.class, 'snow');
assert.equal(first.audioZones.length, 3);
assert.ok(first.fog.density <= ENVIRONMENT_ATMOSPHERE_WEATHER_CONTRACT_V50.maxFogDensity);
assert.ok(first.weather.intensity <= ENVIRONMENT_ATMOSPHERE_WEATHER_CONTRACT_V50.maxWeatherIntensity);
assert.ok(Object.isFrozen(first));
assert.ok(Object.isFrozen(first.weather));
assert.ok(first.serialization.includes('risk') === false);

const malformed = createEnvironmentAtmosphereWeatherContract({
  seed: Number.NaN,
  samples: [{ id: null, distance: Infinity, moisture: Infinity, weather: { cloud: NaN, temperatureC: NaN } }],
  framePressure: Infinity,
});
assert.equal(malformed.seed, 1701);
assert.equal(malformed.samples[0].id, 'sample-0');
assert.ok(Number.isFinite(malformed.fog.density));
assert.ok(Number.isFinite(malformed.weather.intensity));
assert.equal(malformed.quality.detailTier, 'reduced');

const overLimit = createEnvironmentAtmosphereWeatherContract({ samples: Array.from({ length: 300 }, (_, index) => ({ id: `s-${index}` })) });
assert.equal(overLimit.samples.length, 256);
assert.equal(overLimit.summary.failClosed, true);

const target = {};
assert.equal(applyEnvironmentAtmosphereWeatherContract(target, first), true);
assert.equal(target.environmentAtmosphereWeather.digest, first.digest);
assert.equal(applyEnvironmentAtmosphereWeatherContract(null, first), false);

console.log(`ENVIRONMENT_ATMOSPHERE_WEATHER_CONTRACT_V50_OK digest=${first.digest} samples=${first.summary.sampleCount}`);
