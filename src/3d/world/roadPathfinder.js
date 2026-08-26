/**
 * Deterministic slope-aware A* routing for the live road network.
 *
 * The router consumes the exact production terrain sampler. It never edits terrain, hydrology,
 * canonical map ownership, settlement positions or colliders. Its only job is to choose a safer
 * polyline over that existing field.
 *
 * Run 2026-08-26 hardens two failure modes exposed by exact-head browser QA:
 *  1. a finite over-cap penalty allowed A* to accept a single very steep pitch when it shortened
 *     total route cost; and
 *  2. unconditional Chaikin smoothing could cut across terrain that the raw grid route had avoided,
 *     reintroducing a >20 degree segment after a legal search.
 *
 * The search now treats the cart-road grade ceiling as a feasibility constraint, includes exact
 * start/end-to-grid transition grades in that constraint, retries deterministically with a wider
 * corridor when necessary, and only keeps smoothing that remains grade-safe on the real sampled
 * terrain. Geography remains source-owned; this module changes route choice only.
 * @module world/roadPathfinder
 */

export const ROAD_COMFORT_GRADE_DEGREES = 10;
export const ROAD_MAX_GRADE_DEGREES = 17;
export const ROAD_RETURN_GRADE_TARGET_DEGREES = 19.5;

const GRADE_PENALTY_EXPONENT = 3;
const GRID_CELL_METERS = 60;
const CORRIDOR_PADDING_METERS = 700;
const MAX_CORRIDOR_PADDING_METERS = 1500;
const ENDPOINT_LINK_RADIUS_CELLS = 2.35;
const SMOOTHING_ITERATIONS = 2;
const EPSILON = 1e-9;

const EIGHT_NEIGHBOR_OFFSETS = Object.freeze([
	[1, 0], [-1, 0], [0, 1], [0, -1],
	[1, 1], [1, -1], [-1, 1], [-1, -1],
]);

function gradeDegrees(aHeight, bHeight, horizontalDistance) {
	if (horizontalDistance <= EPSILON) return Math.abs(aHeight - bHeight) <= EPSILON ? 0 : 90;
	return (Math.atan2(Math.abs(bHeight - aHeight), horizontalDistance) * 180) / Math.PI;
}

function gradeCostMultiplier(angleDegrees) {
	const ratio = angleDegrees / ROAD_COMFORT_GRADE_DEGREES;
	return 1 + ratio ** GRADE_PENALTY_EXPONENT;
}

class MinHeap {
	constructor() {
		this.items = [];
	}

	get size() {
		return this.items.length;
	}

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
	for (let iteration = 0; iteration < iterations; iteration++) {
		const next = [current[0]];
		for (let index = 0; index < current.length - 1; index++) {
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

function samplePolyline(pointsXZ, sampleHeightMeters) {
	const points = pointsXZ.map(({ x, z }) => ({ x, z, y: sampleHeightMeters(x, z) }));
	let maxGradeDegrees = 0;
	let lengthMeters = 0;
	for (let index = 1; index < points.length; index++) {
		const a = points[index - 1];
		const b = points[index];
		const horizontalDistance = Math.hypot(b.x - a.x, b.z - a.z);
		lengthMeters += horizontalDistance;
		maxGradeDegrees = Math.max(maxGradeDegrees, gradeDegrees(a.y, b.y, horizontalDistance));
	}
	return { points, maxGradeDegrees, lengthMeters };
}

function selectGradeSafePresentation(rawPoints, start, end, sampleHeightMeters) {
	const candidates = [];
	for (let iterations = SMOOTHING_ITERATIONS; iterations >= 0; iterations--) {
		const xz = iterations === 0 ? rawPoints.map((point) => ({ ...point })) : chaikinSmooth(rawPoints, iterations);
		xz[0] = { x: start.x, z: start.z };
		xz[xz.length - 1] = { x: end.x, z: end.z };
		const measured = samplePolyline(xz, sampleHeightMeters);
		candidates.push({ ...measured, smoothingIterations: iterations });
		if (measured.maxGradeDegrees <= ROAD_RETURN_GRADE_TARGET_DEGREES) return measured;
	}

	candidates.sort((a, b) => {
		if (a.maxGradeDegrees !== b.maxGradeDegrees) return a.maxGradeDegrees - b.maxGradeDegrees;
		if (a.lengthMeters !== b.lengthMeters) return a.lengthMeters - b.lengthMeters;
		return a.smoothingIterations - b.smoothingIterations;
	});
	return candidates[0];
}

function buildPaddingAttempts(requestedPadding) {
	const requested = Math.max(GRID_CELL_METERS * 2, requestedPadding);
	const values = [
		requested,
		Math.max(requested, 1000),
		Math.max(requested, 1250),
		Math.max(requested, MAX_CORRIDOR_PADDING_METERS),
	];
	return [...new Set(values.map((value) => Math.min(MAX_CORRIDOR_PADDING_METERS, value)))];
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

function searchStrictGradePath({
	sampleHeightMeters,
	start,
	end,
	cellMeters,
	corridorPaddingMeters,
	maxGradeDegrees,
}) {
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
	const startY = sampleHeightMeters(start.x, start.z);
	const endY = sampleHeightMeters(end.x, end.z);

	const heights = new Float64Array(cols * rows);
	heights.fill(NaN);
	const heightAt = (i, j) => {
		const index = nodeIndex(i, j);
		if (Number.isNaN(heights[index])) heights[index] = sampleHeightMeters(toWorldX(i), toWorldZ(j));
		return heights[index];
	};

	const gScore = new Float64Array(cols * rows);
	gScore.fill(Infinity);
	const cameFrom = new Int32Array(cols * rows);
	cameFrom.fill(-1);
	const closed = new Uint8Array(cols * rows);
	const startLink = new Uint8Array(cols * rows);
	const heap = new MinHeap();
	const endpointRadius = cellMeters * ENDPOINT_LINK_RADIUS_CELLS;
	const heuristic = (i, j) => Math.hypot(toWorldX(i) - end.x, toWorldZ(j) - end.z);

	let startLinkIndex = -1;
	for (let j = 0; j < rows; j++) {
		const dz = toWorldZ(j) - start.z;
		if (Math.abs(dz) > endpointRadius) continue;
		for (let i = 0; i < cols; i++) {
			const dx = toWorldX(i) - start.x;
			if (Math.abs(dx) > endpointRadius) continue;
			const horizontalDistance = Math.hypot(dx, dz);
			if (horizontalDistance > endpointRadius || horizontalDistance <= EPSILON) continue;
			const angle = gradeDegrees(startY, heightAt(i, j), horizontalDistance);
			if (angle > maxGradeDegrees) continue;
			const index = nodeIndex(i, j);
			const cost = horizontalDistance * gradeCostMultiplier(angle);
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
		if (closed[index]) continue;
		if (current.g > gScore[index] + EPSILON) continue;
		if (current.f >= bestGoalCost) break;
		closed[index] = 1;

		const worldX = toWorldX(current.i);
		const worldZ = toWorldZ(current.j);
		const endDistance = Math.hypot(end.x - worldX, end.z - worldZ);
		if (endDistance <= endpointRadius && endDistance > EPSILON) {
			const angle = gradeDegrees(heightAt(current.i, current.j), endY, endDistance);
			if (angle <= maxGradeDegrees) {
				const goalCost = gScore[index] + endDistance * gradeCostMultiplier(angle);
				if (goalCost < bestGoalCost) {
					bestGoalCost = goalCost;
					bestGoalIndex = index;
				}
			}
		}

		const currentHeight = heightAt(current.i, current.j);
		for (const [di, dj] of EIGHT_NEIGHBOR_OFFSETS) {
			const ni = current.i + di;
			const nj = current.j + dj;
			if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
			const neighborIndex = nodeIndex(ni, nj);
			if (closed[neighborIndex]) continue;
			const horizontalDistance = Math.hypot(di * actualCellX, dj * actualCellZ);
			const angle = gradeDegrees(currentHeight, heightAt(ni, nj), horizontalDistance);
			if (angle > maxGradeDegrees) continue;
			const tentative = gScore[index] + horizontalDistance * gradeCostMultiplier(angle);
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
	startLinkIndex = cursor;
	const middle = reconstructPath({ cameFrom, endIndex: bestGoalIndex, cols, toWorldX, toWorldZ, startLinkIndex });
	if (!middle) return null;
	return [{ x: start.x, z: start.z }, ...middle, { x: end.x, z: end.z }];
}

/**
 * Finds a grade-constrained road route on the exact live terrain field.
 *
 * The first pass enforces the design cap (17 degrees). If canonical terrain plus settlement pads
 * make that impossible at the current corridor width, deterministic retries widen the corridor.
 * A final 19.5-degree feasibility pass is available as a fail-soft bridge below the authoritative
 * 20-degree browser safety ceiling; it is still a hard constraint, not a finite preference penalty.
 */
export function findSlopeAwarePath({
	sampleHeightMeters,
	start,
	end,
	cellMeters = GRID_CELL_METERS,
	corridorPaddingMeters = CORRIDOR_PADDING_METERS,
}) {
	if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
	for (const point of [start, end]) {
		if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) throw new TypeError('start/end coordinates must be finite');
	}
	if (!(cellMeters > 0) || !(corridorPaddingMeters > 0)) throw new RangeError('cellMeters and corridorPaddingMeters must be positive');

	const directDistance = Math.hypot(end.x - start.x, end.z - start.z);
	const startY = sampleHeightMeters(start.x, start.z);
	const endY = sampleHeightMeters(end.x, end.z);
	if (directDistance <= EPSILON) {
		return { points: [{ x: start.x, z: start.z, y: startY }], maxGradeDegrees: 0 };
	}
	const directGrade = gradeDegrees(startY, endY, directDistance);
	if (directGrade <= ROAD_MAX_GRADE_DEGREES && directDistance <= cellMeters * 1.25) {
		return { points: [{ x: start.x, z: start.z, y: startY }, { x: end.x, z: end.z, y: endY }], maxGradeDegrees: directGrade };
	}

	const paddings = buildPaddingAttempts(corridorPaddingMeters);
	const gradeCaps = [ROAD_MAX_GRADE_DEGREES, ROAD_RETURN_GRADE_TARGET_DEGREES];
	for (const gradeCap of gradeCaps) {
		for (const padding of paddings) {
			const rawPath = searchStrictGradePath({
				sampleHeightMeters,
				start,
				end,
				cellMeters,
				corridorPaddingMeters: padding,
				maxGradeDegrees: gradeCap,
			});
			if (!rawPath) continue;
			const presentation = selectGradeSafePresentation(rawPath, start, end, sampleHeightMeters);
			if (presentation.maxGradeDegrees <= ROAD_RETURN_GRADE_TARGET_DEGREES) {
				return { points: presentation.points, maxGradeDegrees: presentation.maxGradeDegrees };
			}
		}
	}

	// Canonical terrain should normally yield a constrained route. Preserve scene construction if a
	// future terrain edit genuinely makes one impossible, but report the real grade so exact-head QA
	// remains red rather than hiding the regression.
	const fallback = samplePolyline([{ x: start.x, z: start.z }, { x: end.x, z: end.z }], sampleHeightMeters);
	return { points: fallback.points, maxGradeDegrees: fallback.maxGradeDegrees };
}
