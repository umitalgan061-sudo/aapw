import assert from 'node:assert/strict';
import { BACKENDS, buildRenderProfile, selectRenderBackend } from '../src/3d/renderBackendCapability.js';
import { createFrameGovernor } from '../src/3d/runtimeFrameGovernor.js';
import { createAdaptiveQualityController } from '../src/3d/adaptiveQualityController.js';
import { createStreamingGovernor } from '../src/3d/worldStreamingGovernor.js';
import { createRuntimeWorkScheduler, createWorkItem } from '../src/3d/runtimeWorkScheduler.js';
import { createAssetResidencyCache } from '../src/3d/assetResidencyCache.js';
import { createWorldInterestGrid } from '../src/3d/worldInterestGrid.js';
import { buildDeviceRuntimeProfile, validateDeviceProfile } from '../src/3d/deviceRuntimeModel.js';
import { createRuntimeTelemetry } from '../src/3d/runtimeTelemetry.js';
import { createRuntimeCoordinator } from '../src/3d/runtimeCoordinator.js';

const caps = { webgpu: true, webgl2: true, webgl: true, cpuCores: 12, memoryGiB: 16, coarsePointer: false, pixelRatio: 2, secureContext: true, offscreenCanvas: true, worker: true, sharedArrayBuffer: true, crossOriginIsolated: true };
assert.equal(selectRenderBackend(caps).backend, BACKENDS.WEBGPU);
assert.equal(buildRenderProfile(caps, selectRenderBackend(caps)).enableTemporalHistory, true);

const governor = createFrameGovernor({ warmupFrames: 0, downgradeAfter: 2, upgradeAfter: 3 });
const fast = governor.evaluate(10); governor.evaluate(70); const slow = governor.evaluate(70);
assert.ok(slow.level >= fast.level);
for (let i = 0; i < 5; i += 1) governor.evaluate(10);
assert.ok(governor.snapshot().sampleCount > 0);

governor.reset();
const quality = createAdaptiveQualityController({ governorOptions: { warmupFrames: 0, downgradeAfter: 1, upgradeAfter: 2 } });
const q0 = quality.profile();
quality.sample(100);
const q1 = quality.profile();
assert.ok(q1.level >= q0.level);
quality.reset();
assert.equal(quality.profile().level, 0);

const streaming = createStreamingGovernor({ maxStartsPerFrame: 2, maxEstimatedMsPerFrame: 2 });
const candidates = Array.from({ length: 12 }, (_, index) => ({ id: `chunk-${index}`, distanceMeters: index * 40, visible: index < 8, playerFocused: index === 0, urgent: index === 1, estimatedMs: 0.8, kind: 'start' }));
const planA = streaming.plan({ candidates, residentCount: 4 });
const planB = streaming.plan({ candidates: [...candidates].reverse(), residentCount: 4 });
assert.deepEqual(planA.start.map((x) => x.id), planB.start.map((x) => x.id));

const scheduler = createRuntimeWorkScheduler({ maxItems: 3, maxEstimatedMs: 2 });
for (let index = 0; index < 9; index += 1) scheduler.enqueue(createWorkItem({ id: `task-${index}`, kind: 'test', priority: 20 + index, estimatedMs: 0.5 }));
const workPlan = scheduler.plan();
assert.ok(workPlan.selected.length <= 3);
assert.ok(workPlan.usedMs <= workPlan.budgetMs + 1e-6);

const cache = createAssetResidencyCache({ capacity: 2, maxBytes: 100 });
cache.put({ id: 'a', bytes: 50, priority: 20 });
cache.put({ id: 'b', bytes: 50, priority: 20 });
cache.get('a');
cache.put({ id: 'c', bytes: 60, priority: 80 });
const eviction = cache.evictToBudget();
assert.ok(eviction.evicted.length >= 1);

const grid = createWorldInterestGrid({ cellSizeMeters: 32, maxQueryResults: 10 });
for (let index = 0; index < 30; index += 1) grid.register({ id: `entity-${index}`, x: index * 2, z: 0, kind: index % 2 ? 'animal' : 'npc', priority: index });
const nearby = grid.queryRadius(10, 0, 20);
assert.ok(nearby.length > 0 && nearby.length <= 10);
assert.equal(new Set(nearby.map((x) => x.id)).size, nearby.length);

const device = buildDeviceRuntimeProfile({ hardwareConcurrency: 8, deviceMemory: 8, webgpu: true, webgl2: true, webgl: true, coarsePointer: false });
assert.equal(validateDeviceProfile(device), true);

const telemetry = createRuntimeTelemetry({ capacity: 12, sampleEveryFrames: 1 });
for (let index = 0; index < 20; index += 1) telemetry.capture({ frameMs: 12 + (index % 5), renderCalls: 100 + index, triangles: 1000 + index * 10, residentChunks: 8, faunaActive: 12 });
assert.equal(telemetry.snapshot().sampleCount, 12);

const coordinator = createRuntimeCoordinator({ capabilities: caps });
const frame = coordinator.beginFrame({ frameMs: 16, cpuMs: 3, gpuMs: 4 });
assert.equal(frame.backend.backend, 'webgpu');
coordinator.recordFrame({ frameMs: 16, renderCalls: 80, triangles: 900 });
assert.ok(coordinator.diagnostics().telemetry.sampleCount === 0 || coordinator.diagnostics().frame >= 1);
coordinator.dispose();

console.log('[modern-runtime-foundation] all acceptance assertions passed');
