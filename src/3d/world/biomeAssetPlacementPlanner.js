/**
 * Deterministic placement planner for ecology/scenery assets.
 *
 * The planner sits between geography classification and concrete world producers. It does not own a
 * mesh, a collider, a terrain height field, a road graph, or an asset loader. Instead it converts a
 * biome distribution context into bounded placement requests that producers can validate against the
 * authoritative terrain surface before attaching a real GLB or procedural fallback.
 *
 * Design goals:
 *  - one canonical geography decision for vegetation, natural geology, and scenery;
 *  - explicit exclusion radii for roads, seats, shorelines, and steep ground;
 *  - deterministic ecological clustering instead of uniform random noise;
 *  - density and scale that respond to biome, relief, water proximity, and slope;
 *  - real asset preference where a repository candidate exists, with an explicit fallback family;
 *  - no gameplay semantics: placement is render/environment policy only.
 *
 * @module world/biomeAssetPlacementPlanner
 */

import { resolveBiomeAssetDistribution } from './biomeAssetDistribution.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';

const EPSILON = 1e-9;
const MAX_PLACEMENT_ATTEMPTS = 12;
const DEFAULT_SAMPLE_COUNT = 24;
const DEFAULT_RADIUS_METERS = 260;
const MAX_RADIUS_METERS = 2400;
const MIN_DISTANCE_METERS = 2.8;
const WATER_BUFFER_METERS = 1.5;
const ROAD_BUFFER_METERS = 10;
const SEAT_BUFFER_METERS = 90;
const MAX_SLOPE_DEGREES = 45;
const SOFT_SLOPE_START_DEGREES = 18;
const SOFT_SLOPE_FULL_DEGREES = 40;

function clamp(value, min, max) {
	return value < min ? min : value > max ? max : value;
}

function finite(value, fallback = 0) {
	return Number.isFinite(value) ? value : fallback;
}

function hashString(value) {
	let hash = 2166136261;
	const text = String(value ?? '');
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function nextRandom(seed) {
	let state = seed >>> 0;
	state = Math.imul(state ^ (state >>> 16), 2246822519) >>> 0;
	state = Math.imul(state ^ (state >>> 13), 3266489917) >>> 0;
	state ^= state >>> 16;
	return Object.freeze({ seed: state >>> 0, value: (state >>> 0) / 0xffffffff });
}

function random01(seed, salt) {
	const mixed = hashString(`${seed}:${salt}`);
	return nextRandom(mixed).value;
}

function normalizePoint(normalizedX, normalizedY) {
	const x = finite(Number(normalizedX), NaN);
	const y = finite(Number(normalizedY), NaN);
	if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('normalized map coordinates must be finite');
	if (x < 0 || x > 1 || y < 0 || y > 1) throw new RangeError('normalized map coordinates must be in [0,1]');
	return Object.freeze({ x, y });
}

function distance2D(a, b) {
	return Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));
}

function distancePointToSegment2D(point, start, end) {
	const px = finite(point?.x);
	const pz = finite(point?.z);
	const ax = finite(start?.x);
	const az = finite(start?.z);
	const bx = finite(end?.x);
	const bz = finite(end?.z);
	const abx = bx - ax;
	const abz = bz - az;
	const lengthSquared = abx * abx + abz * abz;
	if (lengthSquared <= EPSILON) return Math.hypot(px - ax, pz - az);
	const t = clamp(((px - ax) * abx + (pz - az) * abz) / lengthSquared, 0, 1);
	return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

function nearestRoadDistance(point, roadEdges = []) {
	let nearest = Infinity;
	for (const edge of Array.isArray(roadEdges) ? roadEdges : []) {
		const points = Array.isArray(edge?.points) ? edge.points : [];
		for (let index = 1; index < points.length; index += 1) {
			nearest = Math.min(nearest, distancePointToSegment2D(point, points[index - 1], points[index]));
		}
	}
	return Number.isFinite(nearest) ? nearest : Infinity;
}

function nearestSeatDistance(point, seats = []) {
	let nearest = Infinity;
	for (const seat of Array.isArray(seats) ? seats : []) nearest = Math.min(nearest, distance2D(point, seat));
	return nearest;
}

function slopeFactor(slopeDegrees) {
	const slope = Math.max(0, finite(slopeDegrees));
	if (slope <= SOFT_SLOPE_START_DEGREES) return 1;
	if (slope >= SOFT_SLOPE_FULL_DEGREES) return 0;
	const t = (slope - SOFT_SLOPE_START_DEGREES) / (SOFT_SLOPE_FULL_DEGREES - SOFT_SLOPE_START_DEGREES);
	return 1 - t * t * (3 - 2 * t);
}

function ecologicalDensity(context, surface, options) {
	const base = Number.isFinite(options.baseDensityPerKm2) ? Math.max(0, options.baseDensityPerKm2) : 24;
	let density = base * context.densityMultiplier;
	if (surface.waterDepth > 0) density *= 0.12;
	if (surface.waterDistance < WATER_BUFFER_METERS) density *= 0.18;
	density *= slopeFactor(surface.slopeDegrees);
	if (context.microPatch?.clearingChance && random01(options.seed, 'clearing') < context.microPatch.clearingChance) density *= 0.42;
	if (context.microPatch?.groveChance && random01(options.seed, 'grove') < context.microPatch.groveChance) density *= 1.40;
	return Math.max(0, density);
}

function chooseAngle(seed, salt) {
	return random01(seed, `${salt}:angle`) * Math.PI * 2;
}

function chooseRadius(seed, salt, innerRadius, outerRadius) {
	const innerSquared = innerRadius * innerRadius;
	const outerSquared = outerRadius * outerRadius;
	return Math.sqrt(innerSquared + random01(seed, `${salt}:radius`) * (outerSquared - innerSquared));
}

function radialCandidate(center, seed, salt, innerRadius, outerRadius) {
	const angle = chooseAngle(seed, salt);
	const radius = chooseRadius(seed, salt, innerRadius, outerRadius);
	return Object.freeze({
		x: center.x + Math.cos(angle) * radius,
		z: center.z + Math.sin(angle) * radius,
		angle,
		radius,
	});
}

function spiralCandidate(center, seed, index, total, radius) {
	const goldenAngle = Math.PI * (3 - Math.sqrt(5));
	const normalized = total <= 1 ? 0 : index / (total - 1);
	const localRadius = Math.sqrt(normalized) * radius;
	const jitter = (random01(seed, `spiral:${index}:jitter`) - 0.5) * Math.min(2.4, radius * 0.06);
	const angle = goldenAngle * index + jitter * 0.02;
	return Object.freeze({
		x: center.x + Math.cos(angle) * localRadius,
		z: center.z + Math.sin(angle) * localRadius,
		angle,
		radius: localRadius,
	});
}

function surfaceAt(sampleHeightMeters, x, z, seaLevelMeters, sampleOffsetMeters) {
	const offset = Math.max(0.25, finite(sampleOffsetMeters, 2));
	const height = sampleHeightMeters(x, z);
	const hx0 = sampleHeightMeters(x - offset, z);
	const hx1 = sampleHeightMeters(x + offset, z);
	const hz0 = sampleHeightMeters(x, z - offset);
	const hz1 = sampleHeightMeters(x, z + offset);
	const slopeX = (hx1 - hx0) / (offset * 2);
	const slopeZ = (hz1 - hz0) / (offset * 2);
	const slopeDegrees = Math.atan(Math.hypot(slopeX, slopeZ)) * 180 / Math.PI;
	const waterDepth = Math.max(0, seaLevelMeters - height);
	const waterDistance = waterDepth > 0 ? 0 : Infinity;
	return Object.freeze({
		height,
		slopeDegrees,
		waterDepth,
		waterDistance,
		gradient: Object.freeze({ x: slopeX, z: slopeZ }),
	});
}

function candidateAllowed(candidate, context) {
	if (Math.hypot(candidate.x, candidate.z) > context.radiusMeters) return false;
	if (context.surface.waterDepth > 0) return false;
	if (context.surface.slopeDegrees > context.maxSlopeDegrees) return false;
	if (context.seatDistance < context.minSeatDistanceMeters) return false;
	if (context.roadDistance < context.minRoadDistanceMeters) return false;
	if (context.existing.length > 0) {
		for (const existing of context.existing) if (distance2D(candidate, existing) < context.minSpacingMeters) return false;
	}
	return true;
}

function chooseFamily(context, seed, index) {
	const scatter = context.distribution.scatter;
	if (scatter.length === 0) return null;
	const totalWeight = scatter.reduce((sum, item) => sum + Math.max(0, finite(item.weight)), 0);
	if (totalWeight <= 0) return scatter[0];
	let cursor = random01(seed, `family:${index}`) * totalWeight;
	for (const item of scatter) {
		cursor -= Math.max(0, finite(item.weight));
		if (cursor <= 0) return item;
	}
	return scatter[scatter.length - 1];
}

function chooseScale(family, seed, index) {
	const min = Math.max(0.2, finite(family?.scaleMin, 0.72));
	const max = Math.max(min, finite(family?.scaleMax, 1.28));
	return Number((min + (max - min) * random01(seed, `scale:${index}`)).toFixed(4));
}

function chooseYaw(seed, index) {
	return Number((random01(seed, `yaw:${index}`) * Math.PI * 2).toFixed(5));
}

function chooseAsset(family, context, seed, index) {
	const requested = context.distribution.architecture;
	if (family?.asset) return family.asset;
	if (requested?.asset && context.category === 'architecture') return requested.asset;
	if (context.category === 'winter' && context.distribution.profileId === 'snow') {
		return context.distribution.architecture?.asset || null;
	}
	return null;
}

export const BIOME_ASSET_PLACEMENT_POLICY = Object.freeze({
	id: 'biome-asset-placement-planner-2026-09-07-v1',
	version: 1,
	renderOnly: true,
	maxPlacementAttempts: MAX_PLACEMENT_ATTEMPTS,
	defaultSampleCount: DEFAULT_SAMPLE_COUNT,
	defaultRadiusMeters: DEFAULT_RADIUS_METERS,
	maxRadiusMeters: MAX_RADIUS_METERS,
	minSpacingMeters: MIN_DISTANCE_METERS,
	waterBufferMeters: WATER_BUFFER_METERS,
	roadBufferMeters: ROAD_BUFFER_METERS,
	seatBufferMeters: SEAT_BUFFER_METERS,
	maxSlopeDegrees: MAX_SLOPE_DEGREES,
	referenceCanvas: WORLD_REFERENCE_ALIGNMENT,
});

export function createBiomeAssetPlacementPlan({
	normalizedX,
	normalizedY,
	worldX = 0,
	worldZ = 0,
	seed = 0,
	category = 'vegetation',
	sampleHeightMeters,
	seaLevelMeters = 6,
	seats = [],
	roadEdges = [],
	radiusMeters = DEFAULT_RADIUS_METERS,
	baseDensityPerKm2,
	sampleOffsetMeters = 2,
	sampleCount = DEFAULT_SAMPLE_COUNT,
	minSpacingMeters = MIN_DISTANCE_METERS,
	minSeatDistanceMeters = SEAT_BUFFER_METERS,
	minRoadDistanceMeters = ROAD_BUFFER_METERS,
	}) {
	if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters is required for biome asset placement');
	const point = normalizePoint(normalizedX, normalizedY);
	const safeRadius = clamp(finite(radiusMeters, DEFAULT_RADIUS_METERS), 0, MAX_RADIUS_METERS);
	const requestedSamples = clamp(Math.trunc(finite(sampleCount, DEFAULT_SAMPLE_COUNT)), 0, 256);
	const distribution = resolveBiomeAssetDistribution(point.x, point.y, seed, { sampleCount: Math.min(12, requestedSamples) });
	const surface = surfaceAt(sampleHeightMeters, worldX, worldZ, seaLevelMeters, sampleOffsetMeters);
	const seatDistance = nearestSeatDistance({ x: worldX, z: worldZ }, seats);
	const roadDistance = nearestRoadDistance({ x: worldX, z: worldZ }, roadEdges);
	const context = {
		distribution,
		category,
		radiusMeters: safeRadius,
		surface,
		seatDistance,
		roadDistance,
		minSpacingMeters: Math.max(0.5, minSpacingMeters),
		minSeatDistanceMeters: Math.max(0, minSeatDistanceMeters),
		minRoadDistanceMeters: Math.max(0, minRoadDistanceMeters),
		maxSlopeDegrees: MAX_SLOPE_DEGREES,
		existing: [],
	};
	const densityPerKm2 = ecologicalDensity(distribution, surface, {
		baseDensityPerKm2,
		seed,
	});
	const areaKm2 = (Math.PI * safeRadius * safeRadius) / 1_000_000;
	const targetCount = Math.min(256, Math.max(0, Math.round(areaKm2 * densityPerKm2)));
	const placements = [];
	const candidateRadius = Math.min(260, safeRadius);
	const center = Object.freeze({ x: worldX, z: worldZ });
	const deterministicSamples = Math.max(targetCount, requestedSamples);
	for (let index = 0; index < deterministicSamples && placements.length < targetCount; index += 1) {
		const candidate = index < requestedSamples
			? spiralCandidate(center, hashString(`${seed}:${category}`), index, Math.max(1, deterministicSamples), candidateRadius)
			: radialCandidate(center, hashString(`${seed}:${category}:${index}`), `candidate:${index}`, 0, candidateRadius);
		const pointSurface = surfaceAt(sampleHeightMeters, candidate.x, candidate.z, seaLevelMeters, sampleOffsetMeters);
		const pointContext = {
			...context,
			surface: pointSurface,
			seatDistance: nearestSeatDistance(candidate, seats),
			roadDistance: nearestRoadDistance(candidate, roadEdges),
		};
		if (!candidateAllowed(candidate, pointContext)) continue;
		const family = chooseFamily(pointContext, seed, index);
		if (!family) continue;
		const placement = Object.freeze({
			index: placements.length,
			x: Number(candidate.x.toFixed(4)),
			z: Number(candidate.z.toFixed(4)),
			worldY: Number(pointSurface.height.toFixed(4)),
			yaw: chooseYaw(seed, placements.length),
			scale: chooseScale(family, seed, placements.length),
			family: family.family,
			asset: chooseAsset(family, { ...pointContext, category }, seed, placements.length),
			slopeDegrees: Number(pointSurface.slopeDegrees.toFixed(3)),
			waterDepth: Number(pointSurface.waterDepth.toFixed(4)),
			roadDistance: Number(pointContext.roadDistance.toFixed(3)),
			seatDistance: Number(pointContext.seatDistance.toFixed(3)),
			fallbackFamily: family.family,
			confidence: distribution.confidence,
		});
		placements.push(placement);
		context.existing.push(placement);
	}
	return Object.freeze({
		policyId: BIOME_ASSET_PLACEMENT_POLICY.id,
		category,
		point,
		worldOrigin: Object.freeze({ x: worldX, z: worldZ }),
		profileId: distribution.profileId,
		climateFamily: distribution.climateFamily,
		densityPerKm2: Number(densityPerKm2.toFixed(4)),
		targetCount,
		placedCount: placements.length,
		placementRatio: targetCount > 0 ? Number((placements.length / targetCount).toFixed(4)) : 1,
		constraints: Object.freeze({
			maxSlopeDegrees: MAX_SLOPE_DEGREES,
			minSpacingMeters: Math.max(0.5, minSpacingMeters),
			minSeatDistanceMeters: Math.max(0, minSeatDistanceMeters),
			minRoadDistanceMeters: Math.max(0, minRoadDistanceMeters),
			seaLevelMeters,
		}),
		distribution,
		placements: Object.freeze(placements),
	});
}

export function createRegionalSceneryRing({
	worldX,
	worldZ,
	normalizedX,
	normalizedY,
	seed,
	sampleHeightMeters,
	seaLevelMeters,
	seats,
	roadEdges,
	radiusMeters,
	sampleOffsetMeters = 2,
}) {
	return createBiomeAssetPlacementPlan({
		worldX,
		worldZ,
		normalizedX,
		normalizedY,
		seed,
		category: 'vegetation',
		sampleHeightMeters,
		seaLevelMeters,
		seats,
		roadEdges,
		radiusMeters,
		sampleOffsetMeters,
		baseDensityPerKm2: 32,
		sampleCount: 32,
	});
}

export function createRegionalRockField({
	worldX,
	worldZ,
	normalizedX,
	normalizedY,
	seed,
	sampleHeightMeters,
	seaLevelMeters,
	seats,
	roadEdges,
	radiusMeters,
}) {
	return createBiomeAssetPlacementPlan({
		worldX,
		worldZ,
		normalizedX,
		normalizedY,
		seed,
		category: 'geology',
		sampleHeightMeters,
		seaLevelMeters,
		seats,
		roadEdges,
		radiusMeters,
		baseDensityPerKm2: 18,
		sampleCount: 28,
		minSpacingMeters: 6,
		minSeatDistanceMeters: 105,
		minRoadDistanceMeters: 14,
	});
}

export function createRegionalArchitectureRing({
	worldX,
	worldZ,
	normalizedX,
	normalizedY,
	seed,
	sampleHeightMeters,
	seaLevelMeters,
	seats,
	roadEdges,
	radiusMeters,
}) {
	return createBiomeAssetPlacementPlan({
		worldX,
		worldZ,
		normalizedX,
		normalizedY,
		seed,
		category: 'architecture',
		sampleHeightMeters,
		seaLevelMeters,
		seats,
		roadEdges,
		radiusMeters: Math.min(150, radiusMeters),
		baseDensityPerKm2: 4,
		sampleCount: 14,
		minSpacingMeters: 18,
		minSeatDistanceMeters: 22,
		minRoadDistanceMeters: 5,
	});
}

export function resolvePlacementSurfaceVariant(distribution, placement) {
	if (!distribution || !placement) return Object.freeze({ surface: 'default', material: null });
	if (distribution.water.signal > 0.55 || placement.waterDepth > 0) return Object.freeze({ surface: 'wet-edge', material: distribution.materialSignals.ground });
	if (placement.slopeDegrees >= 30 || distribution.relieif?.signal > 0.6) return Object.freeze({ surface: 'exposed-rock', material: distribution.materialSignals.rock });
	if (distribution.seasonal.foliageRetention >= 0.9) return Object.freeze({ surface: 'lush', material: distribution.materialSignals.ground });
	if (distribution.seasonal.exposedEarth >= 0.45) return Object.freeze({ surface: 'exposed-earth', material: distribution.materialSignals.ground });
	return Object.freeze({ surface: 'default', material: distribution.materialSignals.ground });
}

export function validatePlacementPlan(plan) {
	const errors = [];
	if (!plan || typeof plan !== 'object') return Object.freeze({ ok: false, errors: Object.freeze(['plan-missing']) });
	if (plan.policyId !== BIOME_ASSET_PLACEMENT_POLICY.id) errors.push('policy-id-mismatch');
	if (!Number.isFinite(plan.targetCount) || plan.targetCount < 0) errors.push('target-count-invalid');
	if (!Number.isFinite(plan.placedCount) || plan.placedCount < 0) errors.push('placed-count-invalid');
	if (!Array.isArray(plan.placements)) errors.push('placements-missing');
	const placements = Array.isArray(plan.placements) ? plan.placements : [];
	for (let index = 0; index < placements.length; index += 1) {
		const placement = placements[index];
		if (!Number.isFinite(placement.x) || !Number.isFinite(placement.z)) errors.push(`placement-${index}-position`);
		if (!Number.isFinite(placement.scale) || placement.scale <= 0) errors.push(`placement-${index}-scale`);
		if (!Number.isFinite(placement.yaw)) errors.push(`placement-${index}-yaw`);
		if (!Number.isFinite(placement.slopeDegrees) || placement.slopeDegrees > MAX_SLOPE_DEGREES) errors.push(`placement-${index}-slope`);
		if (!Number.isFinite(placement.roadDistance) || placement.roadDistance < 0) errors.push(`placement-${index}-road-distance`);
		if (!Number.isFinite(placement.seatDistance) || placement.seatDistance < 0) errors.push(`placement-${index}-seat-distance`);
		for (let previous = 0; previous < index; previous += 1) {
			if (distance2D(placement, placements[previous]) + EPSILON < plan.constraints.minSpacingMeters) errors.push(`placement-${index}-spacing`);
		}
	}
	return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function summarizeRegionalAssetFamilies(plan) {
	const counts = new Map();
	for (const placement of plan?.placements || []) counts.set(placement.family, (counts.get(placement.family) || 0) + 1);
	return Object.freeze([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([family, count]) => Object.freeze({ family, count })));
}

export function estimateTargetCount({ profileId, normalizedX, normalizedY, baseDensityPerKm2, radiusMeters = DEFAULT_RADIUS_METERS }) {
	const point = normalizePoint(normalizedX, normalizedY);
	const distribution = resolveBiomeAssetDistribution(point.x, point.y, 'estimate', { sampleCount: 0 });
	if (profileId && distribution.profileId !== profileId) return 0;
	const safeRadius = clamp(finite(radiusMeters, DEFAULT_RADIUS_METERS), 0, MAX_RADIUS_METERS);
	const density = Math.max(0, finite(baseDensityPerKm2, 24)) * distribution.densityMultiplier;
	return Math.min(256, Math.max(0, Math.round((Math.PI * safeRadius * safeRadius / 1_000_000) * density)));
}

export function deterministicPlacementDigest(plan) {
	let hash = 2166136261;
	const source = [plan?.policyId, plan?.profileId, plan?.targetCount, plan?.placedCount, ...(plan?.placements || []).map((item) => `${item.family}:${item.x}:${item.z}:${item.scale}:${item.yaw}`)].join('|');
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}
