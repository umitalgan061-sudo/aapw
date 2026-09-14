import assert from 'node:assert/strict';
import { buildEcotone, ecotoneSamples, transitionStrength, validateEcotone, ecotoneTelemetry } from '../src/3d/world/environmentRuntimeBiomeTransitionV65.js';
import { buildBridgeRuntime, validateBridge, bridgeHealth, bridgeReplay, bridgeMetrics } from '../src/3d/world/environmentRuntimeBridgeV65.js';

const failures = [];
const check = (id, fn) => { try { fn(); } catch (e) { failures.push(`${id}:${e?.stack || e}`); } };
const forest = { x: 0, z: 0, elevation: 450, slope: 8, moisture: 0.72, temperature: 0.25, confidence: 0.92, biome: 'forest', waterDistance: 260, roadDistance: 40, settlementDistance: 110 };
const steppe = { x: 160, z: 0, elevation: 510, slope: 6, moisture: 0.22, temperature: 0.48, confidence: 0.92, biome: 'steppe', waterDistance: 800, roadDistance: 40, settlementDistance: 110 };
const wetland = { x: 80, z: 40, elevation: 30, slope: 3, moisture: 0.94, temperature: 0.2, confidence: 0.94, biome: 'wetland', waterDistance: 24, roadDistance: 60, settlementDistance: 140 };
const alpine = { x: 80, z: 160, elevation: 1900, slope: 28, moisture: 0.3, temperature: -0.52, confidence: 0.93, biome: 'alpine', waterDistance: 500, roadDistance: 90, settlementDistance: 260 };

check('same-group-low-transition', () => {
  const strength = transitionStrength(forest, { ...forest, x: 40, biome: 'taiga' }, 20);
  assert.ok(strength < 0.7);
});

check('open-wooded-transition', () => {
  const result = buildEcotone(forest, steppe, 70);
  assert.equal(validateEcotone(result).ok, true);
  assert.ok(result.strength > 0.35);
  assert.equal(result.shrubBridge, true);
});

check('wet-wooded-transition', () => {
  const result = buildEcotone(forest, wetland, 50);
  assert.equal(validateEcotone(result).ok, true);
  assert.ok(result.habitatMix.length > 0);
});

check('cold-open-transition', () => {
  const result = buildEcotone(alpine, steppe, 80);
  assert.equal(validateEcotone(result).ok, true);
  assert.ok(result.bandMeters >= 0);
});

check('ecotone-sample-count', () => {
  const samples = ecotoneSamples(forest, steppe, 9);
  assert.equal(samples.length, 9);
  assert.equal(samples[0].t, 0);
  assert.equal(samples.at(-1).t, 1);
});

check('ecotone-sample-determinism', () => {
  const a = ecotoneSamples(forest, wetland, 7);
  const b = ecotoneSamples(forest, wetland, 7);
  assert.deepEqual(a, b);
});

check('telemetry-shape', () => {
  const result = buildEcotone(forest, wetland, 45);
  const telemetry = ecotoneTelemetry(result);
  assert.match(telemetry.digest, /^[0-9a-f]{8}$/);
  assert.ok(telemetry.strength >= 0 && telemetry.strength <= 1);
});

check('bridge-health', () => {
  const bridge = buildBridgeRuntime({ samples: [forest, steppe, wetland, alpine], runtimeInput: { seed: 65 }, weather: { precipitation: 0.18, humidity: 0.6, temperature: 0.12 }, platform: 'desktop' });
  const health = bridgeHealth(bridge);
  assert.equal(health.healthy, true);
  assert.equal(validateBridge(bridge).ok, true);
});

check('bridge-metrics', () => {
  const bridge = buildBridgeRuntime({ samples: [forest, wetland], runtimeInput: { seed: 12 } });
  const metrics = bridgeMetrics(bridge);
  assert.ok(metrics.sampleCount > 0);
  assert.ok(metrics.acceptanceRate >= 0);
  assert.ok(metrics.acceptanceRate <= 1);
});

check('bridge-replay', () => {
  const input = { samples: [forest, steppe, alpine], runtimeInput: { seed: 7 }, weather: { precipitation: 0.2, humidity: 0.5, temperature: 0.2 } };
  const replay = bridgeReplay(input, 3);
  assert.equal(replay.count, 3);
  assert.equal(replay.stable, true);
});

for (const [index, left] of [forest, steppe, wetland, alpine].entries()) {
  check(`pair-${index}`, () => {
    const right = index % 2 ? forest : steppe;
    const transition = buildEcotone(left, right, 60 + index * 10);
    assert.equal(validateEcotone(transition).ok, true);
    assert.ok(transition.habitatMix.length <= 8);
  });
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, suite: 'environment-runtime-v65-biome', checks: 16 }));
}
