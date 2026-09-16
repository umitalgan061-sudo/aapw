import assert from 'node:assert/strict';
import { createRenderDegradationPolicy, degradationDigest, validateRenderDegradationPacket } from '../src/3d/rendering/renderDegradationPolicy.js';

const policy = createRenderDegradationPolicy();
const normal = policy.evaluate({ gpuPressure: 0.1, thermalPressure: 0.1, memoryPressure: 0.2, recoveryPressure: 0, reducedMotion: false });
assert.equal(normal.mode, 'none');
assert.equal(validateRenderDegradationPacket(normal), true);

const light = policy.evaluate({ gpuPressure: 0.45, thermalPressure: 0.2, memoryPressure: 0.3, recoveryPressure: 0, reducedMotion: false });
assert.ok(['light', 'moderate'].includes(light.mode));
assert.equal(validateRenderDegradationPacket(light), true);

const critical = policy.evaluate({ gpuPressure: 0.98, thermalPressure: 0.95, memoryPressure: 0.97, recoveryPressure: 0.9, reducedMotion: true });
assert.equal(critical.mode, 'safe');
assert.equal(critical.preferFallbackBackend, true);
assert.equal(critical.disableExpensivePostProcess, true);
assert.ok(critical.textureBudgetMultiplier < 0.6);
assert.ok(critical.instanceBudgetMultiplier < 0.5);
assert.ok(critical.effectBudgetMultiplier < 0.5);
assert.equal(validateRenderDegradationPacket(critical), true);

const digestA = degradationDigest(critical);
const digestB = degradationDigest(policy.evaluate({ gpuPressure: 0.98, thermalPressure: 0.95, memoryPressure: 0.97, recoveryPressure: 0.9, reducedMotion: true }));
assert.equal(digestA, digestB);

for (const reducedMotion of [false, true]) {
  for (const gpuPressure of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    for (const thermalPressure of [0, 0.5, 1]) {
      const packet = policy.evaluate({ gpuPressure, thermalPressure, memoryPressure: gpuPressure, recoveryPressure: 0, reducedMotion });
      assert.equal(validateRenderDegradationPacket(packet), true);
      assert.ok(packet.renderScaleMultiplier >= 0.55);
      assert.ok(packet.renderScaleMultiplier <= 1);
      assert.ok(packet.textureBudgetMultiplier >= 0.1);
      assert.ok(packet.textureBudgetMultiplier <= 1);
      assert.ok(packet.instanceBudgetMultiplier >= 0.1);
      assert.ok(packet.instanceBudgetMultiplier <= 1);
      assert.ok(packet.effectBudgetMultiplier >= 0.1);
      assert.ok(packet.effectBudgetMultiplier <= 1);
    }
  }
}

console.log('next-gen render degradation policy: PASS');
