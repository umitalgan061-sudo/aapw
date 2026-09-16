import assert from 'node:assert/strict';
import { createRenderQualityGovernor, normalizeRenderGovernorContext, selectQualityTarget } from '../src/3d/renderQualityGovernorR2.js';

const overloaded = { frameMs: 40, gpuMs: 28, cpuMs: 24, memoryPressure: .75, thermalPressure: .4, batteryLevel: .8, batteryCharging: true };
const healthy = { frameMs: 12, gpuMs: 6, cpuMs: 6, memoryPressure: .2, thermalPressure: .2, batteryLevel: .9, batteryCharging: true };
const context = normalizeRenderGovernorContext({ backend: 'webgpu', level: 'ultra', userCeiling: 'ultra' });
assert.equal(selectQualityTarget(context, overloaded), 'high');
assert.equal(selectQualityTarget(context, healthy), 'ultra');

const governor = createRenderQualityGovernor({ level: 'ultra' });
let result;
for (let i = 0; i < 8; i += 1) result = governor.evaluate(overloaded, { backend: 'webgpu', userCeiling: 'ultra', seed: `down-${i}` });
assert.equal(result.state.level, 'high');
assert.ok(result.profile.pixelRatio < 1);
assert.ok(result.profile.shadows <= 2048);

for (let i = 0; i < 44; i += 1) result = governor.evaluate(healthy, { backend: 'webgpu', userCeiling: 'ultra', seed: `up-${i}` });
assert.equal(result.state.level, 'high');
result = governor.evaluate(healthy, { backend: 'webgpu', userCeiling: 'ultra', seed: 'up-final' });
assert.equal(result.state.level, 'ultra');

const thermal = createRenderQualityGovernor({ level: 'high' }).evaluate({ ...healthy, thermalPressure: .98 }, { backend: 'webgpu', userCeiling: 'ultra' });
assert.equal(thermal.state.target, 'compatibility');
assert.equal(thermal.profile.reducedMotion, true);

const hidden = createRenderQualityGovernor({ level: 'high' }).evaluate({ ...healthy, hidden: true, inputActive: false }, { backend: 'webgl2', userCeiling: 'ultra' });
assert.equal(hidden.state.level, 'compatibility');

console.log(JSON.stringify({ pass: true, downshift: result.state.level, thermalTarget: thermal.state.target, hiddenLevel: hidden.state.level }));
