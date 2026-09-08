/**
 * Deterministic occupation schedule policy for existing NPC controllers.
 *
 * This module owns no actor state, scene objects, pathfinding, navigation or animation.
 * It converts a clock + occupation definition into a bounded activity snapshot that
 * existing NPC callers can consume. No second NPC framework is introduced.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const DAY_SECONDS = 24 * 60 * 60;
const MINUTE_SECONDS = 60;

export const OCCUPATION_SCHEDULE_POLICY = freeze({
	id: 'living-world-occupation-schedule-2026-09-08-v1',
	deterministic: true,
	maxSegments: 32,
	maxTravelMeters: 2500,
	maxActivityBlend: 1,
	daySeconds: DAY_SECONDS,
	defaultTransitionSeconds: 8,
});

const DEFAULT_PHASES = freeze({
	work: freeze({ label: 'work', locomotion: 'walk', priority: 50 }),
	travel: freeze({ label: 'travel', locomotion: 'walk', priority: 45 }),
	rest: freeze({ label: 'rest', locomotion: 'idle', priority: 20 }),
	guard: freeze({ label: 'guard', locomotion: 'idle', priority: 60 }),
	patrol: freeze({ label: 'patrol', locomotion: 'walk', priority: 65 }),
	companion: freeze({ label: 'companion', locomotion: 'walk', priority: 55 }),
	roam: freeze({ label: 'roam', locomotion: 'walk', priority: 35 }),
	sleep: freeze({ label: 'sleep', locomotion: 'idle', priority: 5 }),
});

function normalizeClockSeconds(value) {
	const raw = finite(value, 0);
	const modulo = raw % DAY_SECONDS;
	return modulo < 0 ? modulo + DAY_SECONDS : modulo;
}

function normalizePhase(phase, fallback = 'rest') {
	const key = String(phase ?? fallback).trim().toLowerCase();
	return DEFAULT_PHASES[key] ? key : fallback;
}

function normalizeTimeWindow(window, fallbackPhase = 'rest') {
	const start = normalizeClockSeconds(window?.startSeconds ?? window?.start ?? 0);
	const end = normalizeClockSeconds(window?.endSeconds ?? window?.end ?? DAY_SECONDS);
	const phase = normalizePhase(window?.phase ?? fallbackPhase, fallbackPhase);
	const priority = finite(window?.priority, DEFAULT_PHASES[phase]?.priority ?? 0);
	return freeze({
		startSeconds: start,
		endSeconds: end,
		phase,
		priority,
		locationId: window?.locationId == null ? null : String(window.locationId),
		activityId: window?.activityId == null ? null : String(window.activityId),
		targetX: Number.isFinite(Number(window?.targetX)) ? Number(window.targetX) : null,
		targetZ: Number.isFinite(Number(window?.targetZ)) ? Number(window.targetZ) : null,
	});
}

function isInWindow(clockSeconds, window) {
	const now = normalizeClockSeconds(clockSeconds);
	if (window.startSeconds === window.endSeconds) return true;
	if (window.startSeconds < window.endSeconds) return now >= window.startSeconds && now < window.endSeconds;
	return now >= window.startSeconds || now < window.endSeconds;
}

function phaseRank(phase) {
	return DEFAULT_PHASES[phase]?.priority ?? 0;
}

function stableStringHash(value) {
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

function normalizedPhaseList(occupation) {
	const source = Array.isArray(occupation?.schedule)
		? occupation.schedule
		: Array.isArray(occupation?.phases)
			? occupation.phases
			: [];
	const bounded = source.slice(0, OCCUPATION_SCHEDULE_POLICY.maxSegments);
	return bounded
		.map((entry) => normalizeTimeWindow(entry, occupation?.defaultPhase ?? 'rest'))
		.sort((a, b) => {
			if (a.startSeconds !== b.startSeconds) return a.startSeconds - b.startSeconds;
			if (a.priority !== b.priority) return b.priority - a.priority;
			return String(a.activityId ?? a.locationId ?? '').localeCompare(String(b.activityId ?? b.locationId ?? ''));
		});
}

export function normalizeOccupationDefinition(definition = {}) {
	const schedule = normalizedPhaseList(definition);
	const fallbackPhase = normalizePhase(definition.defaultPhase ?? (schedule[0]?.phase ?? 'rest'));
	const anchors = Array.isArray(definition.anchors)
		? definition.anchors.slice(0, OCCUPATION_SCHEDULE_POLICY.maxSegments).map((anchor, index) => freeze({
			id: anchor?.id == null ? `anchor-${index}` : String(anchor.id),
			x: finite(anchor?.x),
			z: finite(anchor?.z),
			type: String(anchor?.type ?? 'activity'),
		}))
		: [];
	return freeze({
		id: definition.id == null ? 'occupation' : String(definition.id),
		schedule: freeze(schedule),
		fallbackPhase,
		anchors: freeze(anchors),
		travelSpeedMps: Math.max(0.1, Math.min(12, finite(definition.travelSpeedMps, 1.4))),
		transitionSeconds: Math.max(0, Math.min(60, finite(definition.transitionSeconds, OCCUPATION_SCHEDULE_POLICY.defaultTransitionSeconds))),
		seed: definition.seed == null ? 0 : definition.seed,
	});
}

export function chooseOccupationPhase(definition, clockSeconds) {
	const normalized = definition?.schedule ? definition : normalizeOccupationDefinition(definition);
	const candidates = normalized.schedule.filter((window) => isInWindow(clockSeconds, window));
	if (candidates.length === 0) {
		return freeze({
			phase: normalized.fallbackPhase,
			priority: phaseRank(normalized.fallbackPhase),
			window: null,
			locationId: null,
			activityId: null,
		});
	}
	candidates.sort((a, b) => {
		if (b.priority !== a.priority) return b.priority - a.priority;
		if (a.startSeconds !== b.startSeconds) return a.startSeconds - b.startSeconds;
		return String(a.activityId ?? a.locationId ?? '').localeCompare(String(b.activityId ?? b.locationId ?? ''));
	});
	const active = candidates[0];
	return freeze({
		phase: active.phase,
		priority: active.priority,
		window: active,
		locationId: active.locationId,
		activityId: active.activityId,
	});
}

function previousWindow(schedule, index) {
	if (!schedule.length) return null;
	return schedule[(index - 1 + schedule.length) % schedule.length];
}

function nextWindow(schedule, index) {
	if (!schedule.length) return null;
	return schedule[(index + 1) % schedule.length];
}

export function occupationScheduleBoundaries(definition) {
	const normalized = definition?.schedule ? definition : normalizeOccupationDefinition(definition);
	const boundaries = [];
	for (const window of normalized.schedule) {
		boundaries.push(window.startSeconds, window.endSeconds);
	}
	return freeze([...new Set(boundaries)].sort((a, b) => a - b));
}

export function secondsUntilNextOccupationChange(definition, clockSeconds) {
	const normalized = definition?.schedule ? definition : normalizeOccupationDefinition(definition);
	const now = normalizeClockSeconds(clockSeconds);
	const boundaries = occupationScheduleBoundaries(normalized);
	if (!boundaries.length) return DAY_SECONDS;
	for (const boundary of boundaries) {
		if (boundary > now) return boundary - now;
	}
	return DAY_SECONDS - now + boundaries[0];
}

function transitionProgress(elapsedSeconds, transitionSeconds) {
	if (!(transitionSeconds > 0)) return 1;
	return clamp(elapsedSeconds / transitionSeconds, 0, 1);
}

function distance2D(a, b) {
	if (!a || !b) return Infinity;
	return Math.hypot(finite(a.x) - finite(b.x), finite(a.z) - finite(b.z));
}

export function resolveOccupationTarget(definition, phaseResult, currentPosition = null) {
	const normalized = definition?.schedule ? definition : normalizeOccupationDefinition(definition);
	const window = phaseResult?.window;
	if (window?.targetX != null && window?.targetZ != null) {
		return freeze({
			type: 'explicit',
			id: window.locationId ?? window.activityId,
			x: window.targetX,
			z: window.targetZ,
			distanceMeters: distance2D(currentPosition, { x: window.targetX, z: window.targetZ }),
		});
	}
	if (window?.locationId) {
		const anchor = normalized.anchors.find((candidate) => candidate.id === window.locationId);
		if (anchor) {
			return freeze({
				type: anchor.type,
				id: anchor.id,
				x: anchor.x,
				z: anchor.z,
				distanceMeters: distance2D(currentPosition, anchor),
			});
		}
	}
	return null;
}

function locomotionForPhase(phase) {
	return DEFAULT_PHASES[normalizePhase(phase)]?.locomotion ?? 'idle';
}

export function createOccupationScheduleState(definition, initialClockSeconds = 0) {
	const normalized = definition?.schedule ? definition : normalizeOccupationDefinition(definition);
	const phase = chooseOccupationPhase(normalized, initialClockSeconds);
	return {
		clockSeconds: normalizeClockSeconds(initialClockSeconds),
		phase: phase.phase,
		previousPhase: null,
		phaseElapsedSeconds: 0,
		travelProgress: 0,
		transitionProgress: 1,
		seed: stableStringHash(normalized.seed),
		definition: normalized,
	};
}

export function advanceOccupationSchedule(state, deltaSeconds, options = {}) {
	if (!state?.definition) throw new Error('occupation state must include definition');
	const delta = Math.max(0, Math.min(2, finite(deltaSeconds, 0)));
	const definition = state.definition;
	const previousPhase = state.phase;
	const nextClock = normalizeClockSeconds(state.clockSeconds + delta);
	const selected = chooseOccupationPhase(definition, nextClock);
	const changed = selected.phase !== previousPhase || selected.activityId !== state.activityId;
	state.clockSeconds = nextClock;
	state.previousPhase = changed ? previousPhase : state.previousPhase;
	state.phase = selected.phase;
	state.activityId = selected.activityId;
	state.locationId = selected.locationId;
	state.phaseElapsedSeconds = changed ? 0 : Math.min(DAY_SECONDS, finite(state.phaseElapsedSeconds) + delta);
	state.transitionProgress = changed ? 0 : Math.min(1, finite(state.transitionProgress, 1) + delta / Math.max(0.1, definition.transitionSeconds));
	const target = resolveOccupationTarget(definition, selected, options.currentPosition ?? null);
	const targetDistance = target?.distanceMeters ?? Infinity;
	const travelBudget = Math.min(OCCUPATION_SCHEDULE_POLICY.maxTravelMeters, finite(options.travelBudgetMeters, 500));
	const shouldTravel = selected.phase === 'travel' || targetDistance > Math.max(2, finite(options.arrivalRadiusMeters, 1.2));
	const travelRatio = shouldTravel && targetDistance < Infinity
		? clamp(delta * definition.travelSpeedMps / Math.max(1, Math.min(travelBudget, targetDistance)))
		: 0;
	state.travelProgress = shouldTravel ? Math.min(1, finite(state.travelProgress) + travelRatio) : 0;
	return freeze({
		clockSeconds: nextClock,
		phase: selected.phase,
		previousPhase,
		changed,
		phaseElapsedSeconds: state.phaseElapsedSeconds,
		transitionProgress: state.transitionProgress,
		activityId: selected.activityId,
		locationId: selected.locationId,
		locomotion: locomotionForPhase(selected.phase),
		target,
		shouldTravel,
		travelProgress: state.travelProgress,
		nextChangeSeconds: secondsUntilNextOccupationChange(definition, nextClock),
		seed: state.seed,
	});
}

export function occupationSnapshot(definition, clockSeconds, currentPosition = null) {
	const normalized = definition?.schedule ? definition : normalizeOccupationDefinition(definition);
	const selected = chooseOccupationPhase(normalized, clockSeconds);
	const target = resolveOccupationTarget(normalized, selected, currentPosition);
	return freeze({
		definitionId: normalized.id,
		clockSeconds: normalizeClockSeconds(clockSeconds),
		phase: selected.phase,
		activityId: selected.activityId,
		locationId: selected.locationId,
		priority: selected.priority,
		locomotion: locomotionForPhase(selected.phase),
		target,
		nextChangeSeconds: secondsUntilNextOccupationChange(normalized, clockSeconds),
		boundaries: occupationScheduleBoundaries(normalized),
	});
}

export function buildOccupationDirective(definition, clockSeconds, currentPosition = null) {
	const snapshot = occupationSnapshot(definition, clockSeconds, currentPosition);
	const travel = snapshot.target
		? freeze({
			accepted: snapshot.target.distanceMeters <= OCCUPATION_SCHEDULE_POLICY.maxTravelMeters,
			arrivalRadiusMeters: Math.max(0.75, snapshot.phase === 'guard' ? 2 : 1.2),
			maxTravelMeters: OCCUPATION_SCHEDULE_POLICY.maxTravelMeters,
		})
		: freeze({ accepted: false, arrivalRadiusMeters: 1.2, maxTravelMeters: OCCUPATION_SCHEDULE_POLICY.maxTravelMeters });
	return freeze({
		snapshot,
		directive: freeze({
			activity: snapshot.phase,
			locomotion: snapshot.locomotion,
			travel,
			transitionSeconds: finite(definition?.transitionSeconds, OCCUPATION_SCHEDULE_POLICY.defaultTransitionSeconds),
		}),
	});
}

export function auditOccupationSchedule(definition) {
	const normalized = definition?.schedule ? definition : normalizeOccupationDefinition(definition);
	const errors = [];
	if (!normalized.schedule.length) errors.push('empty-schedule');
	if (normalized.schedule.length > OCCUPATION_SCHEDULE_POLICY.maxSegments) errors.push('schedule-overflow');
	for (const window of normalized.schedule) {
		if (!Number.isFinite(window.startSeconds) || !Number.isFinite(window.endSeconds)) errors.push('non-finite-window');
		if (!DEFAULT_PHASES[window.phase]) errors.push(`unknown-phase:${window.phase}`);
		if (window.targetX != null && !Number.isFinite(window.targetX)) errors.push('non-finite-target-x');
		if (window.targetZ != null && !Number.isFinite(window.targetZ)) errors.push('non-finite-target-z');
	}
	for (const anchor of normalized.anchors) {
		if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.z)) errors.push(`invalid-anchor:${anchor.id}`);
	}
	return freeze({
		ok: errors.length === 0,
		errors: freeze(errors),
		segmentCount: normalized.schedule.length,
		anchorCount: normalized.anchors.length,
		id: normalized.id,
	});
}

export function estimateOccupationTravelSeconds(definition, clockSeconds, currentPosition) {
	const normalized = definition?.schedule ? definition : normalizeOccupationDefinition(definition);
	const selected = chooseOccupationPhase(normalized, clockSeconds);
	const target = resolveOccupationTarget(normalized, selected, currentPosition);
	if (!target || !(target.distanceMeters < Infinity)) return null;
	const distance = Math.min(OCCUPATION_SCHEDULE_POLICY.maxTravelMeters, Math.max(0, target.distanceMeters));
	return freeze({
		distanceMeters: distance,
		travelSeconds: distance / Math.max(0.1, normalized.travelSpeedMps),
		phase: selected.phase,
		locationId: selected.locationId,
	});
}

export function occupationPhaseTimeline(definition) {
	const normalized = definition?.schedule ? definition : normalizeOccupationDefinition(definition);
	const rows = normalized.schedule.map((window, index) => freeze({
		index,
		startSeconds: window.startSeconds,
		endSeconds: window.endSeconds,
		phase: window.phase,
		priority: window.priority,
		locationId: window.locationId,
		activityId: window.activityId,
		previous: previousWindow(normalized.schedule, index)?.phase ?? null,
		next: nextWindow(normalized.schedule, index)?.phase ?? null,
	}));
	return freeze(rows);
}

export function occupationDigest(definition) {
	const normalized = definition?.schedule ? definition : normalizeOccupationDefinition(definition);
	const payload = JSON.stringify({
		id: normalized.id,
		seed: normalized.seed,
		schedule: normalized.schedule,
		anchors: normalized.anchors,
	});
	return stableStringHash(payload).toString(16).padStart(8, '0');
}
