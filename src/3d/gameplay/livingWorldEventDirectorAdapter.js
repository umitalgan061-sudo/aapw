/**
 * Thin adapter for the existing WorldEventSystem/event bus.
 *
 * It schedules deterministic ambient world-event candidates and forwards only
 * accepted payloads through an injected publisher. The adapter owns neither
 * event persistence nor event semantics, so the existing event system remains
 * authoritative and no second world-event framework is introduced.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const DAY_SECONDS = 86400;
const MAX_CANDIDATES = 24;
const MIN_INTERVAL_SECONDS = 5;

export const LIVING_WORLD_EVENT_DIRECTOR_POLICY = freeze({
	id: 'living-world-event-director-adapter-2026-09-08-v1',
	deterministic: true,
	maxCandidates: MAX_CANDIDATES,
	minIntervalSeconds: MIN_INTERVAL_SECONDS,
	maxAdvanceSeconds: 2,
	ambientTypes: freeze(['wildlife_surge', 'traveller_sighting', 'weather_shift', 'guard_alert', 'caravan_passage']),
});

const DEFAULT_EVENT_RULES = freeze({
	wildlife_surge: freeze({ cooldownSeconds: 900, baseProbability: 0.16, priority: 20, maxDistance: 850 }),
	traveller_sighting: freeze({ cooldownSeconds: 600, baseProbability: 0.14, priority: 18, maxDistance: 700 }),
	weather_shift: freeze({ cooldownSeconds: 1200, baseProbability: 0.10, priority: 10, maxDistance: 1600 }),
	guard_alert: freeze({ cooldownSeconds: 300, baseProbability: 0.20, priority: 35, maxDistance: 500 }),
	caravan_passage: freeze({ cooldownSeconds: 1500, baseProbability: 0.08, priority: 22, maxDistance: 1200 }),
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

function random01(seed) {
	return stableHash(seed) / 0x100000000;
}

function normalizeType(type) {
	const key = String(type ?? '').trim().toLowerCase();
	return LIVING_WORLD_EVENT_DIRECTOR_POLICY.ambientTypes.includes(key) ? key : null;
}

function normalizeRule(type, rules) {
	const normalized = normalizeType(type);
	const fallback = DEFAULT_EVENT_RULES[normalized] ?? DEFAULT_EVENT_RULES.weather_shift;
	const supplied = rules?.[normalized] ?? {};
	return freeze({
		cooldownSeconds: Math.max(MIN_INTERVAL_SECONDS, finite(supplied.cooldownSeconds, fallback.cooldownSeconds)),
		baseProbability: clamp(supplied.baseProbability, 0, 1),
		priority: finite(supplied.priority, fallback.priority),
		maxDistance: Math.max(1, finite(supplied.maxDistance, fallback.maxDistance)),
	});
}

function normalizeContext(context = {}) {
	return freeze({
		worldSeed: context.worldSeed == null ? 0 : context.worldSeed,
		clockSeconds: ((finite(context.clockSeconds, 0) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS,
		playerX: finite(context.playerX, 0),
		playerZ: finite(context.playerZ, 0),
		threatLevel: clamp(context.threatLevel, 0, 1),
		populationDensity: clamp(context.populationDensity, 0, 1),
		weatherPressure: clamp(context.weatherPressure, 0, 1),
		settlementActivity: clamp(context.settlementActivity, 0, 1),
		wildlifeActivity: clamp(context.wildlifeActivity, 0, 1),
		roadActivity: clamp(context.roadActivity, 0, 1),
		nearestSettlementDistanceMeters: Math.max(0, finite(context.nearestSettlementDistanceMeters, Infinity)),
		nearestRoadDistanceMeters: Math.max(0, finite(context.nearestRoadDistanceMeters, Infinity)),
		biome: String(context.biome ?? '').trim().toLowerCase(),
	});
}

function typeActivity(type, context) {
	if (type === 'wildlife_surge') return 0.45 + context.wildlifeActivity * 0.55;
	if (type === 'traveller_sighting') return 0.25 + context.roadActivity * 0.75;
	if (type === 'weather_shift') return 0.25 + context.weatherPressure * 0.75;
	if (type === 'guard_alert') return 0.2 + context.threatLevel * 0.8;
	if (type === 'caravan_passage') return 0.15 + context.roadActivity * 0.85;
	return 0.25;
}

function dayPhaseMultiplier(type, clockSeconds) {
	const hour = (((finite(clockSeconds) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS) / 3600;
	if (type === 'wildlife_surge') return hour < 5 || hour >= 19 ? 1.25 : 0.85;
	if (type === 'traveller_sighting') return hour >= 7 && hour < 19 ? 1.2 : 0.55;
	if (type === 'weather_shift') return 1;
	if (type === 'guard_alert') return hour >= 6 && hour < 22 ? 1.05 : 0.8;
	if (type === 'caravan_passage') return hour >= 8 && hour < 18 ? 1.3 : 0.4;
	return 1;
}

function biomeMultiplier(type, biome) {
	const key = String(biome ?? '').toLowerCase();
	if (type === 'wildlife_surge') {
		if (['forest', 'marsh', 'meadow', 'steppe'].includes(key)) return 1.15;
		if (['desert', 'volcanic'].includes(key)) return 0.6;
	}
	if (type === 'caravan_passage' && ['desert', 'steppe', 'arid'].includes(key)) return 1.25;
	if (type === 'weather_shift' && ['mountain', 'snow', 'north'].includes(key)) return 1.2;
	return 1;
}

export function scoreAmbientEvent(type, context = {}, rules = DEFAULT_EVENT_RULES) {
	const normalized = normalizeType(type);
	if (!normalized) return freeze({ accepted: false, score: 0, reasons: freeze(['unknown-type']) });
	const safe = normalizeContext(context);
	const rule = normalizeRule(normalized, rules);
	const activity = typeActivity(normalized, safe);
	const phase = dayPhaseMultiplier(normalized, safe.clockSeconds);
	const biome = biomeMultiplier(normalized, safe.biome);
	const settlementDistance = Number.isFinite(safe.nearestSettlementDistanceMeters)
		? clamp(safe.nearestSettlementDistanceMeters / rule.maxDistance)
		: 1;
	const roadDistance = Number.isFinite(safe.nearestRoadDistanceMeters)
		? clamp(safe.nearestRoadDistanceMeters / rule.maxDistance)
		: 1;
	let proximity = 0.5;
	if (normalized === 'caravan_passage' || normalized === 'traveller_sighting') proximity = 1 - roadDistance;
	else if (normalized === 'guard_alert') proximity = 1 - settlementDistance * 0.5;
	else if (normalized === 'wildlife_surge') proximity = settlementDistance;
	const score = clamp(rule.baseProbability * activity * phase * biome * (0.55 + proximity * 0.45) * (0.7 + safe.populationDensity * 0.3));
	const reasons = [];
	if (score <= 0) reasons.push('zero-score');
	if (normalized === 'caravan_passage' && roadDistance >= 1) reasons.push('road-context');
	if (normalized === 'guard_alert' && safe.threatLevel < 0.12) reasons.push('low-threat');
	if (normalized === 'wildlife_surge' && safe.nearestSettlementDistanceMeters < 40) reasons.push('settlement-buffer');
	return freeze({
		accepted: score > 0 && reasons.length === 0,
		type: normalized,
		score: Number(score.toFixed(6)),
		priority: rule.priority,
		reasons: freeze(reasons),
		components: freeze({
			activity: Number(activity.toFixed(4)),
			phase: Number(phase.toFixed(4)),
			biome: Number(biome.toFixed(4)),
			proximity: Number(proximity.toFixed(4)),
			baseProbability: rule.baseProbability,
		}),
	});
}

export function createEventDirectorState(seed = 0, initialClockSeconds = 0) {
	return {
		seed,
		clockSeconds: ((finite(initialClockSeconds) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS,
		lastIssuedByType: new Map(),
		sequence: 0,
	};
}

function cooldownReady(state, type, nowSeconds, cooldownSeconds) {
	const last = state.lastIssuedByType.get(type);
	if (last == null) return true;
	const elapsed = ((nowSeconds - last) % DAY_SECONDS + DAY_SECONDS) % DAY_SECONDS;
	return elapsed >= cooldownSeconds;
}

function deterministicLocation(type, state, context, ordinal) {
	const radialSeed = random01(`${state.seed}:${type}:${ordinal}:radial`);
	const angleSeed = random01(`${state.seed}:${type}:${ordinal}:angle`);
	const baseDistance = 45 + radialSeed * 260;
	const angle = angleSeed * Math.PI * 2;
	return freeze({
		x: context.playerX + Math.cos(angle) * baseDistance,
		z: context.playerZ + Math.sin(angle) * baseDistance,
		radiusMeters: baseDistance,
	});
}

export function advanceEventDirector(state, deltaSeconds, context = {}, options = {}) {
	if (!state || !(state.lastIssuedByType instanceof Map)) throw new Error('invalid event director state');
	const delta = Math.max(0, Math.min(LIVING_WORLD_EVENT_DIRECTOR_POLICY.maxAdvanceSeconds, finite(deltaSeconds, 0)));
	const safe = normalizeContext({ ...context, clockSeconds: state.clockSeconds + delta });
	state.clockSeconds = safe.clockSeconds;
	const requested = Array.isArray(options.types)
		? options.types.slice(0, MAX_CANDIDATES).map(normalizeType).filter(Boolean)
		: [...LIVING_WORLD_EVENT_DIRECTOR_POLICY.ambientTypes];
	const candidates = [];
	for (let index = 0; index < requested.length; index += 1) {
		const type = requested[index];
		const rule = normalizeRule(type, options.rules);
		if (!cooldownReady(state, type, state.clockSeconds, rule.cooldownSeconds)) continue;
		const score = scoreAmbientEvent(type, safe, options.rules);
		if (!score.accepted) continue;
		const roll = random01(`${state.seed}:${type}:${Math.floor(state.clockSeconds / MIN_INTERVAL_SECONDS)}`);
		if (roll > score.score) continue;
		const location = deterministicLocation(type, state, safe, state.sequence + index);
		candidates.push(freeze({
			type,
			sequence: state.sequence + index + 1,
			timeSeconds: state.clockSeconds,
			location,
			score: score.score,
			priority: score.priority,
			biome: safe.biome,
			seed: stableHash(`${state.seed}:${type}:${state.sequence + index}`).toString(16),
		}));
	}
	candidates.sort((a, b) => b.priority - a.priority || b.score - a.score || a.type.localeCompare(b.type));
	const selected = candidates.slice(0, Math.max(0, Math.min(MAX_CANDIDATES, Math.floor(finite(options.maxEmissions, 3)))));
	for (const event of selected) {
		state.lastIssuedByType.set(event.type, state.clockSeconds);
		state.sequence = Math.max(state.sequence, event.sequence);
	}
	return freeze({
		clockSeconds: state.clockSeconds,
		candidates: freeze(selected),
		emitted: selected.length,
		sequence: state.sequence,
	});
}

export function createWorldEventPublisherAdapter({ publish, normalizePayload = (value) => value } = {}) {
	return {
		emit(event) {
			if (typeof publish !== 'function' || !event) return freeze({ accepted: false, reason: 'publisher-unavailable' });
			try {
				const payload = normalizePayload(event);
				if (!payload || typeof payload !== 'object') return freeze({ accepted: false, reason: 'invalid-payload' });
				const result = publish(payload);
				return freeze({ accepted: true, result: result ?? null });
			} catch (error) {
				return freeze({ accepted: false, reason: 'publisher-error', message: error instanceof Error ? error.message : 'unknown-error' });
			}
		},
	};
}

export function buildAmbientWorldEventReceipt(event, context = {}) {
	if (!event?.type || !LIVING_WORLD_EVENT_DIRECTOR_POLICY.ambientTypes.includes(event.type)) return null;
	const safe = normalizeContext(context);
	return freeze({
		id: `${event.type}:${event.sequence}:${event.seed}`,
		type: event.type,
		sequence: event.sequence,
		timeSeconds: finite(event.timeSeconds, safe.clockSeconds),
		location: event.location ? freeze({ x: finite(event.location.x), z: finite(event.location.z), radiusMeters: Math.max(0, finite(event.location.radiusMeters)) }) : null,
		biome: safe.biome,
		source: 'living-world-event-director',
		deterministic: true,
	});
}

export function auditEventDirectorState(state) {
	const errors = [];
	if (!state || !(state.lastIssuedByType instanceof Map)) errors.push('invalid-state');
	if (state?.sequence != null && (!Number.isInteger(state.sequence) || state.sequence < 0)) errors.push('invalid-sequence');
	if (state?.clockSeconds != null && !Number.isFinite(state.clockSeconds)) errors.push('invalid-clock');
	return freeze({ ok: errors.length === 0, errors: freeze(errors), sequence: Number(state?.sequence ?? 0), clockSeconds: finite(state?.clockSeconds) });
}
