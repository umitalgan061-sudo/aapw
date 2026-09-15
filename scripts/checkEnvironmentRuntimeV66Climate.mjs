import assert from 'node:assert/strict';
import { buildDailyWeatherEnvelopeV66, buildSnowlineV66, buildClimateBiomeModifierV66, classifyClimatePhaseV66, validateClimateRuntimeV66 } from '../src/3d/world/environmentRuntimeClimateV66.js';

const phases = [
  { dayOfYear: 25, baselineTemperature: 0.38, baselineMoisture: 0.68, elevation: 1200, latitude: 41, biome: 'taiga' },
  { dayOfYear: 105, baselineTemperature: 0.48, baselineMoisture: 0.62, elevation: 700, latitude: 41, biome: 'forest' },
  { dayOfYear: 190, baselineTemperature: 0.6, baselineMoisture: 0.54, elevation: 420, latitude: 41, biome: 'grassland' },
  { dayOfYear: 300, baselineTemperature: 0.5, baselineMoisture: 0.66, elevation: 950, latitude: 41, biome: 'forest' },
];

for (const input of phases) {
  const phase = classifyClimatePhaseV66(input);
  assert.ok(['winter', 'spring', 'summer', 'autumn', 'shoulder'].includes(phase));
  const snow = buildSnowlineV66(input);
  assert.ok(snow.elevation >= 250);
  const modifier = buildClimateBiomeModifierV66(input);
  assert.ok(modifier.canopy >= 0 && modifier.grass >= 0 && modifier.moss >= 0);
}

const envelope = buildDailyWeatherEnvelopeV66({ input: phases[0], forecast: 14, seed: 66 });
assert.equal(validateClimateRuntimeV66(envelope).ok, true);
assert.equal(envelope.entries.length, 15);
assert.ok(envelope.entries.every((entry) => entry.day >= 1 && entry.day <= 365));
assert.ok(envelope.entries.every((entry) => entry.daylight >= 0 && entry.daylight <= 1));

const repeated = buildDailyWeatherEnvelopeV66({ input: phases[0], forecast: 14, seed: 66 });
assert.deepEqual(envelope, repeated);
console.log(JSON.stringify({ ok: true, suite: 'v66-climate', days: envelope.entries.length }));
