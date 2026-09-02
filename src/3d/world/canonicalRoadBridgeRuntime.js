/**
 * Live adoption of the owner-approved medieval stone-bridge policy for the shipped road network.
 *
 * `world/roads.js` remains the authority for current water transport gaps. A bridge replaces the
 * submerged ribbon between two dry banks; it is not required to overlap the obsolete underwater
 * route point-for-point. Canonical terrain, hydrology and topology remain unchanged.
 * @module world/canonicalRoadBridgeRuntime
 */

import * as THREE from 'three';
import { WORLD_DEFAULTS } from '../config.js';
import {
	STONE_BRIDGE_OWNER_POLICY,
	createCanonicalStoneBridgeGeometry,
} from './worldReferenceStoneBridgeShadow.js';

export const CANONICAL_ROAD_BRIDGE_RUNTIME_POLICY = Object.freeze({
	id: 'canonical-road-stone-bridge-live-2026-09-02-v3-bank-to-bank-reroute',
	ownerPolicy: STONE_BRIDGE_OWNER_POLICY.key,
	roadWaterAuditSpacingMeters: 6,
	maxApproachGradeDegrees: 18,
	maxApproachLengthMeters: 320,
	roadVerticalOffsetMeters: 0.4,
	deckSurfaceOffsetMeters: 0.04,
	canonicalTopologyUnchanged: true,
	canonicalTerrainUnchanged: true,
	canonicalHydrologyUnchanged: true,
	liveRoadWaterAuthority: true,
	waterRouteSuppressionRequired: true,
	dryRoadPreservationRequired: true,
	batchedBridgeGeometry: true,
	groundSurfaceMetadataExported: true,
	groundResolverAvailable: true,
});

const RESTORATION_MESH_NAME = 'canonical-bridge-road-restoration';
const BRIDGE_GROUP_NAME = 'canonical-stone-bridges-live';

function round(value, digits = 3) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function distance2(a, b) {
	return Math.hypot(a.x - b.x, a.z - b.z);
}

function gradeDegrees(a, b) {
	return THREE.MathUtils.radToDeg(Math.atan2(Math.abs(b.y - a.y), Math.max(0.001, distance2(a, b))));
}

function nearestPointIndex(points, target, minIndex = 0, maxIndex = points.length - 1) {
	let bestIndex = minIndex;
	let bestDistance = Infinity;
	for (let index = minIndex; index <= maxIndex; index += 1) {
		const distance = Math.hypot(points[index].x - target.x, points[index].z - target.z);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = index;
		}
	}
	return bestIndex;
}

function finalRoadY(sampleHeightMeters, point) {
	return sampleHeightMeters(point.x, point.z) + CANONICAL_ROAD_BRIDGE_RUNTIME_POLICY.roadVerticalOffsetMeters;
}

function isRoadPointSubmerged(sampleHeightMeters, point) {
	return finalRoadY(sampleHeightMeters, point) < WORLD_DEFAULTS.WATER_LEVEL_METERS;
}

/** Mirrors `roads.js::measureSubmergedRibbonExposure` at the same 6 m spacing. */
function sampleLiveRoadWater(points, sampleHeightMeters) {
	const samples = [];
	for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
		const start = points[segmentIndex - 1];
		const end = points[segmentIndex];
		const dx = end.x - start.x;
		const dz = end.z - start.z;
		const segmentLengthMeters = Math.hypot(dx, dz);
		const intervalCount = Math.max(1, Math.ceil(
			segmentLengthMeters / CANONICAL_ROAD_BRIDGE_RUNTIME_POLICY.roadWaterAuditSpacingMeters,
		));
		const intervalMeters = segmentLengthMeters / intervalCount;
		const invLength = segmentLengthMeters > 1e-6 ? 1 / segmentLengthMeters : 0;
		const ux = segmentLengthMeters > 1e-6 ? dx * invLength : 1;
		const uz = segmentLengthMeters > 1e-6 ? dz * invLength : 0;
		for (let intervalIndex = 1; intervalIndex <= intervalCount; intervalIndex += 1) {
			const t = intervalIndex / intervalCount;
			const x = start.x + dx * t;
			const z = start.z + dz * t;
			const ribbonY = sampleHeightMeters(x, z) + CANONICAL_ROAD_BRIDGE_RUNTIME_POLICY.roadVerticalOffsetMeters;
			samples.push(Object.freeze({
				x,
				z,
				submerged: ribbonY < WORLD_DEFAULTS.WATER_LEVEL_METERS,
				intervalMeters,
				ux,
				uz,
			}));
		}
	}
	return samples;
}

function collectLiveWaterCrossings(samples) {
	const crossings = [];
	let current = null;
	for (const sample of samples) {
		if (sample.submerged) {
			if (!current) current = { samples: [], waterMeters: 0 };
			current.samples.push(sample);
			current.waterMeters += sample.intervalMeters;
		} else if (current) {
			crossings.push(current);
			current = null;
		}
	}
	if (current) crossings.push(current);
	return crossings;
}

function crossingDirection(crossing) {
	const first = crossing.samples[0];
	const last = crossing.samples[crossing.samples.length - 1];
	let dx = last.x - first.x;
	let dz = last.z - first.z;
	let length = Math.hypot(dx, dz);
	if (length > 1e-4) return { ux: dx / length, uz: dz / length, chordMeters: length };
	let ux = 0;
	let uz = 0;
	for (const sample of crossing.samples) {
		ux += sample.ux;
		uz += sample.uz;
	}
	length = Math.hypot(ux, uz);
	if (length < 1e-6) return { ux: 1, uz: 0, chordMeters: Math.max(crossing.waterMeters, 0.001) };
	return { ux: ux / length, uz: uz / length, chordMeters: Math.max(crossing.waterMeters, 0.001) };
}

function bridgeFromLiveCrossing(gap, crossing, crossingIndex, sampleHeightMeters) {
	const first = crossing.samples[0];
	const last = crossing.samples[crossing.samples.length - 1];
	const { ux, uz, chordMeters } = crossingDirection(crossing);
	const margin = STONE_BRIDGE_OWNER_POLICY.bankMarginMeters;
	const start = { x: first.x - ux * margin, z: first.z - uz * margin };
	const end = { x: last.x + ux * margin, z: last.z + uz * margin };
	const structuralSpanMeters = Math.max(0.001, Math.hypot(end.x - start.x, end.z - start.z));
	const archCount = Math.max(1, Math.ceil(structuralSpanMeters / STONE_BRIDGE_OWNER_POLICY.targetArchSpanMeters));
	const archSpanMeters = structuralSpanMeters / archCount;
	const archRiseMeters = Math.min(
		STONE_BRIDGE_OWNER_POLICY.maximumArchRiseMeters,
		Math.max(STONE_BRIDGE_OWNER_POLICY.minimumArchRiseMeters, archSpanMeters * 0.22),
	);
	const startGroundY = sampleHeightMeters(start.x, start.z);
	const endGroundY = sampleHeightMeters(end.x, end.z);
	const deckBottomY = Math.max(
		startGroundY,
		endGroundY,
		WORLD_DEFAULTS.WATER_LEVEL_METERS + archRiseMeters + 0.8,
	);
	const deckY = deckBottomY + STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5;
	return Object.freeze({
		id: `${gap.fromId}->${gap.toId}#${crossingIndex + 1}`,
		edgeId: `${gap.fromId}->${gap.toId}`,
		fromId: gap.fromId,
		toId: gap.toId,
		crossingIndex,
		waterMeters: round(crossing.waterMeters),
		waterChordMeters: round(chordMeters),
		structuralSpanMeters: round(structuralSpanMeters),
		archCount,
		archSpanMeters: round(archSpanMeters),
		archRiseMeters: round(archRiseMeters),
		bridgeWidthMeters: STONE_BRIDGE_OWNER_POLICY.bridgeWidthMeters,
		deckY: round(deckY),
		startGroundY: round(startGroundY),
		endGroundY: round(endGroundY),
		centerX: round((start.x + end.x) * 0.5),
		centerZ: round((start.z + end.z) * 0.5),
		yawRadians: round(Math.atan2(-uz, ux), 6),
		startX: round(start.x),
		startZ: round(start.z),
		endX: round(end.x),
		endZ: round(end.z),
	});
}

function buildLiveBridgePlanForGap(gap, sampleHeightMeters) {
	const crossings = collectLiveWaterCrossings(sampleLiveRoadWater(gap.points, sampleHeightMeters));
	if (crossings.length === 0) return null;
	return Object.freeze({
		bridges: Object.freeze(crossings.map((crossing, index) => (
			bridgeFromLiveCrossing(gap, crossing, index, sampleHeightMeters)
		))),
		waterSampleCount: crossings.reduce((sum, crossing) => sum + crossing.samples.length, 0),
		waterMeters: round(crossings.reduce((sum, crossing) => sum + crossing.waterMeters, 0)),
	});
}

function orientBridgeToRoute(points, bridge) {
	const start = { x: bridge.startX, z: bridge.startZ };
	const end = { x: bridge.endX, z: bridge.endZ };
	const startIndex = nearestPointIndex(points, start);
	const endIndex = nearestPointIndex(points, end);
	if (startIndex <= endIndex) return { bridge, routeStart: start, routeEnd: end, startIndex, endIndex };
	return { bridge, routeStart: end, routeEnd: start, startIndex: endIndex, endIndex: startIndex };
}

function resolveBridgeRange(points, oriented, sampleHeightMeters, searchFloor) {
	const { bridge, routeStart, routeEnd } = oriented;
	const deckTopY = bridge.deckY + STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5
		+ CANONICAL_ROAD_BRIDGE_RUNTIME_POLICY.deckSurfaceOffsetMeters;
	const startTarget = { x: routeStart.x, y: deckTopY, z: routeStart.z };
	const endTarget = { x: routeEnd.x, y: deckTopY, z: routeEnd.z };
	const startIndex = nearestPointIndex(points, routeStart, searchFloor);
	const endIndex = nearestPointIndex(points, routeEnd, startIndex);
	let startApproachIndex = -1;
	for (let index = startIndex; index >= searchFloor; index -= 1) {
		const raw = points[index];
		if (isRoadPointSubmerged(sampleHeightMeters, raw)) continue;
		const candidate = { x: raw.x, y: finalRoadY(sampleHeightMeters, raw), z: raw.z };
		if (
			distance2(candidate, startTarget) <= CANONICAL_ROAD_BRIDGE_RUNTIME_POLICY.maxApproachLengthMeters
			&& gradeDegrees(candidate, startTarget) <= CANONICAL_ROAD_BRIDGE_RUNTIME_POLICY.maxApproachGradeDegrees
		) {
			startApproachIndex = index;
			break;
		}
	}
	let endApproachIndex = -1;
	for (let index = endIndex; index < points.length; index += 1) {
		const raw = points[index];
		if (isRoadPointSubmerged(sampleHeightMeters, raw)) continue;
		const candidate = { x: raw.x, y: finalRoadY(sampleHeightMeters, raw), z: raw.z };
		if (
			distance2(candidate, endTarget) <= CANONICAL_ROAD_BRIDGE_RUNTIME_POLICY.maxApproachLengthMeters
			&& gradeDegrees(candidate, endTarget) <= CANONICAL_ROAD_BRIDGE_RUNTIME_POLICY.maxApproachGradeDegrees
		) {
			endApproachIndex = index;
			break;
		}
	}
	if (startApproachIndex < 0 || endApproachIndex < 0 || endApproachIndex <= startApproachIndex) return null;
	const startRaw = points[startApproachIndex];
	const endRaw = points[endApproachIndex];
	const startPoint = { x: startRaw.x, y: finalRoadY(sampleHeightMeters, startRaw), z: startRaw.z };
	const endPoint = { x: endRaw.x, y: finalRoadY(sampleHeightMeters, endRaw), z: endRaw.z };
	return Object.freeze({
		bridge,
		startIndex: startApproachIndex,
		endIndex: endApproachIndex,
		startApproach: Object.freeze({
			from: startPoint,
			to: startTarget,
			lengthMeters: distance2(startPoint, startTarget),
			gradeDegrees: gradeDegrees(startPoint, startTarget),
		}),
		endApproach: Object.freeze({
			from: endTarget,
			to: endPoint,
			lengthMeters: distance2(endTarget, endPoint),
			gradeDegrees: gradeDegrees(endTarget, endPoint),
		}),
	});
}

function routePlanForGap(gap, liveBridgePlan, sampleHeightMeters) {
	const oriented = liveBridgePlan.bridges
		.map((bridge) => orientBridgeToRoute(gap.points, bridge))
		.sort((a, b) => a.startIndex - b.startIndex);
	const ranges = [];
	let searchFloor = 0;
	for (const entry of oriented) {
		const range = resolveBridgeRange(gap.points, entry, sampleHeightMeters, searchFloor);
		if (!range) return null;
		ranges.push(range);
		searchFloor = Math.min(gap.points.length - 1, range.endIndex + 1);
	}
	return Object.freeze({ ranges: Object.freeze(ranges), waterSampleCount: liveBridgePlan.waterSampleCount });
}

function createRibbonBuffers(sourceRoadMesh) {
	const sourceColors = sourceRoadMesh?.geometry?.getAttribute?.('color');
	return {
		positions: [], colors: [], roadSide: [], indices: [],
		color: {
			r: sourceColors?.count ? sourceColors.getX(0) : 0.50,
			g: sourceColors?.count ? sourceColors.getY(0) : 0.42,
			b: sourceColors?.count ? sourceColors.getZ(0) : 0.31,
		},
	};
}

function appendRibbon(buffers, points, widthMeters = STONE_BRIDGE_OWNER_POLICY.bridgeWidthMeters) {
	if (points.length < 2) return;
	const halfWidth = widthMeters * 0.5;
	const baseVertex = buffers.positions.length / 3;
	for (let index = 0; index < points.length; index += 1) {
		const point = points[index];
		const previous = points[Math.max(0, index - 1)];
		const next = points[Math.min(points.length - 1, index + 1)];
		const tangentX = next.x - previous.x;
		const tangentZ = next.z - previous.z;
		const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
		const perpendicularX = -tangentZ / tangentLength;
		const perpendicularZ = tangentX / tangentLength;
		buffers.positions.push(
			point.x + perpendicularX * halfWidth, point.y, point.z + perpendicularZ * halfWidth,
			point.x - perpendicularX * halfWidth, point.y, point.z - perpendicularZ * halfWidth,
		);
		buffers.colors.push(
			buffers.color.r, buffers.color.g, buffers.color.b,
			buffers.color.r, buffers.color.g, buffers.color.b,
		);
		buffers.roadSide.push(-1, 1);
		if (index > 0) {
			const left = baseVertex + index * 2;
			buffers.indices.push(left - 2, left - 1, left, left - 1, left + 1, left);
		}
	}
}

function appendDryRouteRuns(buffers, gap, ranges, sampleHeightMeters) {
	let run = [];
	let renderedPointCount = 0;
	for (let index = 0; index < gap.points.length; index += 1) {
		const raw = gap.points[index];
		const suppressed = ranges.some((range) => index >= range.startIndex && index <= range.endIndex);
		if (suppressed || isRoadPointSubmerged(sampleHeightMeters, raw)) {
			appendRibbon(buffers, run);
			run = [];
			continue;
		}
		renderedPointCount += 1;
		run.push({ x: raw.x, y: finalRoadY(sampleHeightMeters, raw), z: raw.z });
	}
	appendRibbon(buffers, run);
	return renderedPointCount;
}

function createRestorationMesh(buffers, roadMaterial) {
	if (buffers.positions.length === 0 || buffers.indices.length === 0 || !roadMaterial) return null;
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3));
	geometry.setAttribute('roadSide', new THREE.Float32BufferAttribute(buffers.roadSide, 1));
	geometry.setIndex(buffers.indices);
	geometry.computeVertexNormals();
	geometry.computeBoundingSphere();
	const mesh = new THREE.Mesh(geometry, roadMaterial);
	mesh.name = RESTORATION_MESH_NAME;
	mesh.userData.canonicalBridgeRoadRestoration = true;
	return mesh;
}

export function installCanonicalRoadBridgeRuntime(network, { sampleHeightMeters } = {}) {
	if (!network?.group || typeof sampleHeightMeters !== 'function') return network;
	if (network.group.children.some((child) => child.userData?.canonicalBridgeRuntimeMesh)) return network;
	const roadMesh = network.group.getObjectByName('roads');
	if (!roadMesh?.material) return network;
	const sourceWaterGaps = (network.unroutableEdges ?? []).filter(
		(gap) => gap?.diagnostics?.transportGapReason === 'submerged-route',
	);
	const restorationBuffers = createRibbonBuffers(roadMesh);
	const restoredEdges = [];
	const restoredGapSet = new Set();
	const activatedBridges = [];
	const approachRecords = [];
	let restoredDryRoadPointCount = 0;
	let suppressedWaterSampleCount = 0;

	for (const gap of sourceWaterGaps) {
		const liveBridgePlan = buildLiveBridgePlanForGap(gap, sampleHeightMeters);
		if (!liveBridgePlan) continue;
		const routePlan = routePlanForGap(gap, liveBridgePlan, sampleHeightMeters);
		if (!routePlan) continue;
		restoredDryRoadPointCount += appendDryRouteRuns(restorationBuffers, gap, routePlan.ranges, sampleHeightMeters);
		for (const range of routePlan.ranges) {
			appendRibbon(restorationBuffers, [range.startApproach.from, range.startApproach.to]);
			appendRibbon(restorationBuffers, [range.endApproach.from, range.endApproach.to]);
			activatedBridges.push(range.bridge);
			approachRecords.push(range.startApproach, range.endApproach);
		}
		suppressedWaterSampleCount += routePlan.waterSampleCount;
		restoredGapSet.add(gap);
		restoredEdges.push(Object.freeze({
			...gap,
			diagnostics: Object.freeze({
				...gap.diagnostics,
				transportGap: false,
				transportGapReason: null,
				bridgeRestored: true,
				bridgeIds: Object.freeze(routePlan.ranges.map((range) => range.bridge.id)),
				suppressedWaterSampleCount: routePlan.waterSampleCount,
			}),
		}));
	}

	const remainingGaps = (network.unroutableEdges ?? []).filter((gap) => !restoredGapSet.has(gap));
	const remainingWaterGapCount = remainingGaps.filter(
		(gap) => gap?.diagnostics?.transportGapReason === 'submerged-route',
	).length;
	const remainingGradeFallbackCount = remainingGaps.filter(
		(gap) => gap?.diagnostics?.transportGapReason === 'grade-fallback',
	).length;
	if (activatedBridges.length === 0) {
		network.bridgeRuntime = Object.freeze({
			policyId: CANONICAL_ROAD_BRIDGE_RUNTIME_POLICY.id,
			ownerPolicy: STONE_BRIDGE_OWNER_POLICY.key,
			status: sourceWaterGaps.length > 0 ? 'live-water-gaps-unrestored' : 'no-live-water-gaps',
			bridgeCount: 0,
			affectedEdgeCount: 0,
			sourceWaterGapCount: sourceWaterGaps.length,
			unrestoredWaterGapCount: remainingWaterGapCount,
			remainingGradeFallbackCount,
			waterSuppression: Object.freeze({ suppressed: 0, total: 0 }),
			groundSurfaces: Object.freeze([]),
			colliderSegments: Object.freeze([]),
		});
		return network;
	}

	const restorationMesh = createRestorationMesh(restorationBuffers, roadMesh.material);
	if (restorationMesh) network.group.add(restorationMesh);
	const bridgeGroup = createCanonicalStoneBridgeGeometry({ bridges: activatedBridges });
	const bridgeMeshes = [...bridgeGroup.children];
	const managedMaterials = new Set();
	for (const mesh of bridgeMeshes) {
		bridgeGroup.remove(mesh);
		mesh.name = `${BRIDGE_GROUP_NAME}:${mesh.name || mesh.type}`;
		mesh.userData.canonicalBridgeRuntimeMesh = true;
		const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		for (const material of materials) {
			if (!material || managedMaterials.has(material)) continue;
			managedMaterials.add(material);
			const mappedTexture = material.map;
			if (mappedTexture && !material.userData?.canonicalBridgeTextureDisposeGuard) {
				const originalDispose = material.dispose.bind(material);
				let textureDisposed = false;
				material.dispose = () => {
					if (!textureDisposed) { mappedTexture.dispose(); textureDisposed = true; }
					originalDispose();
				};
				material.userData.canonicalBridgeTextureDisposeGuard = true;
			}
		}
		network.group.add(mesh);
	}

	network.edges = [...(network.edges ?? []), ...restoredEdges];
	network.unroutableEdges = remainingGaps;
	network.totalLengthMeters = (network.totalLengthMeters ?? 0)
		+ restoredEdges.reduce((sum, edge) => sum + (edge.lengthMeters || 0), 0);
	network.maxGradeDegrees = Math.max(
		network.maxGradeDegrees ?? 0,
		...restoredEdges.map((edge) => edge.maxGradeDegrees || 0),
		...approachRecords.map((approach) => approach.gradeDegrees),
	);

	const colliderSegments = activatedBridges.map((bridge) => Object.freeze({
		id: bridge.id,
		startX: bridge.startX,
		startZ: bridge.startZ,
		endX: bridge.endX,
		endZ: bridge.endZ,
		widthMeters: bridge.bridgeWidthMeters,
		deckTopY: bridge.deckY + STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5
			+ CANONICAL_ROAD_BRIDGE_RUNTIME_POLICY.deckSurfaceOffsetMeters,
	}));
	const totalWaterSampleCount = sourceWaterGaps.reduce((sum, gap) => (
		sum + collectLiveWaterCrossings(sampleLiveRoadWater(gap.points, sampleHeightMeters))
			.reduce((gapSum, crossing) => gapSum + crossing.samples.length, 0)
	), 0);
	const runtime = Object.freeze({
		policyId: CANONICAL_ROAD_BRIDGE_RUNTIME_POLICY.id,
		ownerPolicy: STONE_BRIDGE_OWNER_POLICY.key,
		status: 'active-render-topology',
		bridgeCount: activatedBridges.length,
		affectedEdgeCount: restoredEdges.length,
		sourceWaterGapCount: sourceWaterGaps.length,
		unrestoredWaterGapCount: remainingWaterGapCount,
		remainingGradeFallbackCount,
		bridgeIds: Object.freeze(activatedBridges.map((bridge) => bridge.id)),
		approachCount: approachRecords.length,
		maxApproachGradeDegrees: Math.max(...approachRecords.map((approach) => approach.gradeDegrees), 0),
		maxApproachLengthMeters: Math.max(...approachRecords.map((approach) => approach.lengthMeters), 0),
		restoredDryRoadPointCount,
		waterSuppression: Object.freeze({ suppressed: suppressedWaterSampleCount, total: totalWaterSampleCount }),
		groundSurfaces: Object.freeze([
			...colliderSegments.map((segment) => Object.freeze({
				id: segment.id,
				kind: 'deck',
				widthMeters: segment.widthMeters,
				from: Object.freeze({ x: segment.startX, y: segment.deckTopY, z: segment.startZ }),
				to: Object.freeze({ x: segment.endX, y: segment.deckTopY, z: segment.endZ }),
			})),
			...approachRecords.map((approach, index) => Object.freeze({
				id: `approach-${index + 1}`,
				kind: 'approach',
				widthMeters: STONE_BRIDGE_OWNER_POLICY.bridgeWidthMeters,
				from: Object.freeze({ ...approach.from }),
				to: Object.freeze({ ...approach.to }),
			})),
		]),
		colliderSegments: Object.freeze(colliderSegments),
	});
	network.bridgeRuntime = runtime;
	network.bridgeColliderSegments = runtime.colliderSegments;
	network.bridgeGroundSurfaces = runtime.groundSurfaces;
	network.group.userData.canonicalRoadBridgeRuntime = runtime;
	return network;
}

function groundSurfaceHeightAt(surface, worldX, worldZ) {
	const ax = surface.from.x;
	const az = surface.from.z;
	const bx = surface.to.x;
	const bz = surface.to.z;
	const dx = bx - ax;
	const dz = bz - az;
	const lengthSquared = dx * dx + dz * dz;
	if (lengthSquared < 1e-6) return null;
	const t = ((worldX - ax) * dx + (worldZ - az) * dz) / lengthSquared;
	if (t < 0 || t > 1) return null;
	const centerX = ax + dx * t;
	const centerZ = az + dz * t;
	if (Math.hypot(worldX - centerX, worldZ - centerZ) > surface.widthMeters * 0.5) return null;
	return surface.from.y + (surface.to.y - surface.from.y) * t;
}

export function createCanonicalRoadBridgeGroundHeightResolver(groundSurfaces, sampleTerrainHeightMeters) {
	if (typeof sampleTerrainHeightMeters !== 'function') throw new TypeError('sampleTerrainHeightMeters must be a function');
	const surfaces = Array.isArray(groundSurfaces) ? groundSurfaces : [];
	return function sampleBridgeAwareGroundHeight(worldX, worldZ) {
		const terrainY = sampleTerrainHeightMeters(worldX, worldZ);
		let surfaceY = -Infinity;
		for (const surface of surfaces) {
			const candidate = groundSurfaceHeightAt(surface, worldX, worldZ);
			if (candidate != null && candidate > surfaceY) surfaceY = candidate;
		}
		return Number.isFinite(surfaceY) ? Math.max(terrainY, surfaceY) : terrainY;
	};
}

export function disposeCanonicalRoadBridgeRuntime(roadGroup) {
	if (!roadGroup) return;
	for (const child of [...roadGroup.children]) {
		if (!child.userData?.canonicalBridgeRuntimeMesh) continue;
		roadGroup.remove(child);
		child.geometry?.dispose?.();
		if (Array.isArray(child.material)) child.material.forEach((material) => material?.dispose?.());
		else child.material?.dispose?.();
	}
	const restorationMesh = roadGroup.getObjectByName(RESTORATION_MESH_NAME);
	if (restorationMesh?.parent === roadGroup) {
		roadGroup.remove(restorationMesh);
		restorationMesh.geometry?.dispose?.();
	}
	delete roadGroup.userData.canonicalRoadBridgeRuntime;
}
