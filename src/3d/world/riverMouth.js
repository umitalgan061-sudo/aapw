/**
 * Carries a traced river across the last of the land and into canonical water (run 391).
 *
 * `generateRiverPath` stops the moment the ground drops to `seaLevelMeters`. That is a *height*
 * test, and the height field is not the authority on where the sea is — map.png's water mask is.
 * The two disagree along the coastline, so a course could finish below sea level while its final
 * point still sat on a pixel the mask calls land. Measured: 8 of the 10 named rivers happened to
 * land wet and 2 landed dry, with green-fork failing at 28% water within 800 m while blue-fork
 * passed at 24% — the difference was luck about where a single sample fell, not geography.
 *
 * A river that stops short of the sea is wrong both on the map and on screen: the ribbon ends on a
 * beach with a visible gap before the water. This walks the course the rest of the way, stepping
 * seaward until the mask agrees the mouth is in water.
 *
 * Fully deterministic — no RNG. Direction candidates are tried in a fixed order and the terrain and
 * mask lookups are pure, so the same course always produces the same mouth.
 * @module world/riverMouth
 */

import { WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { sampleReferenceWaterMask } from './worldReferenceWaterMask.js';

/** How far each seaward step carries the course, in meters. Matches the tracer's own step scale. */
const MOUTH_STEP_METERS = 40;
/** Bound on the extension (40 m x 50 = 2 km). A course needing more than this is not "just short of
 * the sea" — it is somewhere else entirely, and gets left alone rather than given a long false tail. */
const MAX_MOUTH_STEPS = 50;
/** Fixed fan of headings tried at each step, in radians, relative to the current heading. Straight on
 * first so a course that is already pointed at the sea keeps its line. */
const HEADING_FAN_RADIANS = Object.freeze([0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]);

/** World metres to map.png's normalized [0..1] space — same transform the water mask is baked in. */
function toNormalized(worldX, worldZ) {
	const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
	return [
		(worldX / METERS_PER_MAP_UNIT + (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
		(worldZ / METERS_PER_MAP_UNIT + (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
	];
}

/** True where map.png says this world position is canonical water. */
export function isCanonicalWater(worldX, worldZ) {
	return Boolean(sampleReferenceWaterMask(...toNormalized(worldX, worldZ)));
}

/**
 * Extends `points` seaward until its mouth is in canonical water.
 *
 * Returns the ORIGINAL array untouched when the mouth is already wet, when the course is too short
 * to have a heading, or when the sea could not be reached inside `MAX_MOUTH_STEPS`. That last case
 * matters: a course that cannot find water within 2 km has a problem this cannot fix, and appending
 * a tail that ends on dry land would make the map worse while making the check pass.
 * @param {{x: number, y: number, z: number}[]} points A traced course, source first.
 * @param {(worldX: number, worldZ: number) => number} sampleHeightMeters Ground field for the tail.
 * @param {(x: number, y: number, z: number) => object} makePoint Builds a point of the caller's own
 *   type (the tracer uses `THREE.Vector3`), so this module needs no three.js dependency.
 * @returns {{x: number, y: number, z: number}[]} The course, extended or unchanged.
 */
export function extendCourseToCanonicalWater(points, sampleHeightMeters, makePoint) {
	if (!Array.isArray(points) || points.length < 2) return points;
	const mouth = points[points.length - 1];
	if (isCanonicalWater(mouth.x, mouth.z)) return points;

	const previous = points[points.length - 2];
	let heading = Math.atan2(mouth.z - previous.z, mouth.x - previous.x);
	let x = mouth.x;
	let z = mouth.z;
	const tail = [];

	for (let step = 0; step < MAX_MOUTH_STEPS; step++) {
		let bestX = null;
		let bestZ = null;
		let bestHeading = heading;
		let bestHeight = Infinity;
		for (const offset of HEADING_FAN_RADIANS) {
			const angle = heading + offset;
			const candidateX = x + Math.cos(angle) * MOUTH_STEP_METERS;
			const candidateZ = z + Math.sin(angle) * MOUTH_STEP_METERS;
			// Water ends it immediately: the first heading that reaches the sea is the mouth.
			if (isCanonicalWater(candidateX, candidateZ)) {
				tail.push(makePoint(candidateX, sampleHeightMeters(candidateX, candidateZ), candidateZ));
				return points.concat(tail);
			}
			// Otherwise keep descending — on a coastal flat this is what keeps the tail in the channel
			// instead of letting it wander up the beach.
			const candidateHeight = sampleHeightMeters(candidateX, candidateZ);
			if (candidateHeight < bestHeight) {
				bestHeight = candidateHeight;
				bestX = candidateX;
				bestZ = candidateZ;
				bestHeading = angle;
			}
		}
		if (bestX === null) break;
		x = bestX;
		z = bestZ;
		heading = bestHeading;
		tail.push(makePoint(x, bestHeight, z));
	}

	return points;
}
