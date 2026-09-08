/**
 * Deterministic ecology policy for the existing animal/creature/dragon spawn owners.
 *
 * This is a planning/admission policy only. It never instantiates geometry, mutates
 * canonical world data or replaces the existing fauna controllers. Callers provide the
 * canonical biome/settlement/road/water/slope context and keep scene ownership.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));

export const LIVING_WORLD_ECOLOGY_POLICY = freeze({
	id: 'living-world-ecology-policy-2026-09-08-v1',
	deterministic: true,
	maxSpeciesPerHabitat: 12,
	maxCandidates: 96,
	maxGroupSize: 24,
	maxWaterDepthMeters: 8,
	settlementBufferMeters: 120,
	roadBufferMeters: 14,
	minimumSpawnScore: 0.24,
});

const SPECIES = freeze({
	wolf: freeze({
		kind: 'predator',
		minTemperatureC: -20,
		maxTemperatureC: 28,
		preferredMoisture: 0.45,
		waterTolerance: 0.65,
		settlementAvoidance: 0.85,
		roadAvoidance: 0.35,
		preferredSlope: 0.35,
		groupMin: 2,
		groupMax: 6,
		activity: freeze(['roam', 'hunt', 'rest']),
	}),
	bear: freeze({
		kind: 'predator',
		minTemperatureC: -25,
		maxTemperatureC: 25,
		preferredMoisture: 0.65,
		waterTolerance: 0.55,
		settlementAvoidance: 0.9,
		roadAvoidance: 0.5,
		preferredSlope: 0.45,
		groupMin: 1,
		groupMax: 2,
		activity: freeze(['roam', 'forage', 'rest']),
	}),
	deer: freeze({
		kind: 'grazer',
		minTemperatureC: -18,
		maxTemperatureC: 30,
		preferredMoisture: 0.58,
		waterTolerance: 0.7,
		settlementAvoidance: 0.55,
		roadAvoidance: 0.25,
		preferredSlope: 0.25,
		groupMin: 3,
		groupMax: 10,
		activity: freeze(['graze', 'drink', 'flee', 'rest']),
	}),
	bison: freeze({
		kind: 'grazer',
		minTemperatureC: -24,
		maxTemperatureC: 30,
		preferredMoisture: 0.42,
		waterTolerance: 0.75,
		settlementAvoidance: 0.7,
		roadAvoidance: 0.35,
		preferredSlope: 0.15,
		groupMin: 3,
		groupMax: 12,
		activity: freeze(['graze', 'drink', 'flee', 'rest']),
	}),
	horse: freeze({
		kind: 'domestic',
		minTemperatureC: -15,
		maxTemperatureC: 34,
		preferredMoisture: 0.5,
		waterTolerance: 0.85,
		settlementAvoidance: 0.05,
		roadAvoidance: 0.15,
		preferredSlope: 0.2,
		groupMin: 1,
		groupMax: 6,
		activity: freeze(['graze', 'drink', 'rest', 'travel']),
	}),
	boar: freeze({
		kind: 'forager',
		minTemperatureC: -12,
		maxTemperatureC: 34,
		preferredMoisture: 0.72,
		waterTolerance: 0.72,
		settlementAvoidance: 0.65,
		roadAvoidance: 0.25,
		preferredSlope: 0.32,
		groupMin: 1,
		groupMax: 5,
		activity: freeze(['forage', 'roam', 'flee', 'rest']),
	}),
	fox: freeze({
		kind: 'predator',
		minTemperatureC: -25,
		maxTemperatureC: 32,
		preferredMoisture: 0.44,
		waterTolerance: 0.72,
		settlementAvoidance: 0.58,
		roadAvoidance: 0.22,
		preferredSlope: 0.4,
		groupMin: 1,
		groupMax: 2,
		activity: freeze(['roam', 'hunt', 'flee', 'rest']),
	}),
	sheep: freeze({
		kind: 'grazer',
		minTemperatureC: -12,
		maxTemperatureC: 32,
		preferredMoisture: 0.56,
		waterTolerance: 0.7,
		settlementAvoidance: 0.35,
		roadAvoidance: 0.18,
		preferredSlope: 0.28,
		groupMin: 3,
		groupMax: 10,
		activity: freeze(['graze', 'drink', 'flee', 'rest']),
	}),
	goat: freeze({
		kind: 'grazer',
		minTemperatureC: -8,
		maxTemperatureC: 34,
		preferredMoisture: 0.38,
		waterTolerance: 0.74,
		settlementAvoidance: 0.35,
		roadAvoidance: 0.18,
		preferredSlope: 0.7,
		groupMin: 2,
		groupMax: 8,
		activity: freeze(['graze', 'climb', 'drink', 'flee', 'rest']),
	}),
	cat: freeze({
		kind: 'domestic',
		minTemperatureC: -10,
		maxTemperatureC: 36,
		preferredMoisture: 0.45,
		waterTolerance: 0.92,
		settlementAvoidance: 0.08,
		roadAvoidance: 0.12,
		preferredSlope: 0.2,
		groupMin: 1,
		groupMax: 3,
		activity: freeze(['roam', 'rest', 'hunt']),
	}),
	bird: freeze({
		kind: 'avian',
		minTemperatureC: -28,
		maxTemperatureC: 40,
		preferredMoisture: 0.55,
		waterTolerance: 1,
		settlementAvoidance: 0,
		roadAvoidance: 0,
		preferredSlope: 0.1,
		groupMin: 2,
		groupMax: 8,
		activity: freeze(['perch', 'forage', 'flee']),
	}),
	bee: freeze({
		kind: 'pollinator',
		minTemperatureC: 5,
		maxTemperatureC: 38,
		preferredMoisture: 0.62,
		waterTolerance: 0.9,
		settlementAvoidance: 0,
		roadAvoidance: 0,
		preferredSlope: 0.2,
		groupMin: 4,
		groupMax: 18,
		activity: freeze(['forage', 'hover']),
	}),
});

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

function normalizedSpeciesId(value) {
	const key = String(value ?? '').trim().toLowerCase();
	return SPECIES[key] ? key : null;
}

function scoreTemperature(profile, temperatureC) {
	const temp = finite(temperatureC, 12);
	if (temp < profile.minTemperatureC || temp > profile.maxTemperatureC) return 0;
	const center = (profile.minTemperatureC + profile.maxTemperatureC) / 2;
	const half = Math.max(1, (profile.maxTemperatureC - profile.minTemperatureC) / 2);
	return clamp(1 - Math.abs(temp - center) / half, 0, 1);
}

function scoreMoisture(profile, moisture) {
	return clamp(1 - Math.abs(clamp(moisture) - profile.preferredMoisture), 0, 1);
}

function scoreSlope(profile, slopeDegrees) {
	const normalizedSlope = clamp(Math.abs(finite(slopeDegrees)) / 60);
	return clamp(1 - Math.abs(normalizedSlope - profile.preferredSlope) / 0.75, 0, 1);
}

function scoreSettlement(profile, distanceMeters) {
	const distance = Math.max(0, finite(distanceMeters, Infinity));
	if (!Number.isFinite(distance)) return 1;
	const near = clamp(1 - distance / LIVING_WORLD_ECOLOGY_POLICY.settlementBufferMeters);
	return clamp(1 - near * profile.settlementAvoidance);
}

function scoreRoad(profile, distanceMeters) {
	const distance = Math.max(0, finite(distanceMeters, Infinity));
	if (!Number.isFinite(distance)) return 1;
	const near = clamp(1 - distance / LIVING_WORLD_ECOLOGY_POLICY.roadBufferMeters);
	return clamp(1 - near * profile.roadAvoidance);
}

function scoreWater(profile, waterDepthMeters) {
	const depth = Math.max(0, finite(waterDepthMeters, 0));
	if (depth > LIVING_WORLD_ECOLOGY_POLICY.maxWaterDepthMeters) return 0;
	return clamp(1 - depth / Math.max(0.1, LIVING_WORLD_ECOLOGY_POLICY.maxWaterDepthMeters) * (1 - profile.waterTolerance));
}

function biomeAffinity(species, biome = '') {
	const normalized = String(biome ?? '').trim().toLowerCase();
	const table = {
		wolf: {snow: 1, north: 1, mountain: 0.9, forest: 0.95, steppe: 0.8, desert: 0.15, marsh: 0.65},
		bear: {snow: 0.9, north: 0.9, mountain: 0.95, forest: 1, steppe: 0.4, marsh: 0.85},
		deer: {snow: 0.7, north: 0.85, mountain: 0.75, forest: 1, steppe: 0.75, meadow: 1, marsh: 0.8},
		bison: {snow: 0.55, north: 0.8, mountain: 0.45, forest: 0.25, steppe: 1, meadow: 0.95},
		horse: {snow: 0.55, north: 0.7, mountain: 0.6, forest: 0.7, steppe: 1, meadow: 1, desert: 0.7},
		boar: {snow: 0.45, north: 0.7, mountain: 0.55, forest: 1, marsh: 0.95, meadow: 0.65},
		fox: {snow: 0.8, north: 0.85, mountain: 0.8, forest: 0.95, steppe: 0.85, desert: 0.5, marsh: 0.55},
		sheep: {snow: 0.5, north: 0.65, mountain: 0.75, forest: 0.35, steppe: 0.8, meadow: 1, desert: 0.35},
		goat: {snow: 0.65, north: 0.7, mountain: 1, forest: 0.25, steppe: 0.55, desert: 0.55},
		cat: {snow: 0.35, north: 0.45, mountain: 0.35, forest: 0.55, steppe: 0.4, meadow: 0.65, desert: 0.55},
		bird: {snow: 0.5, north: 0.8, mountain: 0.85, forest: 0.95, steppe: 0.9, meadow: 0.9, marsh: 1, coast: 1, desert: 0.65},
		bee: {snow: 0.05, north: 0.3, mountain: 0.7, forest: 1, steppe: 0.9, meadow: 1, marsh: 0.8, desert: 0.4},
	};
	return clamp(table[species]?.[normalized] ?? 0.55);
}

export function getSpeciesProfile(species) {
	const id = normalizedSpeciesId(species);
	return id ? SPECIES[id] : null;
}

export function evaluateHabitat(species, context = {}) {
	const id = normalizedSpeciesId(species);
	if (!id) return freeze({ accepted: false, species: String(species ?? ''), score: 0, reasons: ['unknown-species'] });
	const profile = SPECIES[id];
	const temperatureScore = scoreTemperature(profile, context.temperatureC);
	const moistureScore = scoreMoisture(profile, context.moisture);
	const slopeScore = scoreSlope(profile, context.slopeDegrees);
	const settlementScore = scoreSettlement(profile, context.distanceToSettlementMeters);
	const roadScore = scoreRoad(profile, context.distanceToRoadMeters);
	const waterScore = scoreWater(profile, context.waterDepthMeters);
	const biomeScore = biomeAffinity(id, context.biome);
	const weightedScore = (
		temperatureScore * 0.20
		+ moistureScore * 0.15
		+ slopeScore * 0.10
		+ settlementScore * 0.18
		+ roadScore * 0.08
		+ waterScore * 0.10
		+ biomeScore * 0.19
	);
	const reasons = [];
	if (temperatureScore === 0) reasons.push('temperature');
	if (biomeScore < 0.3) reasons.push('biome');
	if (settlementScore < 0.35) reasons.push('settlement-buffer');
	if (roadScore < 0.35) reasons.push('road-buffer');
	if (waterScore === 0) reasons.push('water-depth');
	return freeze({
		accepted: weightedScore >= LIVING_WORLD_ECOLOGY_POLICY.minimumSpawnScore && reasons.length === 0,
		species: id,
		score: Number(weightedScore.toFixed(6)),
		reasons: freeze(reasons),
		components: freeze({
			temperature: Number(temperatureScore.toFixed(4)),
			moisture: Number(moistureScore.toFixed(4)),
			slope: Number(slopeScore.toFixed(4)),
			settlement: Number(settlementScore.toFixed(4)),
			road: Number(roadScore.toFixed(4)),
			water: Number(waterScore.toFixed(4)),
			biome: Number(biomeScore.toFixed(4)),
		}),
	});
}

export function chooseEcologyActivity(species, context = {}, seed = 0, clockSeconds = 0) {
	const id = normalizedSpeciesId(species);
	if (!id) return 'rest';
	const profile = SPECIES[id];
	const activities = profile.activity;
	const hour = ((finite(clockSeconds) % 86400) + 86400) % 86400 / 3600;
	let preferred = activities[stableHash(`${id}:fallback`) % activities.length];
	if (profile.kind === 'grazer' && hour >= 6 && hour < 18) preferred = 'graze';
	if (profile.kind === 'predator' && (hour >= 19 || hour < 5)) preferred = 'hunt';
	if (profile.kind === 'pollinator' && hour >= 7 && hour < 18) preferred = 'forage';
	if (context.threatLevel >= 0.7 && activities.includes('flee')) preferred = 'flee';
	if (context.nearWater && activities.includes('drink') && hour >= 9 && hour < 17 && context.threatLevel < 0.4) preferred = 'drink';
	return preferred;
}

export function chooseGroupSize(species, seed = 0, abundance = 1) {
	const id = normalizedSpeciesId(species);
	if (!id) return 0;
	const profile = SPECIES[id];
	const min = profile.groupMin;
	const max = Math.min(profile.groupMax, LIVING_WORLD_ECOLOGY_POLICY.maxGroupSize);
	const normalizedAbundance = clamp(abundance);
	if (max <= min) return min;
	const span = max - min + 1;
	const raw = min + (stableHash(`${id}:${seed}`) % span);
	return Math.max(min, Math.min(max, Math.round(raw * (0.65 + normalizedAbundance * 0.35))));
}

export function speciesCompetitionScore(species, existingSpecies = [], context = {}) {
	const id = normalizedSpeciesId(species);
	if (!id) return 0;
	const profile = SPECIES[id];
	let score = evaluateHabitat(id, context).score;
	for (const existing of Array.isArray(existingSpecies) ? existingSpecies.slice(0, LIVING_WORLD_ECOLOGY_POLICY.maxSpeciesPerHabitat) : []) {
		const other = normalizedSpeciesId(existing?.species ?? existing);
		if (!other || other === id) continue;
		if (profile.kind === 'predator' && SPECIES[other].kind === 'predator') score -= 0.08;
		if (profile.kind === 'grazer' && SPECIES[other].kind === 'grazer') score -= 0.025;
		if (profile.kind === 'pollinator' && SPECIES[other].kind === 'pollinator') score -= 0.01;
	}
	return clamp(score, 0, 1);
}

export function planFaunaGroup({ species, centerX = 0, centerZ = 0, radiusMeters = 20, seed = 0, context = {}, existingSpecies = [] } = {}) {
	const id = normalizedSpeciesId(species);
	if (!id) return freeze({ accepted: false, species: String(species ?? ''), points: freeze([]), reasons: freeze(['unknown-species']) });
	const habitat = evaluateHabitat(id, context);
	if (!habitat.accepted) return freeze({ accepted: false, species: id, points: freeze([]), reasons: habitat.reasons });
	const competition = speciesCompetitionScore(id, existingSpecies, context);
	if (competition < LIVING_WORLD_ECOLOGY_POLICY.minimumSpawnScore) return freeze({ accepted: false, species: id, points: freeze([]), reasons: freeze(['competition']) });
	const count = Math.min(LIVING_WORLD_ECOLOGY_POLICY.maxGroupSize, chooseGroupSize(id, seed, competition));
	const radius = Math.max(1, finite(radiusMeters, 20));
	const points = [];
	const golden = 2.399963229728653;
	for (let index = 0; index < count; index += 1) {
		const radial = Math.sqrt((index + 0.5) / Math.max(1, count)) * radius;
		const random = stableHash(`${id}:${seed}:${index}`) / 0x100000000;
		const angle = golden * index + random * Math.PI * 2;
		points.push(freeze({
			x: finite(centerX) + Math.cos(angle) * radial,
			z: finite(centerZ) + Math.sin(angle) * radial,
			ordinal: index,
			activity: chooseEcologyActivity(id, context, seed, context.clockSeconds),
			seed: stableHash(`${id}:${seed}:${index}:point`),
		}));
	}
	return freeze({
		accepted: true,
		species: id,
		score: Number(competition.toFixed(6)),
		groupSize: count,
		points: freeze(points),
		reasons: freeze([]),
	});
}

export function planHabitatSpecies({ species = [], context = {}, seed = 0, maxSpecies = LIVING_WORLD_ECOLOGY_POLICY.maxSpeciesPerHabitat } = {}) {
	const unique = [];
	const seen = new Set();
	for (const value of Array.isArray(species) ? species : []) {
		const id = normalizedSpeciesId(value?.species ?? value);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		unique.push(id);
		if (unique.length >= Math.min(LIVING_WORLD_ECOLOGY_POLICY.maxSpeciesPerHabitat, Math.max(0, Math.floor(maxSpecies)))) break;
	}
	const ranked = unique
		.map((id, index) => ({ id, index, score: speciesCompetitionScore(id, unique.slice(0, index), context) }))
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
	return freeze(ranked.map((entry) => freeze({
		species: entry.id,
		score: Number(entry.score.toFixed(6)),
		activity: chooseEcologyActivity(entry.id, context, `${seed}:${entry.id}`, context.clockSeconds),
	}))); 
}

export function normalizeEcologyContext(context = {}) {
	const safe = {
		biome: String(context.biome ?? '').trim().toLowerCase(),
		temperatureC: finite(context.temperatureC, 12),
		moisture: clamp(context.moisture, 0, 1),
		slopeDegrees: Math.max(0, Math.min(89, finite(context.slopeDegrees, 0))),
		waterDepthMeters: Math.max(0, finite(context.waterDepthMeters, 0)),
		distanceToSettlementMeters: Math.max(0, finite(context.distanceToSettlementMeters, Infinity)),
		distanceToRoadMeters: Math.max(0, finite(context.distanceToRoadMeters, Infinity)),
		nearWater: Boolean(context.nearWater),
		threatLevel: clamp(context.threatLevel, 0, 1),
		clockSeconds: finite(context.clockSeconds, 0),
		season: String(context.season ?? 'summer').toLowerCase(),
	};
	return freeze(safe);
}

export function ecologyDigest(plan) {
	const payload = JSON.stringify(plan ?? null);
	return stableHash(payload).toString(16).padStart(8, '0');
}

export function auditEcologyPlan(plan) {
	const errors = [];
	if (!plan || typeof plan !== 'object') errors.push('missing-plan');
	const points = Array.isArray(plan?.points) ? plan.points : [];
	if (points.length > LIVING_WORLD_ECOLOGY_POLICY.maxCandidates) errors.push('candidate-overflow');
	const positions = new Set();
	for (const point of points) {
		if (!Number.isFinite(point?.x) || !Number.isFinite(point?.z)) errors.push('non-finite-position');
		const key = `${point?.x}:${point?.z}`;
		if (positions.has(key)) errors.push('duplicate-position');
		positions.add(key);
	}
	return freeze({
		ok: errors.length === 0,
		errors: freeze(errors),
		count: points.length,
		digest: ecologyDigest(plan),
	});
}
