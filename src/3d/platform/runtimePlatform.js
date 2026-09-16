/**
 * Unified next-generation runtime platform facade.
 *
 * This module is the narrow integration seam for the 3D game. It composes capability detection,
 * adaptive feature budgeting, accessibility policy, input capabilities, PWA resilience, asset admission,
 * telemetry and health reporting. Each subsystem remains independently testable and none becomes a
 * second gameplay owner.
 *
 * Callers may create the platform once during scene bootstrap and feed frame/work samples from the
 * existing tick loop. The platform returns immutable snapshots; applying them remains the caller's job.
 */

import { createDeviceCapabilities, summarizeDeviceCapabilities } from './deviceCapabilities.js';
import { buildRuntimeFeatureMatrix, featureMatrixDigest } from './runtimeFeatureMatrix.js';
import { createAdaptiveRuntimeGovernor } from './adaptiveRuntimeGovernor.js';
import { createRuntimeTelemetry } from './runtimeTelemetry.js';
import { createOfflineResilience } from './offlineResilience.js';
import { createAccessibilityPolicy } from './accessibilityPolicy.js';
import { createInputCapabilityMatrix, inputCapabilityDigest } from './inputCapabilityMatrix.js';
import { createAssetLoadBudget } from './assetLoadPolicy.js';
import { createRuntimeHealthCoordinator } from './runtimeHealthCoordinator.js';

const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};

function nowDefault() {
	return typeof performance !== 'undefined' && Number.isFinite(performance.now()) ? performance.now() : 0;
}

export function createRuntimePlatform(options = {}) {
	const clock = typeof options.clock === 'function' ? options.clock : nowDefault;
	const telemetry = options.telemetry ?? createRuntimeTelemetry({ clock, limit: options.telemetryLimit ?? 256 });
	const capabilities = options.capabilities ?? createDeviceCapabilities(options.device ?? {});
	const accessibility = options.accessibility ?? createAccessibilityPolicy(options.accessibilityInput ?? {});
	const input = options.input ?? createInputCapabilityMatrix(options.inputInput ?? {});
	const matrix = buildRuntimeFeatureMatrix(capabilities, { budgetOverride: options.budgetOverride });
	const governor = createAdaptiveRuntimeGovernor({
		capabilities,
		matrix,
		initialTier: matrix.quality.tier,
		manualLock: options.manualLock === true,
		now: clock,
		...(options.governor ?? {}),
	});
	const offline = createOfflineResilience(options.offline ?? {});
	const assetBudget = createAssetLoadBudget(matrix, options.assetBudget ?? {});
	const health = createRuntimeHealthCoordinator({ capabilities, matrix, accessibility, input, telemetry });
	telemetry.info('runtime.platform-created', {
		tier: capabilities.tier,
		device: summarizeDeviceCapabilities(capabilities),
		matrix: featureMatrixDigest(matrix),
		input: inputCapabilityDigest(input),
	});

	let disposed = false;
	let latestPerformance = null;

	function sampleFrame(frameMs, work = {}) {
		if (disposed) return snapshot();
		const result = governor.sample({ frameMs, ...work, timestamp: clock() });
		latestPerformance = result.evaluation;
		health.updatePerformance(result.evaluation ?? {});
		if (result.action === 'degrade' || result.action === 'recover') {
			telemetry.info(`runtime.quality-${result.action}`, {
				tier: result.tier,
				sequence: result.sequence,
				reason: result.reason,
			});
		}
		return result;
	}

	function reportOffline(snapshotValue) {
		if (disposed) return snapshot();
		health.updateOffline(snapshotValue);
		telemetry.info('runtime.offline-state', { state: snapshotValue?.network?.state ?? 'unknown' });
		return snapshot();
	}

	function snapshot() {
		return freeze({
			version: 1,
		disposed,
			capabilities,
			accessibility,
			input,
			featureMatrix: matrix,
			governor: governor.snapshot(latestPerformance),
			offline: offline.snapshot(),
			assetBudget,
			health: health.snapshot(),
			telemetry: telemetry.summarize(),
		});
	}

	function setManualQuality(tier, locked = true) {
		if (disposed) return snapshot();
		governor.setManualLock(locked);
		const result = governor.setTier(tier, { reason: locked ? 'manual-quality' : 'automatic-quality' });
		telemetry.info('runtime.quality-manual', { tier: result.tier, locked });
		return result;
	}

	async function refreshPwa() {
		const state = await offline.checkForUpdate();
		health.updateOffline(offline.snapshot());
		return snapshot();
	}

	async function refreshStorage() {
		const state = await offline.refreshStorage();
		health.updateOffline(state);
		return snapshot();
	}

	function setOnline(value) {
		const state = offline.setOnline(value);
		health.updateOffline(state);
		return snapshot();
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		offline.dispose();
		governor.reset();
		telemetry.info('runtime.platform-disposed', {});
		telemetry.dispose();
	}

	return {
		capabilities,
		accessibility,
		input,
		featureMatrix: matrix,
		assetBudget,
		governor,
		telemetry,
		offline,
		health,
		sampleFrame,
		reportOffline,
		setManualQuality,
		setOnline,
		refreshPwa,
		refreshStorage,
		snapshot,
		dispose,
		get isDisposed() { return disposed; },
	};
}
