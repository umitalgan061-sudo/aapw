#!/usr/bin/env node
/**
 * Generated property matrix for runtime resilience invariants.
 *
 * Rather than asserting one hard-coded desktop and one mobile fixture, this check generates a compact
 * Cartesian matrix of CPU, memory, DPR, pointer, network, accessibility and WebGL conditions. Each case
 * must keep the same policy invariants: bounded values, no mobile shadow escalation, no Save-Data texture
 * upgrades, reduced-motion animation caps and stable serialization. The matrix is deterministic and has
 * no dependency on a browser session.
 */

import assert from 'node:assert/strict';
import { createDeviceCapabilities } from '../src/3d/platform/deviceCapabilities.js';
import { buildRuntimeFeatureMatrix, featureMatrixDigest } from '../src/3d/platform/runtimeFeatureMatrix.js';
import { resolveQualityApplication } from '../src/3d/platform/runtimeQualityApplicator.js';
import { createAccessibilityPolicy } from '../src/3d/platform/accessibilityPolicy.js';
import { createInputCapabilityMatrix } from '../src/3d/platform/inputCapabilityMatrix.js';
import { evaluateStoragePressure, storageWriteAllowed } from '../src/3d/platform/runtimeStoragePolicy.js';
import { createRuntimeSessionBudget } from '../src/3d/platform/runtimeSessionBudget.js';
import { createRuntimeFrameSampler } from '../src/3d/platform/runtimeFrameSampler.js';
import { createRuntimeLifecycleCoordinator } from '../src/3d/platform/runtimeLifecycleCoordinator.js';
import { classifyRuntimeError, shouldContinueAfterRuntimeError } from '../src/3d/platform/runtimeErrorPolicy.js';
import { createRuntimeCompatibilityMatrix, compatibilityDigest } from '../src/3d/platform/runtimeCompatibilityMatrix.js';
import { createWorkerCapabilityPolicy, workerTaskAllowed } from '../src/3d/platform/workerCapabilityPolicy.js';

const cpus = [1, 2, 4, 8, 16];
const memories = [null, 1, 2, 4, 8, 16];
const dprs = [0.75, 1, 1.5, 2, 3, 4];
const pointers = [
	{ coarsePointer: false, finePointer: true },
	{ coarsePointer: true, finePointer: false },
	{ coarsePointer: true, finePointer: true },
];
const networks = [
	{ online: true, effectiveType: '4g', saveData: false },
	{ online: true, effectiveType: '3g', saveData: false },
	{ online: true, effectiveType: '2g', saveData: true },
	{ online: false, effectiveType: undefined, saveData: false },
];
const a11y = [
	{ reducedMotion: false, prefersContrast: false },
	{ reducedMotion: true, prefersContrast: false },
	{ reducedMotion: false, prefersContrast: true },
	{ reducedMotion: true, prefersContrast: true },
];
const webgl = [
	{ version: 0, maxTextureSize: null, maxTextureUnits: null },
	{ version: 1, maxTextureSize: 2048, maxTextureUnits: 4 },
	{ version: 2, maxTextureSize: 4096, maxTextureUnits: 8 },
	{ version: 2, maxTextureSize: 8192, maxTextureUnits: 16 },
];

let cases = 0;
let failures = 0;
function verify(name, fn) {
	cases += 1;
	try {
		fn();
	} catch (error) {
		failures += 1;
		console.error(`FAIL ${name}: ${error?.message ?? error}`);
	}
}

for (const cpu of cpus) {
	for (const memory of memories) {
		for (const dpr of dprs) {
			for (const pointer of pointers) {
				for (const network of networks) {
					for (const accessibility of a11y) {
						for (const gpu of webgl) {
							const input = { hardwareConcurrency: cpu, deviceMemory: memory, devicePixelRatio: dpr, viewportWidth: pointer.coarsePointer ? 390 : 1920, viewportHeight: pointer.coarsePointer ? 844 : 1080, ...pointer, ...network, ...accessibility, webgl: gpu };
							const label = `${cpu}c-${memory ?? 'na'}g-${dpr}dpr-${pointer.coarsePointer ? 'coarse' : 'fine'}-${network.online ? network.effectiveType ?? 'online' : 'offline'}-${accessibility.reducedMotion ? 'rm' : 'motion'}-gl${gpu.version}`;
							verify(`${label} capability`, () => {
								const capabilities = createDeviceCapabilities(input);
								assert.ok(['minimal', 'balanced', 'high', 'ultra'].includes(capabilities.tier));
								assert.ok(capabilities.score >= 0 && capabilities.score <= 9.5);
								assert.ok(capabilities.display.dpr >= 0.5 && capabilities.display.dpr <= 8);
							});

							verify(`${label} matrix`, () => {
								const capabilities = createDeviceCapabilities(input);
								const matrix = buildRuntimeFeatureMatrix(capabilities);
								assert.ok(matrix.budget.maxChunkRadius >= 1 && matrix.budget.maxChunkRadius <= 3);
								assert.ok(matrix.budget.maxAnimatedActors >= 4 && matrix.budget.maxAnimatedActors <= 96);
								if (pointer.coarsePointer) {
									assert.equal(matrix.budget.shadowMapSize, 0);
									assert.ok(matrix.budget.pixelRatioCap <= 1);
								}
								if (network.saveData) {
									assert.equal(matrix.budget.maxTextureUpgradeConcurrency, 0);
									assert.equal(matrix.budget.maxAssetConcurrency, 1);
								}
								if (accessibility.reducedMotion) assert.ok(matrix.budget.maxAnimatedActors <= 20);
								assert.equal(featureMatrixDigest(matrix), featureMatrixDigest(buildRuntimeFeatureMatrix(capabilities)));
							});

							verify(`${label} quality application`, () => {
								const capabilities = createDeviceCapabilities(input);
								const matrix = buildRuntimeFeatureMatrix(capabilities);
								const application = resolveQualityApplication({ tier: 'ultra', devicePixelRatio: dpr, hard: { ...matrix.budget, coarsePointer: pointer.coarsePointer, reducedMotion: accessibility.reducedMotion }, requested: { pixelRatio: 2, shadowMapSize: 4096, streamRadius: 3, assetConcurrency: 4 } });
								assert.ok(application.applied.pixelRatio >= 0.5 && application.applied.pixelRatio <= 2);
								assert.ok([0, 512, 1024, 2048, 4096].includes(application.applied.shadowMapSize));
								if (pointer.coarsePointer || accessibility.reducedMotion) assert.equal(application.applied.shadowMapSize, 0);
							});
						}
					}
				}
			}
		}
	}
}

verify('storage boundaries', () => {
	for (const ratio of [0, 0.5, 0.69, 0.7, 0.84, 0.85, 0.94, 0.95, 1]) {
		const policy = evaluateStoragePressure({ usageBytes: ratio * 1000, quotaBytes: 1000 });
		assert.ok(['unknown', 'healthy', 'elevated', 'critical'].includes(policy.state));
		if (ratio >= 0.95) assert.equal(policy.recommendedAction, 'memory-only');
		if (ratio >= 0.85 && ratio < 0.95) assert.equal(policy.recommendedAction, 'defer');
		if (ratio < 0.7) assert.equal(storageWriteAllowed(policy, { bytes: 100, critical: false }), true);
	}
});

verify('session budget invariants', () => {
	const budget = createRuntimeSessionBudget({ limits: { terrain: 2, assets: 2, animation: 4, effects: 1, ui: 1, diagnostics: 1 } });
	for (const channel of ['terrain', 'assets', 'animation', 'effects', 'ui', 'diagnostics']) {
		assert.equal(budget.reserve(channel, budget.snapshot().limits[channel]), true);
		assert.equal(budget.reserve(channel, 1), false);
		budget.release(channel, 999);
		assert.equal(budget.available(channel), budget.snapshot().limits[channel]);
	}
});

verify('frame sampler bounds and reset', () => {
	const sampler = createRuntimeFrameSampler({ warmupFrames: 2, maxSamples: 16, sampleEvery: 2, clock: () => 0 });
	sampler.recordTimestamp(0);
	sampler.recordTimestamp(16);
	sampler.recordTimestamp(32);
	sampler.recordTimestamp(48);
	assert.ok(sampler.size <= 16);
	assert.ok(sampler.values().every((value) => value >= 0 && value <= 250));
	sampler.reset();
	assert.equal(sampler.size, 0);
});

verify('lifecycle state machine rejects invalid transitions', () => {
	const lifecycle = createRuntimeLifecycleCoordinator({ clock: () => 5 });
	assert.equal(lifecycle.can('ready'), false);
	assert.equal(lifecycle.transition('ready').accepted, false);
	assert.equal(lifecycle.transition('boot').accepted, true);
	assert.equal(lifecycle.transition('ready').state, 'running');
	assert.equal(lifecycle.transition('dispose').state, 'disposed');
	assert.equal(lifecycle.transition('resume').accepted, false);
});

verify('runtime error policy escalates retry budget', () => {
	const retry = classifyRuntimeError(new Error('model unavailable'), { domain: 'asset', retryable: true, attempts: 0 });
	const deferred = classifyRuntimeError(new Error('model unavailable'), { domain: 'asset', retryable: true, attempts: 3 });
	assert.equal(retry.action, 'retry');
	assert.equal(deferred.action, 'defer');
	assert.equal(shouldContinueAfterRuntimeError(deferred), true);
});

verify('compatibility matrix remains deterministic', () => {
	const input = { canvasSupported: true, esModules: true, webglSupported: true, webgl2: true, offscreenCanvas: true, serviceWorker: true, cacheStorage: true, indexedDb: true, gamepad: true, webCodecs: true, worker: true, resizeObserver: true, performanceObserver: true };
	const a = createRuntimeCompatibilityMatrix(input);
	const b = createRuntimeCompatibilityMatrix(input);
	assert.equal(a.level, 'full');
	assert.equal(compatibilityDigest(a), compatibilityDigest(b));
});

verify('worker policy is optional rather than required', () => {
	const disabled = createWorkerCapabilityPolicy({ cpu: { logicalCores: 2 } }, { features: { workerOffload: false } });
	const preferred = createWorkerCapabilityPolicy({ cpu: { logicalCores: 16 }, pointer: { coarse: false }, network: { saveData: false }, accessibility: { reducedMotion: false } }, { features: { workerOffload: true } });
	assert.equal(disabled.mode, 'disabled');
	assert.equal(workerTaskAllowed(disabled, 'terrain-analysis', 20), false);
	assert.ok(['optional', 'preferred'].includes(preferred.mode));
});

console.log(`RUNTIME_RESILIENCE_PROPERTY_CASES=${cases}`);
console.log(`RUNTIME_RESILIENCE_PROPERTY_FAILURES=${failures}`);
console.log(`RUNTIME_RESILIENCE_PROPERTY_MATRIX_${failures ? 'FAIL' : 'PASS'}`);
if (failures) process.exit(1);
