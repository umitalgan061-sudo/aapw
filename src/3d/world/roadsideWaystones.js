/**
 * Deterministic roadside waystones for geographic route readability.
 *
 * The road network remains the sole route authority. This render-only layer samples the already
 * routed (and, when present, bridge-restored) road polylines, then places sparse stone markers on
 * dry, moderate-slope shoulders away from kingdom-seat cores. Canonical terrain, hydrology,
 * collision and road geometry are never modified.
 * @module world/roadsideWaystones
 */

import * as THREE from 'three';
import { northReferenceCryosphereAtWorldXZ } from './northReferenceCryosphere.js';
import { valyriaInfluenceAtWorldXZ } from './valyriaGeology.js';

export const ROADSIDE_WAYSTONE_POLICY = Object.freeze({
	id: 'roadside-waystones-geographic-material-2026-09-02-v1',
	renderOnly: true,
	deterministic: true,
	roadAuthorityUnchanged: true,
	terrainAuthorityUnchanged: true,
	hydrologyAuthorityUnchanged: true,
	colliderAuthorityUnchanged: true,
	desktopSpacingMeters: 260,
	mobileSpacingMeters: 420,
	shoulderOffsetMeters: 7.25,
	shoreClearanceMeters: 1.2,
	seatClearanceMeters: 85,
	maxSlopeDegrees: 20,
	slopeProbeMeters: 2.5,
	stoneHeightMeters: 2.8,
	stoneTopRadiusMeters: 0.36,
	stoneBaseRadiusMeters: 0.62,
	foundationInsetMeters: 0.12,
	textureSizePixels: 96,
});

const BASE_STONE = new THREE.Color(0x81796c);
const NORTH_STONE = new THREE.Color(0xaeb9b8);
const DEEP_FROST_STONE = new THREE.Color(0xc6d1d0);
const VALYRIA_STONE = new THREE.Color(0x4b4542);
const MOSS_STONE = new THREE.Color(0x747866);

function mix32(value) {
	let x = value >>> 0;
	x ^= x >>> 16;
	x = Math.imul(x, 0x7feb352d);
	x ^= x >>> 15;
	x = Math.imul(x, 0x846ca68b);
	x ^= x >>> 16;
	return x >>> 0;
}

function hashString(value, seed = 0) {
	let hash = (2166136261 ^ seed) >>> 0;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return mix32(hash);
}

function hash01(value) {
	return mix32(value) / 4294967296;
}

function finitePoint(point) {
	return point && Number.isFinite(point.x) && Number.isFinite(point.z);
}

function distanceToSeats(x, z, seats) {
	let nearest = Infinity;
	for (const seat of seats) {
		if (!Number.isFinite(seat?.x) || !Number.isFinite(seat?.z)) continue;
		nearest = Math.min(nearest, Math.hypot(x - seat.x, z - seat.z));
	}
	return nearest;
}

function sampleSlopeDegrees(sampleHeightMeters, x, z) {
	const d = ROADSIDE_WAYSTONE_POLICY.slopeProbeMeters;
	const west = sampleHeightMeters(x - d, z);
	const east = sampleHeightMeters(x + d, z);
	const north = sampleHeightMeters(x, z - d);
	const south = sampleHeightMeters(x, z + d);
	if (![west, east, north, south].every(Number.isFinite)) return Infinity;
	const gx = (east - west) / (2 * d);
	const gz = (south - north) / (2 * d);
	return THREE.MathUtils.radToDeg(Math.atan(Math.hypot(gx, gz)));
}

function routeLength(points) {
	let length = 0;
	for (let index = 1; index < points.length; index += 1) {
		if (!finitePoint(points[index - 1]) || !finitePoint(points[index])) continue;
		length += Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
	}
	return length;
}

function pointAtRouteDistance(points, targetMeters) {
	let traversed = 0;
	for (let index = 1; index < points.length; index += 1) {
		const a = points[index - 1];
		const b = points[index];
		if (!finitePoint(a) || !finitePoint(b)) continue;
		const dx = b.x - a.x;
		const dz = b.z - a.z;
		const segmentMeters = Math.hypot(dx, dz);
		if (segmentMeters < 1e-6) continue;
		if (traversed + segmentMeters >= targetMeters) {
			const t = Math.min(1, Math.max(0, (targetMeters - traversed) / segmentMeters));
			return {
				x: a.x + dx * t,
				z: a.z + dz * t,
				ux: dx / segmentMeters,
				uz: dz / segmentMeters,
			};
		}
		traversed += segmentMeters;
	}
	return null;
}

function geographicTintAt(x, z, siteHash) {
	const cryosphere = northReferenceCryosphereAtWorldXZ(x, z);
	const valyria = valyriaInfluenceAtWorldXZ(x, z);
	const tint = BASE_STONE.clone();
	let profile = 'temperate';
	if (valyria >= 0.08) {
		profile = 'valyria';
		tint.lerp(VALYRIA_STONE, Math.min(0.88, 0.42 + valyria * 0.52));
	} else if (cryosphere.tundra >= 0.18) {
		profile = 'north';
		tint.lerp(NORTH_STONE, Math.min(0.78, cryosphere.tundra * 0.68));
		tint.lerp(DEEP_FROST_STONE, Math.min(0.52, cryosphere.permanentIce * 0.52));
	} else {
		const moss = 0.05 + hash01(siteHash ^ 0x6d6f7373) * 0.12;
		tint.lerp(MOSS_STONE, moss);
	}
	const shade = 0.91 + hash01(siteHash ^ 0x73686164) * 0.16;
	tint.multiplyScalar(shade);
	return { tint, profile, cryosphere, valyria };
}

/**
 * Plan waystone sites from live road polylines. No THREE scene state is mutated here, which keeps
 * deterministic placement independently testable.
 */
export function planRoadsideWaystoneSites({
	roadEdges,
	seats = [],
	sampleHeightMeters,
	seaLevelMeters,
	seed = 1,
	isMobileClass = false,
} = {}) {
	if (!Array.isArray(roadEdges)) throw new TypeError('roadEdges must be an array');
	if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
	if (!Number.isFinite(seaLevelMeters)) throw new TypeError('seaLevelMeters must be finite');
	const spacingMeters = isMobileClass
		? ROADSIDE_WAYSTONE_POLICY.mobileSpacingMeters
		: ROADSIDE_WAYSTONE_POLICY.desktopSpacingMeters;
	const stats = {
		candidateCount: 0,
		placedCount: 0,
		waterRejectCount: 0,
		seatRejectCount: 0,
		slopeRejectCount: 0,
		nonFiniteRejectCount: 0,
		profiles: { temperate: 0, north: 0, valyria: 0 },
		minGroundClearanceMeters: Infinity,
		maxSlopeDegrees: 0,
	};
	const sites = [];

	for (let edgeIndex = 0; edgeIndex < roadEdges.length; edgeIndex += 1) {
		const edge = roadEdges[edgeIndex];
		const points = Array.isArray(edge?.points) ? edge.points : [];
		if (points.length < 2) continue;
		const edgeId = `${edge?.fromId ?? edgeIndex}->${edge?.toId ?? edgeIndex}`;
		const edgeHash = hashString(edgeId, seed >>> 0);
		const lengthMeters = Number.isFinite(edge?.lengthMeters) ? edge.lengthMeters : routeLength(points);
		const phase = spacingMeters * (0.32 + hash01(edgeHash ^ 0x70686173) * 0.36);

		for (let along = phase, ordinal = 0; along < lengthMeters - phase * 0.45; along += spacingMeters, ordinal += 1) {
			stats.candidateCount += 1;
			const center = pointAtRouteDistance(points, along);
			if (!center) { stats.nonFiniteRejectCount += 1; continue; }
			const siteHash = mix32(edgeHash ^ Math.imul(ordinal + 1, 0x9e3779b1));
			const side = hash01(siteHash ^ 0x73696465) < 0.5 ? -1 : 1;
			const shoulderJitter = (hash01(siteHash ^ 0x6a697474) - 0.5) * 1.1;
			const offset = ROADSIDE_WAYSTONE_POLICY.shoulderOffsetMeters + shoulderJitter;
			const x = center.x - center.uz * offset * side;
			const z = center.z + center.ux * offset * side;
			const groundY = sampleHeightMeters(x, z);
			if (![x, z, groundY].every(Number.isFinite)) { stats.nonFiniteRejectCount += 1; continue; }
			const groundClearanceMeters = groundY - seaLevelMeters;
			if (groundClearanceMeters <= ROADSIDE_WAYSTONE_POLICY.shoreClearanceMeters) {
				stats.waterRejectCount += 1;
				continue;
			}
			if (distanceToSeats(x, z, seats) < ROADSIDE_WAYSTONE_POLICY.seatClearanceMeters) {
				stats.seatRejectCount += 1;
				continue;
			}
			const slopeDegrees = sampleSlopeDegrees(sampleHeightMeters, x, z);
			if (!Number.isFinite(slopeDegrees) || slopeDegrees > ROADSIDE_WAYSTONE_POLICY.maxSlopeDegrees) {
				stats.slopeRejectCount += 1;
				continue;
			}
			const geographic = geographicTintAt(x, z, siteHash);
			stats.profiles[geographic.profile] += 1;
			stats.minGroundClearanceMeters = Math.min(stats.minGroundClearanceMeters, groundClearanceMeters);
			stats.maxSlopeDegrees = Math.max(stats.maxSlopeDegrees, slopeDegrees);
			sites.push(Object.freeze({
				id: `${edgeId}:waystone-${ordinal + 1}`,
				edgeId,
				x,
				y: groundY,
				z,
				yawRadians: Math.atan2(center.ux, center.uz) + (hash01(siteHash ^ 0x796177) - 0.5) * 0.16,
				side,
				shoulderOffsetMeters: offset,
				slopeDegrees,
				groundClearanceMeters,
				profile: geographic.profile,
				color: Object.freeze([geographic.tint.r, geographic.tint.g, geographic.tint.b]),
			}));
		}
	}

	stats.placedCount = sites.length;
	if (!Number.isFinite(stats.minGroundClearanceMeters)) stats.minGroundClearanceMeters = null;
	return Object.freeze({
		policyId: ROADSIDE_WAYSTONE_POLICY.id,
		spacingMeters,
		sites: Object.freeze(sites),
		stats: Object.freeze({
			...stats,
			profiles: Object.freeze({ ...stats.profiles }),
		}),
	});
}

function createStoneTexture(seed) {
	const size = ROADSIDE_WAYSTONE_POLICY.textureSizePixels;
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const pixel = (y * size + x) * 4;
			const cellX = Math.floor(x / 8);
			const cellY = Math.floor(y / 8);
			const coarse = hash01(mix32(seed ^ Math.imul(cellX + 17, 0x45d9f3b) ^ Math.imul(cellY + 31, 0x119de1f3)));
			const fine = hash01(mix32(seed ^ Math.imul(x + 101, 0x27d4eb2d) ^ Math.imul(y + 211, 0x165667b1)));
			const mortar = (x % 24 <= 1) || ((y + (Math.floor(x / 24) % 2) * 8) % 18 <= 1);
			const lichen = coarse > 0.78 && fine > 0.57;
			let r = 142 + Math.round((coarse - 0.5) * 24 + (fine - 0.5) * 10);
			let g = 137 + Math.round((coarse - 0.5) * 21 + (fine - 0.5) * 8);
			let b = 126 + Math.round((coarse - 0.5) * 18 + (fine - 0.5) * 8);
			if (mortar) { r -= 25; g -= 24; b -= 22; }
			if (lichen) { r -= 23; g += 2; b -= 25; }
			data[pixel] = Math.max(0, Math.min(255, r));
			data[pixel + 1] = Math.max(0, Math.min(255, g));
			data[pixel + 2] = Math.max(0, Math.min(255, b));
			data[pixel + 3] = 255;
		}
	}
	const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
	texture.name = 'roadside-waystone-weathered-masonry';
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(1.8, 3.2);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

export function createRoadsideWaystones(options = {}) {
	const plan = planRoadsideWaystoneSites(options);
	const texture = createStoneTexture((options.seed ?? 1) >>> 0);
	const material = new THREE.MeshStandardMaterial({
		map: texture,
		color: 0xffffff,
		roughness: 0.94,
		metalness: 0,
		vertexColors: true,
	});
	const originalDispose = material.dispose.bind(material);
	let textureDisposed = false;
	material.dispose = () => {
		if (!textureDisposed) { texture.dispose(); textureDisposed = true; }
		originalDispose();
	};
	material.userData.roadsideWaystoneTextureDisposeGuard = true;

	const geometry = new THREE.CylinderGeometry(
		ROADSIDE_WAYSTONE_POLICY.stoneTopRadiusMeters,
		ROADSIDE_WAYSTONE_POLICY.stoneBaseRadiusMeters,
		ROADSIDE_WAYSTONE_POLICY.stoneHeightMeters,
		7,
		2,
		false,
	);
	geometry.rotateY(Math.PI / 7);
	const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, plan.sites.length));
	mesh.name = 'roadside-waystones';
	mesh.count = plan.sites.length;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.frustumCulled = true;
	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const rotation = new THREE.Quaternion();
	const scale = new THREE.Vector3(1, 1, 1);
	const color = new THREE.Color();
	for (let index = 0; index < plan.sites.length; index += 1) {
		const site = plan.sites[index];
		const visibleBaseY = site.y - ROADSIDE_WAYSTONE_POLICY.foundationInsetMeters;
		position.set(site.x, visibleBaseY + ROADSIDE_WAYSTONE_POLICY.stoneHeightMeters * 0.5, site.z);
		rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), site.yawRadians);
		matrix.compose(position, rotation, scale);
		mesh.setMatrixAt(index, matrix);
		color.setRGB(site.color[0], site.color[1], site.color[2]);
		mesh.setColorAt(index, color);
	}
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	mesh.computeBoundingSphere?.();
	mesh.userData.roadsideWaystonePolicy = ROADSIDE_WAYSTONE_POLICY;
	mesh.userData.roadsideWaystoneStats = plan.stats;
	mesh.userData.roadsideWaystoneSites = plan.sites;
	mesh.userData.placementAuthority = 'bridge-aware-road-edges-render-only';
	mesh.userData.materialGeography = 'temperate-moss/north-frost/valyria-basalt';
	return Object.freeze({ mesh, sites: plan.sites, stats: plan.stats, policy: ROADSIDE_WAYSTONE_POLICY });
}
