/**
 * Compact runtime evidence helpers for the existing living-world actors.
 *
 * Evidence is observational and fail-closed: no geometry is instantiated, no source asset is
 * rewritten, and no material/placement authority is duplicated. Model-bearing callers may attach
 * their existing MaterialAssignmentCore/WorldAssetPlacementPipeline evidence to userData and this
 * module only validates/serializes it.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const MAX_ACTORS = 128;
const MAX_ERRORS = 64;
const MAX_ASSET_ROLES = 24;
const MAX_TEXTURES = 24;

export const LIVING_WORLD_RUNTIME_EVIDENCE_POLICY = freeze({
	id: 'living-world-runtime-evidence-2026-09-08-v1',
	maxActors: MAX_ACTORS,
	maxErrors: MAX_ERRORS,
	maxAssetRoles: MAX_ASSET_ROLES,
	maxTextures: MAX_TEXTURES,
	minimumFrameBudgetMs: 0,
	maximumFrameBudgetMs: 33.34,
	maximumMissingAssets: 0,
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

function finitePosition(value) {
	if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.z))) return null;
	return freeze({ x: Number(value.x), z: Number(value.z) });
}

function normalizeSurfaceEvidence(evidence = {}) {
	const roles = Array.isArray(evidence.roles)
		? evidence.roles.slice(0, MAX_ASSET_ROLES).map((role) => String(role ?? '').trim().toLowerCase()).filter(Boolean)
		: [];
	const textures = Array.isArray(evidence.textures)
		? evidence.textures.slice(0, MAX_TEXTURES).map((texture, index) => freeze({
			name: String(texture?.name ?? `texture-${index}`),
			width: Math.max(0, Math.floor(finite(texture?.width, 0))),
			height: Math.max(0, Math.floor(finite(texture?.height, 0))),
			map: String(texture?.map ?? 'unknown'),
		})).filter((texture) => texture.width > 0 && texture.height > 0)
		: [];
	const paletteIds = Array.isArray(evidence.paletteIds)
		? evidence.paletteIds.slice(0, MAX_ASSET_ROLES).map((id) => String(id ?? '').trim()).filter(Boolean)
		: [];
	return freeze({
		surfaceCount: Math.max(0, Math.floor(finite(evidence.surfaceCount, roles.length))),
		roles: freeze([...new Set(roles)]),
		textures: freeze(textures),
		paletteIds: freeze([...new Set(paletteIds)]),
		uvPresent: Boolean(evidence.uvPresent),
		materialSlotCount: Math.max(0, Math.floor(finite(evidence.materialSlotCount, 0))),
		validated: Boolean(evidence.validated),
	});
}

function normalizePlacementEvidence(evidence = {}) {
	return freeze({
		accepted: Boolean(evidence.accepted),
		groundAligned: Boolean(evidence.groundAligned),
		navAligned: Boolean(evidence.navAligned),
		habitatAccepted: Boolean(evidence.habitatAccepted),
		waterSafe: Boolean(evidence.waterSafe),
		slopeSafe: Boolean(evidence.slopeSafe),
		placementDigest: evidence.placementDigest == null ? null : String(evidence.placementDigest),
		materialDigest: evidence.materialDigest == null ? null : String(evidence.materialDigest),
		provenance: evidence.provenance == null ? null : String(evidence.provenance),
	});
}

function normalizeActorEvidence(actor, index) {
	const object3D = actor?.object3D ?? actor?.model ?? actor;
	const userData = object3D?.userData ?? {};
	const runtime = userData.livingWorldDirector ?? {};
	const npcPerception = userData.npcPerception ?? {};
	const wildlifeFlee = userData.wildlifeFlee ?? {};
	const position = finitePosition(object3D?.position ?? actor?.position);
	const kind = String(actor?.kind ?? userData.kind ?? 'actor');
	const id = String(actor?.id ?? object3D?.uuid ?? object3D?.name ?? `${kind}-${index}`);
	const surface = normalizeSurfaceEvidence(userData.materialEvidence ?? userData.surfaceEvidence ?? {});
	const placement = normalizePlacementEvidence(userData.placementEvidence ?? userData.livingWorldHabitat ?? {});
	return freeze({
		index,
		id,
		kind,
		position,
		health: finite(userData.health ?? actor?.health, 0),
		state: String(actor?.state ?? actor?.currentState ?? runtime.phase ?? npcPerception.intent ?? wildlifeFlee.phase ?? 'unknown'),
		perception: freeze({
			intent: npcPerception.intent == null ? null : String(npcPerception.intent),
			suspicion: clamp(npcPerception.suspicion, 0, 1),
			heard: Boolean(npcPerception.heard),
			lineOfSight: npcPerception.lineOfSight == null ? null : Boolean(npcPerception.lineOfSight),
			assistSourceId: npcPerception.assistSourceId == null ? null : String(npcPerception.assistSourceId),
		}),
		wildlife: freeze({
			phase: wildlifeFlee.phase == null ? null : String(wildlifeFlee.phase),
			direct: Boolean(wildlifeFlee.direct),
			pack: Boolean(wildlifeFlee.pack),
			recovering: Boolean(wildlifeFlee.recovering),
		}),
		director: freeze({
			phase: runtime.phase == null ? null : String(runtime.phase),
			activityId: runtime.activityId == null ? null : String(runtime.activityId),
			locationId: runtime.locationId == null ? null : String(runtime.locationId),
			travel: Boolean(runtime.travel),
			nextChangeSeconds: Math.max(0, finite(runtime.nextChangeSeconds, 0)),
		}),
		material: surface,
		placement,
	});
}

export function collectLivingWorldRuntimeEvidence({ actors = [], frameMs = 0, tickMs = frameMs, playerPosition = null } = {}) {
	const list = [];
	if (actors && typeof actors[Symbol.iterator] === 'function') {
		try {
			let index = 0;
			for (const actor of actors) {
				list.push(normalizeActorEvidence(actor, index));
				index += 1;
				if (index >= MAX_ACTORS) break;
			}
		} catch {
			// Fail closed below; partial evidence remains useful but never becomes acceptance by itself.
		}
	}
	const boundedFrameMs = Math.max(0, finite(frameMs, 0));
	const boundedTickMs = Math.max(0, finite(tickMs, boundedFrameMs));
	const missingAssets = list.reduce((sum, actor) => sum + (actor.material.validated && actor.placement.accepted ? 0 : 1), 0);
	const alignedActors = list.filter((actor) => actor.placement.groundAligned && actor.placement.habitatAccepted).length;
	const actorStates = list.reduce((counts, actor) => {
		counts[actor.state] = (counts[actor.state] ?? 0) + 1;
		return counts;
	}, {});
	return freeze({
		policyId: LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.id,
		actorCount: list.length,
		actors: freeze(list),
		playerPosition: finitePosition(playerPosition),
		frame: freeze({ frameMs: Number(boundedFrameMs.toFixed(3)), tickMs: Number(boundedTickMs.toFixed(3)) }),
		performance: freeze({ withinFrameBudget: boundedFrameMs <= LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.maximumFrameBudgetMs, budgetMs: LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.maximumFrameBudgetMs }),
		placement: freeze({ alignedActors, missingAssets }),
		stateCounts: freeze(actorStates),
	});
}

export function validateLivingWorldRuntimeEvidence(evidence) {
	const errors = [];
	if (!evidence || evidence.policyId !== LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.id) errors.push('policy-mismatch');
	if (Number(evidence?.actorCount ?? 0) > MAX_ACTORS) errors.push('actor-overflow');
	if (Number(evidence?.placement?.missingAssets ?? 0) > LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.maximumMissingAssets) errors.push('missing-material-or-placement-evidence');
	if (Number(evidence?.frame?.frameMs ?? 0) > LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.maximumFrameBudgetMs) errors.push('frame-budget');
	for (const actor of evidence?.actors ?? []) {
		if (!actor.position) errors.push(`non-finite-position:${actor.id}`);
		if (!actor.material.validated) errors.push(`unvalidated-material:${actor.id}`);
		if (!actor.placement.accepted) errors.push(`placement-rejected:${actor.id}`);
	}
	return freeze({
		ok: errors.length === 0,
		errors: freeze(errors.slice(0, MAX_ERRORS)),
		actorCount: Number(evidence?.actorCount ?? 0),
		withinFrameBudget: Boolean(evidence?.performance?.withinFrameBudget),
		missingAssets: Number(evidence?.placement?.missingAssets ?? 0),
	});
}

export function runtimeEvidenceDigest(evidence) {
	return stableHash(JSON.stringify(evidence ?? null)).toString(16).padStart(8, '0');
}

export function buildLivingWorldAcceptanceSummary(evidence, directorSnapshot = null) {
	const validation = validateLivingWorldRuntimeEvidence(evidence);
	const director = directorSnapshot ? {
		policyId: directorSnapshot.policyId ?? null,
		actorsUpdated: finite(directorSnapshot.actorsUpdated, 0),
		eventsEmitted: finite(directorSnapshot.events?.emitted, 0),
		faunaGroups: Array.isArray(directorSnapshot.fauna) ? directorSnapshot.fauna.length : 0,
	} : null;
	return freeze({
		accepted: validation.ok,
		validation,
		digest: runtimeEvidenceDigest(evidence),
		director,
		proof: freeze({
			assetMaterialValidated: validation.ok && validation.missingAssets === 0,
			groundHabitatAligned: validation.ok,
			finitePositions: validation.ok,
			frameBudgetMs: Number(evidence?.performance?.budgetMs ?? LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.maximumFrameBudgetMs),
		}),
	});
}

const OBSERVATION_MAX_SAMPLES = 120;
const OBSERVATION_FRAME_BUDGET_MS = 16.67;
const OBSERVATION_TICK_BUDGET_MS = 4;
const OBSERVATION_MAX_ACTORS = 512;
const OBSERVATION_MAX_ERRORS = 8;

function observationPercentile(values, ratio) {
	if (!values.length) return 0;
	const sorted = values.slice().sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length - 1) * ratio)))];
}

function observationAverage(values) {
	return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function normalizeObservationSample(sample = {}) {
	const actors = Math.max(0, Math.min(OBSERVATION_MAX_ACTORS, Math.trunc(finite(sample.actors ?? sample.actorCount, 0))));
	const activeActors = Math.max(0, Math.min(actors, Math.trunc(finite(sample.activeActors, actors))));
	const frameMs = Math.max(0, finite(sample.frameMs, 0));
	const tickMs = Math.max(0, finite(sample.tickMs, 0));
	return freeze({
		frameMs: Number(frameMs.toFixed(4)),
		tickMs: Number(tickMs.toFixed(4)),
		actors,
		activeActors,
		errors: Math.max(0, Math.trunc(finite(sample.errors ?? sample.errorCount, 0))),
		worldEvents: Math.max(0, Math.trunc(finite(sample.worldEvents, 0))),
		eventCandidates: Math.max(0, Math.trunc(finite(sample.eventCandidates, 0))),
		threatRatio: Number(clamp(sample.threatRatio, 0, 1).toFixed(4)),
		cohesionRatio: Number(clamp(sample.cohesionRatio, 0, 1).toFixed(4)),
		materialValidated: sample.materialValidated !== false,
		placementValidated: sample.placementValidated !== false,
	});
}

export function summarizeLivingWorldObservationWindow(samples = [], { windowId = 'default' } = {}) {
	const normalized = (Array.isArray(samples) ? samples : []).slice(-OBSERVATION_MAX_SAMPLES).map(normalizeObservationSample);
	const frames = normalized.map((sample) => sample.frameMs);
	const ticks = normalized.map((sample) => sample.tickMs);
	const actors = normalized.map((sample) => sample.actors);
	const errors = normalized.map((sample) => sample.errors);
	const frameP95 = observationPercentile(frames, 0.95);
	const tickP95 = observationPercentile(ticks, 0.95);
	const peakActors = actors.length ? Math.max(...actors) : 0;
	const errorTotal = errors.reduce((sum, value) => sum + value, 0);
	const materialValidated = normalized.every((sample) => sample.materialValidated);
	const placementValidated = normalized.every((sample) => sample.placementValidated);
	const withinFrameBudget = frameP95 <= OBSERVATION_FRAME_BUDGET_MS;
	const withinTickBudget = tickP95 <= OBSERVATION_TICK_BUDGET_MS;
	const actorBudgetOk = peakActors <= OBSERVATION_MAX_ACTORS;
	const errorsOk = errorTotal <= OBSERVATION_MAX_ERRORS;
	const accepted = normalized.length > 0 && withinFrameBudget && withinTickBudget && actorBudgetOk && errorsOk && materialValidated && placementValidated;
	const digestPayload = normalized.map((sample) => JSON.stringify(sample)).join('|');
	return freeze({
		windowId: String(windowId),
		sampleCount: normalized.length,
		performance: freeze({
			averageFrameMs: Number(observationAverage(frames).toFixed(4)),
			frameP95Ms: Number(frameP95.toFixed(4)),
			maxFrameMs: Number((frames.length ? Math.max(...frames) : 0).toFixed(4)),
			averageTickMs: Number(observationAverage(ticks).toFixed(4)),
			tickP95Ms: Number(tickP95.toFixed(4)),
			maxTickMs: Number((ticks.length ? Math.max(...ticks) : 0).toFixed(4)),
			withinFrameBudget,
			withinTickBudget,
		}),
		population: freeze({
			peakActors,
			averageActors: Number(observationAverage(actors).toFixed(4)),
			activeRatio: Number(observationAverage(normalized.map((sample) => sample.actors ? sample.activeActors / sample.actors : 0)).toFixed(4)),
		}),
		world: freeze({
			errorTotal,
			peakErrors: errors.length ? Math.max(...errors) : 0,
			averageThreatRatio: Number(observationAverage(normalized.map((sample) => sample.threatRatio)).toFixed(4)),
			averageCohesionRatio: Number(observationAverage(normalized.map((sample) => sample.cohesionRatio)).toFixed(4)),
			worldEventCount: normalized.reduce((sum, sample) => sum + sample.worldEvents, 0),
			eventCandidateCount: normalized.reduce((sum, sample) => sum + sample.eventCandidates, 0),
		}),
		evidence: freeze({ materialValidated, placementValidated }),
		accepted,
		reason: accepted ? 'healthy' : normalized.length === 0 ? 'empty-window' : !withinFrameBudget ? 'frame-budget' : !withinTickBudget ? 'tick-budget' : !actorBudgetOk ? 'actor-budget' : !errorsOk ? 'errors' : !materialValidated ? 'material-evidence' : 'placement-evidence',
		digest: stableHash(digestPayload).toString(16).padStart(8, '0'),
	});
}

export function buildLivingWorldObservationReceipt(summary, { source = 'living-world' } = {}) {
	const safe = summary && typeof summary === 'object' ? summary : summarizeLivingWorldObservationWindow([]);
	return freeze({
		policyId: `${LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.id}:observation`,
		deterministic: true,
		source: String(source),
		accepted: Boolean(safe.accepted),
		reason: String(safe.reason ?? 'unknown'),
		windowId: String(safe.windowId ?? 'default'),
		sampleCount: Math.max(0, Math.min(OBSERVATION_MAX_SAMPLES, Math.trunc(finite(safe.sampleCount, 0)))),
		digest: String(safe.digest ?? '00000000'),
		frameP95Ms: Number(finite(safe.performance?.frameP95Ms, 0).toFixed(4)),
		tickP95Ms: Number(finite(safe.performance?.tickP95Ms, 0).toFixed(4)),
		peakActors: Math.max(0, Math.min(OBSERVATION_MAX_ACTORS, Math.trunc(finite(safe.population?.peakActors, 0)))),
		errorTotal: Math.max(0, Math.trunc(finite(safe.world?.errorTotal, 0))),
	});
}

export function validateLivingWorldObservationSummary(summary) {
	const errors = [];
	if (!summary || typeof summary !== 'object') errors.push('missing-summary');
	if (summary?.sampleCount > OBSERVATION_MAX_SAMPLES) errors.push('sample-overflow');
	if (summary?.performance?.frameP95Ms < 0 || summary?.performance?.tickP95Ms < 0) errors.push('negative-latency');
	if (summary?.population?.peakActors > OBSERVATION_MAX_ACTORS) errors.push('actor-overflow');
	if (summary?.world?.errorTotal < 0) errors.push('negative-errors');
	return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: String(summary?.digest ?? '00000000') });
}

function observationSlope(first, second) {
	if (!(first.length && second.length)) return 0;
	return observationAverage(second) - observationAverage(first);
}

export function analyzeLivingWorldObservationTrend(samples = [], { windowId = 'trend', warningFrameMs = 20, warningTickMs = 5 } = {}) {
	const normalized = (Array.isArray(samples) ? samples : []).slice(-OBSERVATION_MAX_SAMPLES).map(normalizeObservationSample);
	const split = Math.floor(normalized.length / 2);
	const first = normalized.slice(0, split || normalized.length);
	const second = normalized.slice(split || 0);
	const frameFirst = first.map((sample) => sample.frameMs);
	const frameSecond = second.map((sample) => sample.frameMs);
	const tickFirst = first.map((sample) => sample.tickMs);
	const tickSecond = second.map((sample) => sample.tickMs);
	const frameDeltaMs = observationSlope(frameFirst, frameSecond);
	const tickDeltaMs = observationSlope(tickFirst, tickSecond);
	const errorBurstCount = normalized.filter((sample) => sample.errors > 0).length;
	const actorPressure = normalized.length ? Math.max(...normalized.map((sample) => sample.actors / OBSERVATION_MAX_ACTORS)) : 0;
	const frameWarning = normalized.some((sample) => sample.frameMs > warningFrameMs);
	const tickWarning = normalized.some((sample) => sample.tickMs > warningTickMs);
	const degrading = frameDeltaMs > 1 || tickDeltaMs > 0.75 || errorBurstCount >= 3 || actorPressure > 0.9;
	const digest = stableHash(normalized.map((sample) => JSON.stringify(sample)).join('|')).toString(16).padStart(8, '0');
	return freeze({
		windowId: String(windowId),
		sampleCount: normalized.length,
		frameDeltaMs: Number(frameDeltaMs.toFixed(4)),
		tickDeltaMs: Number(tickDeltaMs.toFixed(4)),
		errorBurstCount,
		actorPressure: Number(actorPressure.toFixed(4)),
		warnings: freeze({ frame: frameWarning, tick: tickWarning }),
		degrading,
		reason: degrading ? (errorBurstCount >= 3 ? 'error-burst' : actorPressure > 0.9 ? 'actor-pressure' : frameDeltaMs > 1 ? 'frame-regression' : 'tick-regression') : 'stable',
		digest,
	});
}

export function buildLivingWorldObservationAcceptance(summary, trend) {
	const baseValidation = validateLivingWorldObservationSummary(summary);
	const trendValidation = trend && typeof trend === 'object' ? trend : analyzeLivingWorldObservationTrend([]);
	const accepted = baseValidation.ok && Boolean(summary?.accepted) && !trendValidation.degrading;
	return freeze({
		accepted,
		reason: accepted ? 'stable' : !baseValidation.ok ? 'invalid-summary' : !summary?.accepted ? String(summary?.reason ?? 'rejected-summary') : trendValidation.reason,
		summaryDigest: String(summary?.digest ?? '00000000'),
		trendDigest: String(trendValidation.digest ?? '00000000'),
		windowId: String(summary?.windowId ?? trendValidation.windowId ?? 'default'),
		proof: freeze({
			performanceStable: !trendValidation.degrading,
			withinFrameBudget: Boolean(summary?.performance?.withinFrameBudget),
			withinTickBudget: Boolean(summary?.performance?.withinTickBudget),
			materialValidated: Boolean(summary?.evidence?.materialValidated),
			placementValidated: Boolean(summary?.evidence?.placementValidated),
		}),
	});
}