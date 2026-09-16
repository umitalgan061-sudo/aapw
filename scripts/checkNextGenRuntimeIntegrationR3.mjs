#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRenderRuntimeCoordinator, classifyRuntimePressure, runtimeFrameBudgetScore } from '../src/3d/rendering/renderRuntimeCoordinator.js';
import { deriveMaterialRecipe, buildMaterialBatchKey, validateMaterialRecipe } from '../src/3d/rendering/materialRuntimeOptimizer.js';
import { buildStreamingRequest, planStreamingAdmissions, validateStreamingPlan } from '../src/3d/rendering/streamingBudgetController.js';
import { buildRenderPipelinePolicy, validatePipelinePolicy } from '../src/3d/rendering/renderPipelinePolicy.js';
import { buildGpuPassBudgetPlan, validateGpuPassBudgetPlan } from '../src/3d/rendering/gpuPassBudget.js';

function runRuntimeDeterminism() {
  const a = createRenderRuntimeCoordinator({ requestedBackend: 'webgl2', initialTier: 3 });
  const b = createRenderRuntimeCoordinator({ requestedBackend: 'webgl2', initialTier: 3 });
  const input = { viewport: { width: 1920, height: 1080 }, device: { mobile: false, coarsePointer: false, devicePixelRatio: 1 }, scene: { visibleObjects: 1400, shadowCasters: 160, animatedObjects: 80, textureBytes: 64 * 1024 * 1024 } };
  for (let index = 0; index < 32; index += 1) { a.recordFrame(15 + (index % 3), input); b.recordFrame(15 + (index % 3), input); }
  assert.deepEqual(a.getSnapshot().features, b.getSnapshot().features);
  assert.equal(a.getSnapshot().tier, b.getSnapshot().tier);
  assert.equal(a.getSnapshot().scale, b.getSnapshot().scale);
  a.dispose(); b.dispose();
}

function runPressureTransitions() {
  const coordinator = createRenderRuntimeCoordinator({ initialTier: 3, pressureSamples: 3, healthySamples: 4 });
  const input = { viewport: { width: 1280, height: 720 }, device: { mobile: false, devicePixelRatio: 1 }, scene: { visibleObjects: 1800 } };
  const before = coordinator.getSnapshot().tier;
  for (let index = 0; index < 8; index += 1) coordinator.recordFrame(45, input);
  const afterPressure = coordinator.getSnapshot();
  assert.ok(afterPressure.tier < before);
  for (let index = 0; index < 12; index += 1) coordinator.recordFrame(10, input);
  assert.ok(coordinator.getSnapshot().tier >= afterPressure.tier);
  coordinator.dispose();
}

function runMaterialContract() {
  const recipe = deriveMaterialRecipe({ quality: 'ultra', backend: 'webgpu', distanceMeters: 20, screenCoverage: 0.3, importance: 0.9 });
  assert.equal(validateMaterialRecipe(recipe), true);
  assert.equal(recipe.useAdvancedLayering, true);
  assert.ok(buildMaterialBatchKey({ type: 'MeshStandardMaterial', side: 'front' }, recipe).includes('MeshStandardMaterial'));
  const pressureRecipe = deriveMaterialRecipe({ quality: 'ultra', backend: 'webgpu', memoryPressure: 0.95, distanceMeters: 80 });
  assert.equal(pressureRecipe.useNormalMap, false);
  assert.equal(pressureRecipe.useEmissive, false);
}

function runStreamingContract() {
  const items = Array.from({ length: 32 }, (_, index) => ({ id: `asset-${String(index).padStart(2, '0')}`, category: index % 6 === 0 ? 'terrain' : index % 5 === 0 ? 'character' : 'vegetation', distanceMeters: 80 + index * 35, importance: 1 - index / 64, estimatedBytes: 2 * 1024 * 1024 }));
  const planA = planStreamingAdmissions(items, { residentBytes: 64 * 1024 * 1024, memoryPressure: 0.2, cameraVelocityMetersPerSecond: 16 });
  const planB = planStreamingAdmissions([...items].reverse(), { residentBytes: 64 * 1024 * 1024, memoryPressure: 0.2, cameraVelocityMetersPerSecond: 16 });
  assert.equal(validateStreamingPlan(planA), true);
  assert.deepEqual(planA.admitted.map((row) => row.id), planB.admitted.map((row) => row.id));
  assert.ok(buildStreamingRequest(items[0], { cameraVelocityMetersPerSecond: 12 }).priority >= 0);
}

function runPipelineContract() {
  const webgpu = buildRenderPipelinePolicy({ backend: 'webgpu', runtimeTier: 'ultra' });
  const webgl = buildRenderPipelinePolicy({ backend: 'webgl2', runtimeTier: 'ultra' });
  assert.equal(validatePipelinePolicy(webgpu), true);
  assert.equal(validatePipelinePolicy(webgl), true);
  assert.equal(webgpu.mrt, true);
  assert.equal(webgl.mrt, false);
  assert.ok(webgpu.effects.includes('ssgi'));
  assert.equal(webgl.effects.includes('ssgi'), false);
}

function runGpuBudgetContract() {
  const plan = buildGpuPassBudgetPlan({ targetFrameMs: 16.67, estimatedGpuMs: 24, pressure: 0.8, activePasses: ['base', 'shadow', 'water', 'foliage', 'effects', 'post'] });
  assert.equal(validateGpuPassBudgetPlan(plan), true);
  assert.equal(plan.overBudget, true);
  assert.ok(plan.shed.length > 0);
}

function runPureHelpers() {
  assert.equal(classifyRuntimePressure(40, 16), 'severe');
  assert.equal(classifyRuntimePressure(19, 16), 'neutral');
  assert.equal(classifyRuntimePressure(10, 16), 'healthy');
  assert.ok(runtimeFrameBudgetScore(8, 16) > runtimeFrameBudgetScore(32, 16));
}

runRuntimeDeterminism();
runPressureTransitions();
runMaterialContract();
runStreamingContract();
runPipelineContract();
runGpuBudgetContract();
runPureHelpers();
console.log('Next-gen runtime integration R3 acceptance passed.');
