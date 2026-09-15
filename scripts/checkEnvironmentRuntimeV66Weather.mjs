import assert from 'node:assert/strict';
import { buildWeatherCouplingScenariosV66, deriveWeatherCouplingV66, validateWeatherCouplingV66 } from '../src/3d/world/environmentRuntimeWeatherCouplingV66.js';

const scenarios = buildWeatherCouplingScenariosV66();
assert.equal(scenarios.length, 5);
for (const scenario of scenarios) {
  const runtime = deriveWeatherCouplingV66(scenario.weather, { wetness: scenario.weather.humidity }, { bankPressure: scenario.weather.precipitation * 0.3 }, { meanForage: 0.5, meanCover: 0.6 });
  assert.equal(validateWeatherCouplingV66({ policy: 'environment-runtime-weather-coupling-v66-2026-09-15', deterministic: true, ...runtime }).ok, true);
  assert.ok(runtime.wetness >= 0 && runtime.wetness <= 1);
  assert.ok(runtime.visibility >= 0 && runtime.visibility <= 1);
}
const clear = deriveWeatherCouplingV66(scenarios[0].weather, { wetness: 0.1 }, { bankPressure: 0.01 }, { meanForage: 0.7, meanCover: 0.8 });
const storm = deriveWeatherCouplingV66(scenarios[2].weather, { wetness: 0.8 }, { bankPressure: 0.8 }, { meanForage: 0.4, meanCover: 0.5 });
assert.ok(storm.flood > clear.flood);
assert.ok(storm.visibility < clear.visibility);
assert.ok(storm.groundResponse.mud > clear.groundResponse.mud);
console.log(JSON.stringify({ ok: true, suite: 'v66-weather', scenarios: scenarios.length }));
