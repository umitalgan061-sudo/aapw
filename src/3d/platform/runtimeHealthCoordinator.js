/**
 * Runtime health coordinator.
 *
 * Combines capability, feature, performance, accessibility and offline snapshots into one immutable
 * health record. It deliberately does not mutate any gameplay owner. The coordinator exists to make
 * failures diagnosable and decisions inspectable: tests can consume the same record a future debug HUD
 * or support bundle would consume.
 */

import { buildRuntimeFeatureMatrix, featureMatrixDigest } from './runtimeFeatureMatrix.js';
import { createAccessibilityPolicy } from './accessibilityPolicy.js';
import { createInputCapabilityMatrix, inputCapabilityDigest } from './inputCapabilityMatrix.js';

const STATUS = Object.freeze({ HEALTHY: 'healthy', DEGRADED: 'degraded', CRITICAL: 'critical', UNKNOWN: 'unknown' });
const freeze = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
};
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function deriveStatus({ performance, offline, capabilities }) {
	if (performance?.pressure === 'critical') return STATUS.CRITICAL;
	if (offline?.network?.state === 'offline' && !offline?.resilience?.canPlayOffline) return STATUS.DEGRADED;
	if (capabilities?.webgl?.available === false) return STATUS.CRITICAL;
	if (performance?.pressure === 'elevated' || offline?.storage?.state === 'limited') return STATUS.DEGRADED;
	return STATUS.HEALTHY;
}

function topIssues({ performance, offline, accessibility, input }) {
	const issues = [];
	if (performance?.pressure === 'critical') issues.push('frame-pressure-critical');
	else if (performance?.pressure === 'elevated') issues.push('frame-pressure-elevated');
	if (offline?.network?.state === 'offline') issues.push('offline');
	if (offline?.storage?.state === 'limited') issues.push('storage-limited');
	if (accessibility?.motion?.level === 'reduced') issues.push('reduced-motion');
	if (input?.device?.primary === 'touch') issues.push('touch-primary');
	return issues.slice(0, 8);
}

export class RuntimeHealthCoordinator {
	constructor({ capabilities, matrix = null, accessibility = null, input = null, telemetry = null } = {}) {
		this.capabilities = freeze(capabilities ?? {});
		this.matrix = freeze(matrix ?? buildRuntimeFeatureMatrix(this.capabilities));
		this.accessibility = freeze(accessibility ?? createAccessibilityPolicy());
		this.input = freeze(input ?? createInputCapabilityMatrix());
		this.telemetry = telemetry ?? null;
		this.performance = freeze({ pressure: 'unknown', p95: 0, frameBudgetMs: 24, pressureScore: 0 });
		this.offline = freeze({ network: { state: 'unknown' }, storage: { state: 'unknown' }, resilience: { canPlayOffline: false } });
		this.sequence = 0;
	}

	updatePerformance(snapshot = {}) {
		this.performance = freeze({
			pressure: snapshot.pressure ?? 'unknown',
			p95: finiteOr(snapshot.frame?.p95, 0),
			frameBudgetMs: finiteOr(snapshot.frame?.budgetMs, 24),
			pressureScore: clamp(finiteOr(snapshot.pressureScore, 0), 0, 6),
		});
		this.sequence += 1;
		return this.snapshot();
	}

	updateOffline(snapshot = {}) {
		this.offline = freeze({
			network: { state: snapshot.network?.state ?? 'unknown' },
			storage: { ...(snapshot.storage ?? { state: 'unknown' }) },
			resilience: { ...(snapshot.resilience ?? { canPlayOffline: false }) },
		});
		this.sequence += 1;
		return this.snapshot();
	}

	updateMatrix(matrix) {
		if (matrix && typeof matrix === 'object') this.matrix = freeze(matrix);
		this.sequence += 1;
		return this.snapshot();
	}

	rebuildMatrix(overrides) {
	this.matrix = buildRuntimeFeatureMatrix(this.capabilities, overrides);
	this.sequence += 1;
	return this.snapshot();
	}

	snapshot() {
	const status = deriveStatus({ performance: this.performance, offline: this.offline, capabilities: this.capabilities });
	const snapshot = {
		version: 1,
		sequence: this.sequence,
		status,
		capabilities: this.capabilities,
		featureMatrix: this.matrix,
		accessibility: this.accessibility,
		input: this.input,
		performance: this.performance,
		offline: this.offline,
		issues: topIssues({ performance: this.performance, offline: this.offline, accessibility: this.accessibility, input: this.input }),
		digests: {
			featureMatrix: featureMatrixDigest(this.matrix),
			input: inputCapabilityDigest(this.input),
			telemetry: this.telemetry?.digest?.() ?? null,
		},
	};
	return freeze(snapshot);
	}

	toSupportRecord() {
		const snap = this.snapshot();
		return freeze({
			version: snap.version,
			sequence: snap.sequence,
			status: snap.status,
			qualityTier: snap.featureMatrix.quality?.tier ?? 'balanced',
			deviceTier: snap.capabilities.tier ?? 'unknown',
			issues: snap.issues.slice(),
			performance: { ...snap.performance },
			offline: { network: { ...snap.offline.network }, storage: { ...snap.offline.storage } },
			digests: { ...snap.digests },
		});
	}
}

export function createRuntimeHealthCoordinator(options) {
	return new RuntimeHealthCoordinator(options);
}

export function runtimeHealthStatuses() { return STATUS; }
