/**
 * Road corridor cut-and-fill — the reason terrain can finally be rough at player scale.
 *
 * **The problem this solves.** ADR-0303 measured why fine ground relief could not be added: moving the
 * `roughness` layer's wavelength from 45 m to 39 m alone pushed road grade 19.4 -> 24.3 deg, while
 * cutting that same layer's amplitude from 7.5 m to 3.0 m moved it only 25.2 -> 24.3 deg. What trips
 * `scripts/roadNetworkSafetyCheck.js` is wavelength, not steepness, because `world/roadPathfinder.js`
 * samples on a 60 m grid: terrain whose wavelength approaches that spacing produces large
 * neighbour-to-neighbour height differences and gets scored as a cliff. The gate was measuring
 * sampling aliasing, and it was the binding constraint on how detailed the world could look.
 *
 * **Why cut-and-fill rather than relaxing the gate.** Widening the grade baseline would have made the
 * number look better without changing the ground — the road would still physically ride over every
 * bump. Real roads are not laid on raw terrain; they are cut into it and filled over it, which is
 * exactly why a cart can cross country a walker finds lumpy. Building that is the honest fix, and it
 * keeps the 20 deg ceiling meaning what it has always meant. The owner chose this option (S-0035).
 *
 * **How it works — the same two-phase pattern settlements already use.** `world/settlements.js`
 * computes its flatten pads against a throwaway *base* sampler and then threads them into the real
 * one; roads do the same. Phase 1 routes every cart edge over terrain that already carries settlement
 * pads. Phase 2 takes each routed polyline, smooths its height profile along its own length, and hands
 * back a field that pulls terrain toward that smoothed profile inside a narrow corridor. The road then
 * runs on ground that rises and falls with the landscape but no longer carries the short-wavelength
 * noise the surrounding country keeps.
 *
 * Endpoints are pinned: a road has to still meet its castle at the height the castle's own flatten pad
 * put it, so smoothing is not allowed to drift the last point.
 *
 * **Determinism.** Routing is the existing seeded A*; smoothing is a fixed-width moving average. No
 * `Math.random()`, no per-frame allocation — the corridor is built once at boot and then only read.
 * @module world/roadCorridorSmoothing
 */

import { computeSeatMST } from './roads.js';
import { findSlopeAwarePath } from './roadPathfinder.js';

export const ROAD_CORRIDOR_POLICY = Object.freeze({
	id: 'road-corridor-cut-and-fill-2026-08-19-v1',
	/** Inside this half-width the ground *is* the road profile — the cut-and-fill bed itself. Slightly
	 * wider than `roads.js`'s 8 m ribbon so the ribbon never overhangs its own bed. */
	fullHalfWidthMeters: 7,
	/** Beyond `fullHalfWidthMeters` the bed blends back to natural terrain by here, so a road reads as
	 * cut into the hillside rather than as a flat ribbon floating on it. Kept deliberately tight: this
	 * is the only place in the world where terrain is overridden for gameplay reasons, and every metre
	 * of it is a metre of the owner's landscape that is not doing what the height field says. */
	fadeHalfWidthMeters: 22,
	/**
	 * Spacing at which the routed polyline is re-sampled before its profile is filtered.
	 *
	 * **This is the whole trick.** `roadPathfinder.js` emits points one `GRID_CELL_METERS` (60 m)
	 * apart, and terrain roughness lives near 39 m — so those points are *already aliased*, and
	 * averaging aliased samples cannot recover the underlying profile (measured: a +/-2-point average
	 * still left the stress route at 22.0 deg). Re-sampling the ground every 8 m first, and filtering
	 * that, low-passes the real signal instead of a corrupted one.
	 */
	resampleSpacingMeters: 8,
	/** Half-width of the moving-average low-pass over the re-sampled profile. 70 m comfortably spans
	 * the 39 m roughness band while leaving genuine landform — a road still climbs the hill, it just
	 * stops treating every ripple on the way up as its own pitch. */
	profileLowPassMeters: 70,
	smoothingPasses: 2,
	/** Spatial bucket size for corridor lookup. Must exceed `fadeHalfWidthMeters` so a query only ever
	 * has to inspect its own cell and the eight around it. */
	lookupCellMeters: 120,
});

function smoothstep(edge0, edge1, value) {
	if (value <= edge0) return 0;
	if (value >= edge1) return 1;
	const t = (value - edge0) / (edge1 - edge0);
	return t * t * (3 - 2 * t);
}

/**
 * Re-samples one routed polyline densely, then low-passes its height profile along its own length.
 *
 * Endpoints are pinned: a road must still meet its castle at the height the castle's own settlement
 * flatten pad established, and letting the filter drift the last sample would reopen the very seam
 * this module exists to close.
 *
 * @param {{x: number, y: number, z: number}[]} points Routed polyline.
 * @param {(x: number, z: number) => number} sampleHeightMeters Phase-1 (pads, no bed) terrain.
 * @returns {{x: number, z: number, y: number}[]} Dense bed samples carrying the filtered profile.
 */
function buildFilteredBed(points, sampleHeightMeters) {
	const { resampleSpacingMeters, profileLowPassMeters, smoothingPasses } = ROAD_CORRIDOR_POLICY;

	// Walk the polyline at a fixed spacing so the profile is a uniformly sampled signal — a prerequisite
	// for the moving average below to be a real low-pass rather than an arbitrary weighting.
	const dense = [];
	for (let i = 1; i < points.length; i += 1) {
		const previous = points[i - 1];
		const current = points[i];
		const spanMeters = Math.hypot(current.x - previous.x, current.z - previous.z);
		const steps = Math.max(1, Math.round(spanMeters / resampleSpacingMeters));
		for (let step = 0; step < steps; step += 1) {
			const t = step / steps;
			const x = previous.x + (current.x - previous.x) * t;
			const z = previous.z + (current.z - previous.z) * t;
			dense.push({ x, z, y: sampleHeightMeters(x, z) });
		}
	}
	const last = points[points.length - 1];
	dense.push({ x: last.x, z: last.z, y: sampleHeightMeters(last.x, last.z) });

	const radius = Math.max(1, Math.round(profileLowPassMeters / resampleSpacingMeters));
	const raw = Float64Array.from(dense, (sample) => sample.y);
	let heights = Float64Array.from(raw);
	for (let pass = 0; pass < smoothingPasses; pass += 1) {
		const next = new Float64Array(heights.length);
		for (let i = 0; i < heights.length; i += 1) {
			let total = 0;
			let count = 0;
			for (let offset = -radius; offset <= radius; offset += 1) {
				const index = i + offset;
				if (index < 0 || index >= heights.length) continue;
				total += heights[index];
				count += 1;
			}
			next[i] = total / count;
		}
		heights = next;
	}

	// Endpoint reconciliation. The filter runs *unpinned* above and the ends are corrected afterwards
	// with a linearly decaying offset, rather than being clamped to the raw height in the loop.
	// Hard-pinning was tried first and measured badly (a stress route graded 57.1 deg): a pinned end
	// sits beside a heavily averaged neighbour 8 m away, so the pin itself becomes a cliff. Fading the
	// correction over the filter's own width lands the road exactly on its castle pad while keeping the
	// profile continuous.
	const lastIndex = heights.length - 1;
	const rampSamples = Math.min(radius * 2, Math.floor(heights.length / 2));
	if (rampSamples > 0) {
		const startResidual = raw[0] - heights[0];
		const endResidual = raw[lastIndex] - heights[lastIndex];
		for (let i = 0; i < rampSamples; i += 1) {
			const weight = 1 - i / rampSamples;
			heights[i] += startResidual * weight;
			heights[lastIndex - i] += endResidual * weight;
		}
	}
	heights[0] = raw[0];
	heights[lastIndex] = raw[lastIndex];
	return dense.map((sample, i) => ({ x: sample.x, z: sample.z, y: heights[i] }));
}

/**
 * Squared distance from a point to a segment, plus the parameter of the closest point along it.
 */
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
 * Builds the corridor field from already-routed road edges.
 *
 * @param {{points: {x: number, y: number, z: number}[]}[]} edges Routed cart-road edges.
 * @returns {{sampleCorridorHeight: (x: number, z: number, baseHeightMeters: number) => number,
 *   segmentCount: number, smoothedEdges: {points: {x: number, y: number, z: number}[]}[]}}
 *   `smoothedEdges` carries each polyline re-projected onto its own smoothed profile, so the road mesh
 *   is built on exactly the bed the terrain now provides rather than on the pre-smoothing heights.
 */
export function buildRoadCorridor(edges, { sampleHeightMeters }) {
	const { fadeHalfWidthMeters, lookupCellMeters, fullHalfWidthMeters } = ROAD_CORRIDOR_POLICY;
	/** @type {{x0: number, z0: number, x1: number, z1: number, y0: number, y1: number}[]} */
	const segments = [];
	const smoothedEdges = [];

	for (const edge of edges) {
		const points = edge.points;
		if (!points || points.length < 2) continue;
		const bed = buildFilteredBed(points, sampleHeightMeters);
		smoothedEdges.push({ ...edge, points: bed.map((sample) => ({ x: sample.x, y: sample.y, z: sample.z })) });
		for (let i = 1; i < bed.length; i += 1) {
			segments.push({
				x0: bed[i - 1].x, z0: bed[i - 1].z, y0: bed[i - 1].y,
				x1: bed[i].x, z1: bed[i].z, y1: bed[i].y,
			});
		}
	}

	// Bucket every segment into each lookup cell its fade envelope can reach, so a query inspects one
	// cell rather than all ~300 segments.
	/** @type {Map<string, number[]>} */
	const buckets = new Map();
	const cellKey = (cx, cz) => `${cx},${cz}`;
	segments.forEach((segment, index) => {
		const minX = Math.min(segment.x0, segment.x1) - fadeHalfWidthMeters;
		const maxX = Math.max(segment.x0, segment.x1) + fadeHalfWidthMeters;
		const minZ = Math.min(segment.z0, segment.z1) - fadeHalfWidthMeters;
		const maxZ = Math.max(segment.z0, segment.z1) + fadeHalfWidthMeters;
		for (let cz = Math.floor(minZ / lookupCellMeters); cz <= Math.floor(maxZ / lookupCellMeters); cz += 1) {
			for (let cx = Math.floor(minX / lookupCellMeters); cx <= Math.floor(maxX / lookupCellMeters); cx += 1) {
				const key = cellKey(cx, cz);
				const list = buckets.get(key);
				if (list) list.push(index);
				else buckets.set(key, [index]);
			}
		}
	});

	const fadeSquared = fadeHalfWidthMeters * fadeHalfWidthMeters;

	function sampleCorridorHeight(x, z, baseHeightMeters) {
		const candidates = buckets.get(cellKey(Math.floor(x / lookupCellMeters), Math.floor(z / lookupCellMeters)));
		if (!candidates) return baseHeightMeters;
		// **The bed is a weighted blend of every segment in range, not the nearest one.**
		//
		// Taking only the nearest segment's height puts a **vertical step of zero width** into the terrain
		// wherever two segments are equidistant — which is precisely what a road junction is, and what
		// happens anywhere two edges of the network run near each other. Crossing that bisector switches
		// `bestHeight` from one segment's bed to the other's in a single sample. Measured at a fork near
		// (-5086, -629): ground 7.437 m at one point and 9.113 m a millimetre away, a 1.68 m cliff a
		// player would meet as an invisible wall or a fall, with the road surface stranded above it.
		//
		// It was found from the other end: a road vertex looked like it floated 2.08 m, and the road
		// turned out to be correctly grounded — on the far side of a step in the ground beneath it. The
		// height layers were bisected one at a time (raw, pads, valleys, corridor) and only the corridor
		// moved.
		//
		// Weighting each segment by its own fade falloff makes the bed continuous by construction: a
		// segment's contribution reaches zero exactly as it leaves range, so segments can enter and leave
		// the blend without the sum jumping. Squaring the weight keeps the nearest segment dominant, so a
		// straight run of road is bedded as tightly as before and only junctions change.
		let nearestSquared = fadeSquared;
		let heightSum = 0;
		let weightSum = 0;
		for (const index of candidates) {
			const segment = segments[index];
			const { distanceSquared, t } = segmentClosest(x, z, segment.x0, segment.z0, segment.x1, segment.z1);
			if (distanceSquared >= fadeSquared) continue;
			const falloff = 1 - smoothstep(fullHalfWidthMeters, fadeHalfWidthMeters, Math.sqrt(distanceSquared));
			if (falloff <= 0) continue;
			const segmentHeight = segment.y0 + (segment.y1 - segment.y0) * t;
			const weight = falloff * falloff;
			heightSum += segmentHeight * weight;
			weightSum += weight;
			if (distanceSquared < nearestSquared) nearestSquared = distanceSquared;
		}
		if (weightSum <= 0) return baseHeightMeters;
		const bedHeight = heightSum / weightSum;
		// 1 inside the bed, easing to 0 at the fade edge.
		const weight = 1 - smoothstep(fullHalfWidthMeters, fadeHalfWidthMeters, Math.sqrt(nearestSquared));
		return baseHeightMeters + (bedHeight - baseHeightMeters) * weight;
	}

	return { sampleCorridorHeight, segmentCount: segments.length, smoothedEdges };
}

/**
 * The full two-phase build: route cart roads over `baseSampleHeightMeters`, then return the corridor
 * those routes imply.
 *
 * Both `sceneManager.js` and `scripts/roadNetworkSafetyCheck.js` must go through this, so the terrain
 * the game renders and the terrain the gate scores are the same terrain.
 *
 * @param {object} options
 * @param {{id: string, x: number, z: number}[]} options.seats
 * @param {(x: number, z: number) => number} options.baseSampleHeightMeters Settlement-flattened, but
 *   without any road corridor — the phase-1 field.
 * @returns {ReturnType<typeof buildRoadCorridor>}
 */
export function computeRoadCorridor({ seats, baseSampleHeightMeters, extraRoutes = [] }) {
	const previewEdges = computeSeatMST(seats).map((edgeSpec) => {
		const from = seats.find((seat) => seat.id === edgeSpec.fromId);
		const to = seats.find((seat) => seat.id === edgeSpec.toId);
		if (!from || !to) return null;
		const { points } = findSlopeAwarePath({
			sampleHeightMeters: baseSampleHeightMeters,
			start: { x: from.x, z: from.z },
			end: { x: to.x, z: to.z },
		});
		return { fromId: edgeSpec.fromId, toId: edgeSpec.toId, points };
	}).filter(Boolean);
	// `extraRoutes` carries the owner map's canonical highways (ADR-0308). They are already routed, so
	// they skip phase 1 and go straight into the bed — every road in this world gets cut-and-fill, not
	// just the seat network.
	return buildRoadCorridor([...previewEdges, ...extraRoutes], { sampleHeightMeters: baseSampleHeightMeters });
}
