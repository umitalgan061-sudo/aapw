import assert from 'node:assert/strict';
import { RENDER_QUALITY_LEVELS, RENDER_QUALITY_BACKENDS, createRenderQualityGovernor, normalizeRenderTelemetry, normalizeRenderGovernorContext, computeRenderPressure, selectQualityTarget, updateQualityState, buildQualityProfile, pushTelemetry, summarizeRenderTelemetry, renderQualityDigest, validateRenderQualityResult } from '../src/3d/renderQualityGovernorR2.js';

const levels = RENDER_QUALITY_LEVELS;
const backends = RENDER_QUALITY_BACKENDS;
const seeds = ['low','medium','high','stress','thermal','battery','hidden','recovery'];
const lodCases = ['webgpu','webgl2','webgl','none'];

for (const backend of backends) {
  for (const level of levels) {
    for (const seed of seeds) {
      const telemetry = normalizeRenderTelemetry({ frameMs: seed === 'stress' ? 36 : seed === 'low' ? 11 : 17.2, gpuMs: seed === 'high' ? 24 : 9, cpuMs: seed === 'high' ? 22 : 8, memoryPressure: seed === 'thermal' ? .94 : .32, thermalPressure: seed === 'thermal' ? .96 : .22, batteryLevel: seed === 'battery' ? .06 : .88, batteryCharging: seed !== 'battery', hidden: seed === 'hidden', inputActive: seed === 'recovery', qualityBias: seed === 'low' ? 1 : 0, timestamp: 100 });
      const context = normalizeRenderGovernorContext({ backend, level, frameIndex: 7, seed });
      assert.equal(levels.includes(context.level), true);
      assert.equal(backends.includes(context.backend), true);
      assert.ok(Number.isFinite(computeRenderPressure(telemetry)));
      const target = selectQualityTarget(context, telemetry);
      assert.equal(levels.includes(target), true);
      const state = updateQualityState({ level, stepDownStreak: 7, stepUpStreak: 44, framesInLevel: 4 }, telemetry, context);
      const profile = buildQualityProfile(context, telemetry, state);
      const result = { state, telemetry, profile, summary: summarizeRenderTelemetry([telemetry]) };
      assert.equal(validateRenderQualityResult(result).valid, true, `${backend}/${level}/${seed}`);
      assert.equal(renderQualityDigest(result), renderQualityDigest(result));
    }
  }
}

const governor = createRenderQualityGovernor({ level: 'ultra' });
const samples = [11, 12, 13, 30, 31, 29, 28, 27, 15, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14];
for (let i = 0; i < samples.length; i += 1) {
  const result = governor.evaluate({ frameMs: samples[i], gpuMs: samples[i] * .55, cpuMs: samples[i] * .4, memoryPressure: .25, thermalPressure: .2, batteryLevel: .8 }, { backend: i % 2 ? 'webgpu' : 'webgl2', seed: `seq-${i}` });
  assert.equal(validateRenderQualityResult(result).valid, true);
}
assert.ok(governor.snapshot().history.length <= 120);

governor.reset('balanced');
const reset = governor.evaluate({ frameMs: 12, gpuMs: 8, cpuMs: 7, batteryLevel: 1 }, { backend: 'webgpu' });
assert.equal(reset.state.level, 'balanced');

governor.dispose();
const disposed = governor.evaluate({ frameMs: 8 }, { backend: 'webgpu' });
assert.equal(disposed.disposed, true);
assert.equal(disposed.profile.reducedMotion, true);

const history = pushTelemetry([], { frameMs: 10 }, 3);
const history2 = pushTelemetry(history, { frameMs: 12 }, 3);
const history3 = pushTelemetry(history2, { frameMs: 14 }, 3);
const history4 = pushTelemetry(history3, { frameMs: 16 }, 3);
assert.equal(history4.length, 3);
assert.equal(summarizeRenderTelemetry(history4).samples, 3);

for (const value of [NaN, Infinity, -1, 999, '7', null]) {
  const t = normalizeRenderTelemetry({ frameMs: value, memoryPressure: value, thermalPressure: value, batteryLevel: value });
  assert.ok(Number.isFinite(t.frameMs));
  assert.ok(t.memoryPressure >= 0 && t.memoryPressure <= 1);
  assert.ok(t.thermalPressure >= 0 && t.thermalPressure <= 1);
  assert.ok(t.batteryLevel >= 0 && t.batteryLevel <= 1);
}

const vectors = 5 * 4 * 8;
console.log(JSON.stringify({ pass: true, vectors, levels: levels.length, backends: backends.length, seeds: seeds.length, smoke: lodCases.length }));
