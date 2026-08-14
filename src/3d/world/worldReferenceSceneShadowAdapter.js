/**
 * Run 193 reusable shadow-only scene adapter for the planned canonical full-reference world.
 *
 * It composes the already-qualified canonical terrain, bridge-aware roads, medieval stone bridges,
 * bounded rocks and the existing water surface into one disposable scene window. No live runtime
 * module imports this adapter; it exists only to prove a bounded future integration contract before
 * the full-reference world is allowed to replace the current live scene.
 * @module world/worldReferenceSceneShadowAdapter
 */

import * as THREE from 'three';
import { WORLD_DEFAULTS, SETTLEMENT_CONFIG } from '../config.js';
import { createHeightSampler } from './terrain.js';
import { KINGDOM_SEATS, computeSettlementFlattenPads, mapToWorldXZ } from './settlements.js';
import { computeSeatMST } from './roads.js';
import { findSlopeAwarePath } from './roadPathfinder.js';
import { createWater, updateWater, disposeWater } from './water.js';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { referenceProtectionRadiiFromMeters, sampleSeatSafeReferenceHydrology } from './worldReferenceHydrology.js';
import {
	FULL_REFERENCE_MAP_BOUNDS,
	FULL_REFERENCE_WORLD_MIGRATION_PLAN,
	plannedWorldXZToMapCanvas,
} from './worldReferenceMigrationPlan.js';
import { createCanonicalHydrologyTerrainSampler } from './worldReferenceTerrainAdapter.js';
import { createCanonicalTerrainShadowChunk, disposeCanonicalTerrainShadowChunk } from './worldReferenceChunkShadow.js';
import {
	generateCanonicalRockShadowCandidates,
	classifyRockRoadClearance,
	createCanonicalRockShadowGeometry,
	disposeCanonicalRockShadowGeometry,
} from './worldReferenceRockShadow.js';
import {
	STONE_BRIDGE_OWNER_POLICY,
	buildCanonicalStoneBridgePlan,
} from './worldReferenceStoneBridgeShadow.js';
import {
	createCanonicalStoneBridgeMedievalArtV2,
	disposeCanonicalStoneBridgeMedievalArtV2,
} from './worldReferenceStoneBridgeMedievalArtV2.js';

export const CANONICAL_SCENE_SHADOW_POLICY = Object.freeze({
	key: 'run193-canonical-scene-shadow-adapter-v1',
	maxApproachGradeDegrees: 18,
	maxApproachLengthMeters: 320,
	roadLiftMeters: 0.4,
	roadWidthMeters: STONE_BRIDGE_OWNER_POLICY.bridgeWidthMeters,
	profiles: Object.freeze({
		mobile: Object.freeze({ radiusMeters: 1200, terrainChunkRadius: 2, terrainSegments: 32, rockProfile: 'mobile' }),
		desktop: Object.freeze({ radiusMeters: 1700, terrainChunkRadius: 3, terrainSegments: 32, rockProfile: 'desktop' }),
	}),
});

function assertFinite(value, label) {
	if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function distanceXZ(a, b) {
	return Math.hypot(a.x - b.x, a.z - b.z);
}

function pointSegmentDistanceXZ(point, a, b) {
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const length2 = dx * dx + dz * dz;
	if (length2 <= 1e-12) return Math.hypot(point.x - a.x, point.z - a.z);
	const t = THREE.MathUtils.clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / length2, 0, 1);
	return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

function projectPointToSegmentXZ(x, z, a, b) {
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const length2 = dx * dx + dz * dz;
	if (length2 <= 1e-12) return { t: 0, rawT: 0, lateralMeters: Math.hypot(x - a.x, z - a.z) };
	const rawT = ((x - a.x) * dx + (z - a.z) * dz) / length2;
	const t = THREE.MathUtils.clamp(rawT, 0, 1);
	return {
		t,
		rawT,
		lateralMeters: Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)),
	};
}

function gradeDegrees(a, b) {
	return THREE.MathUtils.radToDeg(Math.atan2(Math.abs(b.y - a.y), Math.max(0.001, distanceXZ(a, b))));
}

function nearestPointIndex(points, target, minIndex = 0, maxIndex = points.length - 1) {
	let best = minIndex;
	let bestDistance = Infinity;
	for (let index = minIndex; index <= maxIndex; index += 1) {
		const distance = Math.hypot(points[index].x - target.x, points[index].z - target.z);
		if (distance < bestDistance) {
			best = index;
			bestDistance = distance;
		}
	}
	return best;
}

function buildCanonicalContext() {
	const migration = FULL_REFERENCE_WORLD_MIGRATION_PLAN;
	const seaLevelMeters = WORLD_DEFAULTS.WATER_LEVEL_METERS;
	const natural = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
	const pads = computeSettlementFlattenPads({
		sampleHeightMeters: natural,
		seaLevelMeters,
		minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
		mapBounds: FULL_REFERENCE_MAP_BOUNDS,
		metersPerMapUnit: migration.metersPerMapUnit,
	});
	const base = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
	const protectionRadii = referenceProtectionRadiiFromMeters(pads[0].outerRadiusMeters, migration.metersPerMapUnit);
	const protectedSites = KINGDOM_SEATS.map((seat) => ({
		id: seat.id,
		...mapCanvasToNormalizedReference(seat.mapX, seat.mapY),
	}));
	const sampler = createCanonicalHydrologyTerrainSampler({
		baseHeightSampler: base,
		seaLevelMeters,
		protectedSites,
		protectionRadii,
	});
	const hydrologyAtWorld = (x, z) => {
		const map = plannedWorldXZToMapCanvas(x, z);
		const reference = mapCanvasToNormalizedReference(map.x, map.y);
		return sampleSeatSafeReferenceHydrology(reference.x, reference.y, protectedSites, protectionRadii);
	};
	return { migration, seaLevelMeters, sampler, hydrologyAtWorld };
}

function buildRoutes(context) {
	const seats = KINGDOM_SEATS.map((seat) => ({
		id: seat.id,
		...mapToWorldXZ(
			seat.mapX,
			seat.mapY,
			FULL_REFERENCE_MAP_BOUNDS,
			context.migration.metersPerMapUnit,
		),
	}));
	const seatById = new Map(seats.map((seat) => [seat.id, seat]));
	return computeSeatMST(seats).map((edge) => {
		const route = findSlopeAwarePath({
			sampleHeightMeters: context.sampler,
			start: seatById.get(edge.fromId),
			end: seatById.get(edge.toId),
		});
		return Object.freeze({
			edgeId: `${edge.fromId}->${edge.toId}`,
			fromId: edge.fromId,
			toId: edge.toId,
			points: route.points,
		});
	});
}

function buildBridgeTransitions(routes, bridgePlan, context) {
	const bridgesByEdge = new Map();
	for (const bridge of bridgePlan.bridges) {
		if (!bridgesByEdge.has(bridge.edgeId)) bridgesByEdge.set(bridge.edgeId, []);
		bridgesByEdge.get(bridge.edgeId).push(bridge);
	}
	for (const bridges of bridgesByEdge.values()) bridges.sort((a, b) => a.crossingIndex - b.crossingIndex);

	const approaches = [];
	const suppressionByEdge = new Map();
	let totalWaterRoutePoints = 0;
	let coveredWaterRoutePoints = 0;

	for (const route of routes) {
		const ranges = [];
		let searchFloor = 0;
		for (const bridge of bridgesByEdge.get(route.edgeId) || []) {
			const deckTopY = bridge.deckY + STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5;
			const startTarget = { x: bridge.startX, y: deckTopY, z: bridge.startZ };
			const endTarget = { x: bridge.endX, y: deckTopY, z: bridge.endZ };
			let startIndex = nearestPointIndex(route.points, startTarget, searchFloor);
			let endIndex = nearestPointIndex(route.points, endTarget, startIndex);
			if (endIndex < startIndex) [startIndex, endIndex] = [endIndex, startIndex];

			let startApproachIndex = -1;
			for (let index = startIndex; index >= searchFloor; index -= 1) {
				const raw = route.points[index];
				if (context.hydrologyAtWorld(raw.x, raw.z).water) continue;
				const candidate = {
					x: raw.x,
					y: context.sampler(raw.x, raw.z) + CANONICAL_SCENE_SHADOW_POLICY.roadLiftMeters,
					z: raw.z,
				};
				if (
					distanceXZ(candidate, startTarget) <= CANONICAL_SCENE_SHADOW_POLICY.maxApproachLengthMeters
					&& gradeDegrees(candidate, startTarget) <= CANONICAL_SCENE_SHADOW_POLICY.maxApproachGradeDegrees
				) {
					startApproachIndex = index;
					break;
				}
			}

			let endApproachIndex = -1;
			for (let index = endIndex; index < route.points.length; index += 1) {
				const raw = route.points[index];
				if (context.hydrologyAtWorld(raw.x, raw.z).water) continue;
				const candidate = {
					x: raw.x,
					y: context.sampler(raw.x, raw.z) + CANONICAL_SCENE_SHADOW_POLICY.roadLiftMeters,
					z: raw.z,
				};
				if (
					distanceXZ(candidate, endTarget) <= CANONICAL_SCENE_SHADOW_POLICY.maxApproachLengthMeters
					&& gradeDegrees(candidate, endTarget) <= CANONICAL_SCENE_SHADOW_POLICY.maxApproachGradeDegrees
				) {
					endApproachIndex = index;
					break;
				}
			}
			if (startApproachIndex < 0 || endApproachIndex < 0) throw new Error(`${bridge.id}: no bounded dry-bank approach`);

			const startRaw = route.points[startApproachIndex];
			const endRaw = route.points[endApproachIndex];
			const startPoint = {
				x: startRaw.x,
				y: context.sampler(startRaw.x, startRaw.z) + CANONICAL_SCENE_SHADOW_POLICY.roadLiftMeters,
				z: startRaw.z,
			};
			const endPoint = {
				x: endRaw.x,
				y: context.sampler(endRaw.x, endRaw.z) + CANONICAL_SCENE_SHADOW_POLICY.roadLiftMeters,
				z: endRaw.z,
			};
			approaches.push(Object.freeze({
				bridgeId: bridge.id,
				edgeId: route.edgeId,
				side: 'start',
				from: Object.freeze(startPoint),
				to: Object.freeze(startTarget),
				gradeDegrees: gradeDegrees(startPoint, startTarget),
				lengthMeters: distanceXZ(startPoint, startTarget),
			}));
			approaches.push(Object.freeze({
				bridgeId: bridge.id,
				edgeId: route.edgeId,
				side: 'end',
				from: Object.freeze(endTarget),
				to: Object.freeze(endPoint),
				gradeDegrees: gradeDegrees(endTarget, endPoint),
				lengthMeters: distanceXZ(endTarget, endPoint),
			}));
			ranges.push(Object.freeze({ bridgeId: bridge.id, startIndex: startApproachIndex, endIndex: endApproachIndex }));
			searchFloor = Math.min(route.points.length - 1, endApproachIndex + 1);
		}
		suppressionByEdge.set(route.edgeId, Object.freeze(ranges));

		for (let index = 0; index < route.points.length; index += 1) {
			const point = route.points[index];
			if (!context.hydrologyAtWorld(point.x, point.z).water) continue;
			totalWaterRoutePoints += 1;
			if (ranges.some((range) => index >= range.startIndex && index <= range.endIndex)) coveredWaterRoutePoints += 1;
		}
	}
	return { approaches: Object.freeze(approaches), suppressionByEdge, totalWaterRoutePoints, coveredWaterRoutePoints };
}

/** Rebuilds the exact planned-world ingredients once and exposes the reusable Run192 contracts. */
export function buildCanonicalSceneShadowPlan() {
	const context = buildCanonicalContext();
	const routes = buildRoutes(context);
	const bridgePlan = buildCanonicalStoneBridgePlan();
	const transitions = buildBridgeTransitions(routes, bridgePlan, context);
	const rockCandidates = generateCanonicalRockShadowCandidates();
	const rockClearance = classifyRockRoadClearance(rockCandidates, routes);
	return Object.freeze({
		version: CANONICAL_SCENE_SHADOW_POLICY.key,
		context,
		routes: Object.freeze(routes),
		bridgePlan,
		approaches: transitions.approaches,
		suppressionByEdge: transitions.suppressionByEdge,
		totalWaterRoutePoints: transitions.totalWaterRoutePoints,
		coveredWaterRoutePoints: transitions.coveredWaterRoutePoints,
		rockCandidates: Object.freeze(rockCandidates),
		safeRockCandidates: Object.freeze(rockClearance.safeCandidates),
		rockConflicts: Object.freeze(rockClearance.conflicts),
	});
}

function appendRibbon(positions, indices, points, halfWidth) {
	if (points.length < 2) return;
	const baseVertex = positions.length / 3;
	for (let index = 0; index < points.length; index += 1) {
		const point = points[index];
		const previous = points[Math.max(0, index - 1)];
		const next = points[Math.min(points.length - 1, index + 1)];
		const tx = next.x - previous.x;
		const tz = next.z - previous.z;
		const length = Math.hypot(tx, tz) || 1;
		const sideX = -tz / length;
		const sideZ = tx / length;
		positions.push(
			point.x + sideX * halfWidth, point.y, point.z + sideZ * halfWidth,
			point.x - sideX * halfWidth, point.y, point.z - sideZ * halfWidth,
		);
		if (index > 0) {
			const left = baseVertex + index * 2;
			indices.push(left - 2, left - 1, left, left - 1, left + 1, left);
		}
	}
}

function createRibbonMesh(runs, widthMeters, color, name) {
	const positions = [];
	const indices = [];
	for (const run of runs) appendRibbon(positions, indices, run, widthMeters * 0.5);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setIndex(indices);
	if (positions.length) {
		geometry.computeVertexNormals();
		geometry.computeBoundingSphere();
	}
	const material = new THREE.MeshStandardMaterial({ color, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = name;
	mesh.receiveShadow = true;
	return mesh;
}

function createDryRoadMesh(plan, anchor, radiusMeters) {
	const runs = [];
	const radiusPad = CANONICAL_SCENE_SHADOW_POLICY.roadWidthMeters;
	for (const route of plan.routes) {
		const ranges = plan.suppressionByEdge.get(route.edgeId) || [];
		let run = [];
		for (let index = 0; index < route.points.length; index += 1) {
			const raw = route.points[index];
			const inside = Math.hypot(raw.x - anchor.x, raw.z - anchor.z) <= radiusMeters + radiusPad;
			const suppressed = ranges.some((range) => index >= range.startIndex && index <= range.endIndex);
			const water = plan.context.hydrologyAtWorld(raw.x, raw.z).water;
			if (!inside || suppressed || water) {
				if (run.length >= 2) runs.push(run);
				run = [];
				continue;
			}
			run.push({
				x: raw.x,
				y: plan.context.sampler(raw.x, raw.z) + CANONICAL_SCENE_SHADOW_POLICY.roadLiftMeters,
				z: raw.z,
			});
		}
		if (run.length >= 2) runs.push(run);
	}
	return createRibbonMesh(runs, CANONICAL_SCENE_SHADOW_POLICY.roadWidthMeters, 0x82623c, 'run193-canonical-dry-road-window');
}

function selectBridges(plan, anchor, radiusMeters) {
	return plan.bridgePlan.bridges.filter((bridge) => pointSegmentDistanceXZ(
		anchor,
		{ x: bridge.startX, z: bridge.startZ },
		{ x: bridge.endX, z: bridge.endZ },
	) <= radiusMeters);
}

function createApproachMesh(plan, selectedBridgeIds) {
	const runs = plan.approaches
		.filter((approach) => selectedBridgeIds.has(approach.bridgeId))
		.map((approach) => [approach.from, approach.to]);
	return createRibbonMesh(runs, CANONICAL_SCENE_SHADOW_POLICY.roadWidthMeters, 0x9a8468, 'run193-bridge-approach-window');
}

function chooseDefaultAnchor(plan, profilePolicy) {
	let best = null;
	for (const bridge of plan.bridgePlan.bridges) {
		if (bridge.structuralSpanMeters > profilePolicy.radiusMeters * 1.7) continue;
		let rockCount = 0;
		for (const rock of plan.safeRockCandidates) {
			if (Math.hypot(rock.x - bridge.centerX, rock.z - bridge.centerZ) <= profilePolicy.radiusMeters) rockCount += 1;
		}
		const candidate = {
			x: bridge.centerX,
			z: bridge.centerZ,
			bridgeId: bridge.id,
			rockCount,
			spanMeters: bridge.structuralSpanMeters,
		};
		if (!best || candidate.rockCount > best.rockCount || (candidate.rockCount === best.rockCount && candidate.spanMeters < best.spanMeters)) best = candidate;
	}
	if (!best) {
		const bridge = [...plan.bridgePlan.bridges].sort((a, b) => a.structuralSpanMeters - b.structuralSpanMeters)[0];
		best = { x: bridge.centerX, z: bridge.centerZ, bridgeId: bridge.id, rockCount: 0, spanMeters: bridge.structuralSpanMeters };
	}
	return Object.freeze(best);
}

function createTerrainWindow(plan, anchor, profilePolicy) {
	const group = new THREE.Group();
	group.name = 'run193-canonical-terrain-window';
	const size = plan.context.migration.chunkSizeMeters;
	const centerX = Math.round(anchor.x / size);
	const centerZ = Math.round(anchor.z / size);
	for (let dx = -profilePolicy.terrainChunkRadius; dx <= profilePolicy.terrainChunkRadius; dx += 1) {
		for (let dz = -profilePolicy.terrainChunkRadius; dz <= profilePolicy.terrainChunkRadius; dz += 1) {
			group.add(createCanonicalTerrainShadowChunk({
				chunkX: centerX + dx,
				chunkZ: centerZ + dz,
				size,
				segments: profilePolicy.terrainSegments,
				sampleHeightMeters: plan.context.sampler,
				seaLevelMeters: plan.context.seaLevelMeters,
			}));
		}
	}
	return group;
}

function disposeRibbonMesh(mesh) {
	mesh.geometry?.dispose?.();
	mesh.material?.dispose?.();
}

function resolveBridgeDeckHeight(bridges, x, z, insetMeters) {
	for (const bridge of bridges) {
		const dx = x - bridge.centerX;
		const dz = z - bridge.centerZ;
		const cosine = Math.cos(bridge.yawRadians);
		const sine = Math.sin(bridge.yawRadians);
		const localX = cosine * dx - sine * dz;
		const localZ = sine * dx + cosine * dz;
		const halfLength = bridge.structuralSpanMeters * 0.5 + 0.15;
		const halfWidth = bridge.bridgeWidthMeters * 0.5 - insetMeters + 0.02;
		if (Math.abs(localX) <= halfLength && Math.abs(localZ) <= halfWidth) {
			return bridge.deckY + STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5;
		}
	}
	return null;
}

function resolveApproachHeight(approaches, x, z, safeHalfWidthMeters) {
	for (const approach of approaches) {
		const projected = projectPointToSegmentXZ(x, z, approach.from, approach.to);
		if (projected.rawT < -0.001 || projected.rawT > 1.001 || projected.lateralMeters > safeHalfWidthMeters) continue;
		return THREE.MathUtils.lerp(approach.from.y, approach.to.y, projected.t);
	}
	return null;
}

/** Player-compatible composite ground-height facade for one bounded scene window. */
export function createCanonicalSceneShadowGroundCollider(windowState, playerRadiusMeters = 0.4) {
	assertFinite(playerRadiusMeters, 'playerRadiusMeters');
	const safeHalfWidthMeters = STONE_BRIDGE_OWNER_POLICY.bridgeWidthMeters * 0.5
		- STONE_BRIDGE_OWNER_POLICY.parapetThicknessMeters - playerRadiusMeters;
	if (!(safeHalfWidthMeters > 0)) throw new RangeError('player radius leaves no safe bridge corridor');
	const bridges = windowState.selectedBridges;
	const approaches = windowState.selectedApproaches;
	return Object.freeze({
		safeHalfWidthMeters,
		getGroundHeight(x, z) {
			assertFinite(x, 'x');
			assertFinite(z, 'z');
			const deck = resolveBridgeDeckHeight(bridges, x, z, playerRadiusMeters);
			if (deck !== null) return deck;
			const approach = resolveApproachHeight(approaches, x, z, safeHalfWidthMeters);
			return approach === null ? windowState.plan.context.sampler(x, z) : approach;
		},
	});
}

/** Creates one disposable bounded canonical world window without touching the live scene/chunk managers. */
export function createCanonicalSceneShadowWindow({ profile = 'mobile', anchor = null } = {}) {
	const profilePolicy = CANONICAL_SCENE_SHADOW_POLICY.profiles[profile];
	if (!profilePolicy) throw new Error(`unknown canonical scene shadow profile: ${profile}`);
	const plan = buildCanonicalSceneShadowPlan();
	const resolvedAnchor = anchor
		? Object.freeze({ x: Number(anchor.x), z: Number(anchor.z), bridgeId: anchor.bridgeId || null })
		: chooseDefaultAnchor(plan, profilePolicy);
	assertFinite(resolvedAnchor.x, 'anchor.x');
	assertFinite(resolvedAnchor.z, 'anchor.z');

	const root = new THREE.Group();
	root.name = `run193-canonical-scene-window-${profile}`;
	const terrainGroup = createTerrainWindow(plan, resolvedAnchor, profilePolicy);
	const roadMesh = createDryRoadMesh(plan, resolvedAnchor, profilePolicy.radiusMeters);
	const selectedBridges = selectBridges(plan, resolvedAnchor, profilePolicy.radiusMeters);
	const selectedBridgeIds = new Set(selectedBridges.map((bridge) => bridge.id));
	const selectedApproaches = plan.approaches.filter((approach) => selectedBridgeIds.has(approach.bridgeId));
	const approachMesh = createApproachMesh(plan, selectedBridgeIds);
	const bridgeGroup = createCanonicalStoneBridgeMedievalArtV2({ bridges: selectedBridges });
	const windowRocks = plan.safeRockCandidates.filter((rock) => Math.hypot(rock.x - resolvedAnchor.x, rock.z - resolvedAnchor.z) <= profilePolicy.radiusMeters);
	const rockGroup = createCanonicalRockShadowGeometry({
		candidates: windowRocks,
		profile: profilePolicy.rockProfile,
		anchor: resolvedAnchor,
	});
	rockGroup.position.set(resolvedAnchor.x, 0, resolvedAnchor.z);
	const water = createWater(plan.context.seaLevelMeters);
	root.add(terrainGroup, roadMesh, approachMesh, bridgeGroup, rockGroup, water);

	const state = {
		profile,
		profilePolicy,
		plan,
		anchor: resolvedAnchor,
		root,
		terrainGroup,
		roadMesh,
		approachMesh,
		bridgeGroup,
		rockGroup,
		water,
		selectedBridges: Object.freeze(selectedBridges),
		selectedApproaches: Object.freeze(selectedApproaches),
		disposed: false,
	};
	state.groundCollider = createCanonicalSceneShadowGroundCollider(state);
	return state;
}

export function updateCanonicalSceneShadowWindow(windowState, cameraPosition, elapsedSeconds = 0) {
	if (windowState.disposed) return;
	updateWater(windowState.water, cameraPosition, elapsedSeconds);
}

export function summarizeCanonicalSceneShadowWindow(windowState) {
	const roadIndexCount = windowState.roadMesh.geometry.index?.count || 0;
	const approachIndexCount = windowState.approachMesh.geometry.index?.count || 0;
	return Object.freeze({
		version: CANONICAL_SCENE_SHADOW_POLICY.key,
		profile: windowState.profile,
		anchorX: Math.round(windowState.anchor.x * 1000) / 1000,
		anchorZ: Math.round(windowState.anchor.z * 1000) / 1000,
		anchorBridgeId: windowState.anchor.bridgeId || null,
		terrainChunkCount: windowState.terrainGroup.children.length,
		roadTriangles: roadIndexCount / 3,
		approachTriangles: approachIndexCount / 3,
		selectedBridgeIds: Object.freeze(windowState.selectedBridges.map((bridge) => bridge.id)),
		selectedApproachCount: windowState.selectedApproaches.length,
		selectedRockInstances: windowState.rockGroup.userData.rockShadow?.selectedInstances || 0,
		rockDrawCalls: windowState.rockGroup.userData.rockShadow?.drawCalls || 0,
		rockTriangles: windowState.rockGroup.userData.rockShadow?.triangles || 0,
		totalWaterRoutePoints: windowState.plan.totalWaterRoutePoints,
		coveredWaterRoutePoints: windowState.plan.coveredWaterRoutePoints,
		safeRockCandidateCount: windowState.plan.safeRockCandidates.length,
		rockConflictCount: windowState.plan.rockConflicts.length,
		maxApproachGradeDegrees: Math.max(...windowState.plan.approaches.map((approach) => approach.gradeDegrees)),
		maxApproachLengthMeters: Math.max(...windowState.plan.approaches.map((approach) => approach.lengthMeters)),
	});
}

export function disposeCanonicalSceneShadowWindow(windowState) {
	if (!windowState || windowState.disposed) return;
	for (const terrain of [...windowState.terrainGroup.children]) {
		windowState.terrainGroup.remove(terrain);
		disposeCanonicalTerrainShadowChunk(terrain);
	}
	disposeRibbonMesh(windowState.roadMesh);
	disposeRibbonMesh(windowState.approachMesh);
	disposeCanonicalStoneBridgeMedievalArtV2(windowState.bridgeGroup);
	disposeCanonicalRockShadowGeometry(windowState.rockGroup);
	disposeWater(windowState.water);
	windowState.root.clear();
	windowState.disposed = true;
}
