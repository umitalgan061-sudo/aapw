/**
 * Forest scatter — where the woods actually are.
 *
 * **The defect.** `world/terrainBiomeShading.js` has painted ground forest-green inside a deterministic
 * patch mask since run 351, while `world/vegetation.js` scattered trees uniformly across the whole
 * world at `TARGET_DENSITY_PER_KM2` = 30/km². Thirty trees per square kilometre is open steppe — about
 * one tree every 180 m — so the world had forest-coloured ground with no forest on it, and the two
 * systems had no relationship at all. The owner's ask is the plain reading of the map: land that is
 * not a village or a kingdom seat should be woodland, the way map.png draws it.
 *
 * **The other half of the defect, which measurement found.** The shading mask was itself returning ~0
 * across the interior, because its tree line sat at 170-330 m — values authored before ADR-0299's
 * continental uplift raised inland ground from a ~5 m median to hundreds of metres. The numbers never
 * drifted; the ground moved out from under them. That is fixed in the shading policy, and this module
 * then reads the corrected mask.
 *
 * **The rule this module implements.** One authority decides what is forest —
 * `terrainBiomeShading.js`'s `forestCoverage01` — and both the ground colour and these trees obey it,
 * so woodland colour and actual woodland cannot disagree again. Density scales with coverage, so a
 * patch edge thins out into scrub instead of ending at a line.
 *
 * **What stays clear.** Kingdom seats and roads are already excluded by `vegetation.js`'s own
 * `isPlaceablePosition`. Villages are excluded here, which is why `sceneManager.js` now builds
 * villages before vegetation — a forest growing through someone's houses is exactly what the owner
 * asked not to have.
 *
 * **Determinism.** Its own XOR-tagged `mulberry32` stream, so adding this pass cannot perturb the
 * draw order of the base or cluster passes and their historical scatter stays bit-for-bit reproducible.
 * @module world/vegetationForestScatter
 */

import { forestCoverage01 } from './terrainBiomeShading.js';

export const FOREST_SCATTER_POLICY = Object.freeze({
	id: 'forest-scatter-2026-08-19-v1',
	/**
	 * Trees per km² where `forestCoverage01` is 1.
	 *
	 * Real temperate woodland runs to hundreds of stems per hectare, i.e. tens of thousands per km² —
	 * far past what this renderer should draw. 620 is a *visual* density: enough that a forest reads as
	 * a forest from a hillside and closes in around the player at ground level, while the whole world's
	 * scatter stays inside the instanced-draw budget the perf snapshot already tracks. It is a
	 * first-pass value in the same "no real playtest yet" category as `TARGET_DENSITY_PER_KM2` itself.
	 */
	densityPerKm2: 620,
	/** Coverage below this is treated as open ground — stops a vast thin haze of stray trees across
	 * land the mask considers unwooded, which would read as neglect rather than as pasture. */
	minimumCoverage: 0.22,
	/** Cleared radius around a village house, in metres. Wide enough for the house, its steps and the
	 * bit of worked ground a household would actually keep clear. */
	villageClearanceMeters: 34,
	/** Slope sampling offset for the coverage query, in metres. The mask excludes cliffs, so it needs a
	 * slope, and this must be small enough to read local steepness rather than regional tilt. */
	slopeSampleOffsetMeters: 3,
});

/**
 * Local ground slope in degrees, by central difference — the same estimator
 * `scripts/terrainSeatSafetyCheck.js` uses, so "too steep for trees" means what it means elsewhere.
 */
function slopeDegreesAt(x, z, sampleHeightMeters, offset) {
	const slopeX = (sampleHeightMeters(x + offset, z) - sampleHeightMeters(x - offset, z)) / (2 * offset);
	const slopeZ = (sampleHeightMeters(x, z + offset) - sampleHeightMeters(x, z - offset)) / (2 * offset);
	return (Math.atan(Math.hypot(slopeX, slopeZ)) * 180) / Math.PI;
}

/**
 * Generates forest tree positions over the scatter disc.
 *
 * Uses rejection sampling against `forestCoverage01`: a candidate is kept with probability equal to
 * local coverage, which makes density track the mask continuously rather than stamping hard-edged
 * blobs. The candidate count is set from the disc area at full density, so the *placed* count comes
 * out proportional to how much of the disc is genuinely wooded.
 *
 * @param {object} options
 * @param {number} options.radiusMeters Scatter disc radius, matching the vegetation pass.
 * @param {(x: number, z: number) => number} options.sampleHeightMeters
 * @param {number} options.seaLevelMeters
 * @param {(x: number, z: number) => boolean} options.isPlaceable `vegetation.js`'s own seat/road/water
 *   rule, passed in so this module never re-implements — or drifts from — those exclusions.
 * @param {() => number} options.rng Seeded stream owned by the caller.
 * @param {{x: number, z: number}[]} [options.villageHouses] House positions to keep clear.
 * @returns {{x: number, z: number}[]}
 */
export function generateForestPositions({
	radiusMeters, sampleHeightMeters, seaLevelMeters, isPlaceable, rng, villageHouses = [],
}) {
	const { densityPerKm2, minimumCoverage, villageClearanceMeters, slopeSampleOffsetMeters } = FOREST_SCATTER_POLICY;
	const areaKm2 = (Math.PI * radiusMeters * radiusMeters) / 1_000_000;
	const candidateCount = Math.max(0, Math.round(areaKm2 * densityPerKm2));
	const clearanceSquared = villageClearanceMeters * villageClearanceMeters;
	const positions = [];

	for (let candidate = 0; candidate < candidateCount; candidate += 1) {
		// Uniform-disc sampling (r = R*sqrt(u)), same as the base pass — polar-uniform radius would
		// crowd the middle of the world with trees for no reason but the maths.
		const angle = rng() * Math.PI * 2;
		const radius = radiusMeters * Math.sqrt(rng());
		const x = Math.cos(angle) * radius;
		const z = Math.sin(angle) * radius;

		const height = sampleHeightMeters(x, z);
		if (height <= seaLevelMeters) continue;
		const coverage = forestCoverage01(
			x, z, height - seaLevelMeters, slopeDegreesAt(x, z, sampleHeightMeters, slopeSampleOffsetMeters),
		);
		if (coverage < minimumCoverage) continue;
		// Density tracks coverage, so a patch fades into scrub at its edge rather than stopping dead.
		if (rng() > coverage) continue;
		if (!isPlaceable(x, z)) continue;

		let insideVillage = false;
		for (const house of villageHouses) {
			if ((x - house.x) ** 2 + (z - house.z) ** 2 < clearanceSquared) {
				insideVillage = true;
				break;
			}
		}
		if (insideVillage) continue;

		positions.push({ x, z });
	}
	return positions;
}
