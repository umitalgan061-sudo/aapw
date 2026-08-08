/**
 * Run 190 shadow-only canonical rock geometry proof.
 *
 * This module deliberately has no live runtime consumer. It reifies Run189's deterministic
 * canonical rock-site contract into bounded THREE.InstancedMesh geometry so geometry/LOD,
 * provisional road-clearance and GPU submission cost can be measured before any live spawn.
 * @module world/worldReferenceRockShadow
 */

import * as THREE from 'three';
import { WORLD_DEFAULTS, SETTLEMENT_CONFIG } from '../config.js';
import { createHeightSampler } from './terrain.js';
import { KINGDOM_SEATS, computeSettlementFlattenPads } from './settlements.js';
import { computeSeatMST } from './roads.js';
import { findSlopeAwarePath } from './roadPathfinder.js';
import { REFERENCE_BIOME_ZONES, REFERENCE_RELIEF_CHAINS, sampleReferenceInfluence } from './worldReferenceMap.js';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { referenceProtectionRadiiFromMeters, sampleSeatSafeReferenceHydrology } from './worldReferenceHydrology.js';
import {
	FULL_REFERENCE_MAP_BOUNDS,
	FULL_REFERENCE_WORLD_MIGRATION_PLAN,
	mapCanvasToPlannedWorldXZ,
	plannedWorldXZToMapCanvas,
} from './worldReferenceMigrationPlan.js';
import { createCanonicalHydrologyTerrainSampler } from './worldReferenceTerrainAdapter.js';

export const ROCK_SHADOW_SITE_POLICY = Object.freeze({
	cellMeters: 120,
	jitterMeters: 34,
	maxSlopeDegrees: 35,
	minGeologyScore: 0.18,
	roadClearanceMeters: 24,
});

export const ROCK_SHADOW_RENDER_PROFILES = Object.freeze({
	mobile: Object.freeze({ renderRadiusMeters: 1800, nearDistanceMeters: 650, maxInstances: 96 }),
	desktop: Object.freeze({ renderRadiusMeters: 2600, nearDistanceMeters: 900, maxInstances: 192 }),
});

const TIER_COLORS = Object.freeze({
	stone: 0x7b7468,
	rock: 0x665f56,
	boulder: 0x59534c,
});

function mix32(value) {
	let x = value >>> 0;
	x ^= x >>> 16;
	x = Math.imul(x, 0x7feb352d);
	x ^= x >>> 15;
	x = Math.imul(x, 0x846ca68b);
	x ^= x >>> 16;
	return x >>> 0;
}

function rand01(ix, iz, salt) {
	const seed = WORLD_DEFAULTS.WORLD_SEED >>> 0;
	return mix32(seed ^ Math.imul(ix + 4099, 0x9e3779b1) ^ Math.imul(iz + 8191, 0x85ebca6b) ^ salt) / 4294967296;
}

function segmentDistance(px, py, ax, ay, bx, by) {
	const abx = bx - ax;
	const aby = by - ay;
	const length2 = abx * abx + aby * aby;
	if (length2 <= 1e-12) return Math.hypot(px - ax, py - ay);
	const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / length2));
	return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function reliefInfluence(nx, ny) {
	let best = 0;
	for (const chain of REFERENCE_RELIEF_CHAINS) {
		for (let i = 1; i < chain.points.length; i += 1) {
			const a = chain.points[i - 1];
			const b = chain.points[i];
			const distance = segmentDistance(nx, ny, a[0], a[1], b[0], b[1]);
			const influence = Math.max(0, 1 - distance / 0.045);
			best = Math.max(best, influence * influence * (3 - 2 * influence));
		}
	}
	return best;
}

function geology(nx, ny) {
	let bestZone = null;
	let bestInfluence = 0;
	for (const zone of REFERENCE_BIOME_ZONES) {
		if (zone.kind !== 'mountain' && zone.kind !== 'rocky-hills') continue;
		const influence = sampleReferenceInfluence(nx, ny, zone);
		if (influence > bestInfluence) {
			bestInfluence = influence;
			bestZone = zone.id;
		}
	}
	const chainInfluence = reliefInfluence(nx, ny);
	return {
		zoneId: bestZone,
		zoneInfluence: bestInfluence,
		reliefInfluence: chainInfluence,
		score: Math.max(bestInfluence, chainInfluence * 0.9),
	};
}

function buildCanonicalContext() {
	const plan = FULL_REFERENCE_WORLD_MIGRATION_PLAN;
	const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
	const natural = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
	const pads = computeSettlementFlattenPads({
		sampleHeightMeters: natural,
		seaLevelMeters: sea,
		minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
		mapBounds: FULL_REFERENCE_MAP_BOUNDS,
		metersPerMapUnit: plan.metersPerMapUnit,
	});
	const base = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
	const protectionRadii = referenceProtectionRadiiFromMeters(pads[0].outerRadiusMeters, plan.metersPerMapUnit);
	const protectedSites = KINGDOM_SEATS.map((seat) => ({ id: seat.id, ...mapCanvasToNormalizedReference(seat.mapX, seat.mapY) }));
	const sampler = createCanonicalHydrologyTerrainSampler({
		baseHeightSampler: base,
		seaLevelMeters: sea,
		protectedSites,
		protectionRadii,
	});
	return { plan, sea, protectedSites, protectionRadii, sampler };
}

function slopeAt(sampler, x, z) {
	const d = 12;
	const dx = (sampler(x + d, z) - sampler(x - d, z)) / (2 * d);
	const dz = (sampler(x, z + d) - sampler(x, z - d)) / (2 * d);
	return Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
}

/** Reproduces Run189's exact candidate fields/order so its candidate checksum stays an independent gate. */
export function generateCanonicalRockShadowCandidates() {
	const { plan, protectedSites, protectionRadii, sampler } = buildCanonicalContext();
	const { cellMeters, jitterMeters, maxSlopeDegrees, minGeologyScore } = ROCK_SHADOW_SITE_POLICY;
	const minX = -plan.worldWidthMeters * 0.5;
	const maxX = plan.worldWidthMeters * 0.5;
	const minZ = -plan.worldDepthMeters * 0.5;
	const maxZ = plan.worldDepthMeters * 0.5;
	const candidates = [];

	let iz = 0;
	for (let centerZ = minZ + cellMeters * 0.5; centerZ < maxZ - cellMeters * 0.5; centerZ += cellMeters, iz += 1) {
		let ix = 0;
		for (let centerX = minX + cellMeters * 0.5; centerX < maxX - cellMeters * 0.5; centerX += cellMeters, ix += 1) {
			const x = centerX + (rand01(ix, iz, 0x1234abcd) * 2 - 1) * jitterMeters;
			const z = centerZ + (rand01(ix, iz, 0x89abcdef) * 2 - 1) * jitterMeters;
			const map = plannedWorldXZToMapCanvas(x, z);
			const normalized = mapCanvasToNormalizedReference(map.x, map.y);
			const hydrology = sampleSeatSafeReferenceHydrology(normalized.x, normalized.y, protectedSites, protectionRadii);
			if (hydrology.water || hydrology.protectedLand) continue;
			const geo = geology(normalized.x, normalized.y);
			if (geo.score < minGeologyScore) continue;
			const slope = slopeAt(sampler, x, z);
			if (slope > maxSlopeDegrees) continue;
			const densityGate = Math.min(0.92, 0.18 + geo.score * 0.72);
			if (rand01(ix, iz, 0x31415926) > densityGate) continue;
			const tierRoll = rand01(ix, iz, 0x27182818);
			const tier = tierRoll < 0.68 ? 'stone' : tierRoll < 0.93 ? 'rock' : 'boulder';
			const yawRadians = rand01(ix, iz, 0x5f3759df) * Math.PI * 2;
			const scale = tier === 'stone'
				? 0.45 + rand01(ix, iz, 0x11111111) * 0.85
				: tier === 'rock'
					? 1.2 + rand01(ix, iz, 0x22222222) * 2.2
					: 3.5 + rand01(ix, iz, 0x33333333) * 4.5;
			const y = sampler(x, z);
			candidates.push({
				ix, iz,
				x: Math.round(x * 1000) / 1000,
				y: Math.round(y * 1000) / 1000,
				z: Math.round(z * 1000) / 1000,
				slopeDegrees: Math.round(slope * 1000) / 1000,
				geologyScore: Math.round(geo.score * 1000000) / 1000000,
				zoneId: geo.zoneId || 'relief-chain',
				tier,
				yawRadians: Math.round(yawRadians * 1000000) / 1000000,
				scale: Math.round(scale * 1000) / 1000,
			});
		}
	}
	return candidates;
}

/** Diagnostic only: current canonical-target MST/pathfinder centerlines, without choosing Run188 water policy. */
export function buildCanonicalRockRoadDiagnostic() {
	const { sampler } = buildCanonicalContext();
	const seats = KINGDOM_SEATS.map((seat) => ({ id: seat.id, ...mapCanvasToPlannedWorldXZ(seat.mapX, seat.mapY) }));
	const byId = new Map(seats.map((seat) => [seat.id, seat]));
	return computeSeatMST(seats).map((edge) => {
		const route = findSlopeAwarePath({ sampleHeightMeters: sampler, start: byId.get(edge.fromId), end: byId.get(edge.toId) });
		return { fromId: edge.fromId, toId: edge.toId, points: route.points, maxGradeDegrees: route.maxGradeDegrees };
	});
}

function minDistanceToRoads(candidate, roadEdges) {
	let minDistance = Infinity;
	for (const edge of roadEdges) {
		for (let i = 1; i < edge.points.length; i += 1) {
			const a = edge.points[i - 1];
			const b = edge.points[i];
			minDistance = Math.min(minDistance, segmentDistance(candidate.x, candidate.z, a.x, a.z, b.x, b.z));
		}
	}
	return minDistance;
}

export function classifyRockRoadClearance(candidates, roadEdges, clearanceMeters = ROCK_SHADOW_SITE_POLICY.roadClearanceMeters) {
	const safeCandidates = [];
	const conflicts = [];
	let minDistanceMeters = Infinity;
	for (const candidate of candidates) {
		const roadDistanceMeters = minDistanceToRoads(candidate, roadEdges);
		minDistanceMeters = Math.min(minDistanceMeters, roadDistanceMeters);
		const annotated = { ...candidate, roadDistanceMeters };
		if (roadDistanceMeters >= clearanceMeters) safeCandidates.push(annotated);
		else conflicts.push(annotated);
	}
	return { clearanceMeters, safeCandidates, conflicts, minDistanceMeters };
}

export function chooseDenseRockShadowAnchor(candidates, radiusMeters) {
	if (!candidates.length) return { x: 0, z: 0, nearbyCount: 0 };
	let best = { x: candidates[0].x, z: candidates[0].z, nearbyCount: -1 };
	const radius2 = radiusMeters * radiusMeters;
	for (const candidate of candidates) {
		let nearbyCount = 0;
		for (const other of candidates) {
			const dx = other.x - candidate.x;
			const dz = other.z - candidate.z;
			if (dx * dx + dz * dz <= radius2) nearbyCount += 1;
		}
		if (nearbyCount > best.nearbyCount) best = { x: candidate.x, z: candidate.z, nearbyCount };
	}
	return best;
}

function geometryFor(tier, lod) {
	if (lod === 'far') {
		const radius = tier === 'stone' ? 0.75 : tier === 'rock' ? 1.1 : 1.5;
		return new THREE.IcosahedronGeometry(radius, 0);
	}
	if (tier === 'stone') return new THREE.DodecahedronGeometry(0.75, 0);
	if (tier === 'rock') return new THREE.IcosahedronGeometry(1.1, 1);
	return new THREE.DodecahedronGeometry(1.5, 1);
}

function materialFor(tier) {
	return new THREE.MeshStandardMaterial({ color: TIER_COLORS[tier], roughness: 0.94, metalness: 0 });
}

function shapeScale(candidate) {
	const x = 0.78 + rand01(candidate.ix, candidate.iz, 0x44444444) * 0.48;
	const y = 0.58 + rand01(candidate.ix, candidate.iz, 0x55555555) * 0.46;
	const z = 0.74 + rand01(candidate.ix, candidate.iz, 0x66666666) * 0.52;
	return { x, y, z };
}

/**
 * Builds at most six InstancedMeshes (3 tiers x near/far LOD) around one deterministic local anchor.
 * The full 137.5 km² candidate set is never made resident at once.
 */
export function createCanonicalRockShadowGeometry({ candidates, profile = 'mobile', anchor = null } = {}) {
	const renderProfile = ROCK_SHADOW_RENDER_PROFILES[profile];
	if (!renderProfile) throw new Error(`unknown rock shadow profile: ${profile}`);
	const chosenAnchor = anchor || chooseDenseRockShadowAnchor(candidates, renderProfile.renderRadiusMeters);
	const within = candidates
		.map((candidate) => ({ candidate, distanceMeters: Math.hypot(candidate.x - chosenAnchor.x, candidate.z - chosenAnchor.z) }))
		.filter((entry) => entry.distanceMeters <= renderProfile.renderRadiusMeters)
		.sort((a, b) => a.distanceMeters - b.distanceMeters || a.candidate.iz - b.candidate.iz || a.candidate.ix - b.candidate.ix)
		.slice(0, renderProfile.maxInstances);

	const buckets = new Map();
	for (const entry of within) {
		const lod = entry.distanceMeters <= renderProfile.nearDistanceMeters ? 'near' : 'far';
		const key = `${entry.candidate.tier}:${lod}`;
		if (!buckets.has(key)) buckets.set(key, []);
		buckets.get(key).push(entry);
	}

	const group = new THREE.Group();
	group.name = `canonical-rock-shadow-${profile}`;
	const tempPosition = new THREE.Vector3();
	const tempQuaternion = new THREE.Quaternion();
	const tempScale = new THREE.Vector3();
	const tempMatrix = new THREE.Matrix4();
	const up = new THREE.Vector3(0, 1, 0);
	let triangles = 0;
	let drawCalls = 0;
	let nearInstances = 0;
	let farInstances = 0;

	for (const tier of ['stone', 'rock', 'boulder']) {
		for (const lod of ['near', 'far']) {
			const entries = buckets.get(`${tier}:${lod}`) || [];
			if (!entries.length) continue;
			const geometry = geometryFor(tier, lod);
			const material = materialFor(tier);
			const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
			mesh.name = `rock-shadow-${tier}-${lod}`;
			mesh.frustumCulled = false;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
			for (let i = 0; i < entries.length; i += 1) {
				const { candidate } = entries[i];
				const shape = shapeScale(candidate);
				const baseScale = candidate.scale;
				const verticalExtent = baseScale * shape.y;
				tempPosition.set(candidate.x - chosenAnchor.x, candidate.y + verticalExtent * 0.32, candidate.z - chosenAnchor.z);
				tempQuaternion.setFromAxisAngle(up, candidate.yawRadians);
				tempScale.set(baseScale * shape.x, baseScale * shape.y, baseScale * shape.z);
				tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
				mesh.setMatrixAt(i, tempMatrix);
			}
			mesh.instanceMatrix.needsUpdate = true;
			const trianglePerInstance = geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
			triangles += trianglePerInstance * entries.length;
			drawCalls += 1;
			if (lod === 'near') nearInstances += entries.length;
			else farInstances += entries.length;
			group.add(mesh);
		}
	}

	group.userData.rockShadow = Object.freeze({
		profile,
		anchor: Object.freeze({ x: chosenAnchor.x, z: chosenAnchor.z }),
		selectedInstances: within.length,
		nearInstances,
		farInstances,
		drawCalls,
		triangles,
		renderRadiusMeters: renderProfile.renderRadiusMeters,
		nearDistanceMeters: renderProfile.nearDistanceMeters,
		maxInstances: renderProfile.maxInstances,
	});
	return group;
}

export function disposeCanonicalRockShadowGeometry(group) {
	if (!group) return;
	for (const child of group.children) {
		child.geometry?.dispose();
		child.material?.dispose();
	}
	group.clear();
}
