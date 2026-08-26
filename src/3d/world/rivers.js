/**
 * Rivers: a deterministic downhill-flow path traced over `terrain.js`'s existing height field, drawn
 * as a ribbon that follows the terrain surface. `terrain.js` is not modified — the path is *found*
 * by walking the existing FBM noise downhill, not carved into it (ADR-0005, ADR-0009).
 *
 * Also detects and renders **waterfalls**: segments whose drop/distance ratio flags a fall rather
 * than a gentle descent (`detectWaterfalls`/`createWaterfallMesh`). ADR-0011 has the thresholds
 * (calibrated against this world's actual river) and why the visual is a vertical "curtain" at the
 * drop's midpoint rather than a slanted patch following the real, non-cliff terrain between.
 *
 * Both the ribbon and the curtains keep their `MeshStandardMaterial`, so they get `scene.fog` and
 * the day/night lights for free; the flow (ADR-0271) is injected via `onBeforeCompile` rather than
 * replacing the material. It is driven by three baked vertex attributes rather than screen- or
 * UV-space scrolling, so it follows the real geometry: `aFlowDistance` (arc length from the source,
 * which makes foam travel *downstream* rather than in a fixed world direction), `aFlowSpeed`
 * (per-vertex, from the local bed gradient) and `aFlowSide` (-1..1 across the ribbon, catching more
 * foam against the banks than midstream).
 * @module world/rivers
 */

import * as THREE from 'three';
import { mulberry32 } from './terrain.js';
import { valyriaInfluence01 } from './worldReferenceValyria.js';
import { WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { densifyRiverPath } from './riverRibbonPath.js';
import { extendCourseToCanonicalWater } from './riverMouth.js';

/** Seed tag for the named rivers, XORed with the world seed ("RVNM"). */
export const NAMED_RIVER_SEED_TAG = 0x52564e4d;

/** Grid step, in meters, for the deterministic search that picks the river's source point (the
 * highest sampled point within `searchRadiusMeters` of the origin) — coarse enough to stay cheap
 * (a few thousand height samples), fine enough not to miss the general shape of the high ground. */
const SOURCE_SEARCH_STEP_METERS = 100;
/** Candidate downhill directions tested per step. More follow the true steepest descent more
 * faithfully; 12 avoids an obviously-faceted path at this world's scale without slowing generation. */
const DESCENT_CANDIDATE_COUNT = 12;
/** Small seeded rotation per candidate angle, so the path winds naturally instead of running a
 * mathematically-exact steepest-descent line. Seeded, not `Math.random()`. */
const DESCENT_ANGLE_JITTER_RADIANS = 0.35;
/** Multi-octave FBM terrain has many tiny local minima, not just the true valleys a river should
 * follow — naive single-radius steepest descent gets trapped almost immediately (measured: ~10
 * points before "stuck", nowhere near sea level). If no downhill candidate exists at `stepMeters`,
 * retry at `stepMeters * 2^n` up to this many times. See DECISIONS.md ADR-0009. */
const MAX_STUCK_ESCALATIONS = 4;

const RIVER_COLOR = new THREE.Color(0x2f7ea8);

/** Flow speed, in m/s, of the foam pattern over a perfectly flat reach. Not a physical current
 * measurement — the speed the *visual* streaks travel at, tuned so a still-looking pool still reads
 * as moving water. */
const RIVER_BASE_FLOW_SPEED_MPS = 1.2;
/** How much the local bed gradient adds to that speed, via `sqrt(grade)`. The square root (rather
 * than a linear term) is the shape open-channel flow actually follows — Manning/Chézy both give
 * velocity proportional to the square root of the slope — so the steep sections speed up markedly
 * while the near-flat majority of the river stays calm, instead of everything scaling together. */
const RIVER_GRADE_FLOW_GAIN = 6;
/** Spatial frequency of the foam streaks, in radians per meter — 1.0 gives ~6.3m between crests,
 * about two streaks per river width at the default 14m. An earlier 0.35 (~18m) was tried first and
 * rejected on this run's own close-range evidence render: at one streak per two river widths the
 * pattern read as a single drifting blob rather than as moving water. The streaks are evaluated
 * per fragment from an interpolated arc length, so this frequency is independent of how far apart
 * the traced river's actual path points are (~60m at the current step size). */
const RIVER_FLOW_WAVENUMBER = 1.0;
/** Waterfall curtains fall much faster than the river flows, and their drop is short, so they get
 * their own fixed speed rather than a gradient-derived one. */
const WATERFALL_FLOW_SPEED_MPS = 9;

/**
 * Injects downstream foam-streak animation into a stock `MeshStandardMaterial` via
 * `onBeforeCompile`, leaving its PBR/fog/lighting behaviour untouched (see the module doc comment
 * for why the material is not simply replaced with a `ShaderMaterial`).
 *
 * The mesh's geometry must already carry the `aFlowDistance`/`aFlowSpeed`/`aFlowSide` attributes —
 * `createRiverMesh` and `createWaterfallMesh` both bake them.
 * @param {THREE.MeshStandardMaterial} material Mutated in place.
 * @param {string} cacheKey Distinguishes this injected program from any other material three.js
 *   might otherwise consider identical; without it a sibling `MeshStandardMaterial` could be served
 *   a cached program compiled without the injection.
 * @param {number} foamStrength How far the foam colour is mixed in at a streak's peak. The waterfall
 *   curtains get less than the river: their geometry already carries a white-to-blue vertex gradient
 *   (foam at the lip, water at the plunge pool), and layering full-strength streaks on top of that
 *   washed the whole curtain out to flat white in this run's evidence render.
 * @returns {{uTime: {value: number}}} The uniform object `updateFlowAnimation` advances.
 */
function attachFlowAnimation(material, cacheKey, foamStrength) {
	const flowUniforms = { uTime: { value: 0 } };
	material.userData.flowUniforms = flowUniforms;
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = flowUniforms.uTime;
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>
				attribute float aFlowDistance;
				attribute float aFlowSpeed;
				attribute float aFlowSide;
				varying float vFlowDistance;
				varying float vFlowSpeed;
				varying float vFlowSide;`,
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
				vFlowDistance = aFlowDistance;
				vFlowSpeed = aFlowSpeed;
				vFlowSide = aFlowSide;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
				uniform float uTime;
				varying float vFlowDistance;
				varying float vFlowSpeed;
				varying float vFlowSide;`,
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
				{
					// Subtracting time * speed from the along-flow arc length is what makes a crest of
					// constant phase satisfy distance = time * speed, i.e. travel downstream at exactly
					// the per-vertex speed baked from the local bed gradient.
					float flowPhase = (vFlowDistance - uTime * vFlowSpeed) * ${RIVER_FLOW_WAVENUMBER.toFixed(4)};
					float primary = sin(flowPhase) * 0.5 + 0.5;
					// A second, longer band skewed across the channel keeps the streaks from reading as
					// an evenly-spaced barcode marching in lockstep, and makes each one enter the bend
					// at a slight angle the way real surface foam does.
					float secondary = sin(flowPhase * 0.41 + vFlowSide * 3.7) * 0.5 + 0.5;
					float foam = pow(primary * 0.6 + secondary * 0.4, 3.0);
					// Banks catch and hold more foam than midstream does.
					float bankBias = mix(0.5, 1.0, abs(vFlowSide));
					diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.94, 0.97), foam * ${foamStrength.toFixed(3)} * bankBias);
				}`,
			);
	};
	material.customProgramCacheKey = () => cacheKey;
	return flowUniforms;
}

/**
 * Advances the flow animation on a mesh built by `createRiverMesh`/`createWaterfallMesh`. Safe to
 * call on a mesh whose material never got the injection (it simply does nothing), so callers do not
 * have to track which meshes are animated.
 * @param {THREE.Mesh | null | undefined} mesh
 * @param {number} elapsedSeconds
 */
export function updateFlowAnimation(mesh, elapsedSeconds) {
	const flowUniforms = mesh?.material?.userData?.flowUniforms;
	if (flowUniforms) flowUniforms.uTime.value = elapsedSeconds;
}

/**
 * Traces a deterministic downhill flow path from the highest point within `searchRadiusMeters` of
 * the world origin down to sea level (or until it exits `maxRiverRadiusMeters`, gets stuck in a
 * local minimum, or hits `maxSteps` — whichever comes first).
 * @param {object} options
 * @param {number} options.seed World seed — same seed always produces the same path.
 * @param {(worldX: number, worldZ: number) => number} options.sampleHeightMeters `terrain.js`'s `createHeightSampler` output.
 * @param {number} options.seaLevelMeters `WORLD_DEFAULTS.WATER_LEVEL_METERS` — the walk stops once it reaches this height.
 * @param {number} [options.searchRadiusMeters=2000] Radius around the origin to search for the source (highest point).
 * @param {number} [options.maxRiverRadiusMeters=2800] Walk stops if it would step outside this radius **of `originX`/`originZ`** — for the historical single river that is the world origin and the FAZ 1 preview area it was written for (see module doc); a named river gets whatever reach its course to the sea needs.
 * @param {number} [options.stepMeters=40] Distance advanced per walk step.
 * @param {number} [options.maxSteps=400] Hard cap so a pathological height field can't loop forever.
 * @returns {{points: THREE.Vector3[], endReason: 'sea'|'bounds'|'local-minimum'|'max-steps'}}
 */
/** World X/Z to normalized owner-map coordinates, for the Valyria exclusion in the source search. */
function normalizedRiverPoint(worldX, worldZ) {
	const { MAP_BOUNDS, METERS_PER_MAP_UNIT } = WORLD_SCALE;
	const nx = (worldX / METERS_PER_MAP_UNIT + (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
	const ny = (worldZ / METERS_PER_MAP_UNIT + (MAP_BOUNDS.minY + MAP_BOUNDS.maxY) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
	return [Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny))];
}

export function generateRiverPath({
	seed,
	sampleHeightMeters,
	seaLevelMeters,
	/** Centre of the source search, in world metres. Run 376: named rivers pass their own map-read
	 * headwater here; the historical single river leaves it at the origin, so its course is unchanged. */
	originX = 0,
	originZ = 0,
	searchRadiusMeters = 2000,
	maxRiverRadiusMeters = 2800,
	stepMeters = 40,
	maxSteps = 400,
}) {
	let sourceX = 0;
	let sourceZ = 0;
	let sourceHeight = -Infinity;
	for (let x = originX - searchRadiusMeters; x <= originX + searchRadiusMeters; x += SOURCE_SEARCH_STEP_METERS) {
		for (let z = originZ - searchRadiusMeters; z <= originZ + searchRadiusMeters; z += SOURCE_SEARCH_STEP_METERS) {
			// No river rises in the Doom (run 372 / ADR-0319). This search takes the highest ground within
			// its radius, and raising Valyria made a volcanic peak the highest thing near the origin — the
			// river source relocated onto it, the course collapsed from 30 points to 15, and
			// `scripts/checkRiverValleyCarving.js` failed. Valyria is ash and slag; nothing springs there.
			if (valyriaInfluence01(...normalizedRiverPoint(x, z)) > 0.25) continue;
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
		// Bounded around this river's *own* origin, not the world origin. It was written as
		// `hypot(bestX, bestZ)` back when there was exactly one river and its origin was (0, 0), where
		// the two are the same expression. Run 376 gave rivers map-read headwaters, and every Westeros
		// one is 4.5-5.0 km from the world origin — past the 2800 m default — so eight of the ten named
		// rivers broke out of the walk on their very first step and were silently discarded by
		// `computeRiverValleys`'s `points.length < 2` guard. The world had two named rivers, both of
		// them in Essos, purely because those two happened to rise near the world origin.
		if (Math.hypot(bestX - originX, bestZ - originZ) > maxRiverRadiusMeters) {
			endReason = 'bounds';
			break;
		}

		x = bestX;
		z = bestZ;
		y = bestHeight;
		points.push(new THREE.Vector3(x, y, z));
	}

	// The height test says "as low as the sea", not "in the sea" — see `world/riverMouth.js`.
	const asVector = (mx, my, mz) => new THREE.Vector3(mx, my, mz);
	return { points: endReason === 'sea' ? extendCourseToCanonicalWater(points, sampleHeightMeters, asVector) : points, endReason };
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
export function createRiverMesh(points, widthMeters = 14, sampleHeightMeters = null) {
	// eslint-disable-next-line no-param-reassign -- resampled below when a sampler is available.
	if (points.length < 2) return null;

	const halfWidth = widthMeters / 2;
	const verticalOffset = 0.3; // meters above the sampled terrain height — see module/function doc.

	// See `world/riverRibbonPath.js` for why the course must be resampled before it can be ribboned.
	if (sampleHeightMeters) points = densifyRiverPath(points, sampleHeightMeters);
	const positions = new Float32Array(points.length * 2 * 3);
	const colors = new Float32Array(points.length * 2 * 3);
	// Flow-animation attributes — see the module doc comment and `attachFlowAnimation`.
	const flowDistances = new Float32Array(points.length * 2);
	const flowSpeeds = new Float32Array(points.length * 2);
	const flowSides = new Float32Array(points.length * 2);
	const indices = [];

	let arcLengthMeters = 0;
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

		if (i > 0) arcLengthMeters += Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z);
		// Steeper of the two adjoining segments, not their average (run 390): averaging over the full
		// ~120m span left the steepest reach only ~24% faster than the median. Each is still ~60m.
		const segmentGrade = (from, to) => {
			const runMeters = Math.hypot(to.x - from.x, to.z - from.z);
			return runMeters > 0 ? Math.max(0, (from.y - to.y) / runMeters) : 0;
		};
		const grade = Math.max(segmentGrade(prev, point), segmentGrade(point, next));
		const flowSpeedMps = RIVER_BASE_FLOW_SPEED_MPS + Math.sqrt(grade) * RIVER_GRADE_FLOW_GAIN;

		const leftIndex = i * 2;
		const rightIndex = i * 2 + 1;
		flowDistances[leftIndex] = arcLengthMeters;
		flowDistances[rightIndex] = arcLengthMeters;
		flowSpeeds[leftIndex] = flowSpeedMps;
		flowSpeeds[rightIndex] = flowSpeedMps;
		flowSides[leftIndex] = -1;
		flowSides[rightIndex] = 1;
		// Each bank founded at its OWN position, not the centre line's height (run 390). Both edges took
		// `point.y`, sampled MID-channel — right only where the ground is flat across the flow. On a
		// cross-slope the uphill bank sinks by half-width times the cross-grade (~4m on a 14m channel
		// across 30 degrees, against a 0.3m offset), so the river was buried along most of its length
		// and surfaced only where the slope flattened — hence disconnected shards. Same defect as
		// `villageBuildings.js` (382) and `roads.js` (387): one height sample for something with width.
		const leftX = point.x + perpX * halfWidth;
		const leftZ = point.z + perpZ * halfWidth;
		const rightX = point.x - perpX * halfWidth;
		const rightZ = point.z - perpZ * halfWidth;
		// One level for both cannot work: the lower buries the uphill bank, the higher floats the other.
		const leftGround = sampleHeightMeters ? sampleHeightMeters(leftX, leftZ) : point.y;
		const rightGround = sampleHeightMeters ? sampleHeightMeters(rightX, rightZ) : point.y;
		positions[leftIndex * 3] = leftX;
		positions[leftIndex * 3 + 1] = leftGround + verticalOffset;
		positions[leftIndex * 3 + 2] = leftZ;
		positions[rightIndex * 3] = rightX;
		positions[rightIndex * 3 + 1] = rightGround + verticalOffset;
		positions[rightIndex * 3 + 2] = rightZ;

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
	geometry.setAttribute('aFlowDistance', new THREE.BufferAttribute(flowDistances, 1));
	geometry.setAttribute('aFlowSpeed', new THREE.BufferAttribute(flowSpeeds, 1));
	geometry.setAttribute('aFlowSide', new THREE.BufferAttribute(flowSides, 1));
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
	attachFlowAnimation(material, 'river-flow', 0.45);

	const mesh = new THREE.Mesh(geometry, material);
	mesh.userData.totalFlowLengthMeters = arcLengthMeters;
	return mesh;
}

/** Spacing, in metres, of the cross-sections a named river's ribbon is built from. */
const RIVER_SURFACE_SPACING_METERS = 8;
/** How far the water surface is held above the bed beneath it. A river is not a decal on the ground. */
const RIVER_FREEBOARD_METERS = 1;

/**
 * Turns a traced course into the water surface that runs along it.
 *
 * **Why this is not just the traced polyline.** `generateRiverPath` steps 40 m at a time and escalates
 * to as much as 640 m to climb out of the FBM's local minima, so consecutive path points can sit either
 * side of ground far higher than the straight line between them. Drawing a ribbon on that line buries
 * it: measured over the ten named rivers, **23-63% of every ribbon's length was underground**, with the
 * terrain poking up to 28 m through it, which is why the Mander first rendered as a dashed line of
 * disconnected blue patches rather than as a river.
 *
 * So the course is resampled every 8 m — fine enough that the ground can only vary a few centimetres
 * between neighbours — and the surface is then swept **upstream** from the mouth as
 * `surface = max(surfaceDownstream, bed + freeboard)`. Those two terms are exactly the two things water
 * does: it never runs uphill going downstream (the running maximum enforces it), and it is never below
 * the ground it lies on (the freeboard enforces it). Where the course does cross a rise, the sweep
 * ponds the water behind it instead of tunnelling through — which is what a landscape does with a
 * dammed valley, and is legible as a lake rather than as a rendering fault.
 *
 * @param {{x: number, y: number, z: number}[]} points Traced course, source first.
 * @param {(x: number, z: number) => number} sampleHeightMeters The **final** ground field.
 * @returns {THREE.Vector3[]} Dense surface points, source first.
 */
export function buildRiverSurface(points, sampleHeightMeters) {
	const dense = [];
	for (let i = 1; i < points.length; i += 1) {
		const from = points[i - 1];
		const to = points[i];
		const segmentMeters = Math.hypot(to.x - from.x, to.z - from.z);
		const steps = Math.max(1, Math.round(segmentMeters / RIVER_SURFACE_SPACING_METERS));
		// `i === 1` also emits the source itself; every later segment skips its shared first point.
		for (let step = i === 1 ? 0 : 1; step <= steps; step += 1) {
			const t = step / steps;
			const x = from.x + (to.x - from.x) * t;
			const z = from.z + (to.z - from.z) * t;
			dense.push({ x, z, bed: sampleHeightMeters(x, z) });
		}
	}
	if (dense.length < 2) return [];

	const surface = new Array(dense.length);
	let running = -Infinity;
	for (let i = dense.length - 1; i >= 0; i -= 1) {
		running = Math.max(running, dense[i].bed + RIVER_FREEBOARD_METERS);
		surface[i] = running;
	}
	return dense.map((point, i) => new THREE.Vector3(point.x, surface[i], point.z));
}

/**
 * Ribbons the map's named rivers — the Trident's three forks, the Blackwater Rush, the Mander, the
 * Greenblood, the White Knife, the Rhoyne, the Skahazadhan and the Sarne.
 *
 * **The courses come from the carve, not from a second trace.** `terrainValleyCarving.js` has already
 * traced each river over the phase-1 field and cut a valley along that exact polyline. Re-tracing here
 * against the finished ground looked reasonable — a carved floor should attract steepest descent — but
 * measurement disagreed: the second trace wandered out of its own trench often enough to leave a third
 * of each ribbon buried. Reusing the carved polyline removes the possibility entirely, because there is
 * now only one course per river rather than two that can disagree.
 *
 * @param {object} options
 * @param {{id: string, name: string, points: {x: number, y: number, z: number}[]}[]} options.namedRivers
 *   `computeRiverValleys(...).namedRivers` — the courses whose valleys are in the ground.
 * @param {(x: number, z: number) => number} options.sampleHeightMeters The **final** ground field.
 * @returns {THREE.Mesh[]} One ribbon per river; disposed with `disposeRiverMesh`.
 */
export function createNamedRiverMeshes({ namedRivers, sampleHeightMeters }) {
	const meshes = [];
	for (const river of namedRivers ?? []) {
		// Deliberately NOT given the sampler (run 390): these run in valleys carved to hold them
		// (`checkRiverValleyCarving`), and in a carved channel a level cross-section at the course
		// height is the right one. Per-bank grounding sags the ribbon centre below ground wherever the
		// cross-section is convex — measured, 0.46% -> 2.6% of their length underground. It is the fix
		// for the un-carved legacy course in `sceneManager.js`, not for these.
		const surface = buildRiverSurface(river.points, sampleHeightMeters);
		const mesh = createRiverMesh(surface);
		if (!mesh) continue;
		mesh.name = `river-${river.id}`;
		mesh.userData.namedRiver = Object.freeze({
			id: river.id, name: river.name, pointCount: surface.length,
		});
		meshes.push(mesh);
	}
	return meshes;
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
	// Flow runs top-to-bottom here rather than along the channel: distance is measured down the
	// curtain, so the same shader makes the foam fall instead of drift downstream.
	// prettier-ignore
	const flowDistances = new Float32Array([0, 0, dropMeters, dropMeters]);
	const flowSpeeds = new Float32Array([
		WATERFALL_FLOW_SPEED_MPS,
		WATERFALL_FLOW_SPEED_MPS,
		WATERFALL_FLOW_SPEED_MPS,
		WATERFALL_FLOW_SPEED_MPS,
	]);
	const flowSides = new Float32Array([-1, 1, -1, 1]);

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.setAttribute('aFlowDistance', new THREE.BufferAttribute(flowDistances, 1));
	geometry.setAttribute('aFlowSpeed', new THREE.BufferAttribute(flowSpeeds, 1));
	geometry.setAttribute('aFlowSide', new THREE.BufferAttribute(flowSides, 1));
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
	attachFlowAnimation(material, 'waterfall-flow', 0.3);
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
