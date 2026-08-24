/**
 * Road network: connects the 14 kingdom seats (`world/settlements.js`'s `KINGDOM_SEATS`) with a
 * minimum-spanning-tree road topology, each edge routed by `world/roadPathfinder.js`'s slope-aware
 * A* (not a straight line — see that module's doc comment and DECISIONS.md ADR-0076), and rendered
 * as a single merged dirt-colored ribbon mesh following the real combined terrain height
 * (`world/terrain.js`'s fine FBM + run-55's `MACRO_RELIEF_FEATURES`, sampled through the exact same
 * `createHeightSampler` output every other world system already reads through).
 *
 * Topology: a minimum spanning tree over the 14 seats (13 edges, one connected network, no cycles)
 * rather than a complete point-to-point graph (91 possible pairs) — GOVERNANCE.md §18's own task
 * text explicitly allows this ("a minimum-spanning-tree-style network... is fine and arguably more
 * realistic than a complete graph"). MST topology is chosen by raw Euclidean seat-to-seat distance
 * (a standard, deterministic MST — see `computeSeatMST`); *within* each chosen edge, the actual
 * routed path is slope-aware, not Euclidean-straight — topology selection and path routing are
 * deliberately separate concerns (see ADR-0076's Alternatives considered for why a slope-aware
 * topology cost was not worth the extra complexity here).
 *
 * Two road tiers (run 314, ADR-0264, owner-approved 2026-08-12 — see QUESTIONS_FOR_OWNER.md's run 56
 * entry): the original "ana yol" / at arabası yolu (main cart road) MST backbone above, plus a second,
 * thinner "patika" (footpath) tier — short, purely local connections between kingdom seats close
 * enough to be neighboring villages/holdings but not directly linked by the MST backbone (which
 * already routes their traffic through a shared close neighbor). See `computeLocalFootpathEdges` and
 * `FOOTPATH_MAX_LENGTH_METERS` below for the exact selection rule. Rendered as a second, separate
 * merged mesh (own width/color) alongside the unchanged cart-road mesh — the cart-road mesh's own
 * vertex/color/width contract (`scripts/checkRoadVisualContract.js`) is untouched by this addition.
 * @module world/roads
 */

import * as THREE from 'three';
import { findSlopeAwarePath } from './roadPathfinder.js';

/** Ribbon width, in meters, for the single road tier this first pass renders — wide enough to read
 * clearly as a real cart road against the terrain at this world's scale (chunks are 500m/edge),
 * narrower than a settlement keep (34m) so it never competes visually with castles. */
const ROAD_WIDTH_METERS = 8;

/** Meters above the sampled terrain height the ribbon is raised — avoids z-fighting with the ground
 * mesh directly beneath it. Slightly larger than `world/rivers.js`'s 0.3m offset since roads sit on
 * dry, often-rougher fine-noise terrain (no water surface smoothing nearby to hide a thinner gap). */
const VERTICAL_OFFSET_METERS = 0.4;

/** Muted mineral-earth base derived from the supplied mountain-road photogrammetry. It deliberately
 * avoids the old saturated golden-tan, allowing sunlight and procedural dust/stone variation to
 * create warmth instead of baking orange into every road under every time of day. */
const ROAD_COLOR = new THREE.Color(0x816b4f);

/** Ribbon width, in meters, for the second "patika" (footpath) tier (run 314, ADR-0264) — narrow
 * enough to read as a walked dirt track rather than a cart road, wider than a single-file trail so it
 * stays visible at typical play-camera distance. Roughly a third of `ROAD_WIDTH_METERS`. */
const FOOTPATH_WIDTH_METERS = 2.5;

/** Footpaths are drier/worn but stay in the same low-saturation mineral family as cart roads. */
const FOOTPATH_COLOR = new THREE.Color(0xa08c6b);

/** Maximum seat-to-seat Euclidean distance, in meters, for a non-MST pair to qualify as a "patika"
 * footpath (run 314, ADR-0264 — answers ADR-0076's deferred "every edge, or only short/local ones"
 * question: only short/local ones). Deliberately conservative — well under every real MST edge's own
 * length except the tight `olena`<->`berk`/`ziya`<->`olena` pair (~110-125m) — so this only picks up
 * genuine "same small cluster, one direct hop apart" gaps (today: `ziya`<->`berk`, ~150-160m) rather
 * than fanning out a dense web of long, mutually near-parallel shortcuts across the whole map (the
 * next-closest non-MST pairs are all 1.1km+, roughly 7x farther — see DECISIONS.md ADR-0264's Context
 * for the full measured distance table). Revisit this threshold if a future seat layout change makes
 * more genuinely-local gaps worth connecting. */
const FOOTPATH_MAX_LENGTH_METERS = 700;

/**
 * Builds a minimum spanning tree (Prim's algorithm) over `seats` by raw Euclidean `(x, z)` distance
 * — a real, standard, fully-deterministic topology algorithm (no `Math.random()`, and Prim's own
 * tie-breaking here is "first candidate found with a strictly smaller key," a pure function of
 * array order, so the same `seats` array always produces the same tree). 13 edges connect all 14
 * seats with none left out and no redundant cycles — see this module's own doc comment for why MST
 * over a complete graph.
 * @param {{id: string, x: number, z: number}[]} seats
 * @returns {{fromId: string, toId: string, distanceMeters: number}[]} One entry per MST edge.
 */
export function computeSeatMST(seats) {
	const n = seats.length;
	if (n < 2) return [];

	const inTree = new Array(n).fill(false);
	const bestDistance = new Array(n).fill(Infinity);
	const bestParent = new Array(n).fill(-1);
	bestDistance[0] = 0;

	const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

	for (let step = 0; step < n; step++) {
		let u = -1;
		let bestKey = Infinity;
		for (let v = 0; v < n; v++) {
			if (!inTree[v] && bestDistance[v] < bestKey) {
				bestKey = bestDistance[v];
				u = v;
			}
		}
		if (u === -1) break; // Disconnected input (shouldn't happen — every seat has finite coordinates).
		inTree[u] = true;
		for (let v = 0; v < n; v++) {
			if (inTree[v]) continue;
			const d = distance(seats[u], seats[v]);
			if (d < bestDistance[v]) {
				bestDistance[v] = d;
				bestParent[v] = u;
			}
		}
	}

	const edges = [];
	for (let v = 0; v < n; v++) {
		if (bestParent[v] === -1) continue;
		const from = seats[bestParent[v]];
		const to = seats[v];
		edges.push({ fromId: from.id, toId: to.id, distanceMeters: distance(from, to) });
	}
	return edges;
}

/**
 * Appends one road-edge polyline's ribbon geometry (positions/colors/indices) into shared arrays —
 * same left/right-perpendicular ribbon technique `world/rivers.js`'s `createRiverMesh` uses, but
 * generalized to append into a combined multi-edge buffer (network roads are disjoint segments, not
 * one continuous path) so a whole multi-edge tier renders as a single mesh / one draw call rather
 * than one draw call per edge.
 * @param {{positions: number[], colors: number[], indices: number[]}} buffers
 * @param {{x: number, y: number, z: number}[]} points
 * @param {number} [widthMeters] Ribbon width — defaults to the original cart-road width
 *   (`ROAD_WIDTH_METERS`) so existing callers are unaffected.
 * @param {THREE.Color} [color] Ribbon color — defaults to `ROAD_COLOR`.
 */
function appendRoadRibbon(buffers, points, widthMeters = ROAD_WIDTH_METERS, color = ROAD_COLOR) {
	if (points.length < 2) return;
	const halfWidth = widthMeters / 2;
	const baseVertex = buffers.positions.length / 3;

	for (let i = 0; i < points.length; i++) {
		const point = points[i];
		const prev = points[Math.max(0, i - 1)];
		const next = points[Math.min(points.length - 1, i + 1)];
		const tangentX = next.x - prev.x;
		const tangentZ = next.z - prev.z;
		const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
		const perpX = -tangentZ / tangentLength;
		const perpZ = tangentX / tangentLength;

		buffers.positions.push(
			point.x + perpX * halfWidth, point.y + VERTICAL_OFFSET_METERS, point.z + perpZ * halfWidth,
			point.x - perpX * halfWidth, point.y + VERTICAL_OFFSET_METERS, point.z - perpZ * halfWidth,
		);
		buffers.colors.push(color.r, color.g, color.b, color.r, color.g, color.b);

		if (i > 0) {
			const leftIndex = baseVertex + i * 2;
			const rightIndex = leftIndex + 1;
			const prevLeft = leftIndex - 2;
			const prevRight = rightIndex - 2;
			buffers.indices.push(prevLeft, prevRight, leftIndex, prevRight, rightIndex, leftIndex);
		}
	}
}

/**
 * Selects which non-MST seat pairs qualify as "patika" footpaths (run 314, ADR-0264): any pair whose
 * raw Euclidean distance is at most `maxLengthMeters` and which the MST (`computeSeatMST`) does not
 * already connect directly. Deliberately Euclidean/topology-only here (not slope-aware) — this only
 * decides *which* pairs get a footpath at all; the actual routed geometry for each selected pair still
 * goes through the same slope-aware `findSlopeAwarePath` every cart-road edge uses (see
 * `buildRoadNetwork`).
 * @param {{id: string, x: number, z: number}[]} seats
 * @param {{fromId: string, toId: string}[]} mstEdges `computeSeatMST`'s output for the same `seats`.
 * @param {number} [maxLengthMeters] See `FOOTPATH_MAX_LENGTH_METERS`.
 * @returns {{fromId: string, toId: string, distanceMeters: number}[]}
 */
export function computeLocalFootpathEdges(seats, mstEdges, maxLengthMeters = FOOTPATH_MAX_LENGTH_METERS) {
	const mstPairKeys = new Set(mstEdges.map((edge) => [edge.fromId, edge.toId].sort().join('|')));
	const footpaths = [];
	for (let i = 0; i < seats.length; i++) {
		for (let j = i + 1; j < seats.length; j++) {
			const a = seats[i];
			const b = seats[j];
			const pairKey = [a.id, b.id].sort().join('|');
			if (mstPairKeys.has(pairKey)) continue;
			const distanceMeters = Math.hypot(a.x - b.x, a.z - b.z);
			if (distanceMeters <= maxLengthMeters) {
				footpaths.push({ fromId: a.id, toId: b.id, distanceMeters });
			}
		}
	}
	return footpaths;
}

/**
 * Builds the full road network: MST topology (`computeSeatMST`) over `seats`, each edge routed by
 * `findSlopeAwarePath` (GOVERNANCE.md §8.10 slope-aware routing), rendered as one merged ribbon mesh.
 * @param {object} options
 * @param {{id: string, x: number, z: number, groundY: number}[]} options.seats `world/settlements.js`'s `createSettlements` returned `seats` (real, terrain-sampled positions).
 * @param {(worldX: number, worldZ: number) => number} options.sampleHeightMeters `world/terrain.js`'s `createHeightSampler` output — the same combined fine-FBM + macro-relief field every other world system reads through.
 * @returns {{group: THREE.Group, edges: {fromId: string, toId: string, points: {x: number, y: number, z: number}[], lengthMeters: number, maxGradeDegrees: number}[], totalLengthMeters: number, maxGradeDegrees: number, footpathEdges: {fromId: string, toId: string, points: {x: number, y: number, z: number}[], lengthMeters: number, maxGradeDegrees: number}[], footpathTotalLengthMeters: number}}
 *   `edges`/`totalLengthMeters`/`maxGradeDegrees` describe the original cart-road tier (unchanged
 *   shape/values from before run 314). `footpathEdges`/`footpathTotalLengthMeters` are the new run
 *   314/ADR-0264 "patika" tier (see `computeLocalFootpathEdges`) — empty/0 if no pair qualifies for a
 *   given seat layout. Exposed for logging/reporting/regression checks (see
 *   `scripts/roadNetworkSafetyCheck.js`) without needing to re-walk `group`'s raw geometry.
 */
export function buildRoadNetwork({ seats, sampleHeightMeters }) {
	const seatsById = new Map(seats.map((seat) => [seat.id, seat]));
	const mstEdges = computeSeatMST(seats);

	function routeEdges(edgeSpecs, widthMeters, color) {
		const buffers = { positions: [], colors: [], indices: [] };
		const routed = [];
		let totalLengthMeters = 0;
		let maxGradeDegrees = 0;

		for (const edgeSpec of edgeSpecs) {
			const from = seatsById.get(edgeSpec.fromId);
			const to = seatsById.get(edgeSpec.toId);
			if (!from || !to) continue; // Defensive — every edge id comes from `seats` itself.

			const { points, maxGradeDegrees: edgeMaxGrade } = findSlopeAwarePath({
				sampleHeightMeters,
				start: { x: from.x, z: from.z },
				end: { x: to.x, z: to.z },
			});
			appendRoadRibbon(buffers, points, widthMeters, color);

			let lengthMeters = 0;
			for (let i = 1; i < points.length; i++) {
				lengthMeters += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
			}
			totalLengthMeters += lengthMeters;
			if (edgeMaxGrade > maxGradeDegrees) maxGradeDegrees = edgeMaxGrade;

			routed.push({ fromId: edgeSpec.fromId, toId: edgeSpec.toId, points, lengthMeters, maxGradeDegrees: edgeMaxGrade });
		}

		return { buffers, routed, totalLengthMeters, maxGradeDegrees };
	}

	function buildMesh(buffers, name) {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffers.positions), 3));
		geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(buffers.colors), 3));
		geometry.setIndex(buffers.indices);
		geometry.computeVertexNormals();

		const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98, metalness: 0, side: THREE.DoubleSide });
		const mesh = new THREE.Mesh(geometry, material);
		mesh.name = name;
		return mesh;
	}

	const cart = routeEdges(mstEdges, ROAD_WIDTH_METERS, ROAD_COLOR);

	const footpathSpecs = computeLocalFootpathEdges(seats, mstEdges);
	const footpath = routeEdges(footpathSpecs, FOOTPATH_WIDTH_METERS, FOOTPATH_COLOR);

	const group = new THREE.Group();
	group.name = 'road-network';
	// Cart-road mesh stays `group.children[0]` — RUN177's medieval-surface shader wrapper (below)
	// reads `group.children[0]` specifically, and `scripts/checkRoadVisualContract.js` asserts this
	// mesh's own vertex/width/color contract, so ordering here is load-bearing, not incidental.
	group.add(buildMesh(cart.buffers, 'roads'));
	if (footpath.routed.length > 0) group.add(buildMesh(footpath.buffers, 'patika'));

	return {
		group,
		edges: cart.routed,
		totalLengthMeters: cart.totalLengthMeters,
		maxGradeDegrees: cart.maxGradeDegrees,
		footpathEdges: footpath.routed,
		footpathTotalLengthMeters: footpath.totalLengthMeters,
	};
}

/**
 * Disposes the road network's geometry/material (memory-leak checklist). Call on scene teardown,
 * alongside `disposeSettlements`/`disposeRiverMesh`.
 * @param {THREE.Group} group `buildRoadNetwork`'s returned `group`.
 */
export function disposeRoadNetwork(group) {
	for (const mesh of group.children) {
		mesh.geometry.dispose();
		mesh.material.dispose();
	}
}


// RUN 177 — owner-approved medieval road surface. This is intentionally appended instead of
// rewriting the proven road topology/geometry so the additive-only source contract remains intact.
const RUN177_MEDIEVAL_ROAD_SURFACE_KEY = 'run177-medieval-road-surface-v2-geographic';
const buildRoadNetworkBeforeMedievalSurfaceRun177 = buildRoadNetwork;

function applyMedievalRoadSurfaceRun177(network) {
	const mesh = network?.group?.children?.[0];
	if (!mesh?.isMesh || !mesh.geometry || !mesh.material?.isMeshStandardMaterial) return network;

	const positions = mesh.geometry.getAttribute('position');
	if (!positions || positions.count % 2 !== 0) return network;

	const roadSide = new Float32Array(positions.count);
	for (let i = 0; i < positions.count; i += 2) {
		roadSide[i] = -1;
		roadSide[i + 1] = 1;
	}
	mesh.geometry.setAttribute('roadSide', new THREE.BufferAttribute(roadSide, 1));

	const material = mesh.material;
	material.userData.medievalRoadSurfaceRun177 = Object.freeze({
		key: RUN177_MEDIEVAL_ROAD_SURFACE_KEY,
		wheelRutOffsetNormalized: 0.47,
		proceduralStoneThreshold: 0.955,
		dryMineralVariation: true,
		extraDrawCalls: 0,
	});

	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nattribute float roadSide;\nvarying float vRun177RoadSide;\nvarying vec3 vRun177RoadPosition;',
			)
			.replace(
				'#include <begin_vertex>',
				'#include <begin_vertex>\nvRun177RoadSide = roadSide;\nvRun177RoadPosition = position;',
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				'#include <common>\nvarying float vRun177RoadSide;\nvarying vec3 vRun177RoadPosition;\nfloat run177RoadHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
float run177Across = abs(vRun177RoadSide);
float run177WheelRut = 1.0 - smoothstep(0.07, 0.17, abs(run177Across - 0.47));
float run177CenterCrown = 1.0 - smoothstep(0.00, 0.28, run177Across);
float run177ShoulderWear = smoothstep(0.72, 1.00, run177Across);
float run177StoneNoise = run177RoadHash(floor(vRun177RoadPosition.xz * 0.70));
float run177Stone = step(0.955, run177StoneNoise) * (1.0 - run177WheelRut) * (1.0 - run177ShoulderWear * 0.4);
float run177MudNoise = run177RoadHash(floor(vRun177RoadPosition.xz * 0.12) + vec2(19.0, 7.0));
float run177MudPatch = step(0.82, run177MudNoise) * (0.35 + run177WheelRut * 0.65);
float run177DryNoise = run177RoadHash(floor(vRun177RoadPosition.xz * 0.035) + vec2(43.0, 11.0));
float run177MineralNoise = run177RoadHash(floor(vRun177RoadPosition.xz * 0.19) + vec2(3.0, 31.0));
float run177DryTone = (run177DryNoise - 0.5) * 0.11;
float run177MineralDust = smoothstep(0.58, 0.94, run177MineralNoise) * (0.25 + run177ShoulderWear * 0.75);
diffuseColor.rgb *= 1.0 - run177WheelRut * 0.22 - run177ShoulderWear * 0.08 - run177MudPatch * 0.09;
diffuseColor.rgb *= 1.0 + run177CenterCrown * 0.028 + run177DryTone;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.34, 0.29), run177Stone * 0.32);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.48, 0.37), run177MineralDust * 0.10);`,
			);
	};
	material.customProgramCacheKey = () => RUN177_MEDIEVAL_ROAD_SURFACE_KEY;
	material.needsUpdate = true;
	return network;
}

buildRoadNetwork = function buildRoadNetworkWithMedievalSurfaceRun177(options) {
	return applyMedievalRoadSurfaceRun177(buildRoadNetworkBeforeMedievalSurfaceRun177(options));
};
