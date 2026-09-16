import assert from 'node:assert/strict';
import { buildRenderPipelinePolicy } from '../src/3d/rendering/renderPipelinePolicy.js';
import { compileRenderPipelineDescriptor } from '../src/3d/rendering/renderPipelineComposer.js';
import { createDynamicResolutionGovernor } from '../src/3d/rendering/dynamicResolutionGovernor.js';
import { createGpuInstanceBatchPlanner } from '../src/3d/rendering/gpuInstanceBatchPlanner.js';
import { createTextureResidencyPlanner } from '../src/3d/rendering/textureResidencyPlanner.js';
import { createRenderVisibilityScheduler } from '../src/3d/rendering/renderVisibilityScheduler.js';

const backends = ['webgpu', 'webgl2'];
const tiers = ['minimal', 'balanced', 'high', 'ultra'];
const thermal = [0, 0.5, 0.9];
const motion = [false, true];
const battery = [false, true];
const generated = [];

for (const backend of backends) {
  for (const tier of tiers) {
    for (const heat of thermal) {
      for (const reducedMotion of motion) {
        for (const batterySaver of battery) {
          const policy = buildRenderPipelinePolicy({ backend, runtimeTier: tier, hardwareScore: 0.9, thermalPressure: heat, reducedMotion, batterySaver });
          const descriptor = compileRenderPipelineDescriptor(policy);
          assert.ok(descriptor.backend === backend);
          assert.ok(descriptor.estimatedPasses <= 12);
          if (backend === 'webgl2') assert.ok(!descriptor.effectIds.includes('ssgi'));
          generated.push({ backend, tier, heat, reducedMotion, batterySaver, effectCount: descriptor.effectIds.length, pipelineMode: descriptor.pipelineMode });
        }
      }
    }
  }
}
assert.equal(generated.length, 96);

const governor = createDynamicResolutionGovernor();
const scaleTrace = [];
for (let i = 0; i < 90; i += 1) scaleTrace.push(governor.update({ frameMs: i < 45 ? 35 : 11, thermalPressure: i % 7 === 0 ? 0.8 : 0.2 }).scale);
assert.ok(Math.max(...scaleTrace) <= 1 && Math.min(...scaleTrace) >= 0.55);
const flips = scaleTrace.slice(1).reduce((sum, value, index) => sum + (Math.sign(value - scaleTrace[index]) !== Math.sign(scaleTrace[index] - (scaleTrace[index - 1] ?? scaleTrace[index])) ? 1 : 0), 0);
assert.ok(flips < 50);

const renderables = Array.from({ length: 1000 }, (_, i) => ({ id: `r-${i}`, distance: i * 1.5, screenCoverage: 1 / (1 + i / 50), importance: (i % 17) / 17 + 0.1, visible: i % 23 !== 0, geometryKey: `g-${i % 9}`, materialKey: `m-${i % 7}` }));
const visibility = createRenderVisibilityScheduler();
const vis = visibility.schedule(renderables, 1);
assert.ok(vis.visible.length <= 2048);
assert.equal(vis.visible.map((x) => x.id).join('|'), visibility.schedule(renderables, 1).visible.map((x) => x.id).join('|'));

const instances = createGpuInstanceBatchPlanner();
const instancePlan = instances.plan(renderables, { tier: 'balanced', thermalPressure: 0.7 });
assert.ok(instancePlan.batches.every((batch) => batch.instanceCount <= 768));
const textures = createTextureResidencyPlanner();
const texturePlan = textures.plan(renderables.map((x, i) => ({ id: `t-${i}`, width: 1024, height: 1024, format: 'rgba8', distance: x.distance, screenCoverage: x.screenCoverage, importance: x.importance, compressed: i % 2 === 0 })), { tier: 'balanced', budgetMb: 192 });
assert.ok(texturePlan.spentBytes <= texturePlan.budgetBytes + 1024 * 1024 * 16);
console.log(`next-gen rendering matrix: PASS (${generated.length} policy configurations)`);
