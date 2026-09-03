/**
 * Bounded valley field derived from already-accepted named-river courses.
 *
 * The field is deliberately independent from terrain sampling/build order. It receives river
 * polylines and exposes `sampleValleyHeight(x,z,naturalHeight)`. `terrain.js` may compose that field
 * before settlement/foundation pads, preserving the standing rule that authored gameplay foundations
 * win over natural landscape processes.
 *
 * Safety invariants:
 * - never raises terrain;
 * - never carves canonical dry terrain below sea level + a small freeboard;
 * - broadens/deepens downstream rather than stamping a constant-width trench;
 * - uses the exact same course that the water ribbon renders.
 *
 * @module world/terrainNamedRiverValleys
 */

export const NAMED_RIVER_VALLEY_POLICY = Object.freeze({
	id: 'terrain-named-river-valleys-2026-08-31-v1',
	courseAuthority: 'namedRiverRuntime.traceNamedRiverNetwork',
	terrainHeightAuthorityUnchangedUntilComposed: true,
	onlyCutsDown: true,
	canonicalDryLandPreserved: true,
	floorHalfWidthSourceMeters: 18,
	floorHalfWidthMouthMeters: 76,
	rimHalfWidthSourceMeters: 115,
	rimHalfWidthMouthMeters: 360,
	depthSourceMeters: 4.5,
	depthMouthMeters: 21,
	minLandFreeboardMeters: 0.45,
	lookupCellMeters: 450,
});

function smoothstep(edge0, edge1, value) {
	if (value <= edge0) return 0;
	if (value >= edge1) return 1;
	const t = (value - edge0) / (edge1 - edge0);
	return t * t * (3 - 2 * t);
}

function closestOnSegment(x, z, segment) {
	const dx = segment.x1 - segment.x0;
	const dz = segment.z1 - segment.z0;
	const lengthSquared = dx * dx + dz * dz;
	if (lengthSquared <= 1e-12) {
		return { t: 0, distanceSquared: (x - segment.x0) ** 2 + (z - segment.z0) ** 2 };
	}
	const t = Math.max(0, Math.min(1, ((x - segment.x0) * dx + (z - segment.z0) * dz) / lengthSquared));
	const px = segment.x0 + dx * t;
	const pz = segment.z0 + dz * t;
	return { t, distanceSquared: (x - px) ** 2 + (z - pz) ** 2 };
}

function buildCourseSegments(points) {
	if (!Array.isArray(points) || points.length < 2) return [];
	const cumulative = new Float64Array(points.length);
	const floor = new Float64Array(points.length);
	let runningFloor = points[0].y;
	floor[0] = runningFloor;
	for (let index = 1; index < points.length; index += 1) {
		cumulative[index] = cumulative[index - 1]
			+ Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
		runningFloor = Math.min(runningFloor, points[index].y);
		floor[index] = runningFloor;
	}
	const totalLength = cumulative[cumulative.length - 1] || 1;
	const segments = [];
	for (let index = 1; index < points.length; index += 1) {
		segments.push(Object.freeze({
			x0: points[index - 1].x,
			z0: points[index - 1].z,
			y0: floor[index - 1],
			s0: cumulative[index - 1] / totalLength,
			x1: points[index].x,
			z1: points[index].z,
			y1: floor[index],
			s1: cumulative[index] / totalLength,
		}));
	}
	return segments;
}

/** Build one spatially-indexed valley field from a set of useful named-river courses. */
export function buildNamedRiverValleyField(network, seaLevelMeters) {
	if (!Number.isFinite(seaLevelMeters)) throw new TypeError('seaLevelMeters must be finite');
	const P = NAMED_RIVER_VALLEY_POLICY;
	const segments = [];
	for (const river of network?.usefulRivers ?? []) {
		for (const segment of buildCourseSegments(river.points)) segments.push({ ...segment, riverId: river.id });
	}

	if (segments.length === 0) {
		return Object.freeze({
			policyId: P.id,
			segmentCount: 0,
			riverCount: 0,
			sampleValleyHeight: (_x, _z, naturalHeightMeters) => naturalHeightMeters,
			diagnostics: () => Object.freeze({ queryCount: 0, affectedQueryCount: 0, maxCutMeters: 0 }),
		});
	}

	const buckets = new Map();
	const keyFor = (cx, cz) => `${cx},${cz}`;
	const reach = P.rimHalfWidthMouthMeters;
	segments.forEach((segment, index) => {
		const minX = Math.min(segment.x0, segment.x1) - reach;
		const maxX = Math.max(segment.x0, segment.x1) + reach;
		const minZ = Math.min(segment.z0, segment.z1) - reach;
		const maxZ = Math.max(segment.z0, segment.z1) + reach;
		for (let cz = Math.floor(minZ / P.lookupCellMeters); cz <= Math.floor(maxZ / P.lookupCellMeters); cz += 1) {
			for (let cx = Math.floor(minX / P.lookupCellMeters); cx <= Math.floor(maxX / P.lookupCellMeters); cx += 1) {
				const key = keyFor(cx, cz);
				const list = buckets.get(key);
				if (list) list.push(index);
				else buckets.set(key, [index]);
			}
		}
	});

	let queryCount = 0;
	let affectedQueryCount = 0;
	let maxCutMeters = 0;

	function sampleValleyHeight(x, z, naturalHeightMeters) {
		queryCount += 1;
		const candidates = buckets.get(keyFor(Math.floor(x / P.lookupCellMeters), Math.floor(z / P.lookupCellMeters)));
		if (!candidates) return naturalHeightMeters;

		let strongestCutMeters = 0;
		for (const index of candidates) {
			const segment = segments[index];
			const closest = closestOnSegment(x, z, segment);
			const along = segment.s0 + (segment.s1 - segment.s0) * closest.t;
			const floorHalfWidth = P.floorHalfWidthSourceMeters
				+ (P.floorHalfWidthMouthMeters - P.floorHalfWidthSourceMeters) * along;
			const rimHalfWidth = P.rimHalfWidthSourceMeters
				+ (P.rimHalfWidthMouthMeters - P.rimHalfWidthSourceMeters) * along;
			if (closest.distanceSquared >= rimHalfWidth * rimHalfWidth) continue;
			const distance = Math.sqrt(closest.distanceSquared);
			const riverFloor = segment.y0 + (segment.y1 - segment.y0) * closest.t;
			const depth = P.depthSourceMeters + (P.depthMouthMeters - P.depthSourceMeters) * along;
			const floorHeight = riverFloor - depth;
			const rimBlend = smoothstep(floorHalfWidth, rimHalfWidth, distance);
			const desiredHeight = floorHeight + (naturalHeightMeters - floorHeight) * rimBlend;
			const boundedDesired = naturalHeightMeters > seaLevelMeters
				? Math.max(desiredHeight, seaLevelMeters + P.minLandFreeboardMeters)
				: desiredHeight;
			strongestCutMeters = Math.max(strongestCutMeters, Math.max(0, naturalHeightMeters - boundedDesired));
		}
		if (strongestCutMeters <= 0) return naturalHeightMeters;
		affectedQueryCount += 1;
		maxCutMeters = Math.max(maxCutMeters, strongestCutMeters);
		return naturalHeightMeters - strongestCutMeters;
	}

	return Object.freeze({
		policyId: P.id,
		segmentCount: segments.length,
		riverCount: new Set(segments.map((segment) => segment.riverId)).size,
		sampleValleyHeight,
		diagnostics: () => Object.freeze({ queryCount, affectedQueryCount, maxCutMeters }),
	});
}
