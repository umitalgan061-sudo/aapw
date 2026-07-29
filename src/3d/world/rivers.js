/**
 * Rivers: a deterministic downhill-flow path traced over `terrain.js`'s existing height field
 * (via `createHeightSampler`), rendered as a flat ribbon mesh that follows the terrain surface.
 * `terrain.js` itself is not modified — same technique `world/water.js` uses for sea-level lakes
 * (ADR-0005): the path is *found* by walking the existing FBM noise downhill, not carved into it.
 * See DECISIONS.md ADR-0009 for why a path-tracing approach was chosen over terrain carving.
 *
 * Also detects and renders **waterfalls**: river segments whose drop/distance ratio is steep
 * enough to flag as a fall rather than a normal gentle descent (`detectWaterfalls`/
 * `createWaterfallMesh`) — see DECISIONS.md ADR-0011 for the exact thresholds (calibrated against
 * this world's actual generated river, not guessed) and why the visual is a vertical "curtain"
 * standing at the drop's midpoint rather than a slanted patch following the real (gentle, non-
 * cliff) terrain between the two points.
 *
 * Scope of this first pass (see 3D_GAME_PROGRESS.md Known Issues): one static river near the
 * world origin, confined to the FAZ 1 preview area so it never renders over unloaded terrain;
 * a real flow-animated shader for either the river or its waterfalls is follow-up work, not
 * attempted here.
 * @module world/rivers
 */

import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

/** Grid step, in meters, for the deterministic search that picks the river's source point (the
 * highest sampled point within `searchRadiusMeters` of the origin) — coarse enough to stay cheap
 * (a few thousand height samples), fine enough not to miss the general shape of the high ground. */
const SOURCE_SEARCH_STEP_METERS = 100;
/** How many candidate downhill directions to test at each step of the flow walk. More directions
 * follow the true steepest descent more faithfully; 12 is enough to avoid an obviously-faceted
 * path at this world's terrain scale without materially slowing generation. */
const DESCENT_CANDIDATE_COUNT = 12;
/** Small random rotation added to each candidate angle, so the path reads as a naturally winding
 * river instead of a mathematically-exact steepest-descent line. Seeded, not `Math.random()`. */
const DESCENT_ANGLE_JITTER_RADIANS = 0.35;
/** Multi-octave FBM terrain has many tiny local minima at fine-noise scale, not just the true
 * valleys a river should actually follow — naive single-radius steepest descent gets trapped by
 * them almost immediately (measured: ~10 points before "stuck", nowhere near sea level). If no
 * downhill candidate exists at `stepMeters`, retry at `stepMeters * 2^n` (up to this many times)
 * before giving up — effectively looks further ahead to step over small bumps while still
 * preferring the smallest jump that finds a real descent. See DECISIONS.md ADR-0009. */
const MAX_STUCK_ESCALATIONS = 4;

const RIVER_COLOR = new THREE.Color(0x2f7ea8);

/**
 * Traces a deterministic downhill flow path from the highest point within `searchRadiusMeters` of
 * the world origin down to sea level (or until it exits `maxRiverRadiusMeters`, gets stuck in a
 * local minimum, or hits `maxSteps` — whichever comes first).
 * @param {object} options
 * @param {number} options.seed World seed — same seed always produces the same path.
 * @param {(worldX: number, worldZ: number) => number} options.sampleHeightMeters `terrain.js`'s `createHeightSampler` output.
 * @param {number} options.seaLevelMeters `WORLD_DEFAULTS.WATER_LEVEL_METERS` — the walk stops once it reaches this height.
 * @param {number} [options.searchRadiusMeters=2000] Radius around the origin to search for the source (highest point).
 * @param {number} [options.maxRiverRadiusMeters=2800] Walk stops if it would step outside this radius from the origin — keeps the path inside the always-loaded FAZ 1 preview area (see module doc).
 * @param {number} [options.stepMeters=40] Distance advanced per walk step.
 * @param {number} [options.maxSteps=400] Hard cap so a pathological height field can't loop forever.
 * @returns {{points: THREE.Vector3[], endReason: 'sea'|'bounds'|'local-minimum'|'max-steps'}}
 */
export function generateRiverPath({
	seed,
	sampleHeightMeters,
	seaLevelMeters,
	searchRadiusMeters = 2000,
	maxRiverRadiusMeters = 2800,
	stepMeters = 40,
	maxSteps = 400,
}) {
	let sourceX = 0;
	let sourceZ = 0;
	let sourceHeight = -Infinity;
	for (let x = -searchRadiusMeters; x <= searchRadiusMeters; x += SOURCE_SEARCH_STEP_METERS) {
		for (let z = -searchRadiusMeters; z <= searchRadiusMeters; z += SOURCE_SEARCH_STEP_METERS) {
			const h = sampleHeightMeters(x, z);
			if (h > sourceHeight) {
				sourceHeight = h;
				sourceX = x;
				sourceZ = z;
			}
		}
	}

	const rng = mulberry32(seed ^ 0x52495652); // XOR with a fixed tag ("RIVR"-ish) — independent random stream from terrain's own noise, still fully seeded.
	const points = [new THREE.Vector3(sourceX, sourceHeight, sourceZ)];
	let x = sourceX;
	let z = sourceZ;
	let y = sourceHeight;
	let endReason = 'max-steps';

	for (let step = 0; step < maxSteps; step++) {
		if (y <= seaLevelMeters) {
			endReason = 'sea';
			break;
		}

		let bestX = x;
		let bestZ = z;
		let bestHeight = y;
		let found = false;
		for (let escalation = 0; escalation <= MAX_STUCK_ESCALATIONS && !found; escalation++) {
			const searchRadius = stepMeters * 2 ** escalation;
			for (let c = 0; c < DESCENT_CANDIDATE_COUNT; c++) {
				const angle = (c / DESCENT_CANDIDATE_COUNT) * Math.PI * 2 + (rng() - 0.5) * DESCENT_ANGLE_JITTER_RADIANS;
				const candidateX = x + Math.cos(angle) * searchRadius;
				const candidateZ = z + Math.sin(angle) * searchRadius;
				const candidateHeight = sampleHeightMeters(candidateX, candidateZ);
				if (candidateHeight < bestHeight) {
					bestHeight = candidateHeight;
					bestX = candidateX;
					bestZ = candidateZ;
					found = true;
				}
			}
		}

		if (!found) {
			endReason = 'local-minimum';
			break;
		}
		if (Math.hypot(bestX, bestZ) > maxRiverRadiusMeters) {
			endReason = 'bounds';
			break;
		}

		x = bestX;
		z = bestZ;
		y = bestHeight;
		points.push(new THREE.Vector3(x, y, z));
	}

	return { points, endReason };
}

/**
 * Builds a flat ribbon mesh following `points` (a river path from `generateRiverPath`), width
 * `widthMeters`, raised slightly above the sampled terrain height to avoid z-fighting with the
 * ground mesh directly beneath it. Uses a built-in `MeshStandardMaterial` (not a custom shader)
 * deliberately, so it participates in `scene.fog` and the day/night lights automatically, same as
 * `world/terrain.js` — see DECISIONS.md ADR-0009 for why a flow-animated shader was deferred.
 * @param {THREE.Vector3[]} points At least 2 points (a single-point path produces no geometry).
 * @param {number} [widthMeters=14]
 * @returns {THREE.Mesh | null} `null` if `points` has fewer than 2 entries (nothing to ribbon).
 */
export function createRiverMesh(points, widthMeters = 14) {
	if (points.length < 2) return null;

	const halfWidth = widthMeters / 2;
	const verticalOffset = 0.3; // meters above the sampled terrain height — see module/function doc.
	const positions = new Float32Array(points.length * 2 * 3);
	const colors = new Float32Array(points.length * 2 * 3);
	const indices = [];

	for (let i = 0; i < points.length; i++) {
		const point = points[i];
		const prev = points[Math.max(0, i - 1)];
		const next = points[Math.min(points.length - 1, i + 1)];
		const tangentX = next.x - prev.x;
		const tangentZ = next.z - prev.z;
		const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
		// Perpendicular to the flow direction, in the XZ plane.
		const perpX = -tangentZ / tangentLength;
		const perpZ = tangentX / tangentLength;

		const leftIndex = i * 2;
		const rightIndex = i * 2 + 1;
		positions[leftIndex * 3] = point.x + perpX * halfWidth;
		positions[leftIndex * 3 + 1] = point.y + verticalOffset;
		positions[leftIndex * 3 + 2] = point.z + perpZ * halfWidth;
		positions[rightIndex * 3] = point.x - perpX * halfWidth;
		positions[rightIndex * 3 + 1] = point.y + verticalOffset;
		positions[rightIndex * 3 + 2] = point.z - perpZ * halfWidth;

		colors[leftIndex * 3] = RIVER_COLOR.r;
		colors[leftIndex * 3 + 1] = RIVER_COLOR.g;
		colors[leftIndex * 3 + 2] = RIVER_COLOR.b;
		colors[rightIndex * 3] = RIVER_COLOR.r;
		colors[rightIndex * 3 + 1] = RIVER_COLOR.g;
		colors[rightIndex * 3 + 2] = RIVER_COLOR.b;

		if (i > 0) {
			const prevLeft = leftIndex - 2;
			const prevRight = rightIndex - 2;
			indices.push(prevLeft, prevRight, leftIndex, prevRight, rightIndex, leftIndex);
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();

	const material = new THREE.MeshStandardMaterial({
		vertexColors: true,
		roughness: 0.15,
		metalness: 0,
		transparent: true,
		opacity: 0.88,
		side: THREE.DoubleSide,
	});

	return new THREE.Mesh(geometry, material);
}

/**
 * Disposes a mesh created by `createRiverMesh` (geometry + material). Call on teardown — memory-leak checklist.
 * @param {THREE.Mesh} riverMesh
 */
export function disposeRiverMesh(riverMesh) {
	riverMesh.geometry.dispose();
	riverMesh.material.dispose();
}

/** Minimum vertical drop, in meters, between two consecutive river points for the segment to be
 * flagged as a waterfall rather than a normal gentle descent. Calibrated against this world's
 * actual traced river (seed 1337): its steepest two segments drop 2.61m and 4.02m over a 40m step
 * (6.5% and 10.1% grade) while every other segment drops under 1.3m (≤3.2% grade) — see
 * DECISIONS.md ADR-0011 for the full measured profile. Set between those two clusters so real,
 * distinctly-steeper sections are flagged without also flagging the river's normal gentle flow. */
const WATERFALL_MIN_DROP_METERS = 2.5;
/** Minimum drop/horizontal-distance ratio (rise-over-run) for a segment to count as a waterfall —
 * paired with `WATERFALL_MIN_DROP_METERS` so a long, gradual descent that happens to accumulate
 * `WATERFALL_MIN_DROP_METERS` of total drop over a much longer distance isn't misflagged as a fall. */
const WATERFALL_MIN_SLOPE = 0.06;

const WATERFALL_FOAM_COLOR = new THREE.Color(0xf0f8ff);

/**
 * Scans a traced river path (`generateRiverPath`'s `points`) for segments steep enough to count as
 * a waterfall — see `WATERFALL_MIN_DROP_METERS`/`WATERFALL_MIN_SLOPE` for the exact, measured
 * thresholds. Pure function: same `points` always produces the same waterfalls.
 * @param {THREE.Vector3[]} points
 * @returns {{top: THREE.Vector3, bottom: THREE.Vector3, dropMeters: number}[]} One entry per
 *   qualifying segment, `top` being the upstream (higher) point and `bottom` the downstream one.
 */
export function detectWaterfalls(points) {
	const waterfalls = [];
	for (let i = 1; i < points.length; i++) {
		const top = points[i - 1];
		const bottom = points[i];
		const horizontalDistance = Math.hypot(bottom.x - top.x, bottom.z - top.z);
		if (horizontalDistance === 0) continue;
		const dropMeters = top.y - bottom.y;
		const slope = dropMeters / horizontalDistance;
		if (dropMeters >= WATERFALL_MIN_DROP_METERS && slope >= WATERFALL_MIN_SLOPE) {
			waterfalls.push({ top, bottom, dropMeters });
		}
	}
	return waterfalls;
}

/**
 * Builds a vertical "curtain" mesh for one `detectWaterfalls` entry: a flat quad standing upright
 * at the horizontal midpoint between `top`/`bottom`, spanning the full vertical drop, oriented
 * perpendicular to the flow direction (same `perpX`/`perpZ` technique as `createRiverMesh`'s
 * ribbon). Deliberately vertical rather than following the real (gently-sloped, non-cliff) terrain
 * between the two points — `terrain.js`'s smooth FBM has no actual cliff faces yet, so a slanted
 * patch would just look like a tinted continuation of the river ribbon, not a fall. This is a
 * schematic "steep-section marker," not a physically-carved waterfall — see this module's own doc
 * comment and DECISIONS.md ADR-0011.
 * @param {{top: THREE.Vector3, bottom: THREE.Vector3, dropMeters: number}} waterfall One entry from `detectWaterfalls`.
 * @param {number} [widthMeters=14] Matches `createRiverMesh`'s default river width.
 * @returns {THREE.Mesh}
 */
export function createWaterfallMesh({ top, bottom, dropMeters }, widthMeters = 14) {
	const midX = (top.x + bottom.x) / 2;
	const midZ = (top.z + bottom.z) / 2;
	const tangentLength = Math.hypot(bottom.x - top.x, bottom.z - top.z) || 1;
	const perpX = -(bottom.z - top.z) / tangentLength;
	const perpZ = (bottom.x - top.x) / tangentLength;
	const halfWidth = widthMeters / 2;

	// prettier-ignore
	const positions = new Float32Array([
		midX + perpX * halfWidth, top.y, midZ + perpZ * halfWidth, // top-left
		midX - perpX * halfWidth, top.y, midZ - perpZ * halfWidth, // top-right
		midX + perpX * halfWidth, bottom.y, midZ + perpZ * halfWidth, // bottom-left
		midX - perpX * halfWidth, bottom.y, midZ - perpZ * halfWidth, // bottom-right
	]);
	// prettier-ignore
	const colors = new Float32Array([
		WATERFALL_FOAM_COLOR.r, WATERFALL_FOAM_COLOR.g, WATERFALL_FOAM_COLOR.b,
		WATERFALL_FOAM_COLOR.r, WATERFALL_FOAM_COLOR.g, WATERFALL_FOAM_COLOR.b,
		RIVER_COLOR.r, RIVER_COLOR.g, RIVER_COLOR.b,
		RIVER_COLOR.r, RIVER_COLOR.g, RIVER_COLOR.b,
	]);
	const indices = [0, 2, 1, 2, 3, 1];

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();

	const material = new THREE.MeshStandardMaterial({
		vertexColors: true,
		roughness: 0.2,
		metalness: 0,
		transparent: true,
		opacity: 0.82,
		side: THREE.DoubleSide,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.userData.dropMeters = dropMeters;
	return mesh;
}

/**
 * Disposes a mesh created by `createWaterfallMesh` (geometry + material). Call on teardown —
 * memory-leak checklist.
 * @param {THREE.Mesh} waterfallMesh
 */
export function disposeWaterfallMesh(waterfallMesh) {
	waterfallMesh.geometry.dispose();
	waterfallMesh.material.dispose();
}
