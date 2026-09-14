import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV65 } from '../src/3d/world/environmentRuntimeIntegrationV65.js';
import { buildAdaptiveDecision } from '../src/3d/world/environmentRuntimeAdaptiveV65.js';
import { buildChunkContinuity } from '../src/3d/world/environmentRuntimeContinuityV65.js';
import { buildFrameEnvelope } from '../src/3d/world/environmentRuntimeStreamingV65.js';

const failures = [];
const check = (id, fn) => { try { fn(); } catch (error) { failures.push(`${id}:${error?.stack || error}`); } };
const sample = (i, overrides = {}) => ({
  x: (i % 20) * 130 - 1200,
  z: Math.floor(i / 20) * 130 - 700,
  elevation: 80 + (i % 15) * 95,
  slope: 4 + (i % 9) * 4,
  moisture: ((i * 7) % 100) / 100,
  temperature: -0.65 + ((i * 11) % 140) / 100,
  wind: 0.12 + ((i * 5) % 70) / 100,
  snow: i % 13 === 0 ? 0.86 : 0.03 + (i % 5) * 0.04,
  waterDistance: 28 + (i % 25) * 44,
  roadDistance: 18 + (i % 11) * 7,
  settlementDistance: 48 + (i % 23) * 9,
  confidence: 0.82 + (i % 16) * 0.01,
  biome: ['forest', 'taiga', 'wetland', 'grassland', 'alpine', 'coastal'][i % 6],
  ...overrides,
});

for (let i = 0; i < 32; i += 1) {
  check(`grid-adaptive-${i}`, () => {
    const result = buildAdaptiveDecision(sample(i), i);
    assert.ok(result.density.base >= 0.05);
    assert.ok(result.confidence >= 0.82);
    assert.ok(result.families.length <= 6);
  });
}

for (let i = 0; i < 16; i += 1) {
  check(`grid-chunk-${i}`, () => {
    const key = `${i}:0`;
    const anchors = [
      { x: i * 512 + 500, z: 80, family: i % 2 ? 'conifer' : 'grass', scale: 0.8 + (i % 3) * 0.1 },
      { x: i * 512 + 200, z: 500, family: i % 3 ? 'shrub' : 'moss', scale: 0.9 },
    ];
    const result = buildChunkContinuity({ key, anchors, neighbors: {} });
    assert.ok(result.digest);
    assert.ok(result.summary.transferCount >= 0);
  });
}

for (let i = 0; i < 16; i += 1) {
  check(`grid-frame-${i}`, () => {
    const platform = i % 2 ? 'mobile' : 'desktop';
    const envelope = buildFrameEnvelope({
      platform,
      metrics: {
        fps: platform === 'mobile' ? 36 + i % 4 : 52 + i % 5,
        drawCalls: platform === 'mobile' ? 65 + i : 130 + i * 2,
        triangles: platform === 'mobile' ? 440000 + i * 5000 : 1100000 + i * 18000,
        texturesMb: platform === 'mobile' ? 480 + i * 3 : 680 + i * 6,
        residentChunks: platform === 'mobile' ? 4 : 7,
      },
      items: Array.from({ length: 18 }, (_, index) => ({ id: `${i}-${index}`, distance: index * 280, importance: index < 3 ? 0.8 : 0.3 })),
      camera: { velocity: i * 4 },
    });
    assert.ok(Number.isFinite(envelope.usage.max));
    assert.ok(envelope.plan.tiers.near.length >= 0);
  });
}

const samples = Array.from({ length: 48 }, (_, i) => sample(i));
check('large-integrated-grid', () => {
  const runtime = buildEnvironmentRuntimeV65({ samples, runtimeInput: { seed: 6505, region: 'stress' }, weather: { precipitation: 0.21, humidity: 0.63, cloud: 0.4, temperature: 0.08, mode: 'overcast' }, dayOfYear: 250, platform: 'desktop', camera: { x: 200, z: 80, velocity: 35 } });
  assert.equal(runtime.policy, 'environment-runtime-integration-v65-2026-09-14');
  assert.ok(runtime.adaptive.summary.sampleCount === 48);
  assert.ok(runtime.query.snapshots.length === 24);
});

check('large-integrated-repeat', () => {
  const input = { samples, runtimeInput: { seed: 6505, region: 'stress' }, weather: { precipitation: 0.21, humidity: 0.63, cloud: 0.4, temperature: 0.08, mode: 'overcast' }, dayOfYear: 250, platform: 'desktop', camera: { x: 200, z: 80, velocity: 35 } };
  const first = buildEnvironmentRuntimeV65(input);
  const second = buildEnvironmentRuntimeV65(input);
  assert.deepEqual(first.adaptive.decisions, second.adaptive.decisions);
  assert.deepEqual(first.report, second.report);
});

if (failures.length) { console.error(JSON.stringify({ ok: false, failures }, null, 2)); process.exitCode = 1; }
else console.log(JSON.stringify({ ok: true, suite: 'environment-runtime-v65-stress', checks: failures.length ? 0 : 66 }));
