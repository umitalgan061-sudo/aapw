import assert from 'node:assert/strict';
import { buildFrameEnvelope, budgetUsage, adaptiveBudget, buildCullingPlan, selectTier } from '../src/3d/world/environmentRuntimeStreamingV65.js';
import { buildAdaptiveDecision, adaptRegionSamples } from '../src/3d/world/environmentRuntimeAdaptiveV65.js';
import { buildEnvironmentRuntimeV65, runtimeDigest } from '../src/3d/world/environmentRuntimeIntegrationV65.js';

const failures = [];
const check = (id, fn) => { try { fn(); console.log(`ok:${id}`); } catch (error) { failures.push(`${id}:${error?.stack || error}`); } };
const items = Array.from({ length: 160 }, (_, i) => ({ id: `asset-${i}`, distance: (i % 32) * 170 + i * 2, projectedSize: Math.max(0.01, 0.9 - i / 220), importance: i % 17 === 0 ? 0.95 : 0.3, gameplayCritical: i < 4 }));

check('desktop-budget', () => {
  const usage = budgetUsage({ fps: 55, drawCalls: 150, triangles: 1400000, texturesMb: 800, residentChunks: 8 }, 'desktop');
  assert.ok(usage.max <= 1);
});

check('mobile-adaptation', () => {
  const budget = adaptiveBudget({ platform: 'mobile', metrics: { fps: 28, drawCalls: 110, triangles: 800000, texturesMb: 700, residentChunks: 6 } });
  assert.ok(budget.factor < 1);
  assert.ok(budget.triangles < 650000);
});

check('culling-stable', () => {
  const a = buildCullingPlan({ items, camera: { velocity: 20 }, platform: 'desktop' });
  const b = buildCullingPlan({ items, camera: { velocity: 20 }, platform: 'desktop' });
  assert.deepEqual(a, b);
  assert.equal(a.tiers.near.filter((x) => x.id === 'asset-0').length, 1);
});

check('critical-near', () => assert.equal(selectTier({ distance: 180, importance: 0.01, gameplayCritical: true }), 'near'));

check('adaptive-stability', () => {
  const samples = Array.from({ length: 80 }, (_, i) => ({ x: i * 12, z: i * 7, elevation: 200 + i, slope: 6, moisture: 0.64, temperature: 0.24, wind: 0.22, snow: 0.02, waterDistance: 300, roadDistance: 30, settlementDistance: 100, confidence: 0.91, biome: 'forest' }));
  const a = adaptRegionSamples(samples, 42);
  const b = adaptRegionSamples(samples, 42);
  assert.deepEqual(a, b);
  assert.ok(a.every((entry) => entry.confidence >= 0.9));
});

check('integration-digest-stable', () => {
  const samples = Array.from({ length: 18 }, (_, i) => ({ x: i * 80, z: i * 50, elevation: 300, slope: 5, moisture: 0.58, temperature: 0.3, confidence: 0.9, biome: 'forest', waterDistance: 250, roadDistance: 40, settlementDistance: 100 }));
  const input = { samples, runtimeInput: { seed: 7 }, weather: { precipitation: 0.18, humidity: 0.55, temperature: 0.2 }, platform: 'desktop' };
  const first = buildEnvironmentRuntimeV65(input);
  const second = buildEnvironmentRuntimeV65(input);
  assert.equal(runtimeDigest(first), runtimeDigest(second));
});

check('integration-no-exploding-budget', () => {
  const runtime = buildEnvironmentRuntimeV65({ samples: [], runtimeInput: {}, platform: 'mobile', streaming: { metrics: { fps: 60, drawCalls: 0, triangles: 0, texturesMb: 0, residentChunks: 0 }, items: [] } });
  assert.ok(Number.isFinite(runtime.streaming.usage.max));
});

if (failures.length) { console.error(JSON.stringify({ ok: false, failures }, null, 2)); process.exitCode = 1; }
else console.log(JSON.stringify({ ok: true, suite: 'environment-runtime-v65-performance', checks: 7 }));
