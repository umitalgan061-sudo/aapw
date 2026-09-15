import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV66, validateEnvironmentRuntimeV66 } from '../src/3d/world/environmentRuntimeIntegrationV66.js';
import { buildV66ReleaseGate, validateV66ReleaseGate } from '../src/3d/world/environmentRuntimeReleaseV66.js';
import { buildV66Ledger, validateV66Ledger } from '../src/3d/world/environmentRuntimeObservabilityV66.js';
import { buildStreamingBudgetV66 } from '../src/3d/world/environmentRuntimeStreamingV66.js';
import { createV66VisualAcceptanceMatrix } from '../src/3d/world/environmentRuntimeV66Audit.js';

const makeSample = (i, biome) => ({
  x: i * 30,
  z: (i % 4) * 22,
  elevation: 240 + i * 46,
  slope: 6 + ((i * 9) % 38),
  moisture: 0.3 + (i % 8) / 12,
  rainfall: 0.1 + (i % 7) / 14,
  soilDepth: 0.35 + (i % 5) / 10,
  vegetationCover: 0.24 + (i % 8) / 10,
  rockExposure: (i % 7) / 10,
  waterDistance: 4 + (i % 16) * 16,
  waterDepth: i % 13 === 0 ? 0.12 : 0,
  roadDistance: 48 + (i % 12) * 24,
  settlementDistance: 90 + (i % 14) * 34,
  confidence: 0.82 + (i % 8) / 45,
  biome,
});

const biomes = ['forest', 'taiga', 'wetland', 'riverine', 'coastal', 'alpine', 'tundra', 'steppe', 'grassland', 'desert'];
const weather = { precipitation: 0.38, humidity: 0.72, wind: 0.44, cloud: 0.52, temperature: 0.32 };
const samples = biomes.map((biome, i) => makeSample(i, biome));

const runtime = buildEnvironmentRuntimeV66({
  samples,
  weather,
  season: 'autumn',
  dayOfYear: 278,
  time: 18,
  camera: { distance: 1450, mode: 'walk' },
  platform: 'desktop',
});

assert.equal(validateEnvironmentRuntimeV66(runtime).ok, true);
assert.equal(runtime.contract.noWorldMutation, true);
assert.equal(runtime.contract.placementAuthority, 'WorldAssetPlacementPipeline.js');
assert.equal(runtime.contract.materialAuthority, 'MaterialAssignmentCore.js');
assert.equal(runtime.deterministic, true);
assert.ok(runtime.audit.p0Pass);
assert.ok(runtime.eventsRuntime.events.length <= 48);
assert.equal(runtime.navigation.field.length, samples.length);
assert.equal(runtime.ecology.layers.length, samples.length);
assert.equal(runtime.wetEdges.length, samples.length);
assert.match(runtime.digest, /^[0-9a-f]{8}$/);

const budget = buildStreamingBudgetV66({ platform: 'desktop', fps: 58, drawCalls: 144, triangles: 1180000, textureMb: 690, residentChunks: 8 });
assert.ok(budget.max < 1.18);

const ledger = buildV66Ledger({ ...runtime, streaming: { budget } });
assert.equal(ledger.policy, 'environment-runtime-observability-v66-2026-09-15');
assert.equal(validateV66Ledger(ledger).ok, true);

const gate = buildV66ReleaseGate({ ...runtime, streaming: { budget } });
assert.equal(gate.version, 66);
assert.equal(gate.gates.deterministic, true);
assert.equal(gate.gates.noWorldMutation, true);
assert.equal(gate.gates.placementAuthority, true);
assert.equal(gate.gates.materialAuthority, true);
assert.equal(gate.gates.audit, true);
assert.equal(gate.gates.budget, true);
assert.equal(gate.gates.digest, true);
assert.equal(validateV66ReleaseGate({ ...gate, pass: true, gates: { ...gate.gates, audit: true, evidence: true } }).ok, true);

const matrix = createV66VisualAcceptanceMatrix();
assert.equal(matrix.length, 6);
assert.ok(matrix.every((entry) => entry.id && entry.expected.length >= 2));

const desktopReplay = buildEnvironmentRuntimeV66({ samples, weather, season: 'autumn', dayOfYear: 278, time: 18, camera: { distance: 1450, mode: 'walk' }, platform: 'desktop' });
assert.deepEqual(runtime, desktopReplay);

const mobile = buildEnvironmentRuntimeV66({
  samples: samples.slice(0, 6),
  weather: { precipitation: 0.84, humidity: 0.92, wind: 0.7, cloud: 0.86, temperature: 0.18 },
  season: 'winter',
  dayOfYear: 30,
  time: 7,
  camera: { distance: 900, mode: 'walk' },
  platform: 'mobile',
});
assert.equal(validateEnvironmentRuntimeV66(mobile).ok, true);
assert.equal(mobile.contract.noWorldMutation, true);
assert.ok(mobile.audit.p0Pass);

const alternate = buildEnvironmentRuntimeV66({
  samples: samples.map((sample) => ({ ...sample, moisture: 1 - sample.moisture, waterDistance: sample.waterDistance + 80 })),
  weather: { precipitation: 0.03, humidity: 0.15, wind: 0.22, cloud: 0.04, temperature: 0.88 },
  season: 'summer',
  dayOfYear: 198,
  time: 13,
  camera: { distance: 2100, mode: 'sprint' },
  platform: 'desktop',
});
assert.equal(validateEnvironmentRuntimeV66(alternate).ok, true);
assert.notEqual(alternate.digest, runtime.digest);

for (const platform of ['desktop', 'mobile']) {
  const p = buildStreamingBudgetV66({ platform, fps: platform === 'desktop' ? 54 : 38, drawCalls: platform === 'desktop' ? 150 : 70, triangles: platform === 'desktop' ? 1400000 : 520000, textureMb: platform === 'desktop' ? 760 : 460, residentChunks: platform === 'desktop' ? 9 : 5 });
  assert.ok(Number.isFinite(p.max));
  assert.ok(p.max >= 0);
}

console.log(JSON.stringify({ ok: true, suite: 'v66-release-acceptance', biomes: biomes.length, visualCases: matrix.length, digest: runtime.digest, releaseReady: gate.pass }));
