/**
 * Procedural villages around kingdom seats.
 *
 * Grounding rule: a rigid structure is never positioned from a single centre-height sample. Every
 * house samples its rotated footprint (centre, corners and edge mid-points). The wall body extends
 * from the lowest sampled terrain point to a flat top above the highest sampled point, so downhill
 * corners cannot hover while uphill corners remain safely embedded in the terrain. Stairs and field
 * walls are grounded from their own footprints as well.
 * @module world/villages
 */

import * as THREE from 'three';
import { isPlaceablePosition } from './vegetation.js';
import { createStoneMaterial, createRoofMaterial } from './materials.js';

const VILLAGE_OUTER_RADIUS_METERS = 210;
const HAMLET_DISTANCE_MIN_METERS = 115;
const HAMLET_DISTANCE_MAX_METERS = 155;
const HAMLET_RADIUS_METERS = 38;
const MIN_HOUSE_SPACING_METERS = 11;
const MAX_ATTEMPTS_PER_BUILDING = 12;
const GROUND_EMBED_EPSILON_METERS = 0.08;
const STOOP_STEP_COUNT = 3;
const STOOP_STEP_RISE_METERS = 0.18;
const STOOP_STEP_RUN_METERS = 0.34;
const STOOP_WIDTH_METERS = 1.6;

const HOUSE_TYPES = [
	{ id: 'cottage', weight: 0.55, width: 5.2, depth: 4.4, wallHeight: 2.5, roofHeight: 2.2 },
	{ id: 'longhouse', weight: 0.3, width: 8.6, depth: 4.8, wallHeight: 2.7, roofHeight: 2.4 },
	{ id: 'twostory', weight: 0.15, width: 5.6, depth: 5.0, wallHeight: 4.6, roofHeight: 2.6 },
];

const WALL_COLOR = new THREE.Color(0xbdae91);
const STONE_WALL_COLOR = new THREE.Color(0x8d8878);
const THATCH_COLOR = new THREE.Color(0x9c7b42);

export function pickHouseTypeIndex(roll) {
	const total = HOUSE_TYPES.reduce((sum, type) => sum + type.weight, 0);
	let cumulative = 0;
	for (let i = 0; i < HOUSE_TYPES.length; i++) {
		cumulative += HOUSE_TYPES[i].weight / total;
		if (roll < cumulative) return i;
	}
	return HOUSE_TYPES.length - 1;
}

function buildVillageGeometries() {
	const body = new THREE.BoxGeometry(1, 1, 1);
	body.translate(0, 0.5, 0);
	const roof = new THREE.ConeGeometry(0.72, 1, 4);
	roof.rotateY(Math.PI / 4);
	roof.translate(0, 0.5, 0);
	const step = new THREE.BoxGeometry(1, 1, 1);
	step.translate(0, 0.5, 0);
	const wall = new THREE.BoxGeometry(1, 1, 1);
	wall.translate(0, 0.5, 0);
	return { body, roof, step, wall };
}

function rotatedWorldPoint(x, z, yaw, localX, localZ) {
	const sin = Math.sin(yaw);
	const cos = Math.cos(yaw);
	return {
		x: x + localX * cos + localZ * sin,
		z: z - localX * sin + localZ * cos,
	};
}

/** Sample the complete support footprint instead of trusting one centre point. */
function sampleFootprintRange(sampleHeightMeters, x, z, width, depth, yaw) {
	const hx = width * 0.5;
	const hz = depth * 0.5;
	const offsets = [
		[0, 0], [-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz],
		[-hx, 0], [hx, 0], [0, -hz], [0, hz],
	];
	let min = Infinity;
	let max = -Infinity;
	for (const [localX, localZ] of offsets) {
		const p = rotatedWorldPoint(x, z, yaw, localX, localZ);
		const h = sampleHeightMeters(p.x, p.z);
		if (h < min) min = h;
		if (h > max) max = h;
	}
	return { min, max };
}

export function createVillages({
	sampleHeightMeters,
	seaLevelMeters,
	seed,
	seats,
	roadEdges,
	radiusMeters,
	mulberry32,
	housesPerVillage = 10,
}) {
	const group = new THREE.Group();
	group.name = 'villages';
	const eligibleSeats = seats.filter((seat) => Math.hypot(seat.x, seat.z) + VILLAGE_OUTER_RADIUS_METERS <= radiusMeters);
	const maxHouses = eligibleSeats.length * housesPerVillage;
	const maxWalls = eligibleSeats.length * 14;
	if (maxHouses === 0) return { group, villageCount: 0, houseCount: 0, wallCount: 0, houses: [] };

	const rng = mulberry32(seed ^ 0x56494c4c);
	const geometries = buildVillageGeometries();
	const wallMaterial = createStoneMaterial({ seed: seed + 41, baseColor: WALL_COLOR, repeat: 0.6 });
	const roofMaterial = createRoofMaterial({ seed: seed + 42, repeat: 3 });
	const stoneMaterial = createStoneMaterial({ seed: seed + 43, baseColor: STONE_WALL_COLOR, repeat: 0.8 });

	const bodyMesh = new THREE.InstancedMesh(geometries.body, wallMaterial, maxHouses);
	const roofMesh = new THREE.InstancedMesh(geometries.roof, roofMaterial, maxHouses);
	const stepMesh = new THREE.InstancedMesh(geometries.step, stoneMaterial, maxHouses * STOOP_STEP_COUNT);
	const wallMesh = new THREE.InstancedMesh(geometries.wall, stoneMaterial, maxWalls);
	bodyMesh.name = 'village-houses';
	roofMesh.name = 'village-roofs';
	stepMesh.name = 'village-steps';
	wallMesh.name = 'village-walls';
	for (const mesh of [bodyMesh, roofMesh, stepMesh, wallMesh]) {
		mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
	}

	const dummy = new THREE.Object3D();
	const thatch = new THREE.Color();
	let houseCount = 0;
	let stepCount = 0;
	let wallCount = 0;
	let villageCount = 0;
	const houses = [];

	for (const seat of eligibleSeats) {
		const placedHere = [];
		const hamletBearing = rng() * Math.PI * 2;
		const hamletDistance = HAMLET_DISTANCE_MIN_METERS + rng() * (HAMLET_DISTANCE_MAX_METERS - HAMLET_DISTANCE_MIN_METERS);
		const hamletX = seat.x + Math.cos(hamletBearing) * hamletDistance;
		const hamletZ = seat.z + Math.sin(hamletBearing) * hamletDistance;

		for (let i = 0; i < housesPerVillage; i++) {
			for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_BUILDING; attempt++) {
				const spreadAngle = rng() * Math.PI * 2;
				const spreadRadius = HAMLET_RADIUS_METERS * Math.sqrt(rng());
				const x = hamletX + Math.cos(spreadAngle) * spreadRadius;
				const z = hamletZ + Math.sin(spreadAngle) * spreadRadius;
				if (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;
				if (placedHere.some((other) => Math.hypot(x - other.x, z - other.z) < MIN_HOUSE_SPACING_METERS)) continue;

				const type = HOUSE_TYPES[pickHouseTypeIndex(rng())];
				const yaw = Math.atan2(hamletX - x, hamletZ - z) + (rng() - 0.5) * 0.5;
				const support = sampleFootprintRange(sampleHeightMeters, x, z, type.width, type.depth, yaw);
				const bodyBaseY = support.min - GROUND_EMBED_EPSILON_METERS;
				const bodyHeight = type.wallHeight + (support.max - support.min) + GROUND_EMBED_EPSILON_METERS;
				const wallTopY = support.max + type.wallHeight;

				// Extending the body down to the footprint's lowest sampled terrain point is the cheap,
				// instancing-safe equivalent of a terrain skirt: no downhill corner can ever hover.
				dummy.position.set(x, bodyBaseY, z);
				dummy.rotation.set(0, yaw, 0);
				dummy.scale.set(type.width, bodyHeight, type.depth);
				dummy.updateMatrix();
				bodyMesh.setMatrixAt(houseCount, dummy.matrix);

				dummy.position.set(x, wallTopY, z);
				dummy.rotation.set(0, yaw, 0);
				dummy.scale.set(type.width * 1.04, type.roofHeight, type.depth * 1.04);
				dummy.updateMatrix();
				roofMesh.setMatrixAt(houseCount, dummy.matrix);
				thatch.copy(THATCH_COLOR).offsetHSL(0, 0, (rng() - 0.5) * 0.12);
				roofMesh.setColorAt(houseCount, thatch);

				const frontX = Math.sin(yaw);
				const frontZ = Math.cos(yaw);
				for (let s = 0; s < STOOP_STEP_COUNT; s++) {
					const outward = type.depth / 2 + (STOOP_STEP_COUNT - s) * STOOP_STEP_RUN_METERS;
					const stepX = x + frontX * outward;
					const stepZ = z + frontZ * outward;
					const stepGroundY = sampleHeightMeters(stepX, stepZ) - GROUND_EMBED_EPSILON_METERS;
					dummy.position.set(stepX, stepGroundY, stepZ);
					dummy.rotation.set(0, yaw, 0);
					dummy.scale.set(STOOP_WIDTH_METERS, STOOP_STEP_RISE_METERS * (s + 1) + GROUND_EMBED_EPSILON_METERS, STOOP_STEP_RUN_METERS);
					dummy.updateMatrix();
					stepMesh.setMatrixAt(stepCount++, dummy.matrix);
				}

				placedHere.push({ x, z });
				houses.push({ x, z, radius: Math.hypot(type.width, type.depth) / 2 });
				houseCount++;
				break;
			}
		}

		if (placedHere.length === 0) continue;
		villageCount++;
		const ringOrder = [...placedHere].sort((p, q) =>
			Math.atan2(p.z - hamletZ, p.x - hamletX) - Math.atan2(q.z - hamletZ, q.x - hamletX));
		for (let i = 0; i < ringOrder.length && wallCount < maxWalls; i++) {
			const a = ringOrder[i];
			const b = ringOrder[(i + 1) % ringOrder.length];
			const span = Math.hypot(b.x - a.x, b.z - a.z);
			if (span > 26) continue;
			const midX = (a.x + b.x) / 2;
			const midZ = (a.z + b.z) / 2;
			if (!isPlaceablePosition(midX, midZ, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;
			const h0 = sampleHeightMeters(a.x, a.z);
			const h1 = sampleHeightMeters(midX, midZ);
			const h2 = sampleHeightMeters(b.x, b.z);
			const minGround = Math.min(h0, h1, h2) - GROUND_EMBED_EPSILON_METERS;
			const maxGround = Math.max(h0, h1, h2);
			dummy.position.set(midX, minGround, midZ);
			dummy.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0);
			dummy.scale.set(0.45, 0.95 + (maxGround - minGround), span * 0.6);
			dummy.updateMatrix();
			wallMesh.setMatrixAt(wallCount++, dummy.matrix);
		}
	}

	bodyMesh.count = houseCount;
	roofMesh.count = houseCount;
	stepMesh.count = stepCount;
	wallMesh.count = wallCount;
	for (const mesh of [bodyMesh, roofMesh, stepMesh, wallMesh]) mesh.instanceMatrix.needsUpdate = true;
	if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true;
	group.add(bodyMesh, roofMesh, stepMesh, wallMesh);
	return { group, villageCount, houseCount, wallCount, houses };
}

export function disposeVillages(group) {
	const disposedMaterials = new Set();
	for (const mesh of group.children) {
		mesh.geometry.dispose();
		if (disposedMaterials.has(mesh.material)) continue;
		disposedMaterials.add(mesh.material);
		for (const key of ['map', 'roughnessMap', 'normalMap']) if (mesh.material[key]) mesh.material[key].dispose();
		mesh.material.dispose();
	}
}
