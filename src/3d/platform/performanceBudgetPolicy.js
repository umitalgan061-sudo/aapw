/**
 * Adaptive runtime budget policy.
 *
 * A browser game needs more than a target FPS. Long frames, repeated stalls, asset queue pressure and
 * streaming bursts compete for the same main thread. This policy turns those signals into bounded,
 * actionable budgets without touching a renderer or owning any scheduler.
 *
 * The policy intentionally uses robust statistics instead of a single frame sample. It exposes a
 * deterministic score from a window of frame durations, records trend and pressure, then recommends a
 * small quality step. Hysteresis is built in so a single bad frame cannot cause visible oscillation.
 */

const QUALITY_STEPS = Object.freeze(['minimal', 'balanced', 'high', 'ultra']);
const PRESSURE = Object.freeze({ RELAXED: 'relaxed', NORMAL: 'normal', ELEVATED: 'elevated', CRITICAL: 'critical' });
const FRAME_THRESHOLDS_MS = Object.freeze({ minimal: 33.3, balanced: 24, high: 18, ultra: 16.7 });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function percentile(sortedValues, fraction) {
	if (!sortedValues.length) return 0;
	const index = (sortedValues.length - 1) * fraction;
	const lo = Math.floor(index);
	const hi = Math.ceil(index);
	if (lo === hi) return sortedValues[lo];
	return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (index - lo);
}

function robustFrameStats(samples) {
	const sorted = samples.filter(Number.isFinite).sort((a, b) => a - b);
	if (!sorted.length) return { p50: 0, p90: 0, p95: 0, p99: 0, avg: 0, max: 0, longFrames: 0 };
	return {
		p50: percentile(sorted, 0.5),
		p90: percentile(sorted, 0.9),
		p95: percentile(sorted, 0.95),
		p99: percentile(sorted, 0.99),
		avg: mean(sorted),
		max: sorted[sorted.length - 1],
		longFrames: sorted.filter((value) => value >= 50).length,
	};
}

function normalizeCounter(value) {
	return clamp(Math.round(finiteOr(value, 0)), 0, 1000000);
}

function pressureFromStats(stats, budgetMs) {
	const ratio = budgetMs > 0 ? stats.p95 / budgetMs : 9;
	if (ratio >= 2.2 || stats.longFrames >= 4) return PRESSURE.CRITICAL;
	if (ratio >= 1.35 || stats.longFrames >= 2) return PRESSURE.ELEVATED;
	if (ratio >= 1.05) return PRESSURE.NORMAL;
	return PRESSURE.RELAXED;
}

function trend(samples) {
	if (samples.length < 6) return 0;
	const half = Math.floor(samples.length / 2);
	const earlier = mean(samples.slice(0, half));
	const later = mean(samples.slice(-half));
	if (!earlier) return 0;
	return clamp((later - earlier) / earlier, -2, 2);
}

function stepDown(tier) {
	const index = QUALITY_STEPS.indexOf(tier);
	return QUALITY_STEPS[Math.max(0, index - 1)];
}

function stepUp(tier) {
	const index = QUALITY_STEPS.indexOf(tier);
	return QUALITY_STEPS[Math.min(QUALITY_STEPS.length - 1, index + 1)];
}

function freeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
}

export function evaluateRuntimeBudget({
	samples = [],
	currentTier = 'balanced',
	frameBudgetMs = FRAME_THRESHOLDS_MS[currentTier] ?? FRAME_THRESHOLDS_MS.balanced,
	streamingMs = 0,
	assetQueueDepth = 0,
	mainThreadBlockingMs = 0,
	manualLock = false,
	coarsePointer = false,
	reducedMotion = false,
} = {}) {
	const boundedSamples = samples.slice(-120).map((value) => clamp(finiteOr(value, frameBudgetMs), 0, 250));
	const stats = robustFrameStats(boundedSamples);
	const pressure = pressureFromStats(stats, Math.max(frameBudgetMs, 12));
	const networkPressure = assetQueueDepth > 8 || streamingMs > 12;
	const scriptPressure = mainThreadBlockingMs > 50;
	const combinedCritical = pressure === PRESSURE.CRITICAL || scriptPressure || streamingMs > 24;
	const rising = trend(boundedSamples) > 0.12;
	let recommendedTier = currentTier;
	let action = 'hold';
	if (!manualLock) {
		if (combinedCritical || (pressure === PRESSURE.ELEVATED && rising) || networkPressure) {
			recommendedTier = stepDown(currentTier);
			action = recommendedTier === currentTier ? 'stabilize' : 'degrade';
		} else if (pressure === PRESSURE.RELAXED && stats.p95 < frameBudgetMs * 0.82 && boundedSamples.length >= 30) {
			recommendedTier = stepUp(currentTier);
			action = recommendedTier === currentTier ? 'hold' : 'recover';
		}
	}
	if (coarsePointer && recommendedTier === 'ultra') recommendedTier = 'high';
	if (coarsePointer && ['high', 'ultra'].includes(recommendedTier)) recommendedTier = 'balanced';
	if (reducedMotion && recommendedTier === 'ultra') recommendedTier = 'high';

	const utilization = clamp(stats.p95 / Math.max(frameBudgetMs, 1), 0, 6);
	const pressureScore = clamp(
		utilization * 0.55 + clamp(stats.longFrames / 8, 0, 1) * 0.25 + clamp(streamingMs / 24, 0, 1) * 0.1 + clamp(assetQueueDepth / 12, 0, 1) * 0.1,
		0,
		6,
	);
	return freeze({
		version: 1,
		currentTier,
		recommendedTier,
		action,
		pressure,
		pressureScore: Number(pressureScore.toFixed(4)),
		trend: Number(trend(boundedSamples).toFixed(4)),
		utilization: Number(utilization.toFixed(4)),
		frame: {
			budgetMs: Number(frameBudgetMs.toFixed(3)),
			p50: Number(stats.p50.toFixed(3)),
			p90: Number(stats.p90.toFixed(3)),
			p95: Number(stats.p95.toFixed(3)),
			p99: Number(stats.p99.toFixed(3)),
			avg: Number(stats.avg.toFixed(3)),
			max: Number(stats.max.toFixed(3)),
			longFrames: stats.longFrames,
			sampleCount: boundedSamples.length,
		},
		work: {
			streamingMs: Number(clamp(finiteOr(streamingMs, 0), 0, 1000).toFixed(3)),
			assetQueueDepth: normalizeCounter(assetQueueDepth),
			mainThreadBlockingMs: Number(clamp(finiteOr(mainThreadBlockingMs, 0), 0, 1000).toFixed(3)),
		},
		constraints: { manualLock, coarsePointer, reducedMotion },
	});
}

export function createBudgetWindow(limit = 120) {
	let values = [];
	const boundedLimit = clamp(Math.round(finiteOr(limit, 120)), 12, 240);
	return {
		push(frameMs) {
			if (!Number.isFinite(frameMs)) return false;
			values = [...values.slice(-(boundedLimit - 1)), clamp(frameMs, 0, 250)];
			return true;
		},
		pushMany(frames) {
			for (const frame of frames ?? []) this.push(frame);
			return values.length;
		},
		values() { return values.slice(); },
		clear() { values = []; },
		get size() { return values.length; },
	};
}

export function budgetTierIndex(tier) {
	const index = QUALITY_STEPS.indexOf(tier);
	return index < 0 ? 1 : index;
}

export function budgetPolicyConstants() {
	return freeze({ tiers: QUALITY_STEPS, thresholds: FRAME_THRESHOLDS_MS, pressure: PRESSURE });
}
