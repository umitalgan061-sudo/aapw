#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createDeviceCapabilities } from '../src/3d/platform/deviceCapabilities.js';
import { buildRuntimeFeatureMatrix } from '../src/3d/platform/runtimeFeatureMatrix.js';
import { createRuntimeNetworkPolicy } from '../src/3d/platform/runtimeNetworkPolicy.js';
import { createRuntimeCompatibilityMatrix } from '../src/3d/platform/runtimeCompatibilityMatrix.js';
import { createWorkerCapabilityPolicy } from '../src/3d/platform/workerCapabilityPolicy.js';
import { buildVisibilityBudget } from '../src/3d/platform/runtimeVisibilityBudget.js';
import { createRuntimeRecoveryPlan } from '../src/3d/platform/runtimeRecoveryPlan.js';
import { createAccessibilityPolicy } from '../src/3d/platform/accessibilityPolicy.js';

const profiles = [
	{ coarsePointer: false, finePointer: true, reducedMotion: false, saveData: false, online: true, effectiveType: '4g', hardwareConcurrency: 16, deviceMemory: 16, webgl: { version: 2, maxTextureSize: 8192 } },
	{ coarsePointer: true, finePointer: false, reducedMotion: false, saveData: true, online: true, effectiveType: '2g', hardwareConcurrency: 4, deviceMemory: 2, webgl: { version: 2, maxTextureSize: 2048 } },
	{ coarsePointer: false, finePointer: true, reducedMotion: true, saveData: false, online: false, effectiveType: undefined, hardwareConcurrency: 8, deviceMemory: 8, webgl: { version: 2, maxTextureSize: 4096 } },
];

for (const profile of profiles) {
	const capabilities = createDeviceCapabilities(profile);
	const matrix = buildRuntimeFeatureMatrix(capabilities);
	const network = createRuntimeNetworkPolicy(profile);
	const compatibility = createRuntimeCompatibilityMatrix({ webglSupported: profile.webgl.version > 0, webgl2: profile.webgl.version === 2, worker: true, offscreenCanvas: true, serviceWorker: true, cacheStorage: true, indexedDb: true, gamepad: true, resizeObserver: true, performanceObserver: true });
	const worker = createWorkerCapabilityPolicy(capabilities, compatibility);
	const visibility = buildVisibilityBudget({ tier: matrix.quality.tier, coarsePointer: profile.coarsePointer, reducedMotion: profile.reducedMotion, drawDistance: matrix.budget.maxChunkRadius * 500, maxObjects: matrix.budget.maxVisibleVegetationGroups * 4 });
	const accessibility = createAccessibilityPolicy({ reducedMotion: profile.reducedMotion });
	const recovery = createRuntimeRecoveryPlan({ health: { status: 'degraded' }, performance: { pressure: profile.online ? 'elevated' : 'normal' }, offline: { network: { state: profile.online ? 'online' : 'offline' } }, storage: { state: profile.saveData ? 'elevated' : 'healthy' }, compatibility, governor: { action: 'hold' } });
	assert.equal(network.class === 'constrained' && profile.saveData, profile.saveData || network.class !== 'constrained');
	assert.ok(visibility.budget.farDistance >= visibility.budget.midDistance);
	assert.ok(matrix.budget.maxVisibleVegetationGroups >= visibility.budget.nearObjects);
	if (profile.reducedMotion) assert.equal(accessibility.motion.level, 'reduced');
	if (!profile.online) assert.ok(recovery.actions.some((item) => item.action === 'defer-prefetch'));
	if (worker.mode === 'preferred') assert.ok(worker.budgets.maxConcurrentWorkers >= 1);
}

console.log('RUNTIME_RESILIENCE_CONSISTENCY_PASS 3 profiles');
