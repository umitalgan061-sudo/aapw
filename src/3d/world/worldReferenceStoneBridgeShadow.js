/**
 * Run 191 owner-approved canonical road/water stone-bridge shadow system.
 *
 * Owner decision (2026-08-08): when a canonical road crosses water, keep the road connection and
 * carry it over the water with a medieval stone arch bridge. This module deliberately remains
 * shadow-only for its first proof: it resolves deterministic crossings and builds real THREE
 * geometry/materials, but no live scene imports it yet.
 * @module world/worldReferenceStoneBridgeShadow
 */

import * as THREE from 'three';
import { WORLD_DEFAULTS, SETTLEMENT_CONFIG } from '../config.js';
import { createHeightSampler } from './terrain.js';
import { KINGDOM_SEATS, computeSettlementFlattenPads, mapToWorldXZ } from './settlements.js';
import { computeSeatMST } from './roads.js';
import { findSlopeAwarePath } from './roadPathfinder.js';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { referenceProtectionRadiiFromMeters, sampleSeatSafeReferenceHydrology } from './worldReferenceHydrology.js';
import {
	FULL_REFERENCE_MAP_BOUNDS,
	FULL_REFERENCE_WORLD_MIGRATION_PLAN,
	plannedWorldXZToMapCanvas,
} from './worldReferenceMigrationPlan.js';
import { createCanonicalHydrologyTerrainSampler } from './worldReferenceTerrainAdapter.js';

export const STONE_BRIDGE_OWNER_POLICY = Object.freeze({
	key: 'run191-owner-stone-arch-bridge-v1',
	policy: 'stone-arch-bridge',
	waterSampleStepMeters: 10,
	bankMarginMeters: 6,
	targetArchSpanMeters: 36,
	maxArchSpanMeters: 40,
	bridgeWidthMeters: 8,
	deckThicknessMeters: 1.2,
	parapetHeightMeters: 1.15,
	parapetThicknessMeters: 0.45,
	pierWidthMeters: 1.8,
	minimumArchRiseMeters: 3.4,
	maximumArchRiseMeters: 8.5,
	textureSizePixels: 256,
});

const EXPECTED_AFFECTED_EDGES = Object.freeze([
	'robin->berkalp',
	'cersei->stannis',
	'umit->doran',
	'twin->balon',
	'umit->Xaro',
	'jon->Night King',
]);

function mix32(value) {
	let x = value >>> 0;
	x ^= x >>> 16;
	x = Math.imul(x, 0x7feb352d);
	x ^= x >>> 15;
	x = Math.imul(x, 0x846ca68b);
	x ^= x >>> 16;
	return x >>> 0;
}

function hash01(a, b, salt = 0) {
	return mix32(Math.imul(a + 4099, 0x9e3779b1) ^ Math.imul(b + 8191, 0x85ebca6b) ^ salt) / 4294967296;
}

function round(value, digits = 3) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function buildCanonicalContext() {
	const plan = FULL_REFERENCE_WORLD_MIGRATION_PLAN;
	const seaLevelMeters = WORLD_DEFAULTS.WATER_LEVEL_METERS;
	const natural = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
	const pads = computeSettlementFlattenPads({
		sampleHeightMeters: natural,
		seaLevelMeters,
		minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
		mapBounds: FULL_REFERENCE_MAP_BOUNDS,
		metersPerMapUnit: plan.metersPerMapUnit,
	});
	const base = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
	const protectionRadii = referenceProtectionRadiiFromMeters(pads[0].outerRadiusMeters, plan.metersPerMapUnit);
	const protectedSites = KINGDOM_SEATS.map((seat) => ({ id: seat.id, ...mapCanvasToNormalizedReference(seat.mapX, seat.mapY) }));
	const sampler = createCanonicalHydrologyTerrainSampler({
		baseHeightSampler: base,
		seaLevelMeters,
		protectedSites,
		protectionRadii,
	});
	const hydrologyAtWorld = (worldX, worldZ) => {
		const map = plannedWorldXZToMapCanvas(worldX, worldZ);
		const normalized = mapCanvasToNormalizedReference(map.x, map.y);
		return sampleSeatSafeReferenceHydrology(normalized.x, normalized.y, protectedSites, protectionRadii);
	};
	return { plan, seaLevelMeters, sampler, hydrologyAtWorld };
}

function sampleSegmentWater(a, b, hydrologyAtWorld, stepMeters) {
	const distanceMeters = Math.hypot(b.x - a.x, b.z - a.z);
	const steps = Math.max(1, Math.ceil(distanceMeters / stepMeters));
	const samples = [];
	for (let index = 0; index < steps; index += 1) {
		const t = (index + 0.5) / steps;
		const x = a.x + (b.x - a.x) * t;
		const z = a.z + (b.z - a.z) * t;
		samples.push({ x, z, water: hydrologyAtWorld(x, z).water, meters: distanceMeters / steps });
	}
	return samples;
}

function collectWaterCrossings(points, hydrologyAtWorld) {
	const samples = [];
	for (let index = 1; index < points.length; index += 1) {
		samples.push(...sampleSegmentWater(
			points[index - 1],
			points[index],
			hydrologyAtWorld,
			STONE_BRIDGE_OWNER_POLICY.waterSampleStepMeters,
		));
	}
	const crossings = [];
	let current = null;
	for (const sample of samples) {
		if (sample.water) {
			if (!current) current = { waterMeters: 0, first: sample, last: sample };
			current.waterMeters += sample.meters;
			current.last = sample;
		} else if (current) {
			crossings.push(current);
			current = null;
		}
	}
	if (current) crossings.push(current);
	return crossings;
}

function yawForDirection(dx, dz) {
	return Math.atan2(-dz, dx);
}

function bridgeFromCrossing({ edgeId, fromId, toId, crossingIndex, crossing, sampler, seaLevelMeters }) {
	let dx = crossing.last.x - crossing.first.x;
	let dz = crossing.last.z - crossing.first.z;
	let chordMeters = Math.hypot(dx, dz);
	if (chordMeters < 0.001) {
		dx = 1;
		dz = 0;
		chordMeters = Math.max(crossing.waterMeters, STONE_BRIDGE_OWNER_POLICY.waterSampleStepMeters);
	}
	const invLength = 1 / Math.hypot(dx, dz);
	const ux = dx * invLength;
	const uz = dz * invLength;
	const start = {
		x: crossing.first.x - ux * STONE_BRIDGE_OWNER_POLICY.bankMarginMeters,
		z: crossing.first.z - uz * STONE_BRIDGE_OWNER_POLICY.bankMarginMeters,
	};
	const end = {
		x: crossing.last.x + ux * STONE_BRIDGE_OWNER_POLICY.bankMarginMeters,
		z: crossing.last.z + uz * STONE_BRIDGE_OWNER_POLICY.bankMarginMeters,
	};
	const structuralSpanMeters = Math.hypot(end.x - start.x, end.z - start.z);
	const archCount = Math.max(1, Math.ceil(structuralSpanMeters / STONE_BRIDGE_OWNER_POLICY.targetArchSpanMeters));
	const archSpanMeters = structuralSpanMeters / archCount;
	const archRiseMeters = Math.min(
		STONE_BRIDGE_OWNER_POLICY.maximumArchRiseMeters,
		Math.max(STONE_BRIDGE_OWNER_POLICY.minimumArchRiseMeters, archSpanMeters * 0.22),
	);
	const startGroundY = sampler(start.x, start.z);
	const endGroundY = sampler(end.x, end.z);
	const deckBottomY = Math.max(startGroundY, endGroundY, seaLevelMeters + archRiseMeters + 0.8);
	const deckY = deckBottomY + STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5;
	const center = { x: (start.x + end.x) * 0.5, z: (start.z + end.z) * 0.5 };
	return Object.freeze({
		id: `${edgeId}#${crossingIndex + 1}`,
		edgeId,
		fromId,
		toId,
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
		centerX: round(center.x),
		centerZ: round(center.z),
		yawRadians: round(yawForDirection(ux, uz), 6),
		startX: round(start.x),
		startZ: round(start.z),
		endX: round(end.x),
		endZ: round(end.z),
	});
}

/**
 * Recomputes the canonical-target MST/pathfinder routes and applies the owner's bridge policy to
 * every contiguous canonical-water crossing. Same inputs always produce the same bridge list.
 */
export function buildCanonicalStoneBridgePlan() {
	const { plan, seaLevelMeters, sampler, hydrologyAtWorld } = buildCanonicalContext();
	const seats = KINGDOM_SEATS.map((seat) => ({
		id: seat.id,
		...mapToWorldXZ(seat.mapX, seat.mapY, FULL_REFERENCE_MAP_BOUNDS, plan.metersPerMapUnit),
	}));
	const byId = new Map(seats.map((seat) => [seat.id, seat]));
	const bridges = [];
	const routeSummaries = [];
	for (const edge of computeSeatMST(seats)) {
		const route = findSlopeAwarePath({ sampleHeightMeters: sampler, start: byId.get(edge.fromId), end: byId.get(edge.toId) });
		const crossings = collectWaterCrossings(route.points, hydrologyAtWorld);
		const edgeId = `${edge.fromId}->${edge.toId}`;
		routeSummaries.push(Object.freeze({
			edgeId,
			fromId: edge.fromId,
			toId: edge.toId,
			routePointCount: route.points.length,
			crossingCount: crossings.length,
			waterMeters: round(crossings.reduce((sum, crossing) => sum + crossing.waterMeters, 0)),
		}));
		for (let crossingIndex = 0; crossingIndex < crossings.length; crossingIndex += 1) {
			bridges.push(bridgeFromCrossing({
				edgeId,
				fromId: edge.fromId,
				toId: edge.toId,
				crossingIndex,
				crossing: crossings[crossingIndex],
				sampler,
				seaLevelMeters,
			}));
		}
	}
	const affectedEdges = routeSummaries.filter((edge) => edge.crossingCount > 0).map((edge) => edge.edgeId);
	return Object.freeze({
		policyKey: STONE_BRIDGE_OWNER_POLICY.key,
		policy: STONE_BRIDGE_OWNER_POLICY.policy,
		expectedAffectedEdges: EXPECTED_AFFECTED_EDGES,
		routeSummaries: Object.freeze(routeSummaries),
		bridges: Object.freeze(bridges),
		affectedEdges: Object.freeze(affectedEdges),
		waterChordTotalMeters: round(bridges.reduce((sum, bridge) => sum + bridge.waterChordMeters, 0)),
		structuralSpanTotalMeters: round(bridges.reduce((sum, bridge) => sum + bridge.structuralSpanMeters, 0)),
		maxStructuralSpanMeters: round(Math.max(0, ...bridges.map((bridge) => bridge.structuralSpanMeters))),
		totalArchCount: bridges.reduce((sum, bridge) => sum + bridge.archCount, 0),
	});
}

function stoneColor(row, column) {
	const variation = hash01(row, column, 0x53544f4e);
	const base = 118 + Math.round(variation * 28);
	return `rgb(${base + 10},${base + 3},${Math.max(0, base - 8)})`;
}

/** Deterministic, original procedural medieval masonry texture: stone blocks + mortar + sparse moss. */
export function createMedievalStoneTexture() {
	const size = STONE_BRIDGE_OWNER_POLICY.textureSizePixels;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext('2d');
	context.fillStyle = '#6f675b';
	context.fillRect(0, 0, size, size);
	const rowHeight = 32;
	const blockWidth = 64;
	for (let row = 0; row < size / rowHeight; row += 1) {
		const offset = row % 2 === 0 ? 0 : blockWidth / 2;
		for (let column = -1; column <= size / blockWidth; column += 1) {
			const x = column * blockWidth + offset;
			const y = row * rowHeight;
			context.fillStyle = stoneColor(row, column);
			context.fillRect(x + 2, y + 2, blockWidth - 4, rowHeight - 4);
			const weather = hash01(row, column, 0x57454154);
			if (weather > 0.72) {
				context.fillStyle = `rgba(52,68,42,${0.08 + weather * 0.08})`;
				context.fillRect(x + 5, y + rowHeight - 10, blockWidth - 10, 5);
			}
		}
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.name = 'run191-medieval-stone-masonry';
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(8, 4);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

function createHalfArchGeometry() {
	const outerRadius = 1;
	const innerRadius = 0.76;
	const segments = 24;
	const shape = new THREE.Shape();
	shape.moveTo(outerRadius, 0);
	for (let index = 0; index <= segments; index += 1) {
		const angle = index / segments * Math.PI;
		shape.lineTo(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius);
	}
	shape.lineTo(-innerRadius, 0);
	for (let index = segments; index >= 0; index -= 1) {
		const angle = index / segments * Math.PI;
		shape.lineTo(Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius);
	}
	shape.closePath();
	const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, steps: 1, bevelEnabled: false, curveSegments: segments });
	geometry.translate(0, 0, -0.5);
	return geometry;
}

function partTransform(matrix, position, yawRadians, scale) {
	const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yawRadians, 0));
	matrix.compose(new THREE.Vector3(position.x, position.y, position.z), quaternion, new THREE.Vector3(scale.x, scale.y, scale.z));
}

function bridgeAxisPosition(bridge, alongMeters) {
	const dx = bridge.endX - bridge.startX;
	const dz = bridge.endZ - bridge.startZ;
	const length = Math.hypot(dx, dz) || 1;
	return {
		x: bridge.startX + dx / length * alongMeters,
		z: bridge.startZ + dz / length * alongMeters,
	};
}

function instanceColor(index, salt) {
	const shade = 0.82 + hash01(index, salt, 0x42524944) * 0.22;
	return new THREE.Color(0xb9ab92).multiplyScalar(shade);
}

/**
 * Builds one bounded batched bridge group for a supplied plan. Four InstancedMeshes cover decks,
 * arch rings, piers and parapets regardless of how many arches a long crossing needs.
 */
export function createCanonicalStoneBridgeGeometry({ bridges } = {}) {
	if (!Array.isArray(bridges)) throw new TypeError('bridges must be an array');
	const texture = createMedievalStoneTexture();
	const material = new THREE.MeshStandardMaterial({
		map: texture,
		color: 0xb9ab92,
		roughness: 0.96,
		metalness: 0,
		vertexColors: true,
	});
	const deckGeometry = new THREE.BoxGeometry(1, 1, 1);
	const archGeometry = createHalfArchGeometry();
	const pierGeometry = new THREE.BoxGeometry(1, 1, 1);
	const parapetGeometry = new THREE.BoxGeometry(1, 1, 1);
	const totalArches = bridges.reduce((sum, bridge) => sum + bridge.archCount, 0);
	const totalPiers = bridges.reduce((sum, bridge) => sum + bridge.archCount + 1, 0);
	const deckMesh = new THREE.InstancedMesh(deckGeometry, material, Math.max(1, bridges.length));
	const archMesh = new THREE.InstancedMesh(archGeometry, material, Math.max(1, totalArches));
	const pierMesh = new THREE.InstancedMesh(pierGeometry, material, Math.max(1, totalPiers));
	const parapetMesh = new THREE.InstancedMesh(parapetGeometry, material, Math.max(1, bridges.length * 2));
	deckMesh.count = bridges.length;
	archMesh.count = totalArches;
	pierMesh.count = totalPiers;
	parapetMesh.count = bridges.length * 2;
	deckMesh.name = 'run191-stone-bridge-decks';
	archMesh.name = 'run191-stone-bridge-arches';
	pierMesh.name = 'run191-stone-bridge-piers';
	parapetMesh.name = 'run191-stone-bridge-parapets';
	const matrix = new THREE.Matrix4();
	let archInstance = 0;
	let pierInstance = 0;
	for (let bridgeIndex = 0; bridgeIndex < bridges.length; bridgeIndex += 1) {
		const bridge = bridges[bridgeIndex];
		partTransform(matrix, { x: bridge.centerX, y: bridge.deckY, z: bridge.centerZ }, bridge.yawRadians, {
			x: bridge.structuralSpanMeters,
			y: STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters,
			z: bridge.bridgeWidthMeters,
		});
		deckMesh.setMatrixAt(bridgeIndex, matrix);
		deckMesh.setColorAt(bridgeIndex, instanceColor(bridgeIndex, 1));
		const deckBottomY = bridge.deckY - STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5;
		const archBaseY = deckBottomY - bridge.archRiseMeters;
		for (let archIndex = 0; archIndex < bridge.archCount; archIndex += 1) {
			const archCenterAlong = (archIndex + 0.5) * bridge.archSpanMeters;
			const archPosition = bridgeAxisPosition(bridge, archCenterAlong);
			partTransform(matrix, { x: archPosition.x, y: archBaseY, z: archPosition.z }, bridge.yawRadians, {
				x: bridge.archSpanMeters * 0.5,
				y: bridge.archRiseMeters,
				z: bridge.bridgeWidthMeters,
			});
			archMesh.setMatrixAt(archInstance, matrix);
			archMesh.setColorAt(archInstance, instanceColor(archInstance, 2));
			archInstance += 1;
		}
		for (let boundaryIndex = 0; boundaryIndex <= bridge.archCount; boundaryIndex += 1) {
			const along = boundaryIndex * bridge.archSpanMeters;
			const pierPosition = bridgeAxisPosition(bridge, along);
			partTransform(matrix, {
				x: pierPosition.x,
				y: archBaseY + bridge.archRiseMeters * 0.5,
				z: pierPosition.z,
			}, bridge.yawRadians, {
				x: STONE_BRIDGE_OWNER_POLICY.pierWidthMeters,
				y: bridge.archRiseMeters,
				z: bridge.bridgeWidthMeters,
			});
			pierMesh.setMatrixAt(pierInstance, matrix);
			pierMesh.setColorAt(pierInstance, instanceColor(pierInstance, 3));
			pierInstance += 1;
		}
		const halfSideOffset = bridge.bridgeWidthMeters * 0.5 - STONE_BRIDGE_OWNER_POLICY.parapetThicknessMeters * 0.5;
		const axisDx = (bridge.endX - bridge.startX) / bridge.structuralSpanMeters;
		const axisDz = (bridge.endZ - bridge.startZ) / bridge.structuralSpanMeters;
		const sideX = -axisDz;
		const sideZ = axisDx;
		for (let side = -1; side <= 1; side += 2) {
			const parapetIndex = bridgeIndex * 2 + (side > 0 ? 1 : 0);
			partTransform(matrix, {
				x: bridge.centerX + sideX * halfSideOffset * side,
				y: bridge.deckY + STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5 + STONE_BRIDGE_OWNER_POLICY.parapetHeightMeters * 0.5,
				z: bridge.centerZ + sideZ * halfSideOffset * side,
			}, bridge.yawRadians, {
				x: bridge.structuralSpanMeters,
				y: STONE_BRIDGE_OWNER_POLICY.parapetHeightMeters,
				z: STONE_BRIDGE_OWNER_POLICY.parapetThicknessMeters,
			});
			parapetMesh.setMatrixAt(parapetIndex, matrix);
			parapetMesh.setColorAt(parapetIndex, instanceColor(parapetIndex, 4));
		}
	}
	for (const mesh of [deckMesh, archMesh, pierMesh, parapetMesh]) {
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
	}
	const group = new THREE.Group();
	group.name = 'run191-canonical-stone-bridges-shadow';
	group.add(deckMesh, archMesh, pierMesh, parapetMesh);
	group.userData.run191 = Object.freeze({
		bridgeCount: bridges.length,
		totalArchCount: totalArches,
		totalPierCount: totalPiers,
		textureName: texture.name,
	});
	return group;
}

/** Disposes all bridge proof GPU resources, including the procedural masonry texture. */
export function disposeCanonicalStoneBridgeGeometry(group) {
	const geometries = new Set();
	const materials = new Set();
	const textures = new Set();
	for (const child of [...group.children]) {
		if (child.geometry) geometries.add(child.geometry);
		if (child.material) materials.add(child.material);
		group.remove(child);
	}
	for (const material of materials) if (material.map) textures.add(material.map);
	for (const geometry of geometries) geometry.dispose();
	for (const material of materials) material.dispose();
	for (const texture of textures) texture.dispose();
}
