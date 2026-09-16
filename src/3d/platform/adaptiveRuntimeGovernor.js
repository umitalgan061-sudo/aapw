/**
 * Runtime quality governor.
 *
 * Owns policy state only. It does not own Three.js, timers, DOM listeners, requestAnimationFrame,
 * asset loading or world mutation. A caller feeds frame/work measurements into `sample()` and applies
 * the returned immutable snapshot to the already-existing systems.
 *
 * The governor combines device capability, feature budgets and robust performance statistics. It uses
 * hysteresis and cooldown samples to avoid quality flapping. Manual quality is respected, but hard
 * mobile/reduced-motion/network constraints still win because those are safety and accessibility
 * invariants rather than preferences.
 */

import { evaluateRuntimeBudget, budgetTierIndex } from './performanceBudgetPolicy.js';
import { featureMatrixDigest } from './runtimeFeatureMatrix.js';

const TIERS = Object.freeze(['minimal', 'balanced', 'high', 'ultra']);
const ACTIONS = Object.freeze(['hold', 'degrade', 'recover', 'stabilize']);
const DEFAULTS = Object.freeze({
	windowSize: 120,
	degradeConfirmations: 2,
	recoverConfirmations: 4,
	cooldownSamples: 20,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

function freeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
}

function tierAt(index) {
	return TIERS[clamp(index, 0, TIERS.length - 1)];
}

function nextTier(tier, direction) {
	const index = budgetTierIndex(tier);
	return tierAt(index + direction);
}

function sanitizeManualTier(value, fallback) {
	return TIERS.includes(value) ? value : fallback;
}

export class AdaptiveRuntimeGovernor {
	constructor({ capabilities, matrix, initialTier, manualLock = false, now = () => performance.now(), ...options } = {}) {
		this.capabilities = freeze(capabilities ?? {});
		this.matrix = freeze(matrix ?? {});
		this.config = freeze({
			windowSize: clamp(Math.round(finiteOr(options.windowSize, DEFAULTS.windowSize)), 30, 240),
			degradeConfirmations: clamp(Math.round(finiteOr(options.degradeConfirmations, DEFAULTS.degradeConfirmations)), 1, 8),
			recoverConfirmations: clamp(Math.round(finiteOr(options.recoverConfirmations, DEFAULTS.recoverConfirmations)), 1, 12),
			cooldownSamples: clamp(Math.round(finiteOr(options.cooldownSamples, DEFAULTS.cooldownSamples)), 0, 120),
		});
		this.manualLock = Boolean(manualLock);
		this.now = typeof now === 'function' ? now : () => 0;
		this.tier = sanitizeManualTier(initialTier, matrix?.quality?.tier ?? capabilities?.tier ?? 'balanced');
		this.samples = [];
		this.healthyStreak = 0;
		this.pressureStreak = 0;
		this.cooldown = 0;
		this.sequence = 0;
		this.lastAction = 'hold';
		this.lastTimestamp = finiteOr(this.now(), 0);
	}

	setManualLock(locked) {
		this.manualLock = Boolean(locked);
		return this.snapshot();
	}

	setTier(tier, { reason = 'external' } = {}) {
		const safeTier = sanitizeManualTier(tier, this.tier);
		const changed = safeTier !== this.tier;
		this.tier = safeTier;
		this.cooldown = this.config.cooldownSamples;
		this.healthyStreak = 0;
		this.pressureStreak = 0;
		this.lastAction = changed ? (budgetTierIndex(safeTier) < budgetTierIndex(this.tier) ? 'degrade' : 'recover') : 'hold';
		this.sequence += 1;
		this.lastReason = reason;
		return this.snapshot();
	}

	sample({ frameMs, streamingMs = 0, assetQueueDepth = 0, mainThreadBlockingMs = 0, timestamp = this.now() } = {}) {
		if (Number.isFinite(frameMs)) {
			this.samples = [...this.samples.slice(-(this.config.windowSize - 1)), clamp(frameMs, 0, 250)];
		}
		const effectiveBudget = this.matrix.budget?.frameBudgetMs ?? 24;
		const evaluation = evaluateRuntimeBudget({
			samples: this.samples,
			currentTier: this.tier,
			frameBudgetMs: effectiveBudget,
			streamingMs,
			assetQueueDepth,
			mainThreadBlockingMs,
			manualLock: this.manualLock,
			coarsePointer: this.capabilities.pointer?.coarse === true,
			reducedMotion: this.capabilities.accessibility?.reducedMotion === true,
		});
		this.lastTimestamp = finiteOr(timestamp, this.lastTimestamp);
		this._applyEvaluation(evaluation);
		return this.snapshot(evaluation);
	}

	_applyEvaluation(evaluation) {
		if (this.cooldown > 0) this.cooldown -= 1;
		const severe = evaluation.action === 'degrade' && evaluation.recommendedTier !== this.tier;
		const healthy = evaluation.action === 'recover' && evaluation.recommendedTier !== this.tier;
		this.pressureStreak = severe ? this.pressureStreak + 1 : Math.max(0, this.pressureStreak - 1);
		this.healthyStreak = healthy ? this.healthyStreak + 1 : Math.max(0, this.healthyStreak - 1);
		if (!this.manualLock && this.cooldown === 0) {
			if (this.pressureStreak >= this.config.degradeConfirmations) {
				const target = nextTier(this.tier, -1);
				if (target !== this.tier) {
					this.tier = target;
					this.sequence += 1;
					this.cooldown = this.config.cooldownSamples;
					this.lastAction = 'degrade';
					this.lastReason = evaluation.pressure;
				}
				this.pressureStreak = 0;
			}
			if (this.healthyStreak >= this.config.recoverConfirmations) {
				const target = nextTier(this.tier, 1);
				if (target !== this.tier) {
					this.tier = target;
					this.sequence += 1;
					this.cooldown = this.config.cooldownSamples;
					this.lastAction = 'recover';
					this.lastReason = 'sustained-headroom';
				}
				this.healthyStreak = 0;
			}
		}
		if (this.capabilities.pointer?.coarse === true && budgetTierIndex(this.tier) > 1) this.tier = 'balanced';
		if (this.capabilities.accessibility?.reducedMotion === true && this.tier === 'ultra') this.tier = 'high';
	}

	applyMatrix(matrix) {
		if (matrix && typeof matrix === 'object') this.matrix = freeze(matrix);
		return this.snapshot();
	}

	reset({ tier } = {}) {
		this.samples = [];
		this.healthyStreak = 0;
		this.pressureStreak = 0;
		this.cooldown = 0;
		this.sequence += 1;
		if (tier) this.tier = sanitizeManualTier(tier, this.tier);
		this.lastAction = 'hold';
		this.lastReason = 'reset';
		return this.snapshot();
	}

	snapshot(evaluation = null) {
		const snapshot = {
			version: 1,
			sequence: this.sequence,
			timestamp: this.lastTimestamp,
			tier: this.tier,
			action: ACTIONS.includes(this.lastAction) ? this.lastAction : 'hold',
			manualLock: this.manualLock,
			cooldownSamples: this.cooldown,
			pressureStreak: this.pressureStreak,
			healthyStreak: this.healthyStreak,
			sampleCount: this.samples.length,
			matrixDigest: featureMatrixDigest(this.matrix),
			reason: this.lastReason ?? 'steady-state',
			evaluation: evaluation ? { pressure: evaluation.pressure, recommendedTier: evaluation.recommendedTier, pressureScore: evaluation.pressureScore } : null,
		};
		return freeze(snapshot);
	}
}

export function createAdaptiveRuntimeGovernor(options) {
	return new AdaptiveRuntimeGovernor(options);
}

export function governorTierDistance(from, to) {
	return Math.abs(budgetTierIndex(from) - budgetTierIndex(to));
}
