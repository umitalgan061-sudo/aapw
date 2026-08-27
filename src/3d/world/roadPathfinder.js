import { WORLD_DEFAULTS } from '../config.js';
import { generateRiverPath } from './rivers.js';
import {
	ROAD_PROFILE_POLICY,
	checksumProfile,
	gradeDegrees,
	pathIsGradeSafe,
	profileRoadPolyline,
	profileTerrainSegment,
	summarizePolylineCurvature,
} from './roadSurfaceProfile.js';

/**
 * Deterministic, terrain-profiled A* routing for the live road network.
 *
 * The search grid stays intentionally coarser than the rendered road for startup performance, but
 * every endpoint connector and returned presentation path is validated against the continuous terrain
 * sampler at sub-grid spacing. Grid search remains node-based for startup performance; if dense final
 * validation exposes a hidden ridge/gully, deterministic finer-grid stages retry the route.
 *
 * The module remains geography-neutral: it chooses a route over terrain but never changes terrain,
 * hydrology, settlements, map ownership or colliders.
 */

export const ROAD_COMFORT_GRADE_DEGREES = 10;
export const ROAD_MAX_GRADE_DEGREES = 17;
export const ROAD_RETURN_GRADE_TARGET_DEGREES = 19.25;
export const ROAD_MAX_RIVER_ADJACENT_SAMPLES = 3;

export const ROAD_ROUTING_POLICY = Object.freeze({
	id: 'road-routing-2026-08-27-v4-settlement-egress-refinement',
	comfortGradeDegrees: ROAD_COMFORT_GRADE_DEGREES,
	searchGradeDegrees: ROAD_MAX_GRADE_DEGREES,
	returnGradeDegrees: ROAD_RETURN_GRADE_TARGET_DEGREES,
	gridCellMeters: 60,
	baseCorridorPaddingMeters: 700,
	maxCorridorPaddingMeters: 1800,
	maxRiverAdjacentSamples: ROAD_MAX_RIVER_ADJACENT_SAMPLES,
	terrainProfilePolicyId: ROAD_PROFILE_POLICY.id,
	deterministic: true,
	geographyAuthorityUnchanged: true,
});

const GRADE_PENALTY_EXPONENT = 3;
const GRID_CELL_METERS = ROAD_ROUTING_POLICY.gridCellMeters;
const CORRIDOR_PADDING_METERS = ROAD_ROUTING_POLICY.baseCorridorPaddingMeters;
const MAX_CORRIDOR_PADDING_METERS = ROAD_ROUTING_POLICY.maxCorridorPaddingMeters;
const ENDPOINT_LINK_RADIUS_CELLS = 2.6;
const SMOOTHING_ITERATIONS = 2;
const EPSILON = 1e-9;
const RIVER_CLEARANCE_METERS = 25;
const RIVER_AVOIDANCE_RADIUS_METERS = 95;
const RIVER_NEAR_COST_MULTIPLIER = 24;
const RIVER_BANK_COST_MULTIPLIER = 4.5;
const RIVER_PROFILE_SPACING_METERS = 12;
const FINE_REFINEMENT_CELL_METERS = 24;
const MIN_REFINEMENT_CELL_METERS = 36;
const MID_REFINEMENT_CELL_METERS = 45;
// Close seat-to-seat links can sit inside overlapping settlement-pad transition zones. Bounded
// local passes resolve those egress contours without paying for a 12 m grid across long roads.
const SHORT_ROUTE_MAX_DISTANCE_METERS = 320;
const SHORT_ROUTE_REFINEMENT_CELL_METERS = 12;
const SHORT_ROUTE_CORRIDOR_PADDING_METERS = 360;
const MEDIUM_ROUTE_MAX_DISTANCE_METERS = 780;
const MEDIUM_ROUTE_REFINEMENT_CELL_METERS = 12;
const MEDIUM_ROUTE_CORRIDOR_PADDING_METERS = 480;
const riverAvoidanceCache = new WeakMap();

const EIGHT_NEIGHBOR_OFFSETS = Object.freeze([
	[1, 0], [-1, 0], [0, 1], [0, -1],
	[1, 1], [1, -1], [-1, 1], [-1, -1],
]);

function gradeCostMultiplier(angleDegrees) {
	const ratio = angleDegrees / ROAD_COMFORT_GRADE_DEGREES;
	return 1 + ratio ** GRADE_PENALTY_EXPONENT;
}

function buildRiverAvoidanceField(sampleHeightMeters) {
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

function distanceToCanonicalRiver(field, x, z) {
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

function riverCostMultiplier(field, x, z) {
	const distance = distanceToCanonicalRiver(field, x, z);
	if (distance >= RIVER_AVOIDANCE_RADIUS_METERS) return 1;
	if (distance <= RIVER_CLEARANCE_METERS) return RIVER_NEAR_COST_MULTIPLIER;
	const t = (distance - RIVER_CLEARANCE_METERS) / (RIVER_AVOIDANCE_RADIUS_METERS - RIVER_CLEARANCE_METERS);
	const smooth = t * t * (3 - 2 * t);
	return RIVER_BANK_COST_MULTIPLIER + (1 - RIVER_BANK_COST_MULTIPLIER) * smooth;
}

function profileRiverExposure(field, points) {
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

class MinHeap {
	constructor() { this.items = []; }
	get size() { return this.items.length; }
	static less(a, b) {
		if (a.f !== b.f) return a.f < b.f;
		if (a.g !== b.g) return a.g < b.g;
		if (a.j !== b.j) return a.j < b.j;
		return a.i < b.i;
	}
	push(item) {
		const items = this.items;
		items.push(item);
		let index = items.length - 1;
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (!MinHeap.less(items[index], items[parent])) break;
			[items[parent], items[index]] = [items[index], items[parent]];
			index = parent;
		}
	}
	pop() {
		const items = this.items;
		if (items.length === 0) return undefined;
		const top = items[0];
		const last = items.pop();
		if (items.length === 0) return top;
		items[0] = last;
		let index = 0;
		for (;;) {
			let smallest = index;
			const left = index * 2 + 1;
			const right = left + 1;
			if (left < items.length && MinHeap.less(items[left], items[smallest])) smallest = left;
			if (right < items.length && MinHeap.less(items[right], items[smallest])) smallest = right;
			if (smallest === index) break;
			[items[index], items[smallest]] = [items[smallest], items[index]];
			index = smallest;
		}
		return top;
	}
}

function chaikinSmooth(points, iterations) {
	if (points.length < 3 || iterations <= 0) return points.map((point) => ({ ...point }));
	let current = points.map((point) => ({ ...point }));
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		const next = [current[0]];
		for (let index = 0; index < current.length - 1; index += 1) {
			const a = current[index];
			const b = current[index + 1];
			next.push(
				{ x: a.x + (b.x - a.x) * 0.25, z: a.z + (b.z - a.z) * 0.25 },
				{ x: a.x + (b.x - a.x) * 0.75, z: a.z + (b.z - a.z) * 0.75 },
			);
		}
		next.push(current[current.length - 1]);
		current = next;
	}
	return current;
}

function measurePresentation(pointsXZ, sampleHeightMeters, riverField) {
	const terrain = profileRoadPolyline({ points: pointsXZ, sampleHeightMeters });
	const presentationPoints = pointsXZ.map(({ x, z }) => ({ x, z, y: sampleHeightMeters(x, z) }));
	const curvature = summarizePolylineCurvature(presentationPoints);
	const river = profileRiverExposure(riverField, presentationPoints);
	return Object.freeze({
		...terrain,
		points: presentationPoints,
		densifiedPointCount: terrain.points.length,
		curvature,
		river,
		checksum: checksumProfile(terrain),
	});
}

function selectSafePresentation(rawPoints, start, end, sampleHeightMeters, riverField) {
	const candidates = [];
	for (let iterations = SMOOTHING_ITERATIONS; iterations >= 0; iterations -= 1) {
		const xz = iterations === 0 ? rawPoints.map((point) => ({ ...point })) : chaikinSmooth(rawPoints, iterations);
		xz[0] = { x: start.x, z: start.z };
		xz[xz.length - 1] = { x: end.x, z: end.z };
		const measured = measurePresentation(xz, sampleHeightMeters, riverField);
		const candidate = Object.freeze({ ...measured, smoothingIterations: iterations });
		candidates.push(candidate);
		if (
			pathIsGradeSafe(measured, ROAD_RETURN_GRADE_TARGET_DEGREES)
			&& measured.river.maxConsecutiveAdjacentSamples <= ROAD_MAX_RIVER_ADJACENT_SAMPLES
		) return candidate;
	}
	candidates.sort((a, b) => {
		const aRiverOverflow = Math.max(0, a.river.maxConsecutiveAdjacentSamples - ROAD_MAX_RIVER_ADJACENT_SAMPLES);
		const bRiverOverflow = Math.max(0, b.river.maxConsecutiveAdjacentSamples - ROAD_MAX_RIVER_ADJACENT_SAMPLES);
		if (aRiverOverflow !== bRiverOverflow) return aRiverOverflow - bRiverOverflow;
		if (a.maxGradeDegrees !== b.maxGradeDegrees) return a.maxGradeDegrees - b.maxGradeDegrees;
		if (a.lengthMeters !== b.lengthMeters) return a.lengthMeters - b.lengthMeters;
		return a.smoothingIterations - b.smoothingIterations;
	});
	return candidates[0];
}

function buildPaddingAttempts(requestedPadding) {
	const requested = Math.max(GRID_CELL_METERS * 2, requestedPadding);
	const values = [requested, Math.max(requested, 1000), Math.max(requested, 1300), Math.max(requested, 1550), Math.max(requested, MAX_CORRIDOR_PADDING_METERS)];
	return [...new Set(values.map((value) => Math.min(MAX_CORRIDOR_PADDING_METERS, value)))];
}

function buildSearchStages(requestedCellMeters, requestedPaddingMeters, directDistanceMeters) {
	const paddings = buildPaddingAttempts(requestedPaddingMeters);
	const cells = [...new Set([
		requestedCellMeters,
		Math.min(requestedCellMeters, MID_REFINEMENT_CELL_METERS),
		Math.min(requestedCellMeters, MIN_REFINEMENT_CELL_METERS),
		Math.min(requestedCellMeters, FINE_REFINEMENT_CELL_METERS),
	].filter((value) => value > 0))];
	const stages = [];
	if (directDistanceMeters <= SHORT_ROUTE_MAX_DISTANCE_METERS) {
		stages.push(Object.freeze({
			cellMeters: SHORT_ROUTE_REFINEMENT_CELL_METERS,
			paddingMeters: SHORT_ROUTE_CORRIDOR_PADDING_METERS,
		}));
	} else if (directDistanceMeters <= MEDIUM_ROUTE_MAX_DISTANCE_METERS) {
		stages.push(Object.freeze({
			cellMeters: MEDIUM_ROUTE_REFINEMENT_CELL_METERS,
			paddingMeters: MEDIUM_ROUTE_CORRIDOR_PADDING_METERS,
		}));
	}
	for (const [cellIndex, stageCellMeters] of cells.entries()) {
		const minimumPaddingIndex = cellIndex === 0 ? 0 : Math.min(cellIndex, paddings.length - 1);
		for (let paddingIndex = minimumPaddingIndex; paddingIndex < paddings.length; paddingIndex += 1) {
			stages.push(Object.freeze({ cellMeters: stageCellMeters, paddingMeters: paddings[paddingIndex] }));
		}
	}
	return Object.freeze(stages);
}

function reconstructPath({ cameFrom, endIndex, cols, toWorldX, toWorldZ, startLinkIndex }) {
	const reversed = [];
	let cursor = endIndex;
	while (cursor >= 0) {
		reversed.push({ x: toWorldX(cursor % cols), z: toWorldZ(Math.floor(cursor / cols)) });
		if (cursor === startLinkIndex) break;
		cursor = cameFrom[cursor];
	}
	if (reversed.length === 0 || cursor !== startLinkIndex) return null;
	reversed.reverse();
	return reversed;
}

function segmentFeasibility({ start, end, sampleHeightMeters, maxGradeDegrees }) {
	const profile = profileTerrainSegment({ start, end, sampleHeightMeters });
	return {
		profile,
		safe: profile.maxGradeDegrees <= maxGradeDegrees + EPSILON,
	};
}

function searchStrictGradePath({ sampleHeightMeters, start, end, cellMeters, corridorPaddingMeters, maxGradeDegrees }) {
	const minX = Math.min(start.x, end.x) - corridorPaddingMeters;
	const maxX = Math.max(start.x, end.x) + corridorPaddingMeters;
	const minZ = Math.min(start.z, end.z) - corridorPaddingMeters;
	const maxZ = Math.max(start.z, end.z) + corridorPaddingMeters;
	const cols = Math.max(2, Math.ceil((maxX - minX) / cellMeters) + 1);
	const rows = Math.max(2, Math.ceil((maxZ - minZ) / cellMeters) + 1);
	const actualCellX = (maxX - minX) / (cols - 1);
	const actualCellZ = (maxZ - minZ) / (rows - 1);
	const toWorldX = (i) => minX + i * actualCellX;
	const toWorldZ = (j) => minZ + j * actualCellZ;
	const nodeIndex = (i, j) => j * cols + i;
	const riverField = buildRiverAvoidanceField(sampleHeightMeters);

	const heights = new Float64Array(cols * rows); heights.fill(NaN);
	const heightAt = (i, j) => {
		const index = nodeIndex(i, j);
		if (Number.isNaN(heights[index])) heights[index] = sampleHeightMeters(toWorldX(i), toWorldZ(j));
		return heights[index];
	};
	const gScore = new Float64Array(cols * rows); gScore.fill(Infinity);
	const cameFrom = new Int32Array(cols * rows); cameFrom.fill(-1);
	const closed = new Uint8Array(cols * rows);
	const startLink = new Uint8Array(cols * rows);
	const heap = new MinHeap();
	const endpointRadius = cellMeters * ENDPOINT_LINK_RADIUS_CELLS;
	const heuristic = (i, j) => Math.hypot(toWorldX(i) - end.x, toWorldZ(j) - end.z);
	let expandedNodes = 0;
	let rejectedGradeEdges = 0;
	let evaluatedEdges = 0;

	for (let j = 0; j < rows; j += 1) {
		const dz = toWorldZ(j) - start.z;
		if (Math.abs(dz) > endpointRadius) continue;
		for (let i = 0; i < cols; i += 1) {
			const dx = toWorldX(i) - start.x;
			if (Math.abs(dx) > endpointRadius) continue;
			const horizontalDistance = Math.hypot(dx, dz);
			if (horizontalDistance > endpointRadius || horizontalDistance <= EPSILON) continue;
			const endPoint = { x: toWorldX(i), z: toWorldZ(j) };
			const feasibility = segmentFeasibility({ start, end: endPoint, sampleHeightMeters, maxGradeDegrees });
			if (!feasibility.safe) continue;
			const index = nodeIndex(i, j);
			const cost = horizontalDistance * gradeCostMultiplier(feasibility.profile.maxGradeDegrees) * riverCostMultiplier(riverField, endPoint.x, endPoint.z);
			if (cost >= gScore[index]) continue;
			gScore[index] = cost;
			startLink[index] = 1;
			heap.push({ f: cost + heuristic(i, j), g: cost, i, j });
		}
	}
	if (heap.size === 0) return null;

	let bestGoalIndex = -1;
	let bestGoalCost = Infinity;
	while (heap.size > 0) {
		const current = heap.pop();
		const index = nodeIndex(current.i, current.j);
		if (closed[index] || current.g > gScore[index] + EPSILON) continue;
		if (current.f >= bestGoalCost) break;
		closed[index] = 1;
		expandedNodes += 1;

		const worldX = toWorldX(current.i);
		const worldZ = toWorldZ(current.j);
		const endDistance = Math.hypot(end.x - worldX, end.z - worldZ);
		if (endDistance <= endpointRadius && endDistance > EPSILON) {
			const feasibility = segmentFeasibility({ start: { x: worldX, z: worldZ }, end, sampleHeightMeters, maxGradeDegrees });
			if (feasibility.safe) {
				const goalCost = gScore[index] + endDistance * gradeCostMultiplier(feasibility.profile.maxGradeDegrees);
				if (goalCost < bestGoalCost) { bestGoalCost = goalCost; bestGoalIndex = index; }
			}
		}

		const currentHeight = heightAt(current.i, current.j);
		for (const [di, dj] of EIGHT_NEIGHBOR_OFFSETS) {
			const ni = current.i + di;
			const nj = current.j + dj;
			if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
			const neighborIndex = nodeIndex(ni, nj);
			if (closed[neighborIndex]) continue;
			evaluatedEdges += 1;
			const neighborX = toWorldX(ni);
			const neighborZ = toWorldZ(nj);
			const horizontalDistance = Math.hypot(di * actualCellX, dj * actualCellZ);
			const nodeGrade = gradeDegrees(heightAt(ni, nj) - currentHeight, horizontalDistance);
			if (nodeGrade > maxGradeDegrees) { rejectedGradeEdges += 1; continue; }
			const edgeFeasibility = segmentFeasibility({
				start: { x: worldX, z: worldZ },
				end: { x: neighborX, z: neighborZ },
				sampleHeightMeters,
				maxGradeDegrees,
			});
			if (!edgeFeasibility.safe) { rejectedGradeEdges += 1; continue; }
			const edgeGrade = edgeFeasibility.profile.maxGradeDegrees;
			const midpointX = (worldX + neighborX) * 0.5;
			const midpointZ = (worldZ + neighborZ) * 0.5;
			const riverMultiplier = Math.max(
				riverCostMultiplier(riverField, neighborX, neighborZ),
				riverCostMultiplier(riverField, midpointX, midpointZ),
			);
			const tentative = gScore[index] + horizontalDistance * gradeCostMultiplier(edgeGrade) * riverMultiplier;
			if (tentative + EPSILON >= gScore[neighborIndex]) continue;
			gScore[neighborIndex] = tentative;
			cameFrom[neighborIndex] = index;
			heap.push({ f: tentative + heuristic(ni, nj), g: tentative, i: ni, j: nj });
		}
	}

	if (bestGoalIndex < 0) return null;
	let cursor = bestGoalIndex;
	while (cursor >= 0 && !startLink[cursor]) cursor = cameFrom[cursor];
	if (cursor < 0) return null;
	const middle = reconstructPath({ cameFrom, endIndex: bestGoalIndex, cols, toWorldX, toWorldZ, startLinkIndex: cursor });
	if (!middle) return null;
	return {
		rawPoints: [{ x: start.x, z: start.z }, ...middle, { x: end.x, z: end.z }],
		riverField,
		expandedNodes,
		rejectedGradeEdges,
		evaluatedEdges,
		cols,
		rows,
	};
}

export function findSlopeAwarePath({ sampleHeightMeters, start, end, cellMeters = GRID_CELL_METERS, corridorPaddingMeters = CORRIDOR_PADDING_METERS }) {
	if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
	for (const point of [start, end]) {
		if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) throw new TypeError('start/end coordinates must be finite');
	}
	if (!(cellMeters > 0) || !(corridorPaddingMeters > 0)) throw new RangeError('cellMeters and corridorPaddingMeters must be positive');

	const directDistance = Math.hypot(end.x - start.x, end.z - start.z);
	if (directDistance <= EPSILON) {
		const y = sampleHeightMeters(start.x, start.z);
		return { points: [{ x: start.x, z: start.z, y }], maxGradeDegrees: 0, diagnostics: Object.freeze({ mode: 'point', fallback: false, attempts: [] }) };
	}

	const riverField = buildRiverAvoidanceField(sampleHeightMeters);
	if (directDistance <= cellMeters * 1.25) {
		const direct = measurePresentation([start, end], sampleHeightMeters, riverField);
		if (pathIsGradeSafe(direct, ROAD_MAX_GRADE_DEGREES) && direct.river.maxConsecutiveAdjacentSamples <= ROAD_MAX_RIVER_ADJACENT_SAMPLES) {
			return {
				points: direct.points,
				maxGradeDegrees: direct.maxGradeDegrees,
				diagnostics: Object.freeze({ mode: 'direct', fallback: false, smoothingIterations: 0, paddingMeters: 0, gradeCapDegrees: ROAD_MAX_GRADE_DEGREES, expandedNodes: 0, river: direct.river, checksum: direct.checksum, attempts: [] }),
			};
		}
	}

	const stages = buildSearchStages(cellMeters, corridorPaddingMeters, directDistance);
	const gradeCaps = [ROAD_MAX_GRADE_DEGREES, ROAD_RETURN_GRADE_TARGET_DEGREES];
	const attempts = [];
	for (const gradeCap of gradeCaps) {
		for (const stage of stages) {
			const search = searchStrictGradePath({ sampleHeightMeters, start, end, cellMeters: stage.cellMeters, corridorPaddingMeters: stage.paddingMeters, maxGradeDegrees: gradeCap });
			if (!search) {
				attempts.push(Object.freeze({ gradeCapDegrees: gradeCap, cellMeters: stage.cellMeters, paddingMeters: stage.paddingMeters, found: false }));
				continue;
			}
			const presentation = selectSafePresentation(search.rawPoints, start, end, sampleHeightMeters, search.riverField);
			const safeGrade = pathIsGradeSafe(presentation, ROAD_RETURN_GRADE_TARGET_DEGREES);
			const safeRiver = presentation.river.maxConsecutiveAdjacentSamples <= ROAD_MAX_RIVER_ADJACENT_SAMPLES;
			attempts.push(Object.freeze({ gradeCapDegrees: gradeCap, cellMeters: stage.cellMeters, paddingMeters: stage.paddingMeters, found: true, safeGrade, safeRiver, maxGradeDegrees: presentation.maxGradeDegrees, riverRun: presentation.river.maxConsecutiveAdjacentSamples, expandedNodes: search.expandedNodes }));
			if (safeGrade && safeRiver) {
				return {
					points: presentation.points,
					maxGradeDegrees: presentation.maxGradeDegrees,
					diagnostics: Object.freeze({
						mode: 'astar', fallback: false, gradeCapDegrees: gradeCap, cellMeters: stage.cellMeters, paddingMeters: stage.paddingMeters,
						smoothingIterations: presentation.smoothingIterations, expandedNodes: search.expandedNodes,
						evaluatedEdges: search.evaluatedEdges, rejectedGradeEdges: search.rejectedGradeEdges,
						gridCols: search.cols, gridRows: search.rows, river: presentation.river,
						curvature: presentation.curvature, checksum: presentation.checksum, attempts: Object.freeze([...attempts]),
					}),
				};
			}
		}
	}

	const fallback = measurePresentation([start, end], sampleHeightMeters, riverField);
	return {
		points: fallback.points,
		maxGradeDegrees: fallback.maxGradeDegrees,
		diagnostics: Object.freeze({ mode: 'fallback', fallback: true, smoothingIterations: 0, paddingMeters: MAX_CORRIDOR_PADDING_METERS, gradeCapDegrees: ROAD_RETURN_GRADE_TARGET_DEGREES, expandedNodes: 0, river: fallback.river, curvature: fallback.curvature, checksum: fallback.checksum, attempts: Object.freeze([...attempts]) }),
	};
}