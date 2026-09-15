import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV66, validateEnvironmentRuntimeV66 } from '../src/3d/world/environmentRuntimeIntegrationV66.js';
import { buildStreamingBudgetV66, buildChunkAdmissionV66 } from '../src/3d/world/environmentRuntimeStreamingV66.js';
import { buildV66Ledger, validateV66Ledger } from '../src/3d/world/environmentRuntimeObservabilityV66.js';
import { auditEnvironmentV66 } from '../src/3d/world/environmentRuntimeV66Audit.js';

const extreme = {
  x: 999999, z: -999999, elevation: 4200, slope: 89, moisture: 1, rainfall: 1, soilDepth: 0.01,
  vegetationCover: 1, rockExposure: 1, waterDistance: 0, waterDepth: 1, roadDistance: 0, settlementDistance: 0,
  confidence: 0, biome: 'alpine', snow: 1,
};

const runtime = buildEnvironmentRuntimeV66({
  samples: [extreme, { ...extreme, x: extreme.x + 1, biome: 'desert' }],
  weather: { precipitation: 1, humidity: 1, wind: 1, cloud: 1, temperature: 0, stormPulse: 1 },
  season: 'winter', dayOfYear: 1, time: 2, camera: { distance: 8000, mode: 'sprint' }, platform: 'mobile',
});

const validation = validateEnvironmentRuntimeV66(runtime);
assert.equal(validation.ok, true, validation.errors.join(','));
assert.equal(runtime.contract.noWorldMutation, true);
assert.equal(runtime.deterministic, true);
assert.ok(runtime.eventsRuntime.events.length <= 48);
assert.ok(runtime.audit.p0Pass);

const overBudget = buildStreamingBudgetV66({ platform: 'mobile', fps: 10, drawCalls: 300, triangles: 2000000, textureMb: 1200, residentChunks: 20 });
assert.ok(overBudget.emergency);
const chunks = Array.from({ length: 30 }, (_, i) => ({ id: `stress-${i}`, distance: i * 90, importance: i < 3 ? 1 : 0.2 }));
const admission = buildChunkAdmissionV66({ chunks, camera: { velocity: 60 }, budget: overBudget });
assert.ok(admission.admitted.length <= admission.cap);
assert.ok(admission.deferred.length > 0);

const ledger = buildV66Ledger({ audit: { pass: true }, streaming: { budget: overBudget }, sky: { skyLumaFloor: 0.08 }, navigation: {}, deterministic: true });
assert.equal(validateV66Ledger(ledger).ok, true);
assert.equal(auditEnvironmentV66({ ...runtime, streaming: { budget: overBudget } }).p0Pass, true);

const malformed = { ...runtime, contract: { ...runtime.contract, noWorldMutation: false } };
assert.equal(validateEnvironmentRuntimeV66(malformed).ok, false);
console.log(JSON.stringify({ ok: true, suite: 'v66-adversarial', eventCount: runtime.eventsRuntime.events.length, admitted: admission.admitted.length }));
