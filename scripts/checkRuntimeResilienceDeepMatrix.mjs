#!/usr/bin/env node
/**
 * Cross-system matrix for the runtime platform.
 *
 * This suite intentionally stresses combinations rather than happy paths: mobile + Save-Data,
 * reduced motion + high contrast, offline + storage pressure, strong desktop + sustained frame drops,
 * malformed profiles, and bounded asset queues. It imports real production modules and checks invariants
 * that must survive future feature additions.
 */

import assert from 'node:assert/strict';
import { createDeviceCapabilities } from '../src/3d/platform/deviceCapabilities.js';
import { buildRuntimeFeatureMatrix } from '../src/3d/platform/runtimeFeatureMatrix.js';
import { createAccessibilityPolicy } from '../src/3d/platform/accessibilityPolicy.js';
import { createInputCapabilityMatrix } from '../src/3d/platform/inputCapabilityMatrix.js';
import { createAssetLoadBudget, evaluateAssetRequest } from '../src/3d/platform/assetLoadPolicy.js';
import { createRuntimeAssetAdmissionQueue } from '../src/3d/platform/runtimeAssetAdmissionQueue.js';
import { createRuntimeSessionBudget } from '../src/3d/platform/runtimeSessionBudget.js';
import { createRuntimeTelemetry } from '../src/3d/platform/runtimeTelemetry.js';
import { createRuntimeHealthCoordinator } from '../src/3d/platform/runtimeHealthCoordinator.js';
import { createRuntimeSupportSnapshot, supportSnapshotDigest } from '../src/3d/platform/runtimeSnapshotSerializer.js';
import { resolveQualityApplication } from '../src/3d/platform/runtimeQualityApplicator.js';
import { connectRuntimeEventHealth } from '../src/3d/platform/runtimeEventHealthBridge.js';

let passed = 0;
function run(name, fn) {
	fn();
	passed += 1;
	console.log(`PASS ${name}`);
}

const matrixCases = [
	{
		name: 'desktop-fast',
		device: { hardwareConcurrency: 16, deviceMemory: 16, viewportWidth: 1920, viewportHeight: 1080, coarsePointer: false, finePointer: true, reducedMotion: false, prefersContrast: false, online: true, effectiveType: '4g', webgl: { version: 2, maxTextureSize: 8192, maxTextureUnits: 16 } },
	},
	{
		name: 'desktop-reduced-contrast',
		device: { hardwareConcurrency: 8, deviceMemory: 8, viewportWidth: 2560, viewportHeight: 1440, coarsePointer: false, finePointer: true, reducedMotion: true, prefersContrast: true, online: true, effectiveType: '4g', webgl: { version: 2, maxTextureSize: 4096, maxTextureUnits: 16 } },
	},
	{
		name: 'mobile-fast',
		device: { hardwareConcurrency: 8, deviceMemory: 4, viewportWidth: 390, viewportHeight: 844, coarsePointer: true, finePointer: false, reducedMotion: false, prefersContrast: false, online: true, effectiveType: '4g', webgl: { version: 2, maxTextureSize: 4096, maxTextureUnits: 8 } },
	},
	{
		name: 'mobile-save-data',
		device: { hardwareConcurrency: 4, deviceMemory: 2, viewportWidth: 360, viewportHeight: 800, coarsePointer: true, finePointer: false, reducedMotion: false, prefersContrast: false, saveData: true, online: true, effectiveType: '3g', webgl: { version: 1, maxTextureSize: 2048, maxTextureUnits: 4 } },
	},
	{
		name: 'offline-unknown',
		device: { hardwareConcurrency: 2, deviceMemory: 1, viewportWidth: 1024, viewportHeight: 768, coarsePointer: false, finePointer: true, reducedMotion: false, prefersContrast: false, online: false, webgl: { version: 0, maxTextureSize: null, maxTextureUnits: null } },
	},
];

for (const item of matrixCases) {
	run(`matrix ${item.name}`, () => {
		const capabilities = createDeviceCapabilities(item.device);
		const matrix = buildRuntimeFeatureMatrix(capabilities);
		assert.ok(['minimal', 'balanced', 'high', 'ultra'].includes(matrix.quality.tier));
		assert.ok(matrix.budget.maxAssetConcurrency >= 1);
		if (item.name.includes('mobile')) {
			assert.equal(matrix.budget.shadowMapSize, 0);
			assert.ok(matrix.budget.pixelRatioCap <= 1);
		}
		if (item.name.includes('save-data')) {
			assert.equal(matrix.budget.maxTextureUpgradeConcurrency, 0);
			assert.equal(matrix.budget.maxAssetConcurrency, 1);
		}
		if (item.name.includes('reduced')) assert.equal(matrix.features.cameraShake, false);
	});
}

run('malformed capabilities fail closed', () => {
	const capabilities = createDeviceCapabilities({ hardwareConcurrency: Infinity, deviceMemory: -20, devicePixelRatio: NaN, viewportWidth: NaN, viewportHeight: Infinity, coarsePointer: 'yes', webgl: { version: 99, maxTextureSize: NaN, maxTextureUnits: NaN }, online: 'yes' });
	assert.ok(capabilities.cpu.logicalCores >= 1);
	assert.ok(capabilities.display.dpr >= 0.5);
	assert.ok(capabilities.webgl.version >= 0 && capabilities.webgl.version <= 2);
	assert.equal(capabilities.pointer.coarse, false);
});

run('accessibility plus mobile stays constrained', () => {
	const caps = createDeviceCapabilities({ hardwareConcurrency: 12, deviceMemory: 8, viewportWidth: 430, viewportHeight: 900, coarsePointer: true, reducedMotion: true, prefersContrast: true, online: true, webgl: { version: 2, maxTextureSize: 8192, maxTextureUnits: 16 } });
	const matrix = buildRuntimeFeatureMatrix(caps, { budgetOverride: { maxAnimatedActors: 96, pixelRatioCap: 2, shadowMapSize: 4096 } });
	const access = createAccessibilityPolicy({ reducedMotion: true, highContrast: true });
	assert.equal(matrix.budget.shadowMapSize, 0);
	assert.ok(matrix.budget.maxAnimatedActors <= 20);
	assert.equal(access.motion.maxCameraShakeAmplitude, 0);
	assert.equal(access.readability.contrast, 'high');
});

run('input and quality policy agree on coarse pointer', () => {
	const input = createInputCapabilityMatrix({ coarsePointer: true, finePointer: false, touch: true, keyboard: false, mouse: false, gamepad: false, viewportWidth: 390 });
	const caps = createDeviceCapabilities({ hardwareConcurrency: 8, coarsePointer: true, finePointer: false, viewportWidth: 390, online: true, webgl: { version: 2, maxTextureSize: 4096 } });
	const matrix = buildRuntimeFeatureMatrix(caps);
	assert.equal(input.device.primary, 'touch');
	assert.equal(matrix.budget.shadowMapSize, 0);
});

run('quality application clamps unsafe requested renderer state', () => {
	const application = resolveQualityApplication({ tier: 'ultra', devicePixelRatio: 4, hard: { pixelRatioCap: 1, shadowMapSize: 1024, maxChunkRadius: 2, maxAssetConcurrency: 2, coarsePointer: true, reducedMotion: false }, requested: { pixelRatio: 3, shadowMapSize: 4096, streamRadius: 9, assetConcurrency: 8 } });
	assert.ok(application.applied.pixelRatio <= 1);
	assert.equal(application.applied.shadowMapSize, 0);
	assert.equal(application.applied.streamRadius, 2);
	assert.equal(application.applied.assetConcurrency, 2);
	assert.equal(application.clamped.shadowMapSize, true);
});

run('asset queue respects concurrency and deterministic priority', () => {
	const caps = createDeviceCapabilities({ hardwareConcurrency: 16, deviceMemory: 16, coarsePointer: false, finePointer: true, online: true, effectiveType: '4g', webgl: { version: 2, maxTextureSize: 8192 } });
	const matrix = buildRuntimeFeatureMatrix(caps);
	const queue = createRuntimeAssetAdmissionQueue({ matrix, now: () => 100 });
	queue.enqueueMany([
		{ id: 'ambient-z', priority: 20, estimatedBytes: 1000 },
		{ id: 'player', priority: 90, estimatedBytes: 1000 },
		{ id: 'world-a', priority: 70, estimatedBytes: 1000 },
		{ id: 'ambient-a', priority: 20, estimatedBytes: 1000 },
	]);
	const admissions = queue.nextAdmissions();
	assert.ok(admissions.length >= 1);
	assert.equal(admissions[0].request.id, 'player');
	assert.ok(queue.snapshot().activeIds.includes('player'));
	queue.complete('player', { ok: true });
	assert.equal(queue.snapshot().completedIds.includes('player'), true);
});

run('offline asset admission rejects network-required critical work', () => {
	const decision = evaluateAssetRequest({ id: 'required-player', priority: 100, kind: 'critical', networkRequired: true }, { offline: true, activeLoads: 0, concurrencyLimit: 4 });
	assert.equal(decision.action, 'reject');
	assert.equal(decision.critical, true);
});

run('session budget never exceeds channel limits', () => {
	const ledger = createRuntimeSessionBudget({ limits: { terrain: 2, assets: 2, animation: 3, effects: 1, ui: 1, diagnostics: 1 } });
	assert.equal(ledger.reserve('terrain', 2), true);
	assert.equal(ledger.reserve('terrain', 1), false);
	assert.equal(ledger.available('terrain'), 0);
	assert.equal(ledger.release('terrain', 1), true);
	assert.equal(ledger.available('terrain'), 1);
	const result = ledger.withReservation('assets', 2, () => 'done');
	assert.equal(result.admitted, true);
	assert.equal(result.result, 'done');
	assert.equal(ledger.available('assets'), 2);
});

run('telemetry sanitizes object-valued fields', () => {
	const telemetry = createRuntimeTelemetry({ limit: 32, clock: () => 10 });
	const entry = telemetry.info('safe', { object: { secret: true }, url: 'https://example.test/secret', number: 2 });
	assert.equal(entry.fields.object, undefined);
	assert.equal(entry.fields.url, 'https://example.test/secret'.slice(0, 160));
	assert.equal(entry.fields.number, 2);
});

run('health status becomes critical on frame pressure', () => {
	const caps = createDeviceCapabilities({ hardwareConcurrency: 8, deviceMemory: 8, coarsePointer: false, finePointer: true, online: true, webgl: { version: 2, maxTextureSize: 4096 } });
	const matrix = buildRuntimeFeatureMatrix(caps);
	const health = createRuntimeHealthCoordinator({ capabilities: caps, matrix });
	health.updatePerformance({ pressure: 'critical', pressureScore: 5.1, frame: { p95: 80, budgetMs: 18 } });
	assert.equal(health.snapshot().status, 'critical');
});

run('support snapshot strips arbitrary data', () => {
	const telemetry = createRuntimeTelemetry({ limit: 8 });
	telemetry.info('hello', { value: 1 });
	const snapshot = createRuntimeSupportSnapshot({
		version: 'r1',
		health: { snapshot: () => ({ status: 'healthy', capabilities: { tier: 'high', score: 8, webgl: { version: 2 }, pointer: { coarse: false }, accessibility: { reducedMotion: false } }, featureMatrix: { quality: { tier: 'high' } }, issues: [], performance: { pressure: 'relaxed', p95: 15, frameBudgetMs: 18, pressureScore: 0.8 }, offline: {} , digests: { featureMatrix: 'abc', input: 'def' } }) },
		governor: { snapshot: () => ({ tier: 'high', action: 'hold', sequence: 3 }) },
		telemetry,
		offline: { snapshot: () => ({ network: { state: 'online' }, storage: { state: 'available' }, resilience: { canPlayOffline: true }, update: { state: 'idle' } }) },
	});
	const serialized = JSON.stringify(snapshot);
	assert.ok(serialized.length < 10000);
	assert.equal(typeof supportSnapshotDigest(snapshot), 'string');
	assert.ok(snapshot.telemetry.events.length <= 12);
});

run('event health bridge connects and disconnects cleanly', () => {
	const handlers = new Map();
	const events = {
		on(name, handler) {
			handlers.set(name, handler);
			return () => handlers.delete(name);
		},
	};
	const telemetry = createRuntimeTelemetry({ limit: 32 });
	const disconnect = connectRuntimeEventHealth({ events, names: { assetError: 'asset:error', assetsReady: 'assets:ready', gameReady: 'game:ready', gameError: 'game:error' }, telemetry, now: () => 1 });
	assert.equal(handlers.size, 4);
	handlers.get('asset:error')({ id: 'bad-asset' });
	assert.equal(telemetry.count('runtime.event.asset-error'), 1);
	disconnect();
	assert.equal(handlers.size, 0);
});

console.log(`RUNTIME_RESILIENCE_DEEP_MATRIX_PASS ${passed} checks`);
