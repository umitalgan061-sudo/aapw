/**
 * Resampling for river ribbons (run 390).
 *
 * A traced river course steps ~60m at a time, which is fine for the *course* but far too coarse for
 * the *ribbon* drawn along it: a flat quad spanning 60m cuts straight through whatever the ground
 * does between its two ends, so the river surfaced only where a whole span happened to be even and
 * rendered as a row of disconnected shards. Resampling to the terrain's own relief scale is what
 * lets the ribbon hug the ground instead of intersecting it.
 *
 * The course itself is never altered — points are interpolated along the existing polyline and then
 * re-grounded — so anything calibrated against the original course still sees it. In particular
 * waterfall detection (DECISIONS.md ADR-0011) is run on the traced points, not on these.
 * @module world/riverRibbonPath
 */

/** Longest ribbon quad, in meters. Below the terrain's fine-noise relief scale. */
export const RIVER_RIBBON_STEP_METERS = 10;

/**
 * Interpolates `points` along their own polyline so no consecutive pair is further apart than
 * `maxStepMeters`, grounding each interpolated point on the terrain beneath it.
 *
 * Each new point is placed on the SAMPLED GROUND, not on the interpolated course height. Taking the
 * lower of the two was tried first and measured worse: wherever the ground rises above the straight
 * line between two course points, the minimum is the course, which puts the vertex under the terrain
 * by construction — burial on the named rivers went from 0.46% to 2.6% of their length. The ground
 * is the only authority on where a surface-following ribbon can sit without being swallowed.
 * @param {{x: number, y: number, z: number}[]} points The traced course; returned unchanged if fewer than 2.
 * @param {(worldX: number, worldZ: number) => number} sampleHeightMeters Ground field.
 * @param {number} [maxStepMeters=RIVER_RIBBON_STEP_METERS]
 * @returns {{x: number, y: number, z: number}[]} The resampled course, always ending on the original last point.
 */
export function densifyRiverPath(points, sampleHeightMeters, maxStepMeters = RIVER_RIBBON_STEP_METERS) {
	if (!Array.isArray(points) || points.length < 2 || typeof sampleHeightMeters !== 'function') return points;
	const dense = [];
	for (let i = 0; i < points.length - 1; i++) {
		const from = points[i];
		const to = points[i + 1];
		const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / maxStepMeters));
		for (let step = 0; step < steps; step++) {
			const t = step / steps;
			const x = from.x + (to.x - from.x) * t;
			const z = from.z + (to.z - from.z) * t;
			dense.push({ x, y: sampleHeightMeters(x, z), z });
		}
	}
	dense.push(points[points.length - 1]);
	return dense;
}
