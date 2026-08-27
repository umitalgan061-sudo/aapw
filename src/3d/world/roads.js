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
// Run 406: 0.06 m, down from 0.4 m. At eye level a 40 cm lift does not read as a road, it reads as a
// causeway -- the close-up render showed the tan surface standing above the ground on both sides with
// a hard vertical drop, which is the single largest reason the roads looked artificial. The lift was
// only ever there to keep the ribbon out of the terrain's own depth values; `polygonOffset` on the
// material does that job properly, without pushing the surface into the air.
const VERTICAL_OFFSET_METERS = 0.06;

/** Dirt/path color — a warm tan-brown, deliberately distinct from `world/terrain.js`'s grass
 * (`0x3d6b28`) and bare-rock (`0x6b6152`) height colors so the road reads clearly against either. */
const ROAD_COLOR = new THREE.Color(0x9c7b4a);

/** Ribbon width, in meters, for the second "patika" (footpath) tier (run 314, ADR-0264) — narrow
 * enough to read as a walked dirt track rather than a cart road, wider than a single-file trail so it
 * stays visible at typical play-camera distance. Roughly a third of `ROAD_WIDTH_METERS`. */
const FOOTPATH_WIDTH_METERS = 2.5;

/** Footpath color — a paler, more worn tan than `ROAD_COLOR` (less compacted dirt, no cart-wheel
 * churn) so the two tiers read as visually distinct at a glance, while staying in the same warm
 * dirt-path family (not a jarring color swap). */
const FOOTPATH_COLOR = new THREE.Color(0xbfae82);

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
// Exported additively in run 361 so `world/worldReferenceRoadNetwork.js` can draw the owner map's own
// highways with exactly this ribbon geometry, rather than growing a second, slightly different one.
// The MST network above is untouched.
export function appendRoadRibbon(buffers, points, widthMeters = ROAD_WIDTH_METERS, color = ROAD_COLOR, sampleHeightMeters = null) {
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

		// **Each edge of the ribbon is grounded on its own terrain, not on the centreline's.**
		// Both edge vertices used to take `point.y`, the height sampled at the middle of the road. That
		// is only correct where the ground is level *across* the road: on any cross-slope the ribbon
		// stays horizontal while the ground under it tilts, so the downhill edge lifts into the air by
		// half the width times the cross-grade — a 30-degree cross-slope floats a 4 m half-width by
		// 2.3 m — and the uphill edge buries itself. That is the pale sheet standing off the hillside in
		// the village renders. Sampling each edge where it actually lies makes the ribbon follow the
		// ground it is lying on. Falls back to the centreline height when no sampler is supplied, so
		// existing callers keep their current behaviour.
		const leftX = point.x + perpX * halfWidth;
		const leftZ = point.z + perpZ * halfWidth;
		const rightX = point.x - perpX * halfWidth;
		const rightZ = point.z - perpZ * halfWidth;
		const leftY = sampleHeightMeters ? sampleHeightMeters(leftX, leftZ) : point.y;
		const rightY = sampleHeightMeters ? sampleHeightMeters(rightX, rightZ) : point.y;

		buffers.positions.push(
			leftX, leftY + VERTICAL_OFFSET_METERS, leftZ,
			rightX, rightY + VERTICAL_OFFSET_METERS, rightZ,
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
			appendRoadRibbon(buffers, points, widthMeters, color, sampleHeightMeters);

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

// `polygonOffset` is what keeps the ribbon in front of the terrain now that it is only 6 cm above it
// -- a depth bias applied at rasterisation rather than a physical lift, so the road lies on the ground
// instead of hovering over it. The four properties `scripts/checkRoadVisualContract.js` pins (type,
// vertexColors, roughness, metalness, side) are unchanged.
		const material = new THREE.MeshStandardMaterial({
			vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
			polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
		});
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
const RUN177_MEDIEVAL_ROAD_SURFACE_KEY = 'run177-medieval-road-surface-v1';
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
diffuseColor.rgb *= 1.0 - run177WheelRut * 0.22 - run177ShoulderWear * 0.10 - run177MudPatch * 0.08;
diffuseColor.rgb *= 1.0 + run177CenterCrown * 0.035;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.38, 0.31), run177Stone * 0.35);`,
			);
	};
	material.customProgramCacheKey = () => RUN177_MEDIEVAL_ROAD_SURFACE_KEY;
	material.needsUpdate = true;
	return network;
}

buildRoadNetwork = function buildRoadNetworkWithMedievalSurfaceRun177(options) {
	return applyMedievalRoadSurfaceRun177(buildRoadNetworkBeforeMedievalSurfaceRun177(options));
};


// RUN 406 — "yollar çok yapay görünüyor": the road stops being a painted band.
//
// The owner's own reference is in the repository. PR #961 ("yol glb ekledim") uploaded
// `fbx/dusty_path_in_the_fields.glb` and `fbx/snowy_road.glb`, and `fbx/dirt_road_test.glb` sits
// beside them. Rendering `dirt_road_test.glb` — a textured dirt track on grass — against what this
// module draws says exactly where the artificial look comes from, and it is not the surface detail
// run 177 added:
//
// | the reference | this module before run 406 |
// |---|---|
// | the dirt frays into the grass, boundary meanders | one straight edge, ruler-perfect |
// | grass creeps in, worn brown ground either side | dirt meets green with nothing between |
// | lighter and darker stretches along its length | one flat tan the whole way |
//
// So: a **ragged, wandering boundary** instead of a straight cut, a **worn verge** where the dirt
// gives way to trodden ground, and **large-scale variation along the road**. All three are fragment
// shader work on the ribbon that is already there.
//
// **Nothing this run touches is measured by an existing contract.** `checkRoadVisualContract.js`
// pins the geometry (centre, width, vertical offset, per-vertex colour) and the material's type,
// `vertexColors`, `roughness`, `metalness` and `side`; `checkMedievalRoadSurface.js` pins run 177's
// `roadSide` attribute, its `userData` style block and its program cache key. This adds one float
// attribute and chains `onBeforeCompile`, and changes no material property and no vertex — the
// boundary is cut with `discard`, which is why it needs no `alphaTest` flag and no transparency
// (transparency would have put a sorted, depth-writing surface over the terrain for a look that
// `discard` gives outright).
//
// It keeps run 177's cache key deliberately: that key is asserted by name, and both patches are
// applied unconditionally to every road material, so a program compiled under it is always this
// shader. Add a third patch that can be applied selectively and that stops being true.
const RUN406_NATURAL_ROAD_EDGE_KEY = 'run406-natural-road-edge-v1';
const buildRoadNetworkBeforeNaturalEdgeRun406 = buildRoadNetwork;

/** Its own attribute rather than run 177's `roadSide`: re-declaring that one in the same shader is a
 * compile error, and a second float per vertex is cheaper than making the two patches aware of each
 * other. Same convention — `-1` on the left edge, `+1` on the right. */
function ensureRun406SideAttribute(geometry) {
	if (geometry.getAttribute('run406RoadSide')) return true;
	const positions = geometry.getAttribute('position');
	if (!positions || positions.count % 2 !== 0) return false;
	const side = new Float32Array(positions.count);
	for (let i = 0; i < positions.count; i += 2) {
		side[i] = -1;
		side[i + 1] = 1;
	}
	geometry.setAttribute('run406RoadSide', new THREE.BufferAttribute(side, 1));
	return true;
}

function applyNaturalRoadEdgeRun406(network) {
	for (const mesh of network?.group?.children ?? []) {
		if (!mesh?.isMesh || !mesh.geometry || !mesh.material?.isMeshStandardMaterial) continue;
		if (!ensureRun406SideAttribute(mesh.geometry)) continue;

		const material = mesh.material;
		material.userData.naturalRoadEdgeRun406 = Object.freeze({
			key: RUN406_NATURAL_ROAD_EDGE_KEY,
			// Fraction of the half-width that always survives; the rest is eaten by noise, so the
			// drawn road is never wider than the ribbon and never narrower than this.
			minimumKeptHalfWidthNormalized: 0.52,
			extraDrawCalls: 0,
		});

		const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
		material.onBeforeCompile = (shader, renderer) => {
			previousOnBeforeCompile(shader, renderer);
			shader.vertexShader = shader.vertexShader
				.replace(
					'#include <common>',
					'#include <common>\nattribute float run406RoadSide;\nvarying float vRun406Side;\nvarying vec3 vRun406Position;',
				)
				.replace(
					'#include <begin_vertex>',
					'#include <begin_vertex>\nvRun406Side = run406RoadSide;\nvRun406Position = position;',
				);
			shader.fragmentShader = shader.fragmentShader
				.replace(
					'#include <common>',
					`#include <common>
varying float vRun406Side;
varying vec3 vRun406Position;
float run406Hash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.3))) * 24634.6345); }
float run406Noise(vec2 p) {
	vec2 cell = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = run406Hash(cell);
	float b = run406Hash(cell + vec2(1.0, 0.0));
	float c = run406Hash(cell + vec2(0.0, 1.0));
	float d = run406Hash(cell + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float run406Fbm(vec2 p) {
	return run406Noise(p) * 0.6 + run406Noise(p * 2.3) * 0.27 + run406Noise(p * 5.1) * 0.13;
}`,
				)
				.replace(
					'#include <color_fragment>',
					`#include <color_fragment>
float run406Across = abs(vRun406Side);
// The boundary is cut in world space, so it wanders with the ground rather than with the ribbon's
// own vertices -- two edges that happen to run parallel do not fray in step.
float run406EdgeNoise = run406Fbm(vRun406Position.xz * 0.42);
float run406KeptHalfWidth = 0.52 + run406EdgeNoise * 0.46;
if (run406Across > run406KeptHalfWidth) discard;
// Where the dirt gives out it does not simply stop: it thins into trodden ground with grass coming
// back through it, which is what the owner's own reference shows either side of the track.
float run406Verge = smoothstep(run406KeptHalfWidth * 0.55, run406KeptHalfWidth, run406Across);
float run406Regrowth = run406Fbm(vRun406Position.xz * 1.7);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.34, 0.19), run406Verge * (0.24 + run406Regrowth * 0.42));
// Lighter and darker stretches along the length, so no two hundred metres read the same.
float run406Along = run406Fbm(vRun406Position.xz * 0.028);
diffuseColor.rgb *= 0.87 + run406Along * 0.29;`,
				);
		};
		material.needsUpdate = true;
	}
	return network;
}

buildRoadNetwork = function buildRoadNetworkWithNaturalEdgeRun406(options) {
	return applyNaturalRoadEdgeRun406(buildRoadNetworkBeforeNaturalEdgeRun406(options));
};
