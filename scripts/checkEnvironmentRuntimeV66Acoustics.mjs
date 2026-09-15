import assert from 'node:assert/strict';
import { buildAcousticFieldV66, buildWeatherAcousticsV66, classifyAcousticZoneV66, validateAcousticRuntimeV66 } from '../src/3d/world/environmentRuntimeAcousticsV66.js';

const samples = [
  { x: 0, z: 0, biome: 'forest', vegetationCover: 0.88, waterDistance: 110, enclosure: 0.72, wind: 0.18, settlementDistance: 300 },
  { x: 40, z: 0, biome: 'grassland', vegetationCover: 0.2, waterDistance: 80, enclosure: 0.12, wind: 0.44, settlementDistance: 260 },
  { x: 80, z: 0, biome: 'coastal', vegetationCover: 0.34, waterDistance: 4, enclosure: 0.08, wind: 0.76, settlementDistance: 180 },
  { x: 120, z: 0, biome: 'alpine', vegetationCover: 0.18, waterDistance: 150, enclosure: 0.64, wind: 0.58, settlementDistance: 420 },
];
const field = buildAcousticFieldV66({ samples, seed: 66 });
assert.equal(field.length, 4);
assert.ok(field.every((item) => item.reverb >= 0 && item.reverb <= 1));
assert.ok(field.some((item) => item.zone === 'shore'));
assert.equal(validateAcousticRuntimeV66({ policy: 'environment-runtime-acoustics-v66-2026-09-15', deterministic: true, field }).ok, true);
const shore = classifyAcousticZoneV66(samples[2]);
assert.ok(shore.water > 0.8);
assert.ok(shore.windBed > 0);
const weather = buildWeatherAcousticsV66({ precipitation: 0.9, humidity: 0.88, wind: 0.64 });
assert.ok(weather.rainGain > 0.5);
assert.ok(weather.dampening > 0.5);
const repeated = buildAcousticFieldV66({ samples, seed: 66 });
assert.deepEqual(field, repeated);
console.log(JSON.stringify({ ok: true, suite: 'v66-acoustics', zones: field.length }));
