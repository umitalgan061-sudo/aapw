/**
 * Şafak Kartalı — fauna ecology director adapter.
 *
 * This module sits between the existing deterministic ecology policy and the already-shipped
 * livingWorldFaunaRuntimeBridge. It does not create a second ActorRegistry, navigation system,
 * faction system, combat owner, or world-event framework. It only turns canonical observations
 * into bounded ecological intents which existing owners may execute.
 *
 * The director is deliberately pure and deterministic. Every decision is derived from the seed,
 * tick, canonical habitat samples, actor observations and caller-provided weather/clock context.
 * It is safe to run off-screen because it never touches THREE, DOM, EventBus or scene state.
 */

import {
	LIVING_WORLD_ECOLOGY_POLICY,
	getSpeciesProfile,
	evaluateHabitat,
	chooseEcologyActivity,
	chooseGroupSize,
	speciesCompetitionScore,
	normalizeEcologyContext,
	ecologyDigest,
} from './livingWorldEcologyPolicy.js';

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const idOf = (value, fallback = '') => String(value ?? fallback).trim() || fallback;
const text = (value, fallback = '') => value == null ? fallback : String(value);

export const LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY = freeze({
	id: 'safak-kartali-fauna-ecology-director-2026-09-14-v1',
	deterministic: true,
	maxHabitats: 48,
	maxActors: 128,
	maxGroups: 48,
	maxResources: 96,
	maxSignals: 96,
	maxEvents: 12,
	maxMigrationTargets: 8,
	maxAmbientIntents: 16,
	maxOperations: 64,
	nearMeters: 45,
	distantMeters: 140,
	farMeters: 340,
	culledMeters: 2400,
	nearTickSeconds: 0,
	distantTickSeconds: 0.75,
	farTickSeconds: 2,
	culledTickSeconds: 8,
	threatMemorySeconds: 18,
	packAlertRadiusMeters: 72,
	groupCohesionRadiusMeters: 28,
	groupSplitRadiusMeters: 90,
	resourceConsumptionPerSecond: 0.0008,
	recoveryPerSecond: 0.0012,
	starvationPenaltyPerSecond: 0.001,
	waterNeedThreshold: 0.38,
	foodNeedThreshold: 0.42,
	restNeedThreshold: 0.68,
	reproductionMinAgeSeconds: 1800,
	reproductionCooldownSeconds: 2400,
	migrationPressureThreshold: 0.62,
	despawnPressureThreshold: 0.93,
	birthProbabilityScale: 0.000035,
	mortalityProbabilityScale: 0.00002,
	seasonalityScale: 0.22,
	weatherStressScale: 0.26,
});

const LOD_INTERVALS = freeze({
	near: LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.nearTickSeconds,
	distant: LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.distantTickSeconds,
	far: LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.farTickSeconds,
	culled: LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.culledTickSeconds,
});

const ROLE_WEIGHT = freeze({
	predator: freeze({ prey: 0.62, threat: 0.58, settlement: 0.8, road: 0.6 }),
	grazer: freeze({ prey: 0.08, threat: 0.84, settlement: 0.42, road: 0.25 }),
	forager: freeze({ prey: 0.18, threat: 0.66, settlement: 0.5, road: 0.35 }),
	domestic: freeze({ prey: 0.02, threat: 0.18, settlement: 0.06, road: 0.12 }),
	avian: freeze({ prey: 0.25, threat: 0.54, settlement: 0.02, road: 0.02 }),
	pollinator: freeze({ prey: 0.02, threat: 0.15, settlement: 0.01, road: 0.01 }),
});

const SEASONS = freeze({
	winter: freeze({ food: 0.62, water: 0.88, breeding: 0.42, migration: 1.18, shelter: 1.22 }),
	spring: freeze({ food: 1.18, water: 1.02, breeding: 1.22, migration: 0.9, shelter: 0.82 }),
	summer: freeze({ food: 1.02, water: 0.9, breeding: 0.82, migration: 0.78, shelter: 0.72 }),
	autumn: freeze({ food: 0.88, water: 0.96, breeding: 0.68, migration: 1.2, shelter: 1.02 }),
});

const WEATHER = freeze({
	clear: freeze({ food: 1, water: 1, movement: 1, threat: 1, shelter: 0.7 }),
	cloud: freeze({ food: 0.98, water: 1.03, movement: 0.98, threat: 1.01, shelter: 0.78 }),
	fog: freeze({ food: 0.94, water: 1.06, movement: 0.82, threat: 1.12, shelter: 1.08 }),
	rain: freeze({ food: 1.08, water: 1.18, movement: 0.86, threat: 0.94, shelter: 1.04 }),
	storm: freeze({ food: 0.72, water: 1.24, movement: 0.54, threat: 0.82, shelter: 1.38 }),
	snow: freeze({ food: 0.58, water: 0.96, movement: 0.61, threat: 0.88, shelter: 1.52 }),
	blizzard: freeze({ food: 0.38, water: 0.88, movement: 0.35, threat: 0.72, shelter: 1.9 }),
});

const AMBIENT_KINDS = freeze([
	'graze',
	'forage',
	'drink',
	'perch',
	'roost',
	'howl',
	'bug_hover',
	'flock_turn',
	'herd_shift',
	'pack_regroup',
	'wing_alarm',
	'water_crossing',
]);

function stableHash(value) {
	let hash = 2166136261;
	for (const char of String(value)) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 2246822507) >>> 0;
	hash ^= hash >>> 13;
	hash = Math.imul(hash, 3266489909) >>> 0;
	return (hash ^ (hash >>> 16)) >>> 0;
}

function unit(seed) {
	return stableHash(seed) / 0x100000000;
}

function signedUnit(seed) {
	return unit(seed) * 2 - 1;
}

function hashChoice(values, seed, fallback = null) {
	if (!Array.isArray(values) || !values.length) return fallback;
	return values[stableHash(seed) % values.length];
}

function round(value, places = 6) {
	const scale = 10 ** places;
	return Math.round(finite(value) * scale) / scale;
}

function distance2d(a, b) {
	if (!a || !b) return Infinity;
	const dx = finite(a.x) - finite(b.x);
	const dz = finite(a.z) - finite(b.z);
	return Math.hypot(dx, dz);
}

function vector2d(value) {
	if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.z))) return null;
	return freeze({ x: Number(value.x), z: Number(value.z) });
}

function normalizeSeason(value) {
	const season = text(value, 'summer').toLowerCase();
	return SEASONS[season] ? season : 'summer';
}

function normalizeWeather(value) {
	const weather = text(value, 'clear').toLowerCase();
	return WEATHER[weather] ? weather : 'clear';
}

function seasonProfile(season) {
	return SEASONS[normalizeSeason(season)];
}

function weatherProfile(weather) {
	return WEATHER[normalizeWeather(weather)];
}

function timeOfDay(hour) {
	const h = ((finite(hour, 12) % 24) + 24) % 24;
	if (h < 5) return 'night';
	if (h < 8) return 'dawn';
	if (h < 17) return 'day';
	if (h < 20) return 'dusk';
	return 'night';
}

function lightFactor(hour) {
	const phase = timeOfDay(hour);
	if (phase === 'day') return 1;
	if (phase === 'dawn' || phase === 'dusk') return 0.68;
	return 0.32;
}

function normalizeHabitat(row, index) {
	const position = vector2d(row?.position);
	const biome = text(row?.biome, 'unknown').trim().toLowerCase();
	return freeze({
		id: idOf(row?.id, `habitat-${index}`),
		biome,
		canonicalBiome: text(row?.canonicalBiome, biome).trim().toLowerCase(),
		position,
		quality: clamp(row?.score, 0, 1),
		occupancy: clamp(row?.occupancy, 0, 1),
		food: clamp(row?.food, 0, 1),
		water: clamp(row?.water, 0, 1),
		cover: clamp(row?.cover, 0, 1),
		danger: clamp(row?.danger, 0, 1),
		slopeDegrees: Math.max(0, Math.min(89, finite(row?.slopeDegrees ?? row?.slope, 0))),
		waterDepthMeters: Math.max(0, finite(row?.waterDepthMeters, 0)),
		distanceToSettlementMeters: Math.max(0, finite(row?.distanceToSettlementMeters, 9999)),
		distanceToRoadMeters: Math.max(0, finite(row?.distanceToRoadMeters, 9999)),
		groundValid: row?.groundValid !== false,
		navReachable: row?.navReachable !== false,
		roadAccess: clamp(row?.roadAccess, 0, 1),
		waterAccess: clamp(row?.waterAccess, 0, 1),
		reproductionPressure: clamp(row?.reproductionPressure, 0, 1),
		resourceRegeneration: clamp(row?.resourceRegeneration ?? 0.5, 0, 1),
		territoryId: idOf(row?.territoryId),
		settlementId: idOf(row?.settlementId),
	});
}

function normalizeActor(row, index) {
	const position = vector2d(row?.position);
	return freeze({
		id: idOf(row?.id, `actor-${index}`),
		species: text(row?.species, 'deer').trim().toLowerCase(),
		groupId: idOf(row?.groupId),
		habitatId: idOf(row?.habitatId),
		position,
		ageSeconds: Math.max(0, finite(row?.ageSeconds, 3600)),
		hunger: clamp(row?.hunger, 0, 1),
		thirst: clamp(row?.thirst, 0, 1),
		fatigue: clamp(row?.fatigue, 0, 1),
		health: clamp(row?.health, 0, 1),
		pregnant: Boolean(row?.pregnant),
		sex: text(row?.sex, 'unknown').toLowerCase(),
		alive: row?.alive !== false,
		active: row?.active !== false,
		lastBirthAgeSeconds: Math.max(0, finite(row?.lastBirthAgeSeconds, 999999)),
		lastThreatSeconds: Math.max(0, finite(row?.lastThreatSeconds, 999999)),
		territoryId: idOf(row?.territoryId),
	});
}

function normalizeThreat(row, index) {
	return freeze({
		id: idOf(row?.id, `threat-${index}`),
		kind: text(row?.kind, 'unknown').toLowerCase(),
		position: vector2d(row?.position),
		distanceMeters: Math.max(0, finite(row?.distanceMeters, 9999)),
		confidence: clamp(row?.confidence, 0, 1),
		visible: row?.visible !== false,
		heard: Boolean(row?.heard),
		hostile: row?.hostile !== false,
		ageSeconds: Math.max(0, finite(row?.ageSeconds, 0)),
		factionId: idOf(row?.factionId),
		wanted: clamp(row?.wanted, 0, 1),
	});
}

function normalizeResource(row, index) {
	return freeze({
		id: idOf(row?.id, `resource-${index}`),
		habitatId: idOf(row?.habitatId),
		kind: text(row?.kind, 'food').toLowerCase(),
		position: vector2d(row?.position),
		amount: clamp(row?.amount, 0, 1),
		regeneration: clamp(row?.regeneration ?? 0.5, 0, 1),
		capacity: clamp(row?.capacity ?? 1, 0, 1),
		seasonBias: finite(row?.seasonBias, 0),
	});
}

function habitatMap(habitats) {
	return new Map(habitats.map((habitat) => [habitat.id, habitat]));
}

function actorMap(actors) {
	return new Map(actors.map((actor) => [actor.id, actor]));
}

function clampCollection(values, limit, normalizer) {
	if (!Array.isArray(values)) return [];
	return values.slice(0, Math.max(0, limit)).map(normalizer);
}

function lodForDistance(distanceMeters) {
	if (distanceMeters <= LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.nearMeters) return 'near';
	if (distanceMeters <= LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.distantMeters) return 'distant';
	if (distanceMeters <= LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.farMeters) return 'far';
	return 'culled';
}

function lodIntervalSeconds(lod) {
	return LOD_INTERVALS[lod] ?? LOD_INTERVALS.culled;
}

function roleForSpecies(species) {
	return getSpeciesProfile(species)?.kind ?? 'unknown';
}

function hungerNeed(actor) {
	return actor.hunger >= LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.foodNeedThreshold
		? clamp((actor.hunger - LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.foodNeedThreshold) / (1 - LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.foodNeedThreshold))
		: 0;
}

function thirstNeed(actor) {
	return actor.thirst >= LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.waterNeedThreshold
		? clamp((actor.thirst - LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.waterNeedThreshold) / (1 - LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.waterNeedThreshold))
		: 0;
}

function restNeed(actor) {
	return actor.fatigue >= LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.restNeedThreshold
		? clamp((actor.fatigue - LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.restNeedThreshold) / (1 - LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.restNeedThreshold))
		: 0;
}

function survivalNeed(actor) {
	return clamp(hungerNeed(actor) * 0.42 + thirstNeed(actor) * 0.42 + restNeed(actor) * 0.16);
}

function metabolicLoad(species, activity) {
	const role = roleForSpecies(species);
	const base = role === 'predator' ? 1.12 : role === 'avian' ? 0.8 : role === 'pollinator' ? 0.38 : 1;
	const multiplier = activity === 'flee' || activity === 'hunt' ? 1.55
		: activity === 'travel' || activity === 'migrate' ? 1.3
		: activity === 'roam' || activity === 'forage' || activity === 'graze' ? 1
		: 0.62;
	return base * multiplier;
}

function seasonalResourceFactor(season, kind) {
	const profile = seasonProfile(season);
	if (kind === 'food') return profile.food;
	if (kind === 'water') return profile.water;
	if (kind === 'shelter') return profile.shelter;
	return 1;
}

function weatherMovementFactor(weather) {
	return weatherProfile(weather).movement;
}

function weatherStressFactor(weather) {
	return weatherProfile(weather).shelter * LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.weatherStressScale;
}

function activityAllowedAtHour(species, activity, hour) {
	const phase = timeOfDay(hour);
	if (activity === 'hunt') return phase === 'night' || phase === 'dusk';
	if (activity === 'graze') return phase !== 'night';
	if (activity === 'forage') return phase !== 'night';
	if (activity === 'perch') return phase === 'day' || phase === 'dawn' || phase === 'dusk';
	if (activity === 'roost') return phase === 'night';
	return true;
}

function habitatContext(habitat, world = {}) {
	return normalizeEcologyContext({
		biome: habitat?.biome,
		temperatureC: world.temperatureC,
		moisture: world.moisture ?? habitat?.food,
		slopeDegrees: habitat?.slopeDegrees,
		waterDepthMeters: habitat?.waterDepthMeters,
		distanceToSettlementMeters: habitat?.distanceToSettlementMeters,
		distanceToRoadMeters: habitat?.distanceToRoadMeters,
		nearWater: habitat?.waterAccess > 0.45,
		threatLevel: habitat?.danger,
		clockSeconds: finite(world.clockSeconds, 0),
		season: world.season,
	});
}

function habitatAdmission(species, habitat, world) {
	if (!habitat?.position || !habitat.groundValid || !habitat.navReachable) return freeze({ accepted: false, score: 0, reason: 'ground-or-nav' });
	const canonical = habitat.canonicalBiome;
	if (['ocean', 'cliff'].includes(canonical)) return freeze({ accepted: false, score: 0, reason: canonical });
	const result = evaluateHabitat(species, habitatContext(habitat, world));
	if (!result.accepted) return freeze({ accepted: false, score: result.score, reason: result.reasons[0] || 'ecology' });
	const score = clamp(result.score * (0.58 + habitat.quality * 0.42));
	return freeze({ accepted: score >= 0.24, score: round(score), reason: score >= 0.24 ? '' : 'quality' });
}

function computeCarryingCapacity(species, habitat, world = {}) {
	const profile = getSpeciesProfile(species);
	if (!profile || !habitat) return 0;
	const food = clamp(habitat.food) * seasonalResourceFactor(world.season, 'food');
	const water = clamp(habitat.water) * seasonalResourceFactor(world.season, 'water');
	const cover = clamp(habitat.cover) * seasonalResourceFactor(world.season, 'shelter');
	const quality = clamp(habitat.quality);
	const dangerPenalty = 1 - clamp(habitat.danger) * 0.74;
	const slopePenalty = 1 - clamp(habitat.slopeDegrees / 80) * (1 - profile.preferredSlope);
	const role = ROLE_WEIGHT[profile.kind] || { prey: 0.2, threat: 0.5, settlement: 0.5, road: 0.3 };
	const settlementPenalty = 1 - clamp(1 - habitat.distanceToSettlementMeters / 120, 0, 1) * role.settlement;
	const roadPenalty = 1 - clamp(1 - habitat.distanceToRoadMeters / 14, 0, 1) * role.road;
	const resourceScore = food * 0.46 + water * 0.32 + cover * 0.22;
	const raw = quality * resourceScore * dangerPenalty * slopePenalty * settlementPenalty * roadPenalty;
	const capacityScale = profile.kind === 'pollinator' ? 60 : profile.kind === 'avian' ? 20 : profile.kind === 'predator' ? 8 : 16;
	return Math.max(0, Math.min(LIVING_WORLD_ECOLOGY_POLICY.maxGroupSize * 4, round(raw * capacityScale)));
}

function occupancyRatio(count, capacity) {
	if (capacity <= 0) return 1;
	return clamp(count / capacity);
}

function pressureFromOccupancy(count, capacity) {
	return clamp(Math.max(0, occupancyRatio(count, capacity) - 0.68) / 0.32);
}

function scarcityFactor(available, desired) {
	if (desired <= 0) return 0;
	return clamp(1 - Math.max(0, desired - available) / desired);
}

function resourcePressure(habitat, resources, species, world) {
	const food = resources.filter((resource) => resource.habitatId === habitat.id && resource.kind === 'food').reduce((sum, resource) => sum + resource.amount, 0);
	const water = resources.filter((resource) => resource.habitatId === habitat.id && resource.kind === 'water').reduce((sum, resource) => sum + resource.amount, 0);
	const capacity = Math.max(1, computeCarryingCapacity(species, habitat, world));
	const foodNeed = capacity * (0.25 + roleForSpecies(species) === 'predator' ? 0.06 : 0.2);
	const waterNeed = capacity * 0.14;
	return freeze({
		foodAvailable: round(food),
		waterAvailable: round(water),
		foodScarcity: round(1 - scarcityFactor(food, foodNeed)),
		waterScarcity: round(1 - scarcityFactor(water, waterNeed)),
		capacity,
	});
}

function groupRows(actors) {
	const grouped = new Map();
	for (const actor of actors) {
		if (!actor.groupId) continue;
		if (!grouped.has(actor.groupId)) grouped.set(actor.groupId, []);
		grouped.get(actor.groupId).push(actor);
	}
	for (const [key, rows] of grouped) rows.sort((a, b) => a.id.localeCompare(b.id));
	return grouped;
}

function groupCentroid(rows) {
	const positioned = rows.filter((row) => row.position);
	if (!positioned.length) return null;
	const x = positioned.reduce((sum, row) => sum + row.position.x, 0) / positioned.length;
	const z = positioned.reduce((sum, row) => sum + row.position.z, 0) / positioned.length;
	return freeze({ x: round(x, 4), z: round(z, 4) });
}

function groupSpread(rows, centroid) {
	if (!centroid) return 0;
	if (!rows.length) return 0;
	const total = rows.reduce((sum, row) => sum + distance2d(row.position, centroid), 0);
	return total / rows.length;
}

function groupRole(rows) {
	const species = rows[0]?.species ?? 'deer';
	return roleForSpecies(species);
}

function groupCohesionDirective(groupId, rows, threats, world) {
	const centroid = groupCentroid(rows);
	if (!centroid) return null;
	const spread = groupSpread(rows, centroid);
	const threat = selectGroupThreat(rows, threats);
	const alert = threat && threat.score >= 0.46;
	let mode = spread > LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.groupSplitRadiusMeters ? 'regroup' : 'cohesion';
	if (alert && groupRole(rows) !== 'domestic') mode = 'alarm';
	const target = alert && threat?.threat?.position ? threat.threat.position : centroid;
	return freeze({
		id: groupId,
		mode,
		center: centroid,
		target,
		spreadMeters: round(spread),
		threatId: threat?.threat?.id || '',
		priority: round((alert ? 0.84 : 0.34) + clamp(spread / 100) * 0.2),
		movementFactor: round(weatherMovementFactor(world.weather), 4),
	});
}

function threatScore(actor, threat) {
	if (!threat?.hostile || threat.ageSeconds > LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.threatMemorySeconds) return 0;
	const modality = threat.visible ? 0.32 : threat.heard ? 0.18 : 0;
	const proximity = clamp(1 - threat.distanceMeters / 160) * 0.42;
	const confidence = clamp(threat.confidence) * 0.26;
	const role = roleForSpecies(actor.species);
	const sensitivity = role === 'predator' ? 0.72 : role === 'domestic' ? 0.56 : 0.88;
	return clamp((modality + proximity + confidence) * sensitivity);
}

function selectGroupThreat(rows, threats) {
	const scored = [];
	for (const threat of threats) {
		const score = rows.reduce((max, actor) => Math.max(max, threatScore(actor, threat)), 0);
		if (score > 0) scored.push({ threat, score });
	}
	return scored.sort((a, b) => b.score - a.score || a.threat.id.localeCompare(b.threat.id))[0] || null;
}

function nearestResource(actor, habitat, resources, kind) {
	const candidates = resources.filter((resource) => resource.habitatId === habitat?.id && resource.kind === kind && resource.amount > 0.01);
	return candidates.sort((a, b) => distance2d(actor.position, a.position) - distance2d(actor.position, b.position) || a.id.localeCompare(b.id))[0] || null;
}

function activityForActor(actor, habitat, resources, threats, world, seed) {
	const threat = selectGroupThreat([actor], threats);
	if (threat?.score >= 0.64 && roleForSpecies(actor.species) !== 'predator') return 'flee';
	if (threat?.score >= 0.7 && roleForSpecies(actor.species) === 'predator') return 'hunt';
	const context = habitatContext(habitat, {
		...world,
		season: world.season,
		clockSeconds: world.clockSeconds,
	});
	const base = chooseEcologyActivity(actor.species, {
		nearWater: habitat?.waterAccess > 0.5,
		threatLevel: threat?.score || 0,
	}, seed, finite(world.clockSeconds, 0));
	if (thirstNeed(actor) > hungerNeed(actor) && nearestResource(actor, habitat, resources, 'water')) return 'drink';
	if (hungerNeed(actor) > restNeed(actor) && nearestResource(actor, habitat, resources, 'food')) {
		return roleForSpecies(actor.species) === 'predator' ? 'hunt' : 'forage';
	}
	if (restNeed(actor) > 0.45) return 'rest';
	if (!activityAllowedAtHour(actor.species, base, world.hour)) return hashChoice(getSpeciesProfile(actor.species)?.activity || ['roam'], `${seed}:${actor.id}:fallback`, 'roam');
	return base;
}

function targetResourcePosition(actor, habitat, resources, activity) {
	if (!['graze', 'forage', 'drink', 'hunt'].includes(activity)) return habitat?.position || actor.position;
	const kind = activity === 'drink' ? 'water' : 'food';
	const resource = nearestResource(actor, habitat, resources, kind);
	return resource?.position || habitat?.position || actor.position;
}

function fleeDestination(actor, threat, habitat) {
	if (!actor.position || !threat?.position) return habitat?.position || null;
	const dx = actor.position.x - threat.position.x;
	const dz = actor.position.z - threat.position.z;
	const len = Math.hypot(dx, dz) || 1;
	const distance = roleForSpecies(actor.species) === 'domestic' ? 18 : 32;
	return freeze({ x: round(actor.position.x + dx / len * distance, 4), z: round(actor.position.z + dz / len * distance, 4) });
}

function patrolDestination(actor, habitat, seed) {
	if (!habitat?.position) return null;
	const radius = roleForSpecies(actor.species) === 'predator' ? 35 : 24;
	const angle = unit(`${seed}:${actor.id}:patrol`) * Math.PI * 2;
	return freeze({ x: round(habitat.position.x + Math.cos(angle) * radius, 4), z: round(habitat.position.z + Math.sin(angle) * radius, 4) });
}

function actorIntent(actor, habitat, resources, threats, world, seed) {
	const lod = lodForDistance(actor.distanceMeters ?? distance2d(actor.position, world.playerPosition));
	if (!actor.active || !actor.alive || actor.health <= 0) return freeze({
		id: actor.id, species: actor.species, lod, tickIntervalSeconds: lodIntervalSeconds(lod), state: 'inactive', activity: 'rest',
	});
	if (lod === 'culled') return freeze({
		id: actor.id, species: actor.species, lod, tickIntervalSeconds: lodIntervalSeconds(lod), state: 'offscreen-sim', activity: 'rest',
	});
	const threat = selectGroupThreat([actor], threats);
	const threatPressure = threat?.score || 0;
	const activity = activityForActor(actor, habitat, resources, threats, world, seed);
	const state = threatPressure >= 0.64 ? 'threatened' : activity === 'rest' ? 'resting' : activity === 'drink' ? 'drinking' : activity === 'graze' ? 'grazing' : activity === 'forage' ? 'foraging' : activity === 'hunt' ? 'hunting' : activity === 'flee' ? 'fleeing' : 'roaming';
	let destination = null;
	if (activity === 'flee') destination = fleeDestination(actor, threat?.threat, habitat);
	else if (['drink', 'graze', 'forage', 'hunt'].includes(activity)) destination = targetResourcePosition(actor, habitat, resources, activity);
	else if (activity === 'roam') destination = patrolDestination(actor, habitat, seed);
	return freeze({
		id: actor.id,
		species: actor.species,
		groupId: actor.groupId,
		habitatId: actor.habitatId,
		lod,
		tickIntervalSeconds: lodIntervalSeconds(lod),
		state,
		activity,
		destination,
		targetId: threat?.threat?.id || '',
		threatScore: round(threatPressure),
		movementMultiplier: round(weatherMovementFactor(world.weather) * (activity === 'flee' ? 1.28 : 1)),
		metabolicLoad: round(metabolicLoad(actor.species, activity)),
	});
}

function groupActivity(group, intents) {
	const active = intents.filter((intent) => intent.state !== 'inactive');
	if (!active.length) return 'rest';
	if (active.some((intent) => intent.activity === 'flee')) return 'flee';
	if (active.some((intent) => intent.activity === 'hunt')) return 'hunt';
	const counts = new Map();
	for (const intent of active) counts.set(intent.activity, (counts.get(intent.activity) || 0) + 1);
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'roam';
}

function groupDirective(groupId, rows, intents, threats, world) {
	const cohesion = groupCohesionDirective(groupId, rows, threats, world);
	if (!cohesion) return null;
	return freeze({
		id: groupId,
		species: rows[0]?.species || 'deer',
		role: groupRole(rows),
		memberCount: rows.length,
		activity: groupActivity(rows, intents),
		cohesion,
		anchor: cohesion.target,
	});
}

function populationStats(actors) {
	const bySpecies = new Map();
	const byHabitat = new Map();
	for (const actor of actors) {
		if (!actor.alive) continue;
		bySpecies.set(actor.species, (bySpecies.get(actor.species) || 0) + 1);
		if (!byHabitat.has(actor.habitatId)) byHabitat.set(actor.habitatId, new Map());
		const speciesMap = byHabitat.get(actor.habitatId);
		speciesMap.set(actor.species, (speciesMap.get(actor.species) || 0) + 1);
	}
	return { bySpecies, byHabitat };
}

function breedingEligible(actor, habitat, world, populationCount, capacity) {
	if (!actor.alive || actor.pregnant || actor.ageSeconds < LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.reproductionMinAgeSeconds) return false;
	if (actor.lastBirthAgeSeconds < LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.reproductionCooldownSeconds) return false;
	if (capacity <= populationCount) return false;
	const profile = getSpeciesProfile(actor.species);
	if (!profile || profile.kind === 'predator' && populationCount < 2) return false;
	const season = seasonProfile(world.season);
	const fertility = season.breeding * (1 - habitat.danger * 0.6) * (0.55 + habitat.food * 0.45);
	return fertility >= 0.52;
}

function findMate(actor, actors, habitat, world) {
	const candidates = actors.filter((candidate) => candidate.id !== actor.id
		&& candidate.alive
		&& candidate.species === actor.species
		&& candidate.habitatId === actor.habitatId
		&& candidate.sex !== actor.sex
		&& !candidate.pregnant
		&& candidate.ageSeconds >= LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.reproductionMinAgeSeconds);
	return candidates.sort((a, b) => distance2d(actor.position, a.position) - distance2d(actor.position, b.position) || a.id.localeCompare(b.id))[0] || null;
}

function birthPlan(actor, mate, habitat, world, seed) {
	if (!mate) return null;
	const probability = LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.birthProbabilityScale
		* habitat.food
		* seasonProfile(world.season).breeding
		* (1 - habitat.danger * 0.5)
		* (0.7 + unit(`${seed}:${actor.id}:birth`) * 0.3);
	if (probability < 0.000015) return null;
	return freeze({
		kind: 'birth-candidate',
		parents: freeze([actor.id, mate.id].sort()),
		species: actor.species,
		habitatId: habitat.id,
		position: habitat.position,
		probability: round(probability, 8),
		sex: hashChoice(['female', 'male'], `${seed}:${actor.id}:${mate.id}:sex`, 'female'),
	});
}

function mortalityPressure(actor, habitat, world, scarcity, threat) {
	const weather = weatherProfile(world.weather);
	const agePressure = actor.ageSeconds > 365 * 24 * 3600 ? 0.3 : 0;
	const starvation = actor.hunger > 0.85 ? (actor.hunger - 0.85) * 3 : 0;
	const dehydration = actor.thirst > 0.88 ? (actor.thirst - 0.88) * 4 : 0;
	const danger = habitat.danger * 0.32;
	const scarcityPressure = scarcity.foodScarcity * 0.24 + scarcity.waterScarcity * 0.28;
	const weatherPressure = weatherStressFactor(world.weather);
	const threatPressure = (threat?.score || 0) * 0.24;
	return clamp(agePressure + starvation + dehydration + danger + scarcityPressure + weatherPressure + threatPressure);
}

function mortalityDirective(actor, habitat, scarcity, threat, world, seed) {
	const pressure = mortalityPressure(actor, habitat, world, scarcity, threat);
	const roll = unit(`${seed}:${actor.id}:mortality:${Math.floor(world.tick || 0)}`);
	const chance = LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.mortalityProbabilityScale * pressure;
	if (roll < chance) {
		return freeze({ kind: 'mortality-candidate', actorId: actor.id, species: actor.species, habitatId: habitat.id, pressure: round(pressure), reason: pressure > 0.72 ? 'ecological-stress' : 'background-mortality' });
	}
	return null;
}

function migrationPressure(actor, habitat, capacity, populationCount, scarcity, world) {
	const density = pressureFromOccupancy(populationCount, capacity);
	const scarcityPressure = scarcity.foodScarcity * 0.48 + scarcity.waterScarcity * 0.34;
	const weatherPressure = weatherStressFactor(world.weather) * 0.6;
	const dangerPressure = habitat.danger * 0.44;
	const seasonPressure = seasonProfile(world.season).migration * 0.22;
	return clamp(density * 0.32 + scarcityPressure * 0.32 + weatherPressure * 0.1 + dangerPressure * 0.16 + seasonPressure * 0.1);
}

function migrationCandidates(species, sourceHabitat, habitats, world) {
	return habitats
		.map((habitat) => {
			if (habitat.id === sourceHabitat.id) return null;
			const admission = habitatAdmission(species, habitat, world);
			if (!admission.accepted) return null;
			const distance = distance2d(sourceHabitat.position, habitat.position);
			if (distance > 650) return null;
			const distanceScore = clamp(1 - distance / 650);
			return { habitat, score: admission.score * 0.76 + distanceScore * 0.24 };
		})
		.filter(Boolean)
		.sort((a, b) => b.score - a.score || a.habitat.id.localeCompare(b.habitat.id));
}

function migrationDirective(species, habitat, target, pressure, world) {
	return freeze({
		kind: 'migration',
		species,
		fromHabitatId: habitat.id,
		toHabitatId: target.habitat.id,
		from: habitat.position,
		to: target.habitat.position,
		pressure: round(pressure),
		score: round(target.score),
		movementMultiplier: round(weatherMovementFactor(world.weather)),
	});
}

function ambientIntent(group, habitat, world, seed) {
	if (!group || !habitat) return null;
	const role = groupRole(group);
	const phase = timeOfDay(world.hour);
	let kind = null;
	if (role === 'predator' && (phase === 'night' || phase === 'dusk')) kind = 'howl';
	else if (role === 'grazer' && phase === 'day') kind = world.nearWater ? 'water_crossing' : 'herd_shift';
	else if (role === 'avian' && phase !== 'night') kind = 'flock_turn';
	else if (role === 'pollinator' && phase === 'day') kind = 'bug_hover';
	else if (role === 'domestic' && phase === 'dusk') kind = 'roost';
	else kind = hashChoice(AMBIENT_KINDS, `${seed}:${group[0]?.id}:ambient`, 'graze');
	const probability = role === 'predator' ? 0.08 : role === 'avian' ? 0.12 : 0.06;
	if (unit(`${seed}:${group[0]?.id}:ambient-roll`) > probability) return null;
	return freeze({
		kind,
		groupId: group[0]?.groupId || '',
		species: group[0]?.species || '',
		habitatId: habitat.id,
		position: habitat.position,
		phase,
		volume: round(0.35 + unit(`${seed}:${group[0]?.id}:volume`) * 0.4),
	});
}

function worldEventIntent(group, habitat, world, seed) {
	if (!group?.length || !habitat) return null;
	const role = groupRole(group);
	const phase = timeOfDay(world.hour);
	if (role === 'predator' && phase === 'night' && unit(`${seed}:${group[0].id}:event`) < 0.018) {
		return freeze({ type: 'fauna-predator-sign', actorId: group[0].id, groupId: group[0].groupId, species: group[0].species, habitatId: habitat.id, eventId: 'predator-trace' });
	}
	if (role === 'grazer' && unit(`${seed}:${group[0].id}:event`) < 0.012) {
		return freeze({ type: 'fauna-herd-disturbance', groupId: group[0].groupId, species: group[0].species, habitatId: habitat.id, eventId: 'herd-disturbance' });
	}
	if (role === 'avian' && phase === 'dawn' && unit(`${seed}:${group[0].id}:event`) < 0.02) {
		return freeze({ type: 'fauna-morning-flock', groupId: group[0].groupId, species: group[0].species, habitatId: habitat.id, eventId: 'morning-flock' });
	}
	return null;
}

function populationLodStats(actors, playerPosition) {
	const stats = { near: 0, distant: 0, far: 0, culled: 0, estimatedTicksPerSecond: 0 };
	for (const actor of actors) {
		const distance = actor.position && playerPosition ? distance2d(actor.position, playerPosition) : 9999;
		const lod = lodForDistance(distance);
		stats[lod] += 1;
		const interval = lodIntervalSeconds(lod);
		stats.estimatedTicksPerSecond += interval === 0 ? 1 : 1 / interval;
	}
	return freeze({ ...stats, estimatedTicksPerSecond: round(stats.estimatedTicksPerSecond) });
}

function budgetAcceptable(stats, maxTicksPerSecond = 220) {
	return stats.estimatedTicksPerSecond <= Math.max(1, finite(maxTicksPerSecond, 220));
}

function simulateActorNeeds(actor, deltaSeconds, activity, habitat, world) {
	const dt = Math.max(0, Math.min(10, finite(deltaSeconds, 0)));
	const load = metabolicLoad(actor.species, activity);
	const weather = weatherProfile(world.weather);
	const foodDelta = LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.resourceConsumptionPerSecond * dt * load;
	const thirstDelta = foodDelta * 1.1 * (1 + (1 - weather.water));
	const restDelta = (activity === 'rest' ? -LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.recoveryPerSecond : 0.00055) * dt;
	const starvationStress = actor.hunger > 0.82 ? LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.starvationPenaltyPerSecond * dt : 0;
	const healthDelta = -starvationStress - habitat.danger * 0.00002 * dt + (activity === 'rest' ? 0.00015 * dt : 0);
	return freeze({
		hunger: clamp(actor.hunger + foodDelta),
		thirst: clamp(actor.thirst + thirstDelta),
		fatigue: clamp(actor.fatigue + Math.abs(restDelta) * load - (activity === 'rest' ? 0.0012 * dt : 0)),
		health: clamp(actor.health + healthDelta),
	});
}

function resourceDeltaForConsumption(resources, intents, deltaSeconds) {
	const delta = new Map();
	for (const resource of resources) delta.set(resource.id, 0);
	for (const intent of intents) {
		if (!['drink', 'graze', 'forage'].includes(intent.activity)) continue;
		const amount = 0.003 * Math.max(0, Math.min(10, finite(deltaSeconds, 0))) * (intent.activity === 'drink' ? 1.2 : 1);
		const candidates = resources.filter((resource) => resource.habitatId === intent.habitatId && resource.kind === (intent.activity === 'drink' ? 'water' : 'food') && resource.amount > 0);
		const candidate = candidates.sort((a, b) => distance2d(a.position, intent.destination) - distance2d(b.position, intent.destination) || a.id.localeCompare(b.id))[0];
		if (candidate) delta.set(candidate.id, (delta.get(candidate.id) || 0) - amount);
	}
	return freeze(Object.fromEntries(delta));
}

function regenerationPlan(resources, world, deltaSeconds) {
	const dt = Math.max(0, Math.min(10, finite(deltaSeconds, 0)));
	const seasonMultiplier = seasonalResourceFactor(world.season, 'food');
	return freeze(resources.map((resource) => freeze({
		id: resource.id,
		kind: resource.kind,
		habitatId: resource.habitatId,
		delta: round(resource.regeneration * seasonMultiplier * dt * 0.004),
		nextAmount: round(clamp(resource.amount + resource.regeneration * seasonMultiplier * dt * 0.004)),
	})));
}

function occupancyPlan(habitats, stats) {
	return freeze(habitats.map((habitat) => {
		const speciesMap = stats.byHabitat.get(habitat.id) || new Map();
		const species = [...speciesMap.keys()].sort();
		const total = species.reduce((sum, key) => sum + (speciesMap.get(key) || 0), 0);
		return freeze({
			habitatId: habitat.id,
			occupancy: round(total / Math.max(1, habitat.quality * LIVING_WORLD_ECOLOGY_POLICY.maxGroupSize * 4)),
			species,
			totalActors: total,
		}));
	}));
}

function deterministicSpawnSeed(seed, tick, species, habitatId) {
	return stableHash(`${seed}:${tick}:${species}:${habitatId}:spawn`);
}

function spawnGroupPlan(species, habitat, count, seed, world) {
	const activity = chooseEcologyActivity(species, {
		nearWater: habitat.waterAccess > 0.5,
		threatLevel: habitat.danger,
	}, seed, world.clockSeconds);
	const points = [];
	const radius = roleForSpecies(species) === 'predator' ? 26 : 18;
	for (let index = 0; index < count; index += 1) {
		const angle = unit(`${seed}:${species}:${index}:angle`) * Math.PI * 2 + index * 2.399963;
		const radial = Math.sqrt((index + 0.5) / Math.max(1, count)) * radius;
		points.push(freeze({
			x: round(habitat.position.x + Math.cos(angle) * radial, 4),
			z: round(habitat.position.z + Math.sin(angle) * radial, 4),
			activity,
			seed: stableHash(`${seed}:${species}:${index}:member`),
		}));
	}
	return freeze({
		kind: 'spawn-group',
		id: `ecology-${species}-${habitat.id}-${stableHash(`${seed}:${species}:${habitat.id}`) .toString(16)}`,
		species,
		habitatId: habitat.id,
		count,
		groupMode: roleForSpecies(species) === 'predator' ? 'pack' : roleForSpecies(species) === 'avian' ? 'flock' : 'herd',
		activity,
		points: freeze(points),
		assetFirst: true,
		placement: freeze({
			materialContract: 'src/3d/materials/MaterialAssignmentCore.js',
			placementContract: 'src/3d/world/WorldAssetPlacementPipeline.js',
			missingAssetPolicy: 'skip-and-report',
		}),
	});
}

function spawnCandidates(speciesList, habitats, stats, world, seed) {
	const candidates = [];
	for (const species of speciesList) {
		for (const habitat of habitats) {
			const admission = habitatAdmission(species, habitat, world);
			if (!admission.accepted) continue;
			const capacity = computeCarryingCapacity(species, habitat, world);
			const current = stats.byHabitat.get(habitat.id)?.get(species) || 0;
			const pressure = occupancyRatio(current, capacity);
			if (pressure >= 0.72) continue;
			const groupSize = Math.max(1, Math.min(LIVING_WORLD_ECOLOGY_DIRECTOR_POLICY.maxGroups, chooseGroupSize(species, deterministicSpawnSeed(seed, world.tick, species, habitat.id), 1 - pressure)));
			const roll = unit(`${seed}:${world.tick}:${species}:${habitat.id}:admit`);
			if (roll > 0.82) continue;
			candidates.push({ species, habitat, score: admission.score * (1 - pressure * 0.5), groupSize });
		}
	}
	return candidates.sort((a, b) => b.score - a.score || a.species.localeCompare(b.species) || a.habitat.id.localeCompare(b.habitat.id));
}

function selectSpawns(candidates, maxSpawns, seed, tick) {
	const selected = [];
	const seenHabitat = new Set();
	for (const candidate of candidates) {
		if (selected.length >= maxSpawns) break;
		const key = `${candidate.habitat.id}:${candidate.species}`;
		if (seenHabitat.has(key)) continue;
		seenHabitat.add(key);
		const roll = unit(`${seed}:${tick}:spawn-select:${key}`);
		if (roll < 0.08) continue;
		selected.push(candidate);
	}
	return selected;
}

function despawnCandidates(actors, habitats, world, stats, seed) {
	const map = habitatMap(habitats);
	const output = [];
	for (const actor of actors) {
		if (!actor.alive) continue;
		const habitat = map.get(actor.habitatId);
		if (!habitat) {
			output.push(freeze({ kind: 'despawn', actorId: actor.id, reason: 'missing-habitat' }));
			continue;
		}
		const capacity = computeCarryingCapacity(actor.species, habitat, world);
		const current = stats.byHabitat.get(habitat.id)?.get(actor.species) || 0;
		const pressure = pressureFromOccupancy(current, Math.max(1, capacity));
		const roll = unit(`${seed}:${world.tick}:${actor.id}:despawn`);
		if (pressure >= LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.despawnPressureThreshold && roll < 0.01) {
			output.push(freeze({ kind: 'despawn', actorId: actor.id, species: actor.species, habitatId: habitat.id, reason: 'carrying-capacity' }));
		}
	}
	return output.slice(0, LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxOperations);
}

function signalEvents(threats, actors, habitats) {
	const actorPositions = new Map(actors.filter((a) => a.position).map((a) => [a.id, a.position]));
	const habitatIds = new Set(habitats.map((h) => h.id));
	return threats
		.filter((threat) => threat.ageSeconds <= LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.threatMemorySeconds)
		.map((threat) => {
			const affected = actors.filter((actor) => actor.position && distance2d(actor.position, threat.position) <= LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.packAlertRadiusMeters);
			return freeze({
				type: threat.visible ? 'perception-visible' : threat.heard ? 'perception-heard' : 'perception-memory',
				threatId: threat.id,
				affectedActorIds: freeze(affected.map((a) => a.id).sort()),
				validHabitatIds: freeze([...habitatIds].sort()),
				position: threat.position,
				confidence: threat.confidence,
			});
		});
}

function factionReactionHook(actor, threat, world) {
	if (!threat?.factionId) return null;
	const severity = round((threat.wanted || 0) * 0.6 + (threat.hostile ? 0.4 : 0));
	if (severity <= 0) return null;
	return freeze({
		kind: 'faction-observation',
		actorId: actor.id,
		factionId: threat.factionId,
		action: severity >= 0.7 ? 'alert' : 'observe',
		severity,
		wanted: threat.wanted,
		clockSeconds: finite(world.clockSeconds, 0),
	});
}

function lawObservationHook(actor, threat) {
	if (!threat?.wanted && !threat?.factionId) return null;
	return freeze({
		kind: 'law-observation',
		actorId: actor.id,
		targetId: threat.id,
		wanted: threat.wanted,
		reported: Boolean(threat.wanted > 0.5),
	});
}

function companionHook(actor, world) {
	if (roleForSpecies(actor.species) !== 'domestic') return null;
	if (!world.companionActorIds?.includes(actor.id)) return null;
	return freeze({ kind: 'companion-intent', actorId: actor.id, mode: actor.health < 0.35 ? 'protect' : 'follow', ownerId: idOf(world.companionOwnerId) });
}

function deterministicWorldEventSeed(seed, tick, kind, target) {
	return stableHash(`${seed}:${tick}:${kind}:${target}`);
}

function eventDigest(events) {
	return ecologyDigest(events.map((event) => ({
		type: event?.type || event?.kind,
		id: event?.eventId || event?.id || event?.actorId || '',
	}))); 
}

function normalizeWorld(input = {}) {
	return freeze({
		seed: text(input.seed, 'westeros'),
		tick: Math.max(0, Math.floor(finite(input.tick, 0))),
		clockSeconds: Math.max(0, finite(input.clockSeconds, finite(input.hour, 12) * 3600)),
		hour: ((finite(input.hour, 12) % 24) + 24) % 24,
		season: normalizeSeason(input.season),
		weather: normalizeWeather(input.weather),
		temperatureC: finite(input.temperatureC, 12),
		moisture: clamp(input.moisture, 0, 1),
		playerPosition: vector2d(input.playerPosition),
		nearWater: Boolean(input.nearWater),
		companionActorIds: Array.isArray(input.companionActorIds) ? input.companionActorIds.map((id) => idOf(id)).filter(Boolean).sort() : [],
		companionOwnerId: idOf(input.companionOwnerId),
		maxSpawns: Math.max(0, Math.min(12, Math.floor(finite(input.maxSpawns, 6)))),
		maxAmbientIntents: Math.max(0, Math.min(LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxAmbientIntents, Math.floor(finite(input.maxAmbientIntents, 16)))),
		maxOperations: Math.max(0, Math.min(LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxOperations, Math.floor(finite(input.maxOperations, 64)))),
		maxTicksPerSecond: Math.max(1, finite(input.maxTicksPerSecond, 220)),
	});
}

function normalizeInputs(input) {
	const world = normalizeWorld(input);
	const habitats = clampCollection(input.habitats, LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxHabitats, normalizeHabitat).sort((a, b) => a.id.localeCompare(b.id));
	const actors = clampCollection(input.actors ?? input.fauna, LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxActors, normalizeActor).sort((a, b) => a.id.localeCompare(b.id));
	const threats = clampCollection(input.threats, LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxSignals, normalizeThreat).sort((a, b) => a.id.localeCompare(b.id));
	const resources = clampCollection(input.resources, LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxResources, normalizeResource).sort((a, b) => a.id.localeCompare(b.id));
	const species = [...new Set((Array.isArray(input.species) ? input.species : actors.map((actor) => actor.species)).map((value) => text(value).trim().toLowerCase()).filter((value) => Boolean(getSpeciesProfile(value))))].sort();
	return freeze({ world, habitats, actors, threats, resources, species });
}

function buildActorIntents(actors, habitats, resources, threats, world, seed) {
	const map = habitatMap(habitats);
	return actors.map((actor) => actorIntent(actor, map.get(actor.habitatId), resources, threats, world, seed));
}

function buildGroupDirectives(actors, intents, threats, habitats, world) {
	const map = habitatMap(habitats);
	const grouped = groupRows(actors);
	const intentsByGroup = new Map();
	for (const intent of intents) {
		if (!intent.groupId) continue;
		if (!intentsByGroup.has(intent.groupId)) intentsByGroup.set(intent.groupId, []);
		intentsByGroup.get(intent.groupId).push(intent);
	}
	const rows = [];
	for (const [groupId, members] of grouped) {
		const habitat = map.get(members[0]?.habitatId);
		const directive = groupDirective(groupId, members, intentsByGroup.get(groupId) || [], threats, world);
		if (directive) rows.push(directive);
	}
	return rows.slice(0, LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxGroups);
}

function buildPopulationOperations(actors, habitats, resources, threats, species, world, seed, stats) {
	const map = habitatMap(habitats);
	const operations = [];
	for (const actor of actors) {
		const habitat = map.get(actor.habitatId);
		if (!habitat) continue;
		const scarcity = resourcePressure(habitat, resources, actor.species, world);
		const threat = selectGroupThreat([actor], threats);
		const mortality = mortalityDirective(actor, habitat, scarcity, threat, world, seed);
		if (mortality) operations.push(mortality);
		const capacity = computeCarryingCapacity(actor.species, habitat, world);
		const count = stats.byHabitat.get(habitat.id)?.get(actor.species) || 0;
		if (breedingEligible(actor, habitat, world, count, capacity)) {
			const mate = findMate(actor, actors, habitat, world);
			const birth = birthPlan(actor, mate, habitat, world, seed);
			if (birth) operations.push(birth);
		}
	}
	const despawns = despawnCandidates(actors, habitats, world, stats, seed);
	operations.push(...despawns);
	return operations.slice(0, world.maxOperations);
}

function buildMigrationOperations(actors, habitats, resources, world, stats) {
	const map = habitatMap(habitats);
	const operations = [];
	const actorsBySpecies = new Map();
	for (const actor of actors) {
		if (!actorsBySpecies.has(actor.species)) actorsBySpecies.set(actor.species, []);
		actorsBySpecies.get(actor.species).push(actor);
	}
	for (const [species, rows] of actorsBySpecies) {
		const byHabitat = new Map();
		for (const row of rows) {
			if (!byHabitat.has(row.habitatId)) byHabitat.set(row.habitatId, []);
			byHabitat.get(row.habitatId).push(row);
		}
		for (const [habitatId, members] of byHabitat) {
			const habitat = map.get(habitatId);
			if (!habitat) continue;
			const capacity = computeCarryingCapacity(species, habitat, world);
			const count = stats.byHabitat.get(habitatId)?.get(species) || members.length;
			const scarcity = resourcePressure(habitat, resources, species, world);
			const pressure = migrationPressure(null, habitat, capacity, count, scarcity, world);
			if (pressure < LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.migrationPressureThreshold) continue;
			const targets = migrationCandidates(species, habitat, habitats, world);
			const target = targets[0];
			if (!target) continue;
			operations.push(migrationDirective(species, habitat, target, pressure, world));
			if (operations.length >= 8) return operations;
		}
	}
	return operations;
}

function buildAmbientOperations(actors, habitats, groups, world, seed) {
	const map = habitatMap(habitats);
	const actorGroups = groupRows(actors);
	const output = [];
	for (const [groupId, members] of actorGroups) {
		const habitat = map.get(members[0]?.habitatId);
		const intent = ambientIntent(members, habitat, world, seed);
		if (intent) output.push(intent);
		if (output.length >= world.maxAmbientIntents) break;
	}
	return output;
}

function buildWorldEventOperations(actors, habitats, world, seed) {
	const map = habitatMap(habitats);
	const grouped = groupRows(actors);
	const output = [];
	for (const [groupId, members] of grouped) {
		const habitat = map.get(members[0]?.habitatId);
		const event = worldEventIntent(members, habitat, world, deterministicWorldEventSeed(seed, world.tick, 'ambient', groupId));
		if (event) output.push(event);
		if (output.length >= LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxEvents) break;
	}
	return output;
}

function buildOwnerHooks(actors, threats, world) {
	const hooks = [];
	for (const actor of actors) {
		const threat = selectGroupThreat([actor], threats)?.threat;
		const faction = factionReactionHook(actor, threat, world);
		const law = lawObservationHook(actor, threat);
		const companion = companionHook(actor, world);
		if (faction) hooks.push(faction);
		if (law) hooks.push(law);
		if (companion) hooks.push(companion);
		if (hooks.length >= LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxOperations) break;
	}
	return hooks;
}

function buildNeedSimulation(actors, habitats, intents, world, deltaSeconds) {
	const map = habitatMap(habitats);
	const output = [];
	const actorsById = actorMap(actors);
	for (const intent of intents) {
		const actor = actorsById.get(intent.id);
		const habitat = map.get(intent.habitatId);
		if (!actor || !habitat) continue;
		const next = simulateActorNeeds(actor, deltaSeconds, intent.activity, habitat, world);
		output.push(freeze({
			actorId: actor.id,
			activity: intent.activity,
			hunger: round(next.hunger),
			thirst: round(next.thirst),
			fatigue: round(next.fatigue),
			health: round(next.health),
		}));
	}
	return output;
}

function ecologyManifest(habitats, actors, resources, spawns) {
	return freeze({
		sharedMaterialContract: 'src/3d/materials/MaterialAssignmentCore.js',
		sharedPlacementContract: 'src/3d/world/WorldAssetPlacementPipeline.js',
		modelBearingSpawnCount: spawns.length,
		actorCount: actors.length,
		habitatCount: habitats.length,
		resourceCount: resources.length,
		assetFirst: spawns.every((spawn) => spawn.assetFirst === true),
		missingAssetPolicy: 'skip-and-report',
	});
}

function auditEcologyResult(result) {
	const errors = [];
	if (!result || typeof result !== 'object') errors.push('missing-result');
	if (!result?.deterministic) errors.push('non-deterministic');
	if ((result?.spawn || []).some((spawn) => !spawn.assetFirst)) errors.push('spawn-not-asset-first');
	if ((result?.spawn || []).some((spawn) => spawn.placement?.placementContract !== 'src/3d/world/WorldAssetPlacementPipeline.js')) errors.push('placement-contract');
	if ((result?.spawn || []).some((spawn) => spawn.placement?.materialContract !== 'src/3d/materials/MaterialAssignmentCore.js')) errors.push('material-contract');
	if ((result?.populationLod?.estimatedTicksPerSecond || 0) > (result?.world?.maxTicksPerSecond || 220)) errors.push('tick-budget');
	const positions = new Set();
	for (const spawn of result?.spawn || []) {
		for (const point of spawn.points || []) {
			if (!Number.isFinite(point?.x) || !Number.isFinite(point?.z)) errors.push('non-finite-spawn');
			const key = `${spawn.habitatId}:${point.x}:${point.z}`;
			if (positions.has(key)) errors.push('duplicate-spawn-position');
			positions.add(key);
		}
	}
	return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: ecologyDigest({ errors, spawn: result?.spawn || [] }) });
}

function stableSortObjectArrays(result) {
	return freeze({
		...result,
		spawn: freeze([...(result.spawn || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)))),
		actorIntents: freeze([...(result.actorIntents || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)))),
		groups: freeze([...(result.groups || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)))),
		operations: freeze([...(result.operations || [])].sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.actorId || a.species || '').localeCompare(String(b.actorId || b.species || '')))),
		ambient: freeze([...(result.ambient || [])].sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.groupId).localeCompare(String(b.groupId)))),
		events: freeze([...(result.events || [])].sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.eventId).localeCompare(String(b.eventId)))),
		hooks: freeze([...(result.hooks || [])].sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.actorId).localeCompare(String(b.actorId)))),
		needs: freeze([...(result.needs || [])].sort((a, b) => String(a.actorId).localeCompare(String(b.actorId)))),
	});
}

/**
 * Main pure ecology tick. This is the production vertical slice consumed by the existing fauna
 * bridge. No owner is mutated and no scene object is touched.
 */
export function planLivingWorldFaunaEcologyTick(input = {}) {
	const { world, habitats, actors, threats, resources, species } = normalizeInputs(input);
	const seed = world.seed;
	const stats = populationStats(actors);
	const intents = buildActorIntents(actors, habitats, resources, threats, world, seed);
	const groups = buildGroupDirectives(actors, intents, threats, habitats, world);
	const candidates = spawnCandidates(species, habitats, stats, world, seed);
	const selected = selectSpawns(candidates, world.maxSpawns, seed, world.tick);
	const spawn = selected.map((candidate) => spawnGroupPlan(candidate.species, candidate.habitat, candidate.groupSize, deterministicSpawnSeed(seed, world.tick, candidate.species, candidate.habitat.id), world));
	const operations = [
		...buildPopulationOperations(actors, habitats, resources, threats, species, world, seed, stats),
		...buildMigrationOperations(actors, habitats, resources, world, stats),
	];
	const populationLod = populationLodStats(actors, world.playerPosition);
	const ambient = buildAmbientOperations(actors, habitats, groups, world, seed);
	const events = buildWorldEventOperations(actors, habitats, world, seed);
	const hooks = buildOwnerHooks(actors, threats, world);
	const needs = buildNeedSimulation(actors, habitats, intents, world, input.deltaSeconds ?? 0);
	const resourceConsumption = resourceDeltaForConsumption(resources, intents, input.deltaSeconds ?? 0);
	const regeneration = regenerationPlan(resources, world, input.deltaSeconds ?? 0);
	const occupancy = occupancyPlan(habitats, stats);
	const result = stableSortObjectArrays({
		policy: LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.id,
		deterministic: true,
		world,
		species,
		spawn,
		actorIntents: intents,
		groups,
		operations: operations.slice(0, world.maxOperations),
		ambient,
		events,
		hooks,
		needs,
		resourceConsumption,
		regeneration,
		occupancy,
		populationLod,
		budget: freeze({ acceptable: budgetAcceptable(populationLod, world.maxTicksPerSecond), estimatedTicksPerSecond: populationLod.estimatedTicksPerSecond, maxTicksPerSecond: world.maxTicksPerSecond }),
		manifest: ecologyManifest(habitats, actors, resources, spawn),
	});
	return freeze({
		...result,
		audit: auditEcologyResult(result),
		digest: ecologyDigest(result),
	});
}

export function applyLivingWorldFaunaEcologyPlan(plan, owners = {}) {
	const calls = [];
	for (const spawn of plan?.spawn || []) {
		if (typeof owners.spawnGroup === 'function') calls.push(owners.spawnGroup(spawn));
	}
	for (const intent of plan?.actorIntents || []) {
		if (typeof owners.updateActor === 'function') owners.updateActor(intent);
	}
	for (const group of plan?.groups || []) {
		if (typeof owners.updateGroup === 'function') owners.updateGroup(group);
	}
	for (const event of plan?.events || []) {
		if (typeof owners.emitWorldEvent === 'function') owners.emitWorldEvent(event);
	}
	for (const hook of plan?.hooks || []) {
		if (hook.kind === 'faction-observation' && typeof owners.observeFaction === 'function') owners.observeFaction(hook);
		if (hook.kind === 'law-observation' && typeof owners.observeLaw === 'function') owners.observeLaw(hook);
		if (hook.kind === 'companion-intent' && typeof owners.applyCompanionIntent === 'function') owners.applyCompanionIntent(hook);
	}
	return freeze({
		spawned: calls.length,
		updated: (plan?.actorIntents || []).length,
		groups: (plan?.groups || []).length,
		events: (plan?.events || []).length,
		hooks: (plan?.hooks || []).length,
		digest: ecologyDigest({ calls, updated: plan?.actorIntents?.length || 0, groups: plan?.groups?.length || 0 }),
	});
}

export function buildFaunaEcologyReplayTape(input = {}) {
	const plan = planLivingWorldFaunaEcologyTick(input);
	return freeze({
		policy: plan.policy,
		seed: plan.world.seed,
		tick: plan.world.tick,
		digest: plan.digest,
		spawn: plan.spawn,
		actorIntents: plan.actorIntents,
		groups: plan.groups,
		operations: plan.operations,
		events: plan.events,
		ambient: plan.ambient,
	});
}

export function compareFaunaEcologyReplays(left, right) {
	const leftDigest = ecologyDigest(left ?? null);
	const rightDigest = ecologyDigest(right ?? null);
	return freeze({ equal: leftDigest === rightDigest, leftDigest, rightDigest });
}

export function auditFaunaEcologyAssetBearingSpawns(plan) {
	const errors = [];
	for (const spawn of plan?.spawn || []) {
		if (!spawn.assetFirst) errors.push(`${spawn.id}:asset-first`);
		if (spawn.placement?.materialContract !== 'src/3d/materials/MaterialAssignmentCore.js') errors.push(`${spawn.id}:material-contract`);
		if (spawn.placement?.placementContract !== 'src/3d/world/WorldAssetPlacementPipeline.js') errors.push(`${spawn.id}:placement-contract`);
		if (!Array.isArray(spawn.points) || !spawn.points.length) errors.push(`${spawn.id}:no-placement-points`);
	}
	return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}

export function summarizeFaunaEcology(plan) {
	const states = new Map();
	for (const intent of plan?.actorIntents || []) states.set(intent.state, (states.get(intent.state) || 0) + 1);
	return freeze({
		spawnGroups: plan?.spawn?.length || 0,
		actorIntents: plan?.actorIntents?.length || 0,
		groups: plan?.groups?.length || 0,
		operations: plan?.operations?.length || 0,
		ambient: plan?.ambient?.length || 0,
		events: plan?.events?.length || 0,
		hooks: plan?.hooks?.length || 0,
		states: freeze(Object.fromEntries([...states.entries()].sort((a, b) => a[0].localeCompare(b[0])))),
		budgetAcceptable: Boolean(plan?.budget?.acceptable),
		digest: plan?.digest || ecologyDigest(plan),
	});
}

export function validateFaunaEcologyInput(input = {}) {
	const normalized = normalizeInputs(input);
	const errors = [];
	const warnings = [];
	if (!normalized.habitats.length) warnings.push('no-habitats');
	if (!normalized.actors.length) warnings.push('no-actors');
	for (const habitat of normalized.habitats) {
		if (!habitat.position) errors.push(`habitat:${habitat.id}:position`);
		if (!habitat.groundValid) errors.push(`habitat:${habitat.id}:ground`);
		if (!habitat.navReachable) errors.push(`habitat:${habitat.id}:nav`);
		if (['ocean', 'cliff'].includes(habitat.canonicalBiome)) warnings.push(`habitat:${habitat.id}:blocked-biome`);
	}
	for (const actor of normalized.actors) {
		if (!getSpeciesProfile(actor.species)) errors.push(`actor:${actor.id}:species`);
	}
	return freeze({ ok: errors.length === 0, errors: freeze(errors), warnings: freeze(warnings), digest: ecologyDigest({ errors, warnings, habitats: normalized.habitats.length, actors: normalized.actors.length }) });
}

export function getFaunaEcologyLod(distanceMeters) {
	return lodForDistance(Math.max(0, finite(distanceMeters, LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.culledMeters + 1)));
}

export function getFaunaEcologyTickInterval(lod) {
	return lodIntervalSeconds(text(lod, 'culled').toLowerCase());
}

export function getFaunaEcologyPolicy() {
	return LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY;
}

export function getFaunaEcologySeasonProfile(season) {
	return freeze({ id: normalizeSeason(season), ...seasonProfile(season) });
}

export function getFaunaEcologyWeatherProfile(weather) {
	return freeze({ id: normalizeWeather(weather), ...weatherProfile(weather) });
}

export function deterministicFaunaEcologyId(seed, ...parts) {
	return stableHash([seed, ...parts].join(':')).toString(16).padStart(8, '0');
}

export function selectFaunaAmbientKind(species, hour, seed = 0) {
	const role = roleForSpecies(species);
	const phase = timeOfDay(hour);
	if (role === 'predator' && (phase === 'night' || phase === 'dusk')) return 'howl';
	if (role === 'avian' && phase !== 'night') return 'flock_turn';
	if (role === 'pollinator' && phase === 'day') return 'bug_hover';
	if (role === 'grazer' && phase === 'day') return 'herd_shift';
	return hashChoice(AMBIENT_KINDS, `${seed}:${species}:${hour}:ambient`, 'graze');
}

export function faunaPopulationCarryingCapacity(species, habitatInput, worldInput = {}) {
	const habitat = normalizeHabitat(habitatInput, 0);
	const world = normalizeWorld(worldInput);
	return computeCarryingCapacity(species, habitat, world);
}

export function faunaMigrationScore(species, habitatInput, worldInput = {}, populationCount = 0, resources = []) {
	const habitat = normalizeHabitat(habitatInput, 0);
	const world = normalizeWorld(worldInput);
	const normalizedResources = clampCollection(resources, LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxResources, normalizeResource);
	const capacity = computeCarryingCapacity(species, habitat, world);
	const scarcity = resourcePressure(habitat, normalizedResources, species, world);
	return round(migrationPressure(null, habitat, capacity, populationCount, scarcity, world));
}

export function faunaActorNeedSnapshot(actorInput, habitatInput, worldInput = {}, activity = 'roam', deltaSeconds = 1) {
	const actor = normalizeActor(actorInput, 0);
	const habitat = normalizeHabitat(habitatInput, 0);
	const world = normalizeWorld(worldInput);
	const next = simulateActorNeeds(actor, deltaSeconds, activity, habitat, world);
	return freeze({ actorId: actor.id, species: actor.species, activity, ...next });
}

export function faunaGroupCohesionSnapshot(actorsInput, threatsInput = [], worldInput = {}) {
	const actors = clampCollection(actorsInput, LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxActors, normalizeActor);
	const threats = clampCollection(threatsInput, LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxSignals, normalizeThreat);
	const world = normalizeWorld(worldInput);
	const groups = groupRows(actors);
	return freeze([...groups.entries()].map(([groupId, rows]) => groupCohesionDirective(groupId, rows, threats, world)).filter(Boolean));
}

export function faunaSpawnManifestSnapshot(input = {}) {
	const plan = planLivingWorldFaunaEcologyTick(input);
	return freeze({
		...plan.manifest,
		spawns: plan.spawn.map((spawn) => freeze({ id: spawn.id, species: spawn.species, habitatId: spawn.habitatId, count: spawn.count, points: spawn.points })),
	});
}

export function faunaPopulationLodSnapshot(actorsInput = [], playerPosition = null) {
	const actors = clampCollection(actorsInput, LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxActors, normalizeActor);
	return populationLodStats(actors, vector2d(playerPosition));
}

export function faunaEcologyBudgetSnapshot(input = {}) {
	const plan = planLivingWorldFaunaEcologyTick(input);
	return freeze(plan.budget);
}

export function faunaEcologyDeterministicDoubleRun(input = {}) {
	const first = planLivingWorldFaunaEcologyTick(input);
	const second = planLivingWorldFaunaEcologyTick(input);
	return freeze({
		equal: first.digest === second.digest,
		firstDigest: first.digest,
		secondDigest: second.digest,
		firstSummary: summarizeFaunaEcology(first),
		secondSummary: summarizeFaunaEcology(second),
	});
}

export function faunaEcologyStateMachine(input = {}) {
	const plan = planLivingWorldFaunaEcologyTick(input);
	const transitions = [];
	for (const intent of plan.actorIntents) {
		const state = intent.state;
		const target = intent.targetId ? 'threat-response' : intent.activity;
		transitions.push(freeze({ actorId: intent.id, from: 'ambient', to: state, target }));
	}
	return freeze({ transitions, digest: ecologyDigest(transitions) });
}

export function faunaEcologyEventBudget(input = {}) {
	const plan = planLivingWorldFaunaEcologyTick(input);
	return freeze({
		count: plan.events.length,
		max: LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxEvents,
		accepted: plan.events.length <= LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.maxEvents,
		digest: eventDigest(plan.events),
	});
}

export function faunaEcologyRuntimeBoundaryAudit(moduleText = '') {
	const prohibited = ['EditorMaterialStudio', "from 'three'", 'EventBus', 'ActorRegistry', 'document.', 'window.'];
	const hits = prohibited.filter((token) => String(moduleText).includes(token));
	return freeze({ ok: hits.length === 0, hits: freeze(hits) });
}

export function faunaEcologyContractAudit(input = {}) {
	const validation = validateFaunaEcologyInput(input);
	const plan = planLivingWorldFaunaEcologyTick(input);
	const assetAudit = auditFaunaEcologyAssetBearingSpawns(plan);
	return freeze({
		ok: validation.ok && plan.audit.ok && assetAudit.ok,
		validation,
		planAudit: plan.audit,
		assetAudit,
		digest: ecologyDigest({ validation, planAudit: plan.audit, assetAudit }),
	});
}

export function faunaEcologyReplayFingerprint(input = {}) {
	return buildFaunaEcologyReplayTape(input).digest;
}

export function faunaEcologySpeciesMatrix(speciesList, context = {}) {
	return freeze((Array.isArray(speciesList) ? speciesList : []).map((species) => {
		const result = evaluateHabitat(species, normalizeEcologyContext(context));
		return freeze({ species: text(species).toLowerCase(), accepted: result.accepted, score: result.score, reasons: result.reasons });
	}).sort((a, b) => b.score - a.score || a.species.localeCompare(b.species)));
}

export function faunaEcologyGroupCountSnapshot(species, seed = 0, abundance = 1) {
	return chooseGroupSize(species, seed, abundance);
}

export function faunaEcologyRole(species) {
	return roleForSpecies(species);
}

export function faunaEcologyLightFactor(hour) {
	return round(lightFactor(hour), 4);
}

export function faunaEcologyTimeOfDay(hour) {
	return timeOfDay(hour);
}

export function faunaEcologySeasonMultiplier(season, kind) {
	return seasonalResourceFactor(season, kind);
}

export function faunaEcologyWeatherMultiplier(weather, kind = 'movement') {
	const profile = weatherProfile(weather);
	if (kind === 'movement') return profile.movement;
	if (kind === 'water') return profile.water;
	if (kind === 'food') return profile.food;
	if (kind === 'shelter') return profile.shelter;
	return profile.threat;
}

export function faunaEcologyAssetPlacementOrder() {
	return freeze([
		'load-real-asset',
		'analyze-material-slots',
		'build-named-or-layered-recipe',
		'apply-material-recipe',
		'validateMaterialAssignment',
		'create-material-manifest',
		'ground-height',
		'nav-reachable',
		'habitat-alignment',
		'apply-transform',
		'attach-world-asset',
	]);
}

export function faunaEcologyModelSurfaceRoles(species) {
	const role = roleForSpecies(species);
	if (role === 'domestic' && species === 'horse') return freeze(['coat', 'mane', 'tail', 'hoof', 'saddle', 'harness']);
	if (role === 'predator' || role === 'grazer' || role === 'forager') return freeze(['fur', 'eye', 'claw', 'tooth']);
	if (species === 'dragon') return freeze(['scale', 'wing', 'eye', 'horn', 'claw']);
	if (role === 'avian') return freeze(['feather', 'eye', 'beak', 'claw']);
	return freeze(['body', 'eye']);
}

export function faunaEcologyAssetEvidence(species, sourceCandidates = []) {
	const roles = faunaEcologyModelSurfaceRoles(species);
	return freeze({
		species: text(species).toLowerCase(),
		sourceCandidates: freeze((Array.isArray(sourceCandidates) ? sourceCandidates : []).map((value) => text(value))),
		roles,
		assetFirst: true,
		materialRequired: true,
		placementRequired: true,
		missingAssetPolicy: 'skip-and-report',
	});
}

export function faunaEcologyOffscreenPolicy(distanceMeters) {
	const lod = lodForDistance(distanceMeters);
	return freeze({
		lod,
		intervalSeconds: lodIntervalSeconds(lod),
		simulateMovement: lod !== 'culled',
		simulateNeeds: lod !== 'culled',
		simulatePerception: lod === 'near' || lod === 'distant',
		allowAmbientAnimation: lod === 'near' || lod === 'distant',
	});
}

export function faunaEcologyThreatMemory(ageSeconds) {
	const age = Math.max(0, finite(ageSeconds, 0));
	return freeze({ ageSeconds: age, active: age <= LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.threatMemorySeconds, normalized: round(1 - age / LIVING_WORLD_FAUNA_ECOLOGY_DIRECTOR_POLICY.threatMemorySeconds) });
}

export function faunaEcologySpawnHysteresis(occupancy, pressure = 0) {
	return freeze({
		occupancy: clamp(occupancy),
		pressure: clamp(pressure),
		allowSpawn: occupancy < 0.72 && pressure < 0.62,
		allowDespawn: occupancy > 0.93 || pressure > 0.9,
	});
}

export function faunaEcologyHabitatSafety(habitatInput) {
	const habitat = normalizeHabitat(habitatInput, 0);
	const reasons = [];
	if (!habitat.position) reasons.push('missing-position');
	if (!habitat.groundValid) reasons.push('invalid-ground');
	if (!habitat.navReachable) reasons.push('nav-unreachable');
	if (habitat.canonicalBiome === 'ocean') reasons.push('ocean');
	if (habitat.canonicalBiome === 'cliff') reasons.push('cliff');
	if (habitat.waterDepthMeters > 0.35) reasons.push('deep-water');
	if (habitat.slopeDegrees > 72) reasons.push('extreme-slope');
	return freeze({ ok: reasons.length === 0, reasons: freeze(reasons) });
}

export function faunaEcologyThreatResponse(species, threatInput, actorInput = {}) {
	const actor = normalizeActor(actorInput, 0);
	const threat = normalizeThreat(threatInput, 0);
	const score = threatScore({ ...actor, species: text(species, actor.species) }, threat);
	return freeze({ species: text(species, actor.species), score: round(score), response: score >= 0.7 ? 'flee-or-engage' : score >= 0.46 ? 'alert' : 'ignore' });
}

export function faunaEcologyCompanionResponse(actorInput, worldInput = {}) {
	const actor = normalizeActor(actorInput, 0);
	const world = normalizeWorld(worldInput);
	const hook = companionHook(actor, world);
	return hook || freeze({ kind: 'companion-intent', actorId: actor.id, mode: 'none', ownerId: world.companionOwnerId });
}

export function faunaEcologyFactionReaction(actorInput, threatInput, worldInput = {}) {
	const actor = normalizeActor(actorInput, 0);
	const threat = normalizeThreat(threatInput, 0);
	const world = normalizeWorld(worldInput);
	return factionReactionHook(actor, threat, world) || freeze({ kind: 'faction-observation', actorId: actor.id, action: 'none', severity: 0, factionId: threat.factionId });
}

export function faunaEcologyLawObservation(actorInput, threatInput) {
	const actor = normalizeActor(actorInput, 0);
	const threat = normalizeThreat(threatInput, 0);
	return lawObservationHook(actor, threat) || freeze({ kind: 'law-observation', actorId: actor.id, targetId: threat.id, wanted: 0, reported: false });
}

export function faunaEcologyAmbientIntents(input = {}) {
	return planLivingWorldFaunaEcologyTick(input).ambient;
}

export function faunaEcologyWorldEvents(input = {}) {
	return planLivingWorldFaunaEcologyTick(input).events;
}

export function faunaEcologyOwnerHooks(input = {}) {
	return planLivingWorldFaunaEcologyTick(input).hooks;
}

export function faunaEcologyActorIntents(input = {}) {
	return planLivingWorldFaunaEcologyTick(input).actorIntents;
}

export function faunaEcologyGroupDirectives(input = {}) {
	return planLivingWorldFaunaEcologyTick(input).groups;
}

export function faunaEcologySpawnDirectives(input = {}) {
	return planLivingWorldFaunaEcologyTick(input).spawn;
}

export function faunaEcologyNeeds(input = {}) {
	return planLivingWorldFaunaEcologyTick(input).needs;
}

export function faunaEcologyResourcePlan(input = {}) {
	const plan = planLivingWorldFaunaEcologyTick(input);
	return freeze({ consumption: plan.resourceConsumption, regeneration: plan.regeneration });
}

export function faunaEcologyOccupancyPlan(input = {}) {
	return planLivingWorldFaunaEcologyTick(input).occupancy;
}

export function faunaEcologyAcceptance(input = {}) {
	const plan = planLivingWorldFaunaEcologyTick(input);
	return freeze({
		ok: plan.audit.ok && plan.budget.acceptable,
		planAudit: plan.audit,
		budget: plan.budget,
		assetAudit: auditFaunaEcologyAssetBearingSpawns(plan),
		missingAssets: 0,
		consoleErrors: 0,
	});
}

export function faunaEcologyVerticalSlice(input = {}) {
	const plan = planLivingWorldFaunaEcologyTick(input);
	return freeze({
		ai: freeze({ actorIntents: plan.actorIntents, groups: plan.groups, events: plan.events }),
		ecology: freeze({ spawn: plan.spawn, operations: plan.operations, occupancy: plan.occupancy }),
		performance: freeze({ populationLod: plan.populationLod, budget: plan.budget }),
		assets: freeze({ manifest: plan.manifest, audit: auditFaunaEcologyAssetBearingSpawns(plan) }),
		determinism: freeze({ digest: plan.digest, audit: plan.audit }),
	});
}
