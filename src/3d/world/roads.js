/**
 * Road network: connects the 14 kingdom seats (`world/settlements.js`'s `KINGDOM_SEATS`) with a
 * minimum-spanning-tree road topology, each edge routed by `world/roadPathfinder.js`'s slope-aware
 * A* (not a straight line �?" see that module's doc comment and DECISIONS.md ADR-0076), and rendered
 * as a single merged dirt-colored ribbon mesh following the real combined terrain height
 * (`world/terrain.js`'s fine FBM + run-55's `MACRO_RELIEF_FEATURES`, sampled through the exact same
 * `createHeightSampler` output every other world system already reads through).
 *
 * Topology: a minimum spanning tree over the 14 seats (13 edges, one connected network, no cycles).
 * Edges that require an unsafe grade fallback or cross canonical water remain explicit non-rendered
 * transport gaps, preserving the topology without drawing a road over a cliff or along the seabed.
 * rather than a complete point-to-point graph (91 possible pairs) �?" GOVERNANCE.md ��18's own task
 * text explicitly allows this ("a minimum-spanning-tree-style network... is fine and arguably more
 * realistic than a complete graph"). MST topology is chosen by raw Euclidean seat-to-seat distance
 * (a standard, deterministic MST �?" see `computeSeatMST`); *within* each chosen edge, the actual
 * routed path is slope-aware, not Euclidean-straight �?" topology selection and path routing are
 * deliberately separate concerns (see ADR-0076's Alternatives considered for why a slope-aware
 * topology cost was not worth the extra complexity here).
 *
 * Two road tiers (run 314, ADR-0264, owner-approved 2026-08-12 �?" see QUESTIONS_FOR_OWNER.md's run 56
 * entry): the original "ana yol" / at arabas�� yolu (main cart road) MST backbone above, plus a second,
 * thinner "patika" (footpath) tier �?" short, purely local connections between kingdom seats close
 * enough to be neighboring villages/holdings but not directly linked by the MST backbone (which
 * already routes their traffic through a shared close neighbor). See `computeLocalFootpathEdges` and
 * `FOOTPATH_MAX_LENGTH_METERS` below for the exact selection rule. Rendered as a second, separate
 * merged mesh (own width/color) alongside the unchanged cart-road mesh �?" the cart-road mesh's own
 * vertex/color/width contract (`scripts/checkRoadVisualContract.js`) is untouched by this addition.
 * @module world/roads
 */

import * as THREE from 'three';
import { WORLD_DEFAULTS } from '../config.js';
import { findSlopeAwarePath } from './roadPathfinder.js';
import { GEOGRAPHIC_REFERENCE_PALETTE, GEOGRAPHIC_REFERENCE_PALETTE_POLICY } from './geographicReferencePalette.js';

/** Ribbon width, in meters, for the single road tier this first pass renders �?" wide enough to read
 * clearly as a real cart road against the terrain at this world's scale (chunks are 500m/edge),
 * narrower than a settlement keep (34m) so it never competes visually with castles. */
const ROAD_WIDTH_METERS = 8;

/** Meters above the sampled terrain height the ribbon is raised �?" avoids z-fighting with the ground
 * mesh directly beneath it. Slightly larger than `world/rivers.js`'s 0.3m offset since roads sit on
 * dry, often-rougher fine-noise terrain (no water surface smoothing nearby to hide a thinner gap). */
const VERTICAL_OFFSET_METERS = 0.4;

/** Dense canonical-water audit for rendered ribbons. A route can satisfy grade limits while still
 * following the seabed; any continuous submerged ribbon run longer than one audit interval remains
 * an explicit transport gap until a bridge/ferry system owns that geography. */
const ROAD_WATER_AUDIT_SPACING_METERS = 6;
const ROAD_MAX_SUBMERGED_RIBBON_RUN_METERS = ROAD_WATER_AUDIT_SPACING_METERS;

/** Muted mineral-earth base derived from the supplied mountain-road photogrammetry. It deliberately
 * avoids the old saturated golden-tan, allowing sunlight and procedural dust/stone variation to
 * create warmth instead of baking orange into every road under every time of day. */
const ROAD_COLOR = new THREE.Color(0x816b4f);

/** Ribbon width, in meters, for the second "patika" (footpath) tier (run 314, ADR-0264) �?" narrow
 * enough to read as a walked dirt track rather than a cart road, wider than a single-file trail so it
 * stays visible at typical play-camera distance. Roughly a third of `ROAD_WIDTH_METERS`. */
const FOOTPATH_WIDTH_METERS = 2.5;

/** Footpaths are drier/worn but stay in the same low-saturation mineral family as cart roads. */
const FOOTPATH_COLOR = new THREE.Color(0xa08c6b);

const ROAD_REFERENCE_COLORS = Object.freeze({
	compacted: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.road.compacted),
	rut: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.road.rut),
	dust: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.road.dust),
	stone: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.road.stone),
	mossEdge: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.road.mossEdge),
});
ROAD_COLOR.lerp(ROAD_REFERENCE_COLORS.compacted, 0.58);
FOOTPATH_COLOR.lerp(ROAD_REFERENCE_COLORS.dust, 0.28);
ROAD_COLOR.copy(ROAD_REFERENCE_COLORS.compacted);
FOOTPATH_COLOR.copy(ROAD_REFERENCE_COLORS.dust);

/** Maximum seat-to-seat Euclidean distance, in meters, for a non-MST pair to qualify as a "patika"
 * footpath (run 314, ADR-0264 �?" answers ADR-0076's deferred "every edge, or only short/local ones"
 * question: only short/local ones). Deliberately conservative �?" well under every real MST edge's own
 * length except the tight `olena`<->`berk`/`ziya`<->`olena` pair (~110-125m) �?" so this only picks up
 * genuine "same small cluster, one direct hop apart" gaps (today: `ziya`<->`berk`, ~150-160m) rather
 * than fanning out a dense web of long, mutually near-parallel shortcuts across the whole map (the
 * next-closest non-MST pairs are all 1.1km+, roughly 7x farther �?" see DECISIONS.md ADR-0264's Context
 * for the full measured distance table). Revisit this threshold if a future seat layout change makes
 * more genuinely-local gaps worth connecting. */
const FOOTPATH_MAX_LENGTH_METERS = 700;

/**
 * Builds a minimum spanning tree (Prim's algorithm) over `seats` by raw Euclidean `(x, z)` distance
 * �?" a real, standard, fully-deterministic topology algorithm (no `Math.random()`, and Prim's own
 * tie-breaking here is "first candidate found with a strictly smaller key," a pure function of
 * array order, so the same `seats` array always produces the same tree). 13 edges connect all 14
 * seats with none left out and no redundant cycles �?" see this module's own doc comment for why MST
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
		if (u === -1) break;
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

function measureSubmergedRibbonExposure(points, sampleHeightMeters) {
	let currentRunMeters = 0;
	let maxSubmergedRunMeters = 0;
	let totalSubmergedMeters = 0;
	let submergedSampleCount = 0;
	for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
		const start = points[segmentIndex - 1];
		const end = points[segmentIndex];
		const segmentLengthMeters = Math.hypot(end.x - start.x, end.z - start.z);
		const intervalCount = Math.max(1, Math.ceil(segmentLengthMeters / ROAD_WATER_AUDIT_SPACING_METERS));
		const intervalMeters = segmentLengthMeters / intervalCount;
		for (let intervalIndex = 1; intervalIndex <= intervalCount; intervalIndex += 1) {
			const t = intervalIndex / intervalCount;
			const x = start.x + (end.x - start.x) * t;
			const z = start.z + (end.z - start.z) * t;
			const ribbonY = sampleHeightMeters(x, z) + VERTICAL_OFFSET_METERS;
			if (ribbonY < WORLD_DEFAULTS.WATER_LEVEL_METERS) {
				currentRunMeters += intervalMeters;
				totalSubmergedMeters += intervalMeters;
				submergedSampleCount += 1;
				maxSubmergedRunMeters = Math.max(maxSubmergedRunMeters, currentRunMeters);
			} else {
				currentRunMeters = 0;
			}
		}
	}
	return Object.freeze({
		auditSpacingMeters: ROAD_WATER_AUDIT_SPACING_METERS,
		maxAllowedRunMeters: ROAD_MAX_SUBMERGED_RIBBON_RUN_METERS,
		maxSubmergedRunMeters,
		totalSubmergedMeters,
		submergedSampleCount,
	});
}

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

export function buildRoadNetwork({ seats, sampleHeightMeters }) {
	const seatsById = new Map(seats.map((seat) => [seat.id, seat]));
	const mstEdges = computeSeatMST(seats);

	function routeEdges(edgeSpecs, widthMeters, color) {
		const buffers = { positions: [], colors: [], indices: [] };
		const routed = [];
		const unroutable = [];
		let totalLengthMeters = 0;
		let maxGradeDegrees = 0;

		for (const edgeSpec of edgeSpecs) {
			const from = seatsById.get(edgeSpec.fromId);
			const to = seatsById.get(edgeSpec.toId);
			if (!from || !to) continue;

			const routeStartedAt = globalThis.performance?.now?.() ?? Date.now();
			const { points, maxGradeDegrees: edgeMaxGrade, diagnostics } = findSlopeAwarePath({
				sampleHeightMeters,
				start: { x: from.x, z: from.z },
				end: { x: to.x, z: to.z },
			});
			const routeElapsedMs = (globalThis.performance?.now?.() ?? Date.now()) - routeStartedAt;
			let lengthMeters = 0;
			for (let i = 1; i < points.length; i++) {
				lengthMeters += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
			}
			const waterExposure = measureSubmergedRibbonExposure(points, sampleHeightMeters);
			const submergedRoute = waterExposure.maxSubmergedRunMeters > ROAD_MAX_SUBMERGED_RIBBON_RUN_METERS;
			if (diagnostics?.fallback || submergedRoute) {
				const transportGapReason = diagnostics?.fallback ? 'grade-fallback' : 'submerged-route';
				const gapDiagnostics = Object.freeze({
					...diagnostics,
					transportGap: true,
					transportGapReason,
					waterExposure,
				});
				unroutable.push({
					fromId: edgeSpec.fromId,
					toId: edgeSpec.toId,
					points,
					lengthMeters,
					maxGradeDegrees: edgeMaxGrade,
					routeElapsedMs,
					diagnostics: gapDiagnostics,
					waterExposure,
				});
				continue;
			}
			appendRoadRibbon(buffers, points, widthMeters, color);

			totalLengthMeters += lengthMeters;
			if (edgeMaxGrade > maxGradeDegrees) maxGradeDegrees = edgeMaxGrade;
			routed.push({ fromId: edgeSpec.fromId, toId: edgeSpec.toId, points, lengthMeters, maxGradeDegrees: edgeMaxGrade, routeElapsedMs, diagnostics, waterExposure });
		}

		return { buffers, routed, unroutable, totalLengthMeters, maxGradeDegrees };
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
	group.add(buildMesh(cart.buffers, 'roads'));
	if (footpath.routed.length > 0) group.add(buildMesh(footpath.buffers, 'patika'));

	return {
		group,
		edges: cart.routed,
		unroutableEdges: cart.unroutable,
		totalLengthMeters: cart.totalLengthMeters,
		maxGradeDegrees: cart.maxGradeDegrees,
		footpathEdges: footpath.routed,
		unroutableFootpathEdges: footpath.unroutable,
		footpathTotalLengthMeters: footpath.totalLengthMeters,
	};
}

export function disposeRoadNetwork(group) {
	for (const mesh of group.children) {
		mesh.geometry.dispose();
		mesh.material.dispose();
	}
}

// RUN 177 �?" owner-approved medieval road surface. The geometry/topology stays authoritative; this
// material-only pass adds deterministic world-space cart wear, stones, dust and moisture variation.
const RUN177_MEDIEVAL_ROAD_SURFACE_KEY = 'run177-medieval-road-surface-v3-world-weathering';
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
		proceduralStoneThreshold: 0.84,
		dryMineralVariation: true,
		worldSpaceMultiScaleWeathering: true,
		roughnessVariation: true,
		referencePalettePolicyId: GEOGRAPHIC_REFERENCE_PALETTE_POLICY.id,
		photogrammetryShoulderMoss: true,
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
				'#include <begin_vertex>\nvRun177RoadSide = roadSide;\nvRun177RoadPosition = (modelMatrix * vec4(position, 1.0)).xyz;',
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
varying float vRun177RoadSide;
varying vec3 vRun177RoadPosition;
float run177RoadHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float run177RoadNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = run177RoadHash(i); float b = run177RoadHash(i + vec2(1.0, 0.0));
  float c = run177RoadHash(i + vec2(0.0, 1.0)); float d = run177RoadHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float run177RoadFbm(vec2 p) {
  return run177RoadNoise(p) * 0.58 + run177RoadNoise(p * 2.13 + vec2(17.3, 5.1)) * 0.28 + run177RoadNoise(p * 5.17 + vec2(-9.7, 23.4)) * 0.14;
}`,
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
float run177Across = abs(vRun177RoadSide);
float run177WheelRut = 1.0 - smoothstep(0.07, 0.17, abs(run177Across - 0.47));
float run177CenterCrown = 1.0 - smoothstep(0.00, 0.28, run177Across);
float run177ShoulderWear = smoothstep(0.72, 1.00, run177Across);
vec2 run177World = vRun177RoadPosition.xz;
vec2 run177Warp = vec2(run177RoadFbm(run177World * 0.005 + vec2(11.7, -4.3)), run177RoadFbm(run177World * 0.005 + vec2(-7.1, 18.9))) - 0.5;
float run177Macro = run177RoadFbm(run177World * 0.018 + run177Warp * 2.4);
float run177Meso = run177RoadFbm(run177World * 0.072 + run177Warp * 4.8 + vec2(31.0, 9.0));
float run177StoneField = run177RoadFbm(run177World * 0.46 + run177Warp * 7.0 + vec2(5.0, 41.0));
float run177Stone = smoothstep(0.84, 0.94, run177StoneField) * (1.0 - run177WheelRut * 0.72) * (1.0 - run177ShoulderWear * 0.28);
float run177MudPatch = smoothstep(0.69, 0.89, run177Macro * 0.62 + run177Meso * 0.38) * (0.28 + run177WheelRut * 0.72);
float run177DryTone = (run177Macro - 0.5) * 0.10 + (run177Meso - 0.5) * 0.045;
float run177MineralDust = smoothstep(0.61, 0.88, run177Meso) * (0.25 + run177ShoulderWear * 0.75);
diffuseColor.rgb *= 1.0 - run177WheelRut * 0.18 - run177ShoulderWear * 0.065 - run177MudPatch * 0.105;
diffuseColor.rgb *= 1.0 + run177CenterCrown * 0.026 + run177DryTone;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.34, 0.29), run177Stone * 0.30);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.48, 0.37), run177MineralDust * 0.11);
vec3 run177RutReference = vec3(${ROAD_REFERENCE_COLORS.rut.r.toFixed(4)}, ${ROAD_REFERENCE_COLORS.rut.g.toFixed(4)}, ${ROAD_REFERENCE_COLORS.rut.b.toFixed(4)});
vec3 run177DustReference = vec3(${ROAD_REFERENCE_COLORS.dust.r.toFixed(4)}, ${ROAD_REFERENCE_COLORS.dust.g.toFixed(4)}, ${ROAD_REFERENCE_COLORS.dust.b.toFixed(4)});
vec3 run177StoneReference = vec3(${ROAD_REFERENCE_COLORS.stone.r.toFixed(4)}, ${ROAD_REFERENCE_COLORS.stone.g.toFixed(4)}, ${ROAD_REFERENCE_COLORS.stone.b.toFixed(4)});
vec3 run177MossReference = vec3(${ROAD_REFERENCE_COLORS.mossEdge.r.toFixed(4)}, ${ROAD_REFERENCE_COLORS.mossEdge.g.toFixed(4)}, ${ROAD_REFERENCE_COLORS.mossEdge.b.toFixed(4)});
float run177DampRut = run177WheelRut * smoothstep(0.54, 0.88, run177Macro);
float run177MossShoulder = run177ShoulderWear * smoothstep(0.60, 0.90, 1.0 - run177Meso) * (1.0 - run177MineralDust);
diffuseColor.rgb = mix(diffuseColor.rgb, run177RutReference, run177DampRut * 0.22);
diffuseColor.rgb = mix(diffuseColor.rgb, run177StoneReference, run177Stone * 0.16);
diffuseColor.rgb = mix(diffuseColor.rgb, run177DustReference, run177MineralDust * 0.10);
diffuseColor.rgb = mix(diffuseColor.rgb, run177MossReference, run177MossShoulder * 0.18);`,
			)
			.replace(
				'#include <roughnessmap_fragment>',
				`#include <roughnessmap_fragment>
float run177RoughRut = 1.0 - smoothstep(0.07, 0.17, abs(abs(vRun177RoadSide) - 0.47));
float run177RoughField = run177RoadFbm(vRun177RoadPosition.xz * 0.031 + vec2(13.0, 27.0));
roughnessFactor = clamp(roughnessFactor - run177RoughRut * 0.055 + (run177RoughField - 0.5) * 0.085, 0.76, 1.0);`,
			);
	};
	material.customProgramCacheKey = () => RUN177_MEDIEVAL_ROAD_SURFACE_KEY;
	material.needsUpdate = true;
	return network;
}

buildRoadNetwork = function buildRoadNetworkWithMedievalSurfaceRun177(options) {
	return applyMedievalRoadSurfaceRun177(buildRoadNetworkBeforeMedievalSurfaceRun177(options));
};

