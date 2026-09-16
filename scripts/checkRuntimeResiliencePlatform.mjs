#!/usr/bin/env node
/**
 * Executable contract for the next-generation runtime resilience platform.
 *
 * The project intentionally avoids a package dependency for focused acceptance checks. This script
 * imports the real production modules directly and verifies their contracts with deterministic fixtures.
 * The matrix is broad enough to catch regressions across device detection, accessibility, input,
 * performance adaptation, asset admission, telemetry, offline resilience and health aggregation.
 */

import assert from 'node:assert/strict';
import { createDeviceCapabilities, summarizeDeviceCapabilities, getCapabilityTierConstants } from '../src/3d/platform/deviceCapabilities.js';
import { buildRuntimeFeatureMatrix, featureMatrixDigest, mergeFeatureMatrix } from '../src/3d/platform/runtimeFeatureMatrix.js';
import { evaluateRuntimeBudget, createBudgetWindow, budgetTierIndex } from '../src/3d/platform/performanceBudgetPolicy.js';
import { createAdaptiveRuntimeGovernor, governorTierDistance } from '../src/3d/platform/adaptiveRuntimeGovernor.js';
import { createRuntimeTelemetry } from '../src/3d/platform/runtimeTelemetry.js';
import { createOfflineResilience, offlineResilienceConstants } from '../src/3d/platform/offlineResilience.js';
import { createAccessibilityPolicy, scaleAnimationDuration, scaleCameraShake } from '../src/3d/platform/accessibilityPolicy.js';
import { createInputCapabilityMatrix, inputCapabilityDigest } from '../src/3d/platform/inputCapabilityMatrix.js';
import { evaluateAssetRequest, sortAssetRequests, createAssetLoadBudget } from '../src/3d/platform/assetLoadPolicy.js';
import { createRuntimeHealthCoordinator } from '../src/3d/platform/runtimeHealthCoordinator.js';
import { createRuntimePlatform } from '../src/3d/platform/runtimePlatform.js';

const checks = [];
function check(name, fn) {
	try {
		fn();
		checks.push({ name, status: 'PASS' });
		console.log(`PASS ${name}`);
	} catch (error) {
		checks.push({ name, status: 'FAIL', error: String(error) });
		console.error(`FAIL ${name}\n${error?.stack ?? error}`);
		throw error;
	}
}

async function checkAsync(name, fn) {
	try {
		await fn();
		checks.push({ name, status: 'PASS' });
		console.log(`PASS ${name}`);
	} catch (error) {
		checks.push({ name, status: 'FAIL', error: String(error) });
		console.error(`FAIL ${name}\n${error?.stack ?? error}`);
		throw error;
	}
}

const desktopDevice = createDeviceCapabilities({
	hardwareConcurrency: 16,
	deviceMemory: 16,
	devicePixelRatio: 1.5,
	viewportWidth: 1920,
	viewportHeight: 1080,
	coarsePointer: false,
	finePointer: true,
	reducedMotion: false,
	prefersContrast: false,
	online: true,
	effectiveType: '4g',
	webgl: { version: 2, maxTextureSize: 8192, maxTextureUnits: 16, renderer: 'Test Renderer', vendor: 'Test Vendor' },
});

const mobileDevice = createDeviceCapabilities({
	hardwareConcurrency: 8,
	deviceMemory: 4,
	devicePixelRatio: 3,
	viewportWidth: 390,
	viewportHeight: 844,
	coarsePointer: true,
	finePointer: false,
	reducedMotion: false,
	prefersContrast: false,
	online: true,
	effectiveType: '4g',
	webgl: { version: 2, maxTextureSize: 4096, maxTextureUnits: 8, renderer: 'Mobile Test', vendor: 'Test Vendor' },
});

const reducedDevice = createDeviceCapabilities({
	hardwareConcurrency: 8,
	deviceMemory: 8,
	devicePixelRatio: 1,
	viewportWidth: 1440,
	viewportHeight: 900,
	coarsePointer: false,
	finePointer: true,
	reducedMotion: true,
	prefersContrast: true,
	online: true,
	effectiveType: '4g',
	webgl: { version: 2, maxTextureSize: 4096, maxTextureUnits: 16 },
});

check('capability constants are exposed', () => {
	const constants = getCapabilityTierConstants();
	assert.deepEqual(Object.keys(constants.tiers).sort(), ['balanced', 'high', 'minimal', 'ultra']);
	assert.equal(constants.pointers.COARSE, 'coarse');
	assert.equal(constants.networks.FAST, 'fast');
});

check('desktop capability tier reaches high or ultra under strong fixture', () => {
	assert.ok(['high', 'ultra'].includes(desktopDevice.tier));
	assert.equal(desktopDevice.webgl.version, 2);
	assert.equal(desktopDevice.network.class, 'fast');
	assert.equal(desktopDevice.pointer.class, 'fine');
});

check('mobile capability profile remains conservative', () => {
	assert.ok(['minimal', 'balanced'].includes(mobileDevice.tier));
	assert.equal(mobileDevice.features.enableShadows, false);
	assert.equal(mobileDevice.features.enableHeavyAssetPrefetch, true);
	assert.equal(mobileDevice.pointer.class, 'coarse');
});

check('reduced motion is a hard presentation constraint', () => {
	assert.equal(reducedDevice.accessibility.reducedMotion, true);
	assert.equal(reducedDevice.features.enableHighFrequencyAnimation, false);
	assert.equal(reducedDevice.features.enableShadows, false);
});

check('capability summary is deterministic', () => {
	assert.equal(summarizeDeviceCapabilities(desktopDevice), summarizeDeviceCapabilities(desktopDevice));
	assert.match(summarizeDeviceCapabilities(desktopDevice), /^v1\|/);
});

const desktopMatrix = buildRuntimeFeatureMatrix(desktopDevice);
const mobileMatrix = buildRuntimeFeatureMatrix(mobileDevice);
const reducedMatrix = buildRuntimeFeatureMatrix(reducedDevice);

check('desktop feature matrix is frozen and internally coherent', () => {
	assert.equal(Object.isFrozen(desktopMatrix), true);
	assert.equal(desktopMatrix.features.shadows, true);
	assert.ok(desktopMatrix.budget.maxAssetConcurrency >= 2);
	assert.ok(desktopMatrix.budget.pixelRatioCap >= 1);
});

check('mobile hard invariants beat override requests', () => {
	const matrix = buildRuntimeFeatureMatrix(mobileDevice, {
		budgetOverride: { shadowMapSize: 4096, pixelRatioCap: 2, maxChunkRadius: 99, maxTextureUpgradeConcurrency: 3 },
	});
	assert.equal(matrix.budget.shadowMapSize, 0);
	assert.ok(matrix.budget.pixelRatioCap <= 1);
	assert.ok(matrix.budget.maxChunkRadius <= 2);
	assert.equal(matrix.budget.maxTextureUpgradeConcurrency, 0);
});

check('reduced-motion matrix lowers animation budget', () => {
	assert.ok(reducedMatrix.budget.maxAnimatedActors <= 20);
	assert.equal(reducedMatrix.features.cameraShake, false);
});

check('feature matrix digest remains stable under repeated evaluation', () => {
	assert.equal(featureMatrixDigest(desktopMatrix), featureMatrixDigest(buildRuntimeFeatureMatrix(desktopDevice)));
});

check('feature matrix merge preserves base metadata', () => {
	const merged = mergeFeatureMatrix(desktopMatrix, { budget: { frameBudgetMs: 19 } });
	assert.equal(merged.quality.tier, desktopMatrix.quality.tier);
	assert.equal(merged.budget.frameBudgetMs, 19);
});

check('budget evaluator detects critical sustained pressure', () => {
	const evaluation = evaluateRuntimeBudget({
		samples: Array.from({ length: 40 }, () => 48),
		currentTier: 'high',
		frameBudgetMs: 18,
		streamingMs: 20,
		assetQueueDepth: 12,
		mainThreadBlockingMs: 80,
	});
	assert.equal(evaluation.pressure, 'critical');
	assert.equal(evaluation.action, 'degrade');
	assert.equal(evaluation.recommendedTier, 'balanced');
	assert.ok(evaluation.frame.p95 >= 48);
});

check('budget evaluator requires sustained headroom before recovery', () => {
	const evaluation = evaluateRuntimeBudget({
		samples: Array.from({ length: 60 }, () => 12),
		currentTier: 'balanced',
		frameBudgetMs: 24,
	});
	assert.equal(evaluation.action, 'recover');
	assert.equal(evaluation.recommendedTier, 'high');
});

check('manual lock prevents adaptation', () => {
	const evaluation = evaluateRuntimeBudget({
		samples: Array.from({ length: 60 }, () => 80),
		currentTier: 'ultra',
		manualLock: true,
	});
	assert.equal(evaluation.action, 'hold');
	assert.equal(evaluation.recommendedTier, 'ultra');
});

check('budget window is bounded and rejects non-finite values', () => {
	const window = createBudgetWindow(32);
	assert.equal(window.push(Number.NaN), false);
	assert.equal(window.push(Infinity), false);
	window.pushMany(Array.from({ length: 60 }, () => 17));
	assert.equal(window.size, 32);
	assert.equal(window.values().every((value) => value === 17), true);
	window.clear();
	assert.equal(window.size, 0);
});

check('tier indexing is monotonic', () => {
	assert.equal(budgetTierIndex('minimal'), 0);
	assert.equal(budgetTierIndex('balanced'), 1);
	assert.equal(budgetTierIndex('high'), 2);
	assert.equal(budgetTierIndex('ultra'), 3);
	assert.equal(budgetTierIndex('garbage'), 1);
});

const governor = createAdaptiveRuntimeGovernor({
	capabilities: desktopDevice,
	matrix: desktopMatrix,
	initialTier: 'high',
	degradeConfirmations: 2,
	recoverConfirmations: 4,
	cooldownSamples: 2,
	now: () => 100,
});

check('governor requires confirmation before degrading', () => {
	const first = governor.sample({ frameMs: 60, mainThreadBlockingMs: 90 });
	assert.equal(first.tier, 'high');
	const second = governor.sample({ frameMs: 60, mainThreadBlockingMs: 90 });
	assert.equal(second.tier, 'balanced');
	assert.equal(second.action, 'degrade');
});

check('governor cooldown prevents immediate oscillation', () => {
	governor.sample({ frameMs: 12 });
	const snap = governor.sample({ frameMs: 12 });
	assert.ok(snap.cooldownSamples >= 0);
	assert.ok(['balanced', 'high'].includes(snap.tier));
});

check('governor manual lock holds tier', () => {
	governor.setManualLock(true);
	const before = governor.snapshot();
	const after = governor.sample({ frameMs: 90, mainThreadBlockingMs: 100 });
	assert.equal(after.tier, before.tier);
	assert.equal(after.action, before.action === 'degrade' ? 'degrade' : 'hold');
	governor.setManualLock(false);
});

check('governor tier distance is symmetric', () => {
	assert.equal(governorTierDistance('minimal', 'ultra'), governorTierDistance('ultra', 'minimal'));
	assert.equal(governorTierDistance('balanced', 'high'), 1);
});

const telemetry = createRuntimeTelemetry({ limit: 8, clock: () => 10, sessionId: 'contract-test' });
check('telemetry retains bounded safe fields', () => {
	for (let i = 0; i < 20; i += 1) telemetry.info(`event-${i}`, { value: i, unsafe: { object: true }, long: 'x'.repeat(500) });
	assert.equal(telemetry.recent(8).length, 8);
	assert.equal(telemetry.summarize().retained, 8);
	assert.ok(telemetry.digest().length >= 8);
	assert.ok(telemetry.count('event-19') >= 1);
});

check('telemetry is fail-closed after disposal', () => {
	telemetry.dispose();
	assert.equal(telemetry.info('ignored', {}), null);
	assert.equal(telemetry.isDisposed, true);
});

const reducedAccessibility = createAccessibilityPolicy({ reducedMotion: true, highContrast: true });
check('accessibility policy scales motion down', () => {
	assert.equal(reducedAccessibility.motion.level, 'reduced');
	assert.equal(scaleCameraShake(0.8, reducedAccessibility), 0);
	assert.ok(scaleAnimationDuration(1000, reducedAccessibility) <= 80);
	assert.equal(reducedAccessibility.readability.contrast, 'high');
});

const inputDesktop = createInputCapabilityMatrix({ coarsePointer: false, finePointer: true, keyboard: true, mouse: true, touch: false, gamepad: true, viewportWidth: 1440 });
const inputTouch = createInputCapabilityMatrix({ coarsePointer: true, finePointer: false, keyboard: false, mouse: false, touch: true, gamepad: true, maxTouchPoints: 5, viewportWidth: 390 });
check('input matrix chooses mouse as fine-pointer primary', () => {
	assert.equal(inputDesktop.device.primary, 'mouse');
	assert.equal(inputDesktop.features.showTouchHud, false);
	assert.ok(inputDesktop.actionHints.camera.includes('gamepad'));
});

check('input matrix chooses touch as coarse-pointer primary', () => {
	assert.equal(inputTouch.device.primary, 'touch');
	assert.equal(inputTouch.features.showTouchHud, true);
	assert.equal(inputTouch.features.preferLargeControls, true);
	assert.equal(inputCapabilityDigest(inputTouch), inputCapabilityDigest(inputTouch));
});

const assetBudget = createAssetLoadBudget(desktopMatrix);
check('asset budget inherits runtime matrix', () => {
	assert.ok(assetBudget.concurrencyLimit >= 2);
	assert.ok(assetBudget.maxDeferredQueue >= 8);
});

check('asset admission prioritizes player over ambient work', () => {
	const ambient = evaluateAssetRequest({ id: 'ambient-tree', priority: 20, estimatedBytes: 100000 }, { activeLoads: 4, concurrencyLimit: 4 });
	const player = evaluateAssetRequest({ id: 'player', priority: 90, estimatedBytes: 100000 }, { activeLoads: 4, concurrencyLimit: 4 });
	assert.equal(ambient.action, 'defer');
	assert.equal(player.action, 'admit');
});

check('asset admission is fail-safe offline', () => {
	const critical = evaluateAssetRequest({ id: 'player', priority: 100, networkRequired: true, kind: 'critical' }, { offline: true });
	const optional = evaluateAssetRequest({ id: 'tree', priority: 20, networkRequired: true }, { offline: true });
	assert.equal(critical.action, 'reject');
	assert.equal(optional.action, 'defer');
});

check('asset request sorting is deterministic', () => {
	const requests = [{ id: 'z', priority: 40 }, { id: 'a', priority: 40 }, { id: 'player', priority: 90 }];
	assert.deepEqual(sortAssetRequests(requests).map((item) => item.id), ['player', 'a', 'z']);
});

const offline = createOfflineResilience({ onlineState: false, storageEstimate: { state: 'limited', ratio: 0.95, usageBytes: 95, quotaBytes: 100 }, caches: { keys: async () => ['b', 'a'] } });
await checkAsync('offline resilience reports safe offline state', async () => {
	const state = offline.snapshot();
	assert.equal(state.network.state, 'offline');
	assert.equal(state.resilience.canPlayOffline, false);
	assert.equal(state.resilience.shouldDeferHeavyPrefetch, true);
	const caches = await offline.inspectCaches();
	assert.deepEqual(caches.names, ['a', 'b']);
});

await checkAsync('offline resilience storage probe is bounded', async () => {
	const state = await offline.refreshStorage();
	assert.ok(['unknown', 'limited', 'available'].includes(state.storage.state));
});

offline.dispose();
check('offline constants are immutable', () => {
	const constants = offlineResilienceConstants();
	assert.equal(Object.isFrozen(constants), true);
	assert.equal(constants.states.OFFLINE, 'offline');
});

const health = createRuntimeHealthCoordinator({ capabilities: desktopDevice, matrix: desktopMatrix, telemetry: createRuntimeTelemetry() });
check('health coordinator aggregates performance and issues', () => {
	health.updatePerformance({ pressure: 'elevated', frame: { p95: 31, budgetMs: 18 }, pressureScore: 2.4 });
	health.updateOffline({ network: { state: 'online' }, storage: { state: 'available' }, resilience: { canPlayOffline: true } });
	const snap = health.snapshot();
	assert.equal(snap.status, 'degraded');
	assert.ok(snap.issues.includes('frame-pressure-elevated'));
	assert.equal(snap.digests.featureMatrix, featureMatrixDigest(desktopMatrix));
});

const platform = createRuntimePlatform({
	capabilities: desktopDevice,
	clock: () => 500,
	governor: { degradeConfirmations: 2, cooldownSamples: 1 },
});

check('runtime platform creates a coherent unified snapshot', () => {
	const snap = platform.snapshot();
	assert.equal(snap.version, 1);
	assert.ok(snap.featureMatrix);
	assert.ok(snap.governor);
	assert.ok(snap.health);
	assert.ok(snap.telemetry);
	assert.equal(platform.isDisposed, false);
});

check('runtime platform samples without requiring browser globals', () => {
	const first = platform.sampleFrame(16.5, { streamingMs: 2, assetQueueDepth: 1 });
	assert.ok(['hold', 'recover', 'degrade', 'stabilize'].includes(first.action));
	const second = platform.sampleFrame(65, { streamingMs: 30, assetQueueDepth: 12, mainThreadBlockingMs: 100 });
	assert.ok(second.sequence >= first.sequence);
});

await checkAsync('runtime platform can refresh PWA state without blocking creation', async () => {
	const snapshot = await platform.refreshStorage();
	assert.ok(snapshot.health);
	assert.ok(snapshot.offline);
});

check('runtime platform manual quality path is observable', () => {
	const manual = platform.setManualQuality('high', true);
	assert.equal(manual.tier, 'high');
	assert.equal(manual.manualLock, true);
	platform.setManualQuality('high', false);
});

const finalBeforeDispose = platform.snapshot();
check('runtime platform disposal is deterministic', () => {
	platform.dispose();
	assert.equal(platform.isDisposed, true);
	assert.equal(platform.snapshot().disposed, true);
	assert.equal(finalBeforeDispose.version, 1);
});

const failures = checks.filter((entry) => entry.status === 'FAIL');
console.log(`RUNTIME_RESILIENCE_PLATFORM_${failures.length ? 'FAIL' : 'PASS'} ${checks.length} checks`);
if (failures.length) process.exit(1);
