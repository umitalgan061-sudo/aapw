/**
 * Starts each river at its spring line rather than on the summit its trace began from.
 *
 * **The defect.** `rivers.js`'s source search picks "the highest sampled point within
 * `searchRadiusMeters` of the origin", so by construction every course begins on a local peak. Run 444
 * measured what that costs: at station 0.05 the ground 200 m either side of the water sits a median
 * 46.0 m *below* the water line (p90 143.4 m, max 193.0 m — The White Knife springs at 283.8 m with
 * land 200 m away at 90.8 m). By station 0.30 the same figure is -2.1 m, i.e. the land has risen above
 * the water and the river is properly in a valley. So this is a headwater-placement defect, not a
 * valley-width one, and run 446 photographed it: `artifacts/river-source/the-white-knife-from-head.png`
 * shows a full-width river materialising on an open snowfield with the land falling away on every side.
 *
 * **Why trimming the drawn ribbon is the right fix and not a cosmetic dodge.** The alternative is to
 * re-seed the trace at a local low point, which is more principled but moves every course, and with it
 * the carve, the ground under the carve (GOVERNANCE §8.4), and run 441's eight bridges. Trimming has a
 * physical reading instead of merely hiding the problem: a river does not begin where its catchment
 * begins, it begins at the spring line partway down, and the dry channel above that is a real landform.
 * The carve stays on the full course, so what is left above the new head is a shallow gully running off
 * the summit — which is what the render shows the carve already looks like there.
 *
 * **Trimming the surface array is identical to trimming the course and rebuilding it.**
 * `buildRiverSurface` sweeps upstream from the mouth as `surface = max(surfaceDownstream, bed + freeboard)`,
 * so every retained point's height depends only on points *downstream* of it. Dropping head points
 * therefore cannot move the water anywhere it is kept, and the ponding behaviour is preserved exactly.
 */

/**
 * Measured constants. Every one of them is a run-444 number, not a taste call.
 */
export const RIVER_HEADWATER_SPRING_POLICY = Object.freeze({
	/**
	 * Distance either side of the course, in metres, at which "is this river in a valley?" is asked.
	 * 200 m is the offset run 444 measured the perch at, and the one at which the healthy middle
	 * stations already read as valleys.
	 */
	perchProbeMeters: 200,
	/**
	 * How far the water line may sit above the land at that distance and still count as seated, in
	 * metres. Stations 0.30 and 0.50 measured -2.1 m and -1.1 m, so ±2 m is the natural spread of a
	 * reach nobody has ever complained about; anything looser would keep tens of metres of perch.
	 */
	acceptablePerchMeters: 2,
	/**
	 * Ceiling on the trim, as a share of the course's own length. The eight rivers that clear do so
	 * between 80 m and 320 m of arc; Green Fork and Red Fork never clear within 40% of their length, and
	 * for those the cap is what stops a headwater fix from eating a quarter of the river.
	 */
	maximumTrimShareOfCourse: 0.25,
	/** Absolute ceiling on the trim, in metres — 400 m clears all eight and bounds the other two. */
	maximumTrimMeters: 400,
	/** Never trim a course below this many surface points; a two-point ribbon is not a river. */
	minimumRetainedPoints: 24,
});

/**
 * How far the water line at `index` stands above the lower of the two banks probed
 * `perchProbeMeters` out. Positive means perched — the land falls away from the river on at least one
 * side. Negative means seated: the land rises above the water on both sides, which is a valley.
 *
 * The lower bank is the one that decides, because a river only reads as being in a valley when the
 * ground comes back up on *both* sides of it.
 *
 * @param {{x: number, y: number, z: number}[]} points
 * @param {number} index
 * @param {(x: number, z: number) => number} sampleHeightMeters
 * @returns {number} Metres of perch.
 */
function perchMetersAt(points, index, sampleHeightMeters) {
	const point = points[index];
	const previous = points[Math.max(0, index - 1)];
	const next = points[Math.min(points.length - 1, index + 1)];
	const tangentX = next.x - previous.x;
	const tangentZ = next.z - previous.z;
	const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
	// Perpendicular to the flow in the XZ plane — the same construction `createRiverMesh` ribbons with.
	const reach = RIVER_HEADWATER_SPRING_POLICY.perchProbeMeters;
	const acrossX = (-tangentZ / tangentLength) * reach;
	const acrossZ = (tangentX / tangentLength) * reach;
	const left = sampleHeightMeters(point.x + acrossX, point.z + acrossZ);
	const right = sampleHeightMeters(point.x - acrossX, point.z - acrossZ);
	return point.y - Math.min(left, right);
}

/**
 * Drops the perched head of a water surface so the river emerges at its spring line.
 *
 * Pure and deterministic: the same points and the same height field always yield the same cut, which is
 * what lets the drawn ribbon and `sceneManager.js`'s crossing courses stay in step without either of
 * them knowing about the other (GOVERNANCE §8.9).
 *
 * Walks downstream from the source, stopping at the first point that is seated within
 * `acceptablePerchMeters`. If no point inside the trim budget is seated — Green Fork and Red Fork —
 * it falls back to the least-perched point found, which always improves the head and never exceeds the
 * cap. If even that is the source itself, the course is returned untouched.
 *
 * @param {{x: number, y: number, z: number}[]} surfacePoints Dense surface, source first.
 * @param {(x: number, z: number) => number} sampleHeightMeters The **final** ground field.
 * @returns {{x: number, y: number, z: number}[]} The same array, or a suffix of it.
 */
export function trimHeadwaterPerch(surfacePoints, sampleHeightMeters) {
	const policy = RIVER_HEADWATER_SPRING_POLICY;
	if (typeof sampleHeightMeters !== 'function') return surfacePoints;
	if (!Array.isArray(surfacePoints)) return surfacePoints;
	const lastSearchable = surfacePoints.length - policy.minimumRetainedPoints;
	if (lastSearchable <= 0) return surfacePoints;

	let courseMeters = 0;
	for (let i = 1; i < surfacePoints.length; i += 1) {
		courseMeters += Math.hypot(
			surfacePoints[i].x - surfacePoints[i - 1].x,
			surfacePoints[i].z - surfacePoints[i - 1].z,
		);
	}
	const budgetMeters = Math.min(policy.maximumTrimMeters, courseMeters * policy.maximumTrimShareOfCourse);
	if (!(budgetMeters > 0)) return surfacePoints;

	let arcMeters = 0;
	let bestIndex = 0;
	let bestPerchMeters = Infinity;
	for (let index = 0; index < lastSearchable; index += 1) {
		if (index > 0) {
			arcMeters += Math.hypot(
				surfacePoints[index].x - surfacePoints[index - 1].x,
				surfacePoints[index].z - surfacePoints[index - 1].z,
			);
			if (arcMeters > budgetMeters) break;
		}
		const perchMeters = perchMetersAt(surfacePoints, index, sampleHeightMeters);
		if (perchMeters <= policy.acceptablePerchMeters) {
			return index === 0 ? surfacePoints : surfacePoints.slice(index);
		}
		if (perchMeters < bestPerchMeters) {
			bestPerchMeters = perchMeters;
			bestIndex = index;
		}
	}
	return bestIndex === 0 ? surfacePoints : surfacePoints.slice(bestIndex);
}
