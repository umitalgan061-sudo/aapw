/**
 * Deterministic runtime-observation policy for living-world QA.
 *
 * The policy consumes caller-provided samples and returns bounded performance,
 * load, error, and activity summaries. It owns no scheduler, controller, scene,
 * renderer, event bus, or persistence state.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const MAX_WINDOW_SAMPLES = 120;

export const LIVING_WORLD_RUNTIME_OBSERVATION_POLICY = freeze({
	id: 'living-world-runtime-observation-policy-2026-09-08-v1',
	deterministic: true,
	maxWindowSamples: MAX_WINDOW_SAMPLES,
	frameBudgetMs: 16.67,
	softFrameBudgetMs: 20,
	tickBudgetMs: 4,
	maxActorCount: 512,
	maxErrorCount: 8,
});

function stableHash(value) {
	let hash = 2166136261;
	for (const character of String(value)) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 2246822507) >>> 0;
	hash ^= hash >>> 13;
	hash = Math.imul(hash, 3266489909) >>> 0;
	return (hash ^ (hash >>> 16)) >>> 0;
}

function normalizeCount(value) {
	return Math.max(0, Math.min(LIVING_WORLD_RUNTIME_OBSERVATION_POLICY.maxActorCount, Math.trunc(finite(value, 0))));
}

export function normalizeRuntimeObservationSample(sample = {}) {
	const frameMs = Math.max(0, finite(sample.frameMs, 0));
	const tickMs = Math.max(0, finite(sample.tickMs, 0));
	const actors = normalizeCount(sample.actors ?? sample.actorCount);
	const activeActors = Math.max(0, Math.min(actors, Math.trunc(finite(sample.activeActors, actors))));
	const skippedActors = Math.max(0, Math.min(actors, Math.trunc(finite(sample.skippedActors, Math.max(0, actors - activeActors)))));
	const errors = Math.max(0, Math.trunc(finite(sample.errors ?? sample.errorCount, 0)));
	const worldEvents = Math.max(0, Math.trunc(finite(sample.worldEvents, 0)));
	const eventCandidates = Math.max(worldEvents, Math.trunc(finite(sample.eventCandidates, worldEvents)));
	const threatRatio = clamp(sample.threatRatio, 0, 1);
	const cohesionRatio = clamp(sample.cohesionRatio, 0, 1);
	const materialValidated = sample.materialValidated !== false;
	const placementValidated = sample.placementValidated !== false;
	return freeze({
		frameMs: Number(frameMs.toFixed(4)),
		tickMs: Number(tickMs.toFixed(4)),
		actors,
		activeActors,
		skippedActors,
		errors,
		worldEvents,
		eventCandidates,
		threatRatio: Number(threatRatio.toFixed(4)),
		cohesionRatio: Number(cohesionRatio.toFixed(4)),
		materialValidated,
		placementValidated,
	});
}

function percentile(values, ratio) {
	if (!values.length) return 0;
	const sorted = values.slice().sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length - 1) * ratio)));
	return sorted[index];
}

function average(values) {
	if (!values.length) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizeRuntimeObservationWindow(samples = [], { windowId = 'default' } = {}) {
	const normalized = (Array.isArray(samples) ? samples : [])
		.slice(-MAX_WINDOW_SAMPLES)
		.map(normalizeRuntimeObservationSample);
	const frameValues = normalized.map((sample) => sample.frameMs);
	const tickValues = normalized.map((sample) => sample.tickMs);
	const actorValues = normalized.map((sample) => sample.actors);
	const errorValues = normalized.map((sample) => sample.errors);
	const activeValues = normalized.map((sample) => sample.activeActors);
	const frameP95 = percentile(frameValues, 0.95);
	const tickP95 = percentile(tickValues, 0.95);
	const maxFrameMs = frameValues.length ? Math.max(...frameValues) : 0;
	const maxTickMs = tickValues.length ? Math.max(...tickValues) : 0;
	const errorTotal = errorValues.reduce((sum, value) => sum + value, 0);
	const actorPeak = actorValues.length ? Math.max(...actorValues) : 0;
	const activeRatio = actorValues.length
		? average(normalized.map((sample) => sample.actors ? sample.activeActors / sample.actors : 0))
		: 0;
	const cohesion = average(normalized.map((sample) => sample.cohesionRatio));
	const threat = average(normalized.map((sample) => sample.threatRatio));
	const materialValidated = normalized.every((sample) => sample.materialValidated);
	const placementValidated = normalized.every((sample) => sample.placementValidated);
	const withinFrameBudget = frameP95 <= LIVING_WORLD_RUNTIME_OBSERVATION_POLICY.frameBudgetMs;
	const withinSoftFrameBudget = maxFrameMs <= LIVING_WORLD_RUNTIME_OBSERVATION_POLICY.softFrameBudgetMs;
	const withinTickBudget = tickP95 <= LIVING_WORLD_RUNTIME_OBSERVATION_POLICY.tickBudgetMs;
	const actorBudgetOk = actorPeak <= LIVING_WORLD_RUNTIME_OBSERVATION_POLICY.maxActorCount;
	const errorsOk = errorTotal <= LIVING_WORLD_RUNTIME_OBSERVATION_POLICY.maxErrorCount;
	const healthy = normalized.length > 0 && withinFrameBudget && withinTickBudget && actorBudgetOk && errorsOk && materialValidated && placementValidated;
	const digestPayload = normalized.map((sample) => JSON.stringify(sample)).join('|');
	return freeze({
		windowId: String(windowId),
		sampleCount: normalized.length,
		performance: freeze({
			averageFrameMs: Number(average(frameValues).toFixed(4)),
			frameP95Ms: Number(frameP95.toFixed(4)),
			maxFrameMs: Number(maxFrameMs.toFixed(4)),
			averageTickMs: Number(average(tickValues).toFixed(4)),
			tickP95Ms: Number(tickP95.toFixed(4)),
			maxTickMs: Number(maxTickMs.toFixed(4)),
			withinFrameBudget,
			withinSoftFrameBudget,
			withinTickBudget,
		}),
		population: freeze({
			peakActors: actorPeak,
			averageActors: Number(average(actorValues).toFixed(4)),
			activeRatio: Number(clamp(activeRatio).toFixed(4)),
		}),
		world: freeze({
			errorTotal,
			peakErrors: errorValues.length ? Math.max(...errorValues) : 0,
			averageThreatRatio: Number(threat.toFixed(4)),
			averageCohesionRatio: Number(cohesion.toFixed(4)),
			worldEventCount: normalized.reduce((sum, sample) => sum + sample.worldEvents, 0),
			eventCandidateCount: normalized.reduce((sum, sample) => sum + sample.eventCandidates, 0),
		}),
		evidence: freeze({ materialValidated, placementValidated }),
		accepted: healthy,
		reason: healthy ? 'healthy' : normalized.length === 0 ? 'empty-window' : !withinFrameBudget ? 'frame-budget' : !withinTickBudget ? 'tick-budget' : !actorBudgetOk ? 'actor-budget' : !errorsOk ? 'errors' : !materialValidated ? 'material-evidence' : 'placement-evidence',
		digest: stableHash(digestPayload).toString(16).padStart(8, '0'),
	});
}

export function buildRuntimeObservationReceipt(summary, { source = 'living-world' } = {}) {
	const safe = summary && typeof summary === 'object' ? summary : summarizeRuntimeObservationWindow([]);
	return freeze({
		policyId: LIVING_WORLD_RUNTIME_OBSERVATION_POLICY.id,
		deterministic: true,
		source: String(source),
		accepted: Boolean(safe.accepted),
		reason: String(safe.reason ?? 'unknown'),
		windowId: String(safe.windowId ?? 'default'),
		sampleCount: Math.max(0, Math.min(MAX_WINDOW_SAMPLES, Math.trunc(finite(safe.sampleCount, 0)))),
		digest: String(safe.digest ?? '00000000'),
		frameP95Ms: Number(finite(safe.performance?.frameP95Ms, 0).toFixed(4)),
		tickP95Ms: Number(finite(safe.performance?.tickP95Ms, 0).toFixed(4)),
		peakActors: normalizeCount(safe.population?.peakActors),
		errorTotal: Math.max(0, Math.trunc(finite(safe.world?.errorTotal, 0))),
	});
}

export function auditRuntimeObservationSummary(summary) {
	const errors = [];
	if (!summary || typeof summary !== 'object') errors.push('missing-summary');
	if (summary?.sampleCount > MAX_WINDOW_SAMPLES) errors.push('sample-overflow');
	if (summary?.performance?.frameP95Ms < 0 || summary?.performance?.tickP95Ms < 0) errors.push('negative-latency');
	if (summary?.population?.peakActors > LIVING_WORLD_RUNTIME_OBSERVATION_POLICY.maxActorCount) errors.push('actor-overflow');
	if (summary?.world?.errorTotal < 0) errors.push('negative-errors');
	return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: String(summary?.digest ?? '00000000') });
}