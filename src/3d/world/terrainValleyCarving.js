/**
 * River valley carving — so a river runs in a valley instead of lying on top of a plain.
 *
 * **What was wrong.** `world/rivers.js` traces a descending path across the height field and draws a
 * ribbon along it, but nothing ever cut the ground it runs through. The result is a river sitting on
 * the surface like a painted line: no floodplain, no banks, no valley. Real rivers do not decorate
 * landscapes, they *make* them — a valley is the single most recognisable landform in temperate
 * country, and its absence is a large part of why the world still read as generic noise even after
 * ADR-0304 gave the ground real roughness.
 *
 * **How it works — the same two-phase pattern roads and settlements already use.** Phase 1 traces the
 * river over terrain that carries settlement pads but no valley. Phase 2 turns that polyline into a
 * field that pulls the ground down toward the river's own profile inside a corridor, easing back to
 * natural terrain at the valley rim. Because the valley is part of the *natural* landscape rather than
 * a gameplay override, it is applied before settlement pads and before the road bed: a castle's pad
 * still wins over its valley, and a road still gets its cut-and-fill on whatever ground results.
 *
 * **Three rules that keep it safe.**
 *
 * 1. *It only ever cuts down.* The field returns `min(natural, valleyProfile)`, so carving can never
 *    raise ground and can never invent a hill the height field did not ask for.
 * 2. *It never breaches sea level on land.* The canonical coastline from map.png is the one thing this
 *    project does not move (ADR-0299 and every alignment check since). A valley deepening past sea
 *    level near the coast would punch new water into land the owner map calls dry, so the carve is
 *    clamped to stay above sea level wherever the natural ground was above it.
 * 3. *The floor descends monotonically.* The river's sampled profile is forced to a running minimum
 *    downstream, so a valley floor can never run back uphill — water does not, and a floor that did
 *    would read as a chain of basins rather than a valley.
 *
 * **Determinism.** The path comes from `rivers.js`'s existing seeded trace; everything here is a fixed
 * geometric transform of it. No `Math.random()`, no per-frame allocation.
 * @module world/terrainValleyCarving
 */

import { generateRiverPath, NAMED_RIVER_SEED_TAG } from './rivers.js';
import { allRiverHeadwaters } from './worldReferenceRivers.js';

export const TERRAIN_VALLEY_POLICY = Object.freeze({
	id: 'terrain-river-valley-carving-2026-08-20-v1',
	/** Half-width of the flat valley floor at the river's source, in metres. The floodplain a young
	 * stream occupies is narrow; it is the downstream widening below that does the visible work. */
	floorHalfWidthSourceMeters: 22,
	/** Half-width of the valley floor at the mouth. A mature river's floodplain is wide and flat. */
	floorHalfWidthMouthMeters: 90,
	/** Distance from the centreline at which the ground is fully natural again, at the source. */
	rimHalfWidthSourceMeters: 130,
	/** Same, at the mouth — the valley opens out as it descends. */
	rimHalfWidthMouthMeters: 420,
	/** How far below the water surface the valley floor is cut at the source. */
	depthSourceMeters: 6,
	/** ...and at the mouth. Deliberately modest: this is a lowland river valley, not a canyon, and
	 * every metre of carve is a metre of the owner map's height field being overridden. */
	depthMouthMeters: 26,
	/** Clearance kept above sea level wherever natural ground was dry, so carving can never turn
	 * canonical land into water. See rule 2 in this module's header. */
	minLandFreeboardMeters: 0.4,
	/** Spatial bucket size for the nearest-segment lookup. Must exceed `rimHalfWidthMouthMeters` so a
	 * query only ever inspects its own cell and the eight around it. */
	lookupCellMeters: 500,
});

function smoothstep(edge0, edge1, value) {
	if (value <= edge0) return 0;
	if (value >= edge1) return 1;
	const t = (value - edge0) / (edge1 - edge0);
	return t * t * (3 - 2 * t);
}

function segmentClosest(x, z, x0, z0, x1, z1) {
	const dx = x1 - x0;
	const dz = z1 - z0;
	const lengthSquared = dx * dx + dz * dz;
	if (lengthSquared === 0) return { distanceSquared: (x - x0) ** 2 + (z - z0) ** 2, t: 0 };
	let t = ((x - x0) * dx + (z - z0) * dz) / lengthSquared;
	t = t < 0 ? 0 : t > 1 ? 1 : t;
	const cx = x0 + dx * t;
	const cz = z0 + dz * t;
	return { distanceSquared: (x - cx) ** 2 + (z - cz) ** 2, t };
}

/**
 * Builds the valley field from an already-traced river polyline.
 *
 * @param {{x: number, y: number, z: number}[]} points River centreline, source first.
 * @param {number} seaLevelMeters
 * @returns {{sampleValleyHeight: (x: number, z: number, naturalHeightMeters: number) => number,
 *   segmentCount: number, maxDepthMeters: number}}
 */
export function buildRiverValleyField(points, seaLevelMeters) {
	const P = TERRAIN_VALLEY_POLICY;
	/** @type {{x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, s0: number, s1: number}[]} */
	const segments = [];
	if (!points || points.length < 2) {
		return { sampleValleyHeight: (x, z, natural) => natural, segmentCount: 0, maxDepthMeters: 0 };
	}

	// Running minimum downstream: the traced path can wobble upward by a few centimetres where the
	// sampler's noise beats its step size, and a valley floor that climbs would read as a bead of
	// basins rather than as a valley.
	const floorHeights = new Float64Array(points.length);
	let running = points[0].y;
	for (let i = 0; i < points.length; i += 1) {
		running = Math.min(running, points[i].y);
		floorHeights[i] = running;
	}

	// Normalised distance along the path, used to widen and deepen the valley downstream.
	const cumulative = new Float64Array(points.length);
	for (let i = 1; i < points.length; i += 1) {
		cumulative[i] = cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
	}
	const totalLength = cumulative[points.length - 1] || 1;

	for (let i = 1; i < points.length; i += 1) {
		segments.push({
			x0: points[i - 1].x, z0: points[i - 1].z, y0: floorHeights[i - 1], s0: cumulative[i - 1] / totalLength,
			x1: points[i].x, z1: points[i].z, y1: floorHeights[i], s1: cumulative[i] / totalLength,
		});
	}

	/** @type {Map<string, number[]>} */
	const buckets = new Map();
	const cellKey = (cx, cz) => `${cx},${cz}`;
	const reach = P.rimHalfWidthMouthMeters;
	segments.forEach((segment, index) => {
		const minX = Math.min(segment.x0, segment.x1) - reach;
		const maxX = Math.max(segment.x0, segment.x1) + reach;
		const minZ = Math.min(segment.z0, segment.z1) - reach;
		const maxZ = Math.max(segment.z0, segment.z1) + reach;
		for (let cz = Math.floor(minZ / P.lookupCellMeters); cz <= Math.floor(maxZ / P.lookupCellMeters); cz += 1) {
			for (let cx = Math.floor(minX / P.lookupCellMeters); cx <= Math.floor(maxX / P.lookupCellMeters); cx += 1) {
				const key = cellKey(cx, cz);
				const list = buckets.get(key);
				if (list) list.push(index);
				else buckets.set(key, [index]);
			}
		}
	});

	let maxDepthMeters = 0;

	function sampleValleyHeight(x, z, naturalHeightMeters) {
		const candidates = buckets.get(cellKey(Math.floor(x / P.lookupCellMeters), Math.floor(z / P.lookupCellMeters)));
		if (!candidates) return naturalHeightMeters;

		let bestDistanceSquared = Infinity;
		let bestFloor = 0;
		let bestAlong = 0;
		for (const index of candidates) {
			const segment = segments[index];
			const { distanceSquared, t } = segmentClosest(x, z, segment.x0, segment.z0, segment.x1, segment.z1);
			if (distanceSquared >= bestDistanceSquared) continue;
			bestDistanceSquared = distanceSquared;
			bestFloor = segment.y0 + (segment.y1 - segment.y0) * t;
			bestAlong = segment.s0 + (segment.s1 - segment.s0) * t;
		}

		// Valley geometry widens and deepens downstream.
		const floorHalfWidth = P.floorHalfWidthSourceMeters + (P.floorHalfWidthMouthMeters - P.floorHalfWidthSourceMeters) * bestAlong;
		const rimHalfWidth = P.rimHalfWidthSourceMeters + (P.rimHalfWidthMouthMeters - P.rimHalfWidthSourceMeters) * bestAlong;
		if (bestDistanceSquared >= rimHalfWidth * rimHalfWidth) return naturalHeightMeters;

		const distance = Math.sqrt(bestDistanceSquared);
		const depth = P.depthSourceMeters + (P.depthMouthMeters - P.depthSourceMeters) * bestAlong;
		const floorHeight = bestFloor - depth;
		// 0 on the valley floor, 1 at the rim.
		const rise = smoothstep(floorHalfWidth, rimHalfWidth, distance);
		const carved = floorHeight + (naturalHeightMeters - floorHeight) * rise;

		// Rule 1: only ever cut down.
		let result = Math.min(naturalHeightMeters, carved);
		// Rule 2: never turn canonical land into water.
		if (naturalHeightMeters > seaLevelMeters) {
			result = Math.max(result, seaLevelMeters + P.minLandFreeboardMeters);
		}
		const cut = naturalHeightMeters - result;
		if (cut > maxDepthMeters) maxDepthMeters = cut;
		return result;
	}

	return {
		sampleValleyHeight,
		segmentCount: segments.length,
		get maxDepthMeters() { return maxDepthMeters; },
	};
}

/**
 * The full two-phase build: trace the river over `baseSampleHeightMeters`, then return the valley that
 * river implies.
 *
 * Both `sceneManager.js` and the safety checks must go through this, so the ground the game renders and
 * the ground the gates score are the same ground.
 *
 * @param {object} options
 * @param {number} options.seed
 * @param {(x: number, z: number) => number} options.baseSampleHeightMeters Phase-1 field: settlement
 *   pads applied, no valley and no road bed yet.
 * @param {number} options.seaLevelMeters
 * @param {{id: string, name: string, x: number, z: number, searchRadiusMeters: number}[]} [options.headwaters]
 *   Named rivers to carve. **Defaults to the full map-read set** rather than to none, deliberately: a
 *   dozen check scripts build this field themselves to measure the world, and a default of `[]` would
 *   have let every one of them silently score a world with different rivers than the game renders. That
 *   exact class of bug — a check scoring something the game does not do — has cost this project several
 *   runs, so the safe value is the one that matches the game.
 * @returns {ReturnType<typeof buildRiverValleyField> & {riverPoints: {x: number, y: number, z: number}[]}}
 */
export function computeRiverValleys({ seed, baseSampleHeightMeters, seaLevelMeters, headwaters = allRiverHeadwaters() }) {
	// The historical unnamed river, traced from the highest ground near the origin. Its source search and
	// therefore its course are untouched, so every measurement calibrated against it still holds.
	const { points } = generateRiverPath({ seed, sampleHeightMeters: baseSampleHeightMeters, seaLevelMeters });
	const primaryField = buildRiverValleyField(points, seaLevelMeters);

	// Run 376 / ADR-0323 — the map's named rivers. Each is traced downhill from its own map-read
	// headwater, so its course is guaranteed to run downhill on the terrain this world actually has
	// rather than following a drawing that may disagree with it.
	const named = [];
	for (const headwater of headwaters) {
		const traced = generateRiverPath({
			seed: seed ^ NAMED_RIVER_SEED_TAG,
			sampleHeightMeters: baseSampleHeightMeters,
			seaLevelMeters,
			originX: headwater.x,
			originZ: headwater.z,
			searchRadiusMeters: headwater.searchRadiusMeters,
		});
		if (traced.points.length < 2) continue;
		named.push({
			id: headwater.id,
			name: headwater.name,
			points: traced.points,
			field: buildRiverValleyField(traced.points, seaLevelMeters),
		});
	}

	/**
	 * Every river cuts, in turn.
	 *
	 * `buildRiverValleyField`'s own contract is that it only ever lowers ground — it returns
	 * `min(natural, profile)` — so applying the fields one after another composes safely: the result is
	 * the deepest cut any single river makes there, and no river can raise what another lowered. That is
	 * also why the order does not matter.
	 */
	const sampleValleyHeight = (x, z, naturalHeight) => {
		let height = primaryField.sampleValleyHeight(x, z, naturalHeight);
		for (const river of named) height = river.field.sampleValleyHeight(x, z, height);
		return height;
	};

	return {
		...primaryField,
		sampleValleyHeight,
		riverPoints: points,
		namedRivers: named.map(({ id, name, points: riverPoints }) => ({ id, name, points: riverPoints })),
	};
}
