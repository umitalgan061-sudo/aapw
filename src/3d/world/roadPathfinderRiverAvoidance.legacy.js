import { WORLD_DEFAULTS } from '../config.js';
import { generateRiverPath } from './rivers.js';

/**
 * River-avoidance field for `roadPathfinder.js`'s A* search and presentation validation.
 *
 * Split out of `roadPathfinder.js` (GOVERNANCE.md Altın Kural 7, 600-line file cap) as a pure,
 * self-contained extraction: every export here was already private to that module and is consumed
 * only by it. No behavior changes — same constants, same cache, same math, same output shape.
 */

const RIVER_CLEARANCE_METERS = 25;
const RIVER_AVOIDANCE_RADIUS_METERS = 95;
const RIVER_NEAR_COST_MULTIPLIER = 24;
const RIVER_BANK_COST_MULTIPLIER = 4.5;
const RIVER_PROFILE_SPACING_METERS = 12;
const riverAvoidanceCache = new WeakMap();

export function buildRiverAvoidanceField(sampleHeightMeters) {
	if (riverAvoidanceCache.has(sampleHeightMeters)) return riverAvoidanceCache.get(sampleHeightMeters);
	const { points } = generateRiverPath({
		seed: WORLD_DEFAULTS.WORLD_SEED,
		sampleHeightMeters,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
	});
	const cellSize = RIVER_AVOIDANCE_RADIUS_METERS;
	const bins = new Map();
	for (const point of points) {
		const ix = Math.floor(point.x / cellSize);
		const iz = Math.floor(point.z / cellSize);
		const key = `${ix},${iz}`;
		let bucket = bins.get(key);
		if (!bucket) {
			bucket = [];
			bins.set(key, bucket);
		}
		bucket.push({ x: point.x, z: point.z });
	}
	const field = Object.freeze({ bins, cellSize, pointCount: points.length });
	riverAvoidanceCache.set(sampleHeightMeters, field);
	return field;
}

export function distanceToCanonicalRiver(field, x, z) {
	if (!field || field.pointCount === 0) return Infinity;
	const ix = Math.floor(x / field.cellSize);
	const iz = Math.floor(z / field.cellSize);
	let nearest = Infinity;
	for (let dz = -2; dz <= 2; dz += 1) {
		for (let dx = -2; dx <= 2; dx += 1) {
			const bucket = field.bins.get(`${ix + dx},${iz + dz}`);
			if (!bucket) continue;
			for (const point of bucket) nearest = Math.min(nearest, Math.hypot(x - point.x, z - point.z));
		}
	}
	return nearest;
}

export function riverCostMultiplier(field, x, z) {
	const distance = distanceToCanonicalRiver(field, x, z);
	if (distance >= RIVER_AVOIDANCE_RADIUS_METERS) return 1;
	if (distance <= RIVER_CLEARANCE_METERS) return RIVER_NEAR_COST_MULTIPLIER;
	const t = (distance - RIVER_CLEARANCE_METERS) / (RIVER_AVOIDANCE_RADIUS_METERS - RIVER_CLEARANCE_METERS);
	const smooth = t * t * (3 - 2 * t);
	return RIVER_BANK_COST_MULTIPLIER + (1 - RIVER_BANK_COST_MULTIPLIER) * smooth;
}

export function profileRiverExposure(field, points) {
	if (!field || field.pointCount === 0 || !Array.isArray(points) || points.length === 0) {
		return Object.freeze({
			minimumDistanceMeters: Infinity,
			adjacentPointCount: 0,
			maxConsecutiveAdjacentSamples: 0,
			continuousAdjacentRunMeters: 0,
			continuousSampleCount: 0,
		});
	}
	let minimumDistanceMeters = Infinity;
	let adjacentPointCount = 0;
	let maxConsecutiveAdjacentSamples = 0;
	let pointRun = 0;
	for (const point of points) {
		const distance = distanceToCanonicalRiver(field, point.x, point.z);
		minimumDistanceMeters = Math.min(minimumDistanceMeters, distance);
		if (distance < RIVER_CLEARANCE_METERS) {
			adjacentPointCount += 1;
			pointRun += 1;
			maxConsecutiveAdjacentSamples = Math.max(maxConsecutiveAdjacentSamples, pointRun);
		} else {
			pointRun = 0;
		}
	}

	let currentRunMeters = 0;
	let continuousAdjacentRunMeters = 0;
	let continuousSampleCount = 0;
	for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
		const start = points[segmentIndex - 1];
		const end = points[segmentIndex];
		const segmentLength = Math.hypot(end.x - start.x, end.z - start.z);
		const intervals = Math.max(1, Math.ceil(segmentLength / RIVER_PROFILE_SPACING_METERS));
		const stepLength = segmentLength / intervals;
		for (let step = 1; step <= intervals; step += 1) {
			const t = step / intervals;
			const x = start.x + (end.x - start.x) * t;
			const z = start.z + (end.z - start.z) * t;
			const distance = distanceToCanonicalRiver(field, x, z);
			minimumDistanceMeters = Math.min(minimumDistanceMeters, distance);
			continuousSampleCount += 1;
			if (distance < RIVER_CLEARANCE_METERS) {
				currentRunMeters += stepLength;
				continuousAdjacentRunMeters = Math.max(continuousAdjacentRunMeters, currentRunMeters);
			} else {
				currentRunMeters = 0;
			}
		}
	}

	return Object.freeze({
		minimumDistanceMeters,
		adjacentPointCount,
		maxConsecutiveAdjacentSamples,
		continuousAdjacentRunMeters,
		continuousSampleCount,
	});
}
