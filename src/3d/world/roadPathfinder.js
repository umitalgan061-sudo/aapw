/**
 * Slope-aware A* pathfinder over a padded grid corridor between two world-space points. Used by
 * `world/roads.js` to route roads that visibly avoid steep terrain (GOVERNANCE.md §8.10's "ana yol
 * eğime duyarlı rota seçer, dağın dik yamacından düz geçmez") instead of a naive straight line
 * between two kingdom seats. Pure/stateless — takes a height sampler (`world/terrain.js`'s
 * `createHeightSampler` output, the same combined fine-FBM + macro-relief field
 * `createTerrainChunk`/`world/rivers.js` already read through) and returns a polyline; it never
 * touches THREE.js or scene state, so it can be unit-tested/regression-checked in isolation (see
 * `scripts/roadNetworkSafetyCheck.js`).
 *
 * Algorithm: 8-directional grid A* (admissible Euclidean heuristic — real segment cost is always
 * >= raw horizontal distance since `gradeCostMultiplier` is always >= 1, so the search is optimal),
 * with movement cost between adjacent grid nodes scaled by how steep that step's grade is. This
 * world's terrain (fine FBM + a few smooth macro-relief domes, see `world/terrain.js`) has no
 * literal vertical cliffs, so a route always exists at *some* finite cost — steep ground is
 * increasingly expensive rather than impassable, which is what actually produces the "bends around
 * the mountain instead of refusing to move" behavior a real cart road should have, rather than a
 * pathfinder that fails outright whenever a straight line would cross rough ground.
 *
 * Deterministic by construction: no `Math.random()` anywhere in this module, and every input
 * (`sampleHeightMeters`, `start`, `end`, grid parameters) is a pure function of the caller's own
 * already-deterministic values — same inputs always produce the same grid, the same A* expansion
 * order, and therefore the exact same output path.
 * @module world/roadPathfinder
 */

/** Soft target grade, in degrees, at/under which a road segment is treated as effectively free (its
 * cost stays within a few percent of raw horizontal distance) — a horse-drawn cart road should
 * comfortably manage this. Deliberately gentler than `scripts/terrainSeatSafetyCheck.js`'s 35°
 * foot-walkable default (a cart needs a shallower grade than a person on foot climbing the same
 * slope) but not a hard limit — steeper ground is still routable, just penalized ever more steeply
 * (see `gradeCostMultiplier`) so the search bends around it whenever a flatter detour exists. This
 * specific number is a real design choice, not an API fact — logged to `QUESTIONS_FOR_OWNER.md` per
 * GOVERNANCE.md §14, the same way run 55 logged the 35° walkable-slope default. */
export const ROAD_COMFORT_GRADE_DEGREES = 10;

/** Exponent on `(angleDegrees / ROAD_COMFORT_GRADE_DEGREES)` in `gradeCostMultiplier` — cubic rather
 * than linear/quadratic so grades well under the comfort target stay very cheap (a route that's
 * only mildly steep isn't punished much) while grades meaningfully over it become expensive fast
 * (at 2x the comfort grade the multiplier is already 9x raw distance; at 3x it's 28x) — steep enough
 * that A* reliably prefers even a noticeably longer detour over crossing a genuinely steep slope,
 * without making any grade literally infinite/unreachable (see module doc). */
const GRADE_PENALTY_EXPONENT = 3;

/**
 * Hard grade cap, in degrees, above which a single step becomes so expensive that A* will only take
 * it when no alternative exists at all.
 *
 * **Why a cap and not just a steeper penalty (2026-08-19).** `scripts/roadNetworkSafetyCheck.js`
 * asserts a route's *maximum* grade, but A* minimises a route's *total* cost — so a shorter route
 * containing one over-limit pitch legitimately beats a longer gentle one, and no amount of tuning the
 * smooth penalty changes that, because the two are optimising different quantities. This was measured
 * the hard way in ADR-0299: widening the search corridor to give roads more room to go around hills
 * made `cersei -> stannis` *worse* (18.4 -> 26.9 deg), since the extra room simply revealed more
 * short-but-steep candidates. A near-prohibitive cost above the cap is what actually aligns the two:
 * it makes A* treat "stay under the cap" as the primary objective and "be short" as the tiebreaker.
 *
 * Set below the check's own 20 deg ceiling so smoothing and terrain resampling
 * (`smoothAndResamplePath`) cannot nudge a barely-legal route over the line afterwards.
 *
 * The cost stays finite on purpose — the module's contract is that a route always exists at *some*
 * cost, so terrain that genuinely cannot be crossed gently still yields a road rather than nothing.
 * The Euclidean heuristic also stays admissible, since the multiplier remains >= 1.
 */
export const ROAD_MAX_GRADE_DEGREES = 17;

/** Multiplier applied on top of the smooth penalty once a step exceeds `ROAD_MAX_GRADE_DEGREES`.
 * Large enough that crossing one capped cell costs more than a kilometre of gentle detour, small
 * enough to stay far from floating-point trouble when summed over a long route. */
const OVER_CAP_PENALTY = 4000;

/** Grid cell size, in meters, for the A* search corridor. Small enough to resolve the macro-relief
 * mountain's own falloff shape (1300m radius, see `world/terrain.js`'s `MACRO_RELIEF_FEATURES`) with
 * many cells across it, large enough that even the longest kingdom-seat-to-seat corridor stays a few
 * thousand nodes (cheap, one-time, at scene-build time only — see `world/roads.js`). */
// Kept at 60 m. Refining to 50 m was tried on 2026-08-19 and measured *worse*, for a reason worth
// recording: this grid is also the baseline the route's own grades are sampled over, so a finer grid
// reports steeper local slopes on the same ground. It made three edges appear to fail that the
// terrain had not actually changed under. Corridor width, not cell size, is the lever that lets a
// road go around a hill.
const GRID_CELL_METERS = 60;

/** Extra margin, in meters, added on all sides of the straight-line bounding box between `start` and
 * `end` before gridding — gives the search room to actually detour around an obstacle near the
 * direct line rather than being boxed in against it. */
// Kept at 700 m. Widening to 1400 m was tried on 2026-08-19 and measured worse on `cersei -> stannis`
// (18.4 -> 26.9 deg) for a structural reason worth recording: A* minimises *total* route cost, not
// *maximum* grade, so a wider search space can win with a longer route that contains one steeper
// pitch. Letting roads go further around a hill needs a max-grade-aware cost or a hard per-step grade
// cap, not merely more room — its own subtask.
const CORRIDOR_PADDING_METERS = 700;

/** Number of Chaikin corner-cutting passes applied to the raw grid path before returning it — purely
 * cosmetic (smooths the natural "staircase" look of 8-directional grid movement into a gentler
 * curve for the ribbon mesh) and safe: each pass only ever moves points strictly inside the existing
 * polyline's corners (never outside it), and every resulting point gets its height freshly re-sampled
 * from the real terrain afterward (see `smoothAndResamplePath`), so smoothing can never make the road
 * float above/sink below the ground it's meant to follow. */
const SMOOTHING_ITERATIONS = 2;

const EIGHT_NEIGHBOR_OFFSETS = Object.freeze([
	[1, 0], [-1, 0], [0, 1], [0, -1],
	[1, 1], [1, -1], [-1, 1], [-1, -1],
]);

/**
 * Cost multiplier applied to a grid step's raw horizontal distance, as a function of that step's
 * grade. See `ROAD_COMFORT_GRADE_DEGREES`/`GRADE_PENALTY_EXPONENT` for the shape and reasoning.
 * @param {number} angleDegrees Grade of the step, in degrees above horizontal.
 * @returns {number} Always >= 1.
 */
function gradeCostMultiplier(angleDegrees) {
	const ratio = angleDegrees / ROAD_COMFORT_GRADE_DEGREES;
	const smooth = 1 + ratio ** GRADE_PENALTY_EXPONENT;
	return angleDegrees > ROAD_MAX_GRADE_DEGREES ? smooth * OVER_CAP_PENALTY : smooth;
}

/**
 * Minimal binary min-heap keyed on `.f` (A* score), used instead of a linear-scan open set — the
 * search corridor can hold several thousand nodes (see `GRID_CELL_METERS`), and a linear scan per
 * pop would make the whole network build noticeably slower for no benefit. Deterministic: contains
 * no randomness, and (like the rest of this module) always produces the same pop order for the same
 * sequence of pushes.
 */
class MinHeap {
	constructor() {
		/** @type {{f: number, i: number, j: number}[]} */
		this.items = [];
	}

	get size() {
		return this.items.length;
	}

	/** @param {{f: number, i: number, j: number}} item */
	push(item) {
		const items = this.items;
		items.push(item);
		let i = items.length - 1;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (items[parent].f <= items[i].f) break;
			[items[parent], items[i]] = [items[i], items[parent]];
			i = parent;
		}
	}

	/** @returns {{f: number, i: number, j: number} | undefined} */
	pop() {
		const items = this.items;
		const top = items[0];
		const last = items.pop();
		if (items.length > 0) {
			items[0] = last;
			let i = 0;
			const n = items.length;
			for (;;) {
				let smallest = i;
				const l = 2 * i + 1;
				const r = 2 * i + 2;
				if (l < n && items[l].f < items[smallest].f) smallest = l;
				if (r < n && items[r].f < items[smallest].f) smallest = r;
				if (smallest === i) break;
				[items[smallest], items[i]] = [items[i], items[smallest]];
				i = smallest;
			}
		}
		return top;
	}
}

/**
 * Chaikin corner-cutting: replaces each interior corner with two points at 1/4 and 3/4 along its
 * neighboring segments, run `SMOOTHING_ITERATIONS` times. Endpoints (`points[0]`/last) are always
 * preserved exactly, so a smoothed path still starts/ends exactly at the requested seat coordinate.
 * @param {{x: number, z: number}[]} points At least 2 points.
 * @returns {{x: number, z: number}[]}
 */
function chaikinSmooth(points) {
	if (points.length < 3) return points;
	let current = points;
	for (let iteration = 0; iteration < SMOOTHING_ITERATIONS; iteration++) {
		const next = [current[0]];
		for (let i = 0; i < current.length - 1; i++) {
			const a = current[i];
			const b = current[i + 1];
			next.push({ x: a.x + (b.x - a.x) * 0.25, z: a.z + (b.z - a.z) * 0.25 });
			next.push({ x: a.x + (b.x - a.x) * 0.75, z: a.z + (b.z - a.z) * 0.75 });
		}
		next.push(current[current.length - 1]);
		current = next;
	}
	return current;
}

/**
 * Finds a slope-aware route from `start` to `end` over a padded grid corridor, via A* weighted by
 * `gradeCostMultiplier`. Falls back to a plain 2-point straight line only if the search space is
 * degenerate (`start`/`end` collapse to the same grid cell) or, in principle, if no path is found —
 * the latter should be unreachable given this world's terrain has no literal cliffs (see module doc),
 * but the fallback exists so a pathological future terrain change fails safe (a straight road) rather
 * than crashing scene construction.
 * @param {object} options
 * @param {(worldX: number, worldZ: number) => number} options.sampleHeightMeters `world/terrain.js`'s `createHeightSampler` output.
 * @param {{x: number, z: number}} options.start
 * @param {{x: number, z: number}} options.end
 * @param {number} [options.cellMeters] Grid resolution — see `GRID_CELL_METERS`.
 * @param {number} [options.corridorPaddingMeters] Search-space margin — see `CORRIDOR_PADDING_METERS`.
 * @returns {{points: {x: number, z: number, y: number}[], maxGradeDegrees: number}} `points` always
 *   starts/ends exactly at `start`/`end` (with real sampled height, not a grid-snapped approximation).
 *   `maxGradeDegrees` is the steepest single consecutive-point-to-point grade actually present in the
 *   *returned* (smoothed, re-sampled) path — the real number a future safety check should assert
 *   against, not an internal search estimate.
 */
export function findSlopeAwarePath({
	sampleHeightMeters,
	start,
	end,
	cellMeters = GRID_CELL_METERS,
	corridorPaddingMeters = CORRIDOR_PADDING_METERS,
	referenceRoadPreference = null,
	referenceRoadOffGuidePenalty = 0,
}) {
	const minX = Math.min(start.x, end.x) - corridorPaddingMeters;
	const maxX = Math.max(start.x, end.x) + corridorPaddingMeters;
	const minZ = Math.min(start.z, end.z) - corridorPaddingMeters;
	const maxZ = Math.max(start.z, end.z) + corridorPaddingMeters;
	const cols = Math.max(2, Math.round((maxX - minX) / cellMeters) + 1);
	const rows = Math.max(2, Math.round((maxZ - minZ) / cellMeters) + 1);

	const toGridI = (x) => Math.min(cols - 1, Math.max(0, Math.round((x - minX) / cellMeters)));
	const toGridJ = (z) => Math.min(rows - 1, Math.max(0, Math.round((z - minZ) / cellMeters)));
	const toWorldX = (i) => minX + i * cellMeters;
	const toWorldZ = (j) => minZ + j * cellMeters;
	const nodeIndex = (i, j) => j * cols + i;

	const startI = toGridI(start.x);
	const startJ = toGridJ(start.z);
	const endI = toGridI(end.x);
	const endJ = toGridJ(end.z);
	const endIdx = nodeIndex(endI, endJ);

	const heightCache = new Float64Array(cols * rows).fill(NaN);
	const heightAt = (i, j) => {
		const idx = nodeIndex(i, j);
		if (Number.isNaN(heightCache[idx])) heightCache[idx] = sampleHeightMeters(toWorldX(i), toWorldZ(j));
		return heightCache[idx];
	};

	const gScore = new Float64Array(cols * rows).fill(Infinity);
	const cameFrom = new Int32Array(cols * rows).fill(-1);
	const closed = new Uint8Array(cols * rows);
	const heuristic = (i, j) => Math.hypot((i - endI) * cellMeters, (j - endJ) * cellMeters);

	const startIdx = nodeIndex(startI, startJ);
	gScore[startIdx] = 0;
	const heap = new MinHeap();
	heap.push({ f: heuristic(startI, startJ), i: startI, j: startJ });

	let found = startIdx === endIdx;
	while (!found && heap.size > 0) {
		const current = heap.pop();
		const idx = nodeIndex(current.i, current.j);
		if (closed[idx]) continue;
		closed[idx] = 1;
		if (idx === endIdx) {
			found = true;
			break;
		}

		const hCurrent = heightAt(current.i, current.j);
		for (const [di, dj] of EIGHT_NEIGHBOR_OFFSETS) {
			const ni = current.i + di;
			const nj = current.j + dj;
			if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
			const nIdx = nodeIndex(ni, nj);
			if (closed[nIdx]) continue;

			const horizontalDistance = Math.hypot(di * cellMeters, dj * cellMeters);
			const rise = Math.abs(heightAt(ni, nj) - hCurrent);
			const angleDegrees = (Math.atan2(rise, horizontalDistance) * 180) / Math.PI;
			const roadPreference = referenceRoadPreference
				? Math.max(0, Math.min(1, referenceRoadPreference(toWorldX(ni), toWorldZ(nj))))
				: 1;
			// Preference can only add cost away from the painted corridor; it never discounts below
			// raw horizontal distance, so the Euclidean A* heuristic remains admissible. Grade safety
			// still dominates because the existing over-cap multiplier is orders of magnitude larger.
			const guideMultiplier = 1 + (1 - roadPreference) * Math.max(0, referenceRoadOffGuidePenalty);
			const stepCost = horizontalDistance * gradeCostMultiplier(angleDegrees) * guideMultiplier;
			const tentativeG = gScore[idx] + stepCost;
			if (tentativeG < gScore[nIdx]) {
				gScore[nIdx] = tentativeG;
				cameFrom[nIdx] = idx;
				heap.push({ f: tentativeG + heuristic(ni, nj), i: ni, j: nj });
			}
		}
	}

	if (!found) {
		const startY = sampleHeightMeters(start.x, start.z);
		const endY = sampleHeightMeters(end.x, end.z);
		return { points: [{ x: start.x, z: start.z, y: startY }, { x: end.x, z: end.z, y: endY }], maxGradeDegrees: NaN };
	}

	const gridPath = [];
	let cursor = endIdx;
	while (cursor !== -1) {
		gridPath.push({ i: cursor % cols, j: Math.floor(cursor / cols) });
		cursor = cameFrom[cursor];
	}
	gridPath.reverse();

	const rawPoints = gridPath.map(({ i, j }) => ({ x: toWorldX(i), z: toWorldZ(j) }));
	return smoothAndResamplePath(rawPoints, start, end, sampleHeightMeters);
}

/**
 * Smooths a raw grid-aligned polyline (cosmetic only, see `chaikinSmooth`), forces its first/last
 * points to the exact requested `start`/`end`, and re-samples every point's height fresh from
 * `sampleHeightMeters` (never carried over from the search's own cached grid heights) — guarantees
 * the returned path always sits on the real terrain surface at its exact `(x, z)`, not an
 * approximation from a nearby grid node. Also computes the real max consecutive-point grade of the
 * *returned* path (see `findSlopeAwarePath`'s own doc for why this, not an internal search estimate).
 * @param {{x: number, z: number}[]} rawPoints
 * @param {{x: number, z: number}} start
 * @param {{x: number, z: number}} end
 * @param {(worldX: number, worldZ: number) => number} sampleHeightMeters
 * @returns {{points: {x: number, z: number, y: number}[], maxGradeDegrees: number}}
 */
function smoothAndResamplePath(rawPoints, start, end, sampleHeightMeters) {
	const smoothedXZ = chaikinSmooth(rawPoints);
	smoothedXZ[0] = { x: start.x, z: start.z };
	smoothedXZ[smoothedXZ.length - 1] = { x: end.x, z: end.z };

	const points = smoothedXZ.map(({ x, z }) => ({ x, z, y: sampleHeightMeters(x, z) }));

	let maxGradeDegrees = 0;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const horizontalDistance = Math.hypot(b.x - a.x, b.z - a.z);
		if (horizontalDistance < 1e-6) continue;
		const grade = (Math.atan2(Math.abs(b.y - a.y), horizontalDistance) * 180) / Math.PI;
		if (grade > maxGradeDegrees) maxGradeDegrees = grade;
	}

	return { points, maxGradeDegrees };
}
