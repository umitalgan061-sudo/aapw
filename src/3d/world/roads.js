/**
 * Deterministic terrain-following road network for the canonical kingdom seats.
 * Topology, slope routing, terrain sampling and water-gap authority stay unchanged; the final
 * material pass only naturalizes the visible cart-road and footpath surfaces.
 * @module world/roads
 */

import * as THREE from 'three';
import { WORLD_DEFAULTS } from '../config.js';
import { findSlopeAwarePath } from './roadPathfinder.js';
import { GEOGRAPHIC_REFERENCE_PALETTE, GEOGRAPHIC_REFERENCE_PALETTE_POLICY } from './geographicReferencePalette.js';

const ROAD_WIDTH_METERS = 8;
const FOOTPATH_WIDTH_METERS = 2.5;
const VERTICAL_OFFSET_METERS = 0.4;
const ROAD_WATER_AUDIT_SPACING_METERS = 6;
const ROAD_MAX_SUBMERGED_RIBBON_RUN_METERS = ROAD_WATER_AUDIT_SPACING_METERS;
const FOOTPATH_MAX_LENGTH_METERS = 700;

const ROAD_COLOR = new THREE.Color(0x816b4f);
const FOOTPATH_COLOR = new THREE.Color(0xa08c6b);
const ROAD_REFERENCE_COLORS = Object.freeze({
	compacted: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.road.compacted),
	rut: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.road.rut),
	dust: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.road.dust),
	stone: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.road.stone),
	mossEdge: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.road.mossEdge),
});
ROAD_COLOR.copy(ROAD_REFERENCE_COLORS.compacted);
FOOTPATH_COLOR.copy(ROAD_REFERENCE_COLORS.dust);

export const ROAD_SURFACE_REALISM_POLICY = Object.freeze({
	id: 'road-surface-realism-2026-08-31-v4-cart-footpath-pbr',
	renderOnly: true,
	canonicalTopologyUnchanged: true,
	canonicalTerrainUnchanged: true,
	canonicalHydrologyUnchanged: true,
	cartRoadSurface: true,
	footpathSurface: true,
	worldSpaceMultiScaleAlbedo: true,
	worldSpaceNormalVariation: true,
	worldSpaceRoughnessVariation: true,
	irregularEdgeWeathering: true,
	terrainIngressAtShoulder: true,
	deterministic: true,
});

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
			buffers.indices.push(leftIndex - 2, rightIndex - 2, leftIndex, rightIndex - 2, rightIndex, leftIndex);
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
			if (distanceMeters <= maxLengthMeters) footpaths.push({ fromId: a.id, toId: b.id, distanceMeters });
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
				const gapDiagnostics = Object.freeze({ ...diagnostics, transportGap: true, transportGapReason, waterExposure });
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
			routed.push({
				fromId: edgeSpec.fromId,
				toId: edgeSpec.toId,
				points,
				lengthMeters,
				maxGradeDegrees: edgeMaxGrade,
				routeElapsedMs,
				diagnostics,
				waterExposure,
			});
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

const RUN177_MEDIEVAL_ROAD_SURFACE_KEY = 'run177-medieval-road-surface-v4-cart-footpath-pbr';
const buildRoadNetworkBeforeMedievalSurfaceRun177 = buildRoadNetwork;

function applyRoadSurfaceToMesh(mesh, tier) {
	if (!mesh?.isMesh || !mesh.geometry || !mesh.material?.isMeshStandardMaterial) return;
	const positions = mesh.geometry.getAttribute('position');
	if (!positions || positions.count % 2 !== 0) return;
	const roadSide = new Float32Array(positions.count);
	for (let i = 0; i < positions.count; i += 2) {
		roadSide[i] = -1;
		roadSide[i + 1] = 1;
	}
	mesh.geometry.setAttribute('roadSide', new THREE.BufferAttribute(roadSide, 1));

	const isFootpath = tier === 'footpath';
	const wheelRutGain = isFootpath ? 0 : 1;
	const treadGain = isFootpath ? 1 : 0.28;
	const edgeGain = isFootpath ? 1.18 : 1;
	const normalGain = isFootpath ? 0.16 : 0.20;
	const material = mesh.material;
	material.userData.medievalRoadSurfaceRun177 = Object.freeze({
		key: RUN177_MEDIEVAL_ROAD_SURFACE_KEY,
		tier,
		wheelRutOffsetNormalized: isFootpath ? null : 0.47,
		centralTread: true,
		proceduralStoneThreshold: 0.84,
		worldSpaceMultiScaleWeathering: true,
		worldSpaceNormalVariation: true,
		roughnessVariation: true,
		photogrammetryShoulderMoss: true,
		irregularEdgeErosion: true,
		terrainIngressAtShoulder: true,
		referencePalettePolicyId: GEOGRAPHIC_REFERENCE_PALETTE_POLICY.id,
		extraDrawCalls: 0,
	});

	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nattribute float roadSide;\nvarying float vRun177RoadSide;\nvarying vec3 vRun177RoadPosition;')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRun177RoadSide = roadSide;\nvRun177RoadPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
varying float vRun177RoadSide;
varying vec3 vRun177RoadPosition;
float run177RoadHash(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
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
vec2 run177World = vRun177RoadPosition.xz;
vec2 run177Warp = vec2(run177RoadFbm(run177World * 0.005 + vec2(11.7, -4.3)), run177RoadFbm(run177World * 0.005 + vec2(-7.1, 18.9))) - 0.5;
float run177Macro = run177RoadFbm(run177World * 0.018 + run177Warp * 2.4);
float run177Meso = run177RoadFbm(run177World * 0.072 + run177Warp * 4.8 + vec2(31.0, 9.0));
float run177Fine = run177RoadFbm(run177World * 0.31 + run177Warp * 6.5 + vec2(-16.2, 37.4));
float run177WheelRut = (1.0 - smoothstep(0.07, 0.17, abs(run177Across - 0.47))) * ${wheelRutGain.toFixed(2)};
float run177CenterTread = (1.0 - smoothstep(0.14, 0.62, run177Across)) * ${treadGain.toFixed(2)};
float run177CenterCrown = (1.0 - smoothstep(0.00, 0.28, run177Across)) * ${(1 - treadGain * 0.45).toFixed(2)};
float run177ShoulderWear = smoothstep(0.70, 1.0, run177Across);
float run177Stone = smoothstep(0.82, 0.94, run177Fine) * (1.0 - run177WheelRut * 0.72) * (1.0 - run177CenterTread * 0.45);
float run177MudPatch = smoothstep(0.68, 0.88, run177Macro * 0.62 + run177Meso * 0.38) * (0.24 + run177WheelRut * 0.62 + run177CenterTread * 0.34);
float run177MineralDust = smoothstep(0.60, 0.87, run177Meso) * (0.22 + run177ShoulderWear * 0.78);
float run177EdgeMacro = run177RoadFbm(run177World * 0.011 + run177Warp * 3.1 + vec2(-18.4, 7.9));
float run177EdgeMeso = run177RoadFbm(run177World * 0.094 + vec2(6.8, -27.3));
float run177ShoulderCut = mix(0.91, 1.015, run177EdgeMacro * 0.65 + run177EdgeMeso * 0.35);
if (run177Across > run177ShoulderCut) discard;
float run177EdgeThreshold = mix(0.70, 0.91, run177EdgeMacro);
float run177EdgeErosion = smoothstep(run177EdgeThreshold, 1.0, run177Across) * smoothstep(0.28, 0.79, run177EdgeMeso) * ${edgeGain.toFixed(2)};
float run177TerrainIngress = smoothstep(mix(0.77, 0.93, run177EdgeMeso), 1.0, run177Across) * smoothstep(0.36, 0.75, 1.0 - run177Macro) * ${edgeGain.toFixed(2)};
vec3 run177RutReference = vec3(${ROAD_REFERENCE_COLORS.rut.r.toFixed(4)}, ${ROAD_REFERENCE_COLORS.rut.g.toFixed(4)}, ${ROAD_REFERENCE_COLORS.rut.b.toFixed(4)});
vec3 run177DustReference = vec3(${ROAD_REFERENCE_COLORS.dust.r.toFixed(4)}, ${ROAD_REFERENCE_COLORS.dust.g.toFixed(4)}, ${ROAD_REFERENCE_COLORS.dust.b.toFixed(4)});
vec3 run177StoneReference = vec3(${ROAD_REFERENCE_COLORS.stone.r.toFixed(4)}, ${ROAD_REFERENCE_COLORS.stone.g.toFixed(4)}, ${ROAD_REFERENCE_COLORS.stone.b.toFixed(4)});
vec3 run177MossReference = vec3(${ROAD_REFERENCE_COLORS.mossEdge.r.toFixed(4)}, ${ROAD_REFERENCE_COLORS.mossEdge.g.toFixed(4)}, ${ROAD_REFERENCE_COLORS.mossEdge.b.toFixed(4)});
float run177DryTone = (run177Macro - 0.5) * 0.105 + (run177Meso - 0.5) * 0.050 + (run177Fine - 0.5) * 0.018;
diffuseColor.rgb *= 1.0 + run177DryTone + run177CenterCrown * 0.022 - run177WheelRut * 0.17 - run177CenterTread * 0.075 - run177MudPatch * 0.10;
diffuseColor.rgb = mix(diffuseColor.rgb, run177StoneReference, run177Stone * 0.24);
diffuseColor.rgb = mix(diffuseColor.rgb, run177DustReference, run177MineralDust * 0.12);
diffuseColor.rgb = mix(diffuseColor.rgb, run177RutReference, (run177WheelRut * 0.22 + run177CenterTread * 0.09) * smoothstep(0.50, 0.88, run177Macro));
vec3 run177IrregularShoulder = mix(run177StoneReference, run177MossReference, smoothstep(0.42, 0.76, 1.0 - run177Meso));
diffuseColor.rgb = mix(diffuseColor.rgb, run177IrregularShoulder, run177EdgeErosion * 0.24);
diffuseColor.rgb = mix(diffuseColor.rgb, run177MossReference, run177TerrainIngress * 0.22);`,
			)
			.replace(
				'#include <roughnessmap_fragment>',
				`#include <roughnessmap_fragment>
float run177RoughField = run177RoadFbm(vRun177RoadPosition.xz * 0.031 + vec2(13.0, 27.0));
roughnessFactor = clamp(0.91 + (run177RoughField - 0.5) * 0.13 + run177Stone * 0.05 + run177EdgeErosion * 0.04 - run177WheelRut * 0.075 - run177CenterTread * 0.035, 0.76, 1.0);`,
			)
			.replace(
				'#include <normal_fragment_maps>',
				`#include <normal_fragment_maps>
vec2 run177NormalP = vRun177RoadPosition.xz * 0.23 + run177Warp * 2.8;
float run177Nx = run177RoadFbm(run177NormalP + vec2(0.18, 0.0)) - run177RoadFbm(run177NormalP - vec2(0.18, 0.0));
float run177Nz = run177RoadFbm(run177NormalP + vec2(0.0, 0.18)) - run177RoadFbm(run177NormalP - vec2(0.0, 0.18));
float run177CompactionNormal = 1.0 - run177WheelRut * 0.35 - run177CenterTread * 0.20;
vec3 run177WorldPerturb = vec3(-run177Nx, 0.0, -run177Nz) * ${normalGain.toFixed(2)} * run177CompactionNormal;
normal = normalize(normal + mat3(viewMatrix) * run177WorldPerturb);`,
			);
	};
	material.customProgramCacheKey = () => `${RUN177_MEDIEVAL_ROAD_SURFACE_KEY}:${tier}`;
	material.needsUpdate = true;
}

function applyMedievalRoadSurfaceRun177(network) {
	for (const mesh of network?.group?.children ?? []) {
		applyRoadSurfaceToMesh(mesh, mesh.name === 'patika' ? 'footpath' : 'cart');
	}
	return network;
}

buildRoadNetwork = function buildRoadNetworkWithMedievalSurfaceRun177(options) {
	return applyMedievalRoadSurfaceRun177(buildRoadNetworkBeforeMedievalSurfaceRun177(options));
};
