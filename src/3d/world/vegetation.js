/**
 * Procedural instanced trees — closes a real, long-standing gap: `GOVERNANCE.md` §3's target
 * architecture has named "Vegetation" as a `world/` system since this project's very first
 * architecture doc, and `config.js`'s `WORLD_DEFAULTS.WORLD_SEED` comment ("terrain, later
 * vegetation/rivers/etc.") has said so since before rivers even existed. Run 111/ADR-0138 shipped
 * the first pass (scatter-only, one species). Run 112/ADR-0139 added the "species variety" follow-up
 * ADR-0138 itself named as the natural next step: two low-poly species (a narrow conical "pine" —
 * ADR-0138's original tree, unchanged — and a rounder "round-crown" tree with a sphere foliage cap)
 * mixed by a deterministic per-tree weighted roll, so the scatter no longer reads as visually
 * uniform. Run 113/ADR-0140 adds the other follow-up ADR-0139 itself named: seat-local clustering —
 * a denser ring of trees just outside each kingdom seat's flattened footprint (reads as a managed
 * treeline/windbreak/hunting ground near a castle, not open wild forest), an independent *second*
 * placement pass layered on top of the unchanged base disc scatter (own tagged rng stream, own
 * annulus sampling, same shared `isPlaceablePosition`/`pickSpeciesIndex` — see `createVegetation`'s
 * own doc comment for why only seats near the loaded terrain disc qualify).
 *
 * Far-north species selection now consumes the canonical map-aligned X+Z cryosphere field. The
 * lands-always-winter zone receives snow-laden pine while same-latitude eastern regions no longer
 * become snowy merely because they share world Z. The legacy Z-only picker remains exported for
 * compatibility, but live scatter uses X+Z ownership from `northReferenceCryosphere.js`.
 * @module world/vegetation
 */

import * as THREE from 'three';
import { mulberry32 } from './terrain.js';
import { northClimateWeightsAtWorldZ } from './terrainBiomeShading.js';
import { northReferenceCryosphereAtWorldXZ } from './northReferenceCryosphere.js';

/**
 * Low-poly species recipes. `weight` applies only to the temperate picker; climate-only species use
 * weight 0 and are selected explicitly by the climate-aware pickers below.
 */
const SPECIES = [
	{
		id: 'pine',
		weight: 0.6,
		trunk: { radiusTop: 0.22, radiusBottom: 0.38, height: 3.4, radialSegments: 6, color: 0x5b4028 },
		foliage: { kind: 'cone', radius: 2.15, height: 5.6, radialSegments: 7, overlapMeters: 0.3, color: 0x2f5c26 },
	},
	{
		id: 'round',
		weight: 0.4,
		trunk: { radiusTop: 0.2, radiusBottom: 0.34, height: 2.8, radialSegments: 6, color: 0x5b4028 },
		foliage: { kind: 'sphere', radius: 2.4, widthSegments: 7, heightSegments: 6, overlapMeters: 0.7, color: 0x4a7a2e },
	},
	{
		id: 'snow-pine',
		weight: 0,
		trunk: { radiusTop: 0.20, radiusBottom: 0.36, height: 3.2, radialSegments: 6, color: 0x4f443b },
		foliage: { kind: 'cone', radius: 2.25, height: 5.9, radialSegments: 7, overlapMeters: 0.34, color: 0xcad9d6 },
	},
];

const TEMPERATE_SPECIES_COUNT = 2;
const SNOW_PINE_SPECIES_INDEX = 2;

export const VEGETATION_NORTH_CLIMATE_POLICY = Object.freeze({
	id: 'vegetation-map-aligned-north-climate-2026-08-22-v2',
	climateAuthority: 'northReferenceCryosphereAtWorldXZ',
	permanentIceSnowOnlyThreshold: 0.55,
	tundraClimateThreshold: 0.20,
	tundraBaseSnowChance: 0.22,
	tundraSnowGain: 0.55,
	iceSnowGain: 0.55,
	greenBroadleafAllowedInTundra: false,
	verifiedAssetCandidates: Object.freeze([
		'assets/models/vegetation/winter_tree.glb',
		'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb',
	]),
	liveRepresentation: 'instanced-procedural-snow-pine',
});

/** Trees per km² of the scatter disc. */
const TARGET_DENSITY_PER_KM2 = 30;
const MAX_ATTEMPTS_PER_TREE = 8;
const SEAT_EXCLUSION_RADIUS_METERS = 90;
const ROAD_EXCLUSION_RADIUS_METERS = 10;
const SHORE_MARGIN_METERS = 1.5;
const MAX_GROUND_SLOPE_DEGREES = 45;
const SLOPE_SAMPLE_OFFSET_METERS = 3;
const SCALE_MIN = 0.75;
const SCALE_MAX = 1.35;
const CLUSTER_RING_INNER_MARGIN_METERS = 10;
const CLUSTER_RING_OUTER_RADIUS_METERS = 260;
const CLUSTER_DENSITY_PER_KM2 = 220;

/** Shortest 2D X/Z distance from a point to a segment. */
export function distancePointToSegment2D(px, pz, ax, az, bx, bz) {
	const abx = bx - ax;
	const abz = bz - az;
	const lengthSquared = abx * abx + abz * abz;
	if (lengthSquared === 0) return Math.hypot(px - ax, pz - az);
	let t = ((px - ax) * abx + (pz - az) * abz) / lengthSquared;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

/** Whether `(x,z)` is a safe tree-placement point. */
export function isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges }) {
	for (const seat of seats) {
		if (Math.hypot(x - seat.x, z - seat.z) < SEAT_EXCLUSION_RADIUS_METERS) return false;
	}
	for (const edge of roadEdges) {
		const points = edge.points;
		for (let i = 1; i < points.length; i++) {
			const distance = distancePointToSegment2D(x, z, points[i - 1].x, points[i - 1].z, points[i].x, points[i].z);
			if (distance < ROAD_EXCLUSION_RADIUS_METERS) return false;
		}
	}
	const groundY = sampleHeightMeters(x, z);
	if (groundY <= seaLevelMeters + SHORE_MARGIN_METERS) return false;

	const dxHeight = sampleHeightMeters(x + SLOPE_SAMPLE_OFFSET_METERS, z) - groundY;
	const dzHeight = sampleHeightMeters(x, z + SLOPE_SAMPLE_OFFSET_METERS) - groundY;
	const gradeXDegrees = (Math.atan2(Math.abs(dxHeight), SLOPE_SAMPLE_OFFSET_METERS) * 180) / Math.PI;
	const gradeZDegrees = (Math.atan2(Math.abs(dzHeight), SLOPE_SAMPLE_OFFSET_METERS) * 180) / Math.PI;
	if (Math.max(gradeXDegrees, gradeZDegrees) > MAX_GROUND_SLOPE_DEGREES) return false;
	return true;
}

/** Deterministically picks one temperate species from one `[0,1)` draw. */
export function pickSpeciesIndex(roll) {
	const totalWeight = SPECIES.slice(0, TEMPERATE_SPECIES_COUNT).reduce((sum, species) => sum + species.weight, 0);
	let cumulative = 0;
	for (let i = 0; i < TEMPERATE_SPECIES_COUNT; i++) {
		cumulative += SPECIES[i].weight / totalWeight;
		if (roll < cumulative) return i;
	}
	return TEMPERATE_SPECIES_COUNT - 1;
}

function pickSpeciesIndexForClimate(roll, climate) {
	const policy = VEGETATION_NORTH_CLIMATE_POLICY;
	if (climate.permanentIce >= policy.permanentIceSnowOnlyThreshold) return SNOW_PINE_SPECIES_INDEX;
	if (Math.max(climate.permanentIce, climate.tundra) >= policy.tundraClimateThreshold) {
		const snowChance = Math.min(1,
			policy.tundraBaseSnowChance
			+ climate.tundra * policy.tundraSnowGain
			+ climate.permanentIce * policy.iceSnowGain);
		return roll < snowChance ? SNOW_PINE_SPECIES_INDEX : 0;
	}
	return pickSpeciesIndex(roll);
}

/** Compatibility picker for callers that still only know world Z. */
export function pickSpeciesIndexForWorldZ(roll, worldZ) {
	return pickSpeciesIndexForClimate(roll, northClimateWeightsAtWorldZ(worldZ));
}

/** Canonical live picker: X+Z decides whether a point actually belongs to northern Westeros. */
export function pickSpeciesIndexForWorldXZ(roll, worldX, worldZ) {
	return pickSpeciesIndexForClimate(roll, northReferenceCryosphereAtWorldXZ(worldX, worldZ));
}

export function vegetationSpeciesId(index) {
	return SPECIES[index]?.id ?? null;
}

/** Uniform random point inside an annulus. */
export function sampleAnnulusPoint(rng, centerX, centerZ, innerRadius, outerRadius) {
	const angle = rng() * Math.PI * 2;
	const radius = Math.sqrt(rng() * (outerRadius * outerRadius - innerRadius * innerRadius) + innerRadius * innerRadius);
	return { x: centerX + Math.cos(angle) * radius, z: centerZ + Math.sin(angle) * radius };
}

function buildSpeciesAssets(species) {
	const { trunk, foliage } = species;
	const trunkGeometry = new THREE.CylinderGeometry(trunk.radiusTop, trunk.radiusBottom, trunk.height, trunk.radialSegments);
	trunkGeometry.translate(0, trunk.height / 2, 0);

	let foliageGeometry;
	if (foliage.kind === 'cone') {
		foliageGeometry = new THREE.ConeGeometry(foliage.radius, foliage.height, foliage.radialSegments);
		foliageGeometry.translate(0, trunk.height + foliage.height / 2 - foliage.overlapMeters, 0);
	} else if (foliage.kind === 'sphere') {
		foliageGeometry = new THREE.SphereGeometry(foliage.radius, foliage.widthSegments, foliage.heightSegments);
		foliageGeometry.translate(0, trunk.height + foliage.radius - foliage.overlapMeters, 0);
	} else {
		throw new Error(`world/vegetation.js: unknown foliage kind "${foliage.kind}" for species "${species.id}"`);
	}

	const trunkMaterial = new THREE.MeshStandardMaterial({ color: trunk.color, roughness: 1, metalness: 0 });
	const foliageMaterial = new THREE.MeshStandardMaterial({ color: foliage.color, roughness: 0.9, metalness: 0 });
	return { trunkGeometry, foliageGeometry, trunkMaterial, foliageMaterial };
}

function placeTreeInstance(entry, x, z, sampleHeightMeters, rng, up, matrix, position, quaternion, scaleVector) {
	const groundY = sampleHeightMeters(x, z);
	const scale = SCALE_MIN + rng() * (SCALE_MAX - SCALE_MIN);
	const yaw = rng() * Math.PI * 2;
	position.set(x, groundY, z);
	quaternion.setFromAxisAngle(up, yaw);
	scaleVector.set(scale, scale, scale);
	matrix.compose(position, quaternion, scaleVector);
	entry.trunkMesh.setMatrixAt(entry.placedCount, matrix);
	entry.foliageMesh.setMatrixAt(entry.placedCount, matrix);
	entry.placedCount++;
}

/**
 * Scatters deterministic trees in the existing base-disc + seat-cluster passes, with species now
 * resolved against the canonical map-aligned north cryosphere.
 */
export function createVegetation({ sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, radiusMeters, densityPerKm2 = TARGET_DENSITY_PER_KM2 }) {
	const group = new THREE.Group();
	const areaKm2 = (Math.PI * radiusMeters * radiusMeters) / 1_000_000;
	const baseTargetCount = Math.max(0, Math.round(areaKm2 * densityPerKm2));

	const clusterInnerRadius = SEAT_EXCLUSION_RADIUS_METERS + CLUSTER_RING_INNER_MARGIN_METERS;
	const clusterSeats = seats.filter((seat) => Math.hypot(seat.x, seat.z) + CLUSTER_RING_OUTER_RADIUS_METERS <= radiusMeters);
	const ringAreaKm2 = (Math.PI * (CLUSTER_RING_OUTER_RADIUS_METERS ** 2 - clusterInnerRadius ** 2)) / 1_000_000;
	const clusterTargetPerSeat = Math.max(0, Math.round(ringAreaKm2 * CLUSTER_DENSITY_PER_KM2));
	const clusterTargetTotal = clusterSeats.length * clusterTargetPerSeat;

	const targetCount = baseTargetCount + clusterTargetTotal;
	if (targetCount === 0) return { group, targetCount: 0, placedCount: 0, clusterSeatCount: 0, winterTreeCount: 0 };

	const rng = mulberry32(seed ^ 0x56454745);
	const clusterRng = mulberry32(seed ^ 0x434c5354);
	const up = new THREE.Vector3(0, 1, 0);

	const perSpecies = SPECIES.map((species) => {
		const { trunkGeometry, foliageGeometry, trunkMaterial, foliageMaterial } = buildSpeciesAssets(species);
		const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, targetCount);
		const foliageMesh = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, targetCount);
		trunkMesh.name = `vegetation-${species.id}-trunks`;
		foliageMesh.name = `vegetation-${species.id}-foliage`;
		trunkMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
		foliageMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
		return { species, trunkMesh, foliageMesh, placedCount: 0 };
	});

	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();
	const scaleVector = new THREE.Vector3();

	let placedCount = 0;
	for (let treeIndex = 0; treeIndex < baseTargetCount; treeIndex++) {
		for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TREE; attempt++) {
			const angle = rng() * Math.PI * 2;
			const radius = radiusMeters * Math.sqrt(rng());
			const x = Math.cos(angle) * radius;
			const z = Math.sin(angle) * radius;
			if (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;

			const speciesIndex = pickSpeciesIndexForWorldXZ(rng(), x, z);
			const entry = perSpecies[speciesIndex];
			placeTreeInstance(entry, x, z, sampleHeightMeters, rng, up, matrix, position, quaternion, scaleVector);
			placedCount++;
			break;
		}
	}

	for (const seat of clusterSeats) {
		for (let treeIndex = 0; treeIndex < clusterTargetPerSeat; treeIndex++) {
			for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TREE; attempt++) {
				const { x, z } = sampleAnnulusPoint(clusterRng, seat.x, seat.z, clusterInnerRadius, CLUSTER_RING_OUTER_RADIUS_METERS);
				if (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;

				const speciesIndex = pickSpeciesIndexForWorldXZ(clusterRng(), x, z);
				const entry = perSpecies[speciesIndex];
				placeTreeInstance(entry, x, z, sampleHeightMeters, clusterRng, up, matrix, position, quaternion, scaleVector);
				placedCount++;
				break;
			}
		}
	}

	for (const entry of perSpecies) {
		entry.trunkMesh.count = entry.placedCount;
		entry.foliageMesh.count = entry.placedCount;
		entry.trunkMesh.instanceMatrix.needsUpdate = true;
		entry.foliageMesh.instanceMatrix.needsUpdate = true;
		group.add(entry.trunkMesh, entry.foliageMesh);
	}

	const winterTreeCount = perSpecies[SNOW_PINE_SPECIES_INDEX].placedCount;
	group.userData.northClimateVegetation = Object.freeze({
		policyId: VEGETATION_NORTH_CLIMATE_POLICY.id,
		climateAuthority: VEGETATION_NORTH_CLIMATE_POLICY.climateAuthority,
		mapAligned: true,
		winterTreeCount,
		temperateTreeCount: placedCount - winterTreeCount,
		liveRepresentation: VEGETATION_NORTH_CLIMATE_POLICY.liveRepresentation,
	});
	return { group, targetCount, placedCount, clusterSeatCount: clusterSeats.length, winterTreeCount };
}

export function disposeVegetation(group) {
	for (const mesh of group.children) {
		mesh.geometry.dispose();
		mesh.material.dispose();
	}
}

// Run 136 / ADR-0160 — mobile-only vegetation geometry LOD.
const MOBILE_VEGETATION_LOD_RUN136 = Object.freeze({
	trunkRadialSegments: 4,
	coneRadialSegments: 5,
	sphereWidthSegments: 5,
	sphereHeightSegments: 4,
});

function geometryTriangleCountRun136(geometry) {
	if (geometry.index) return geometry.index.count / 3;
	const positions = geometry.getAttribute('position');
	return positions ? positions.count / 3 : 0;
}

function buildMobileVegetationGeometryRun136(species) {
	const { trunk, foliage } = species;
	const trunkGeometry = new THREE.CylinderGeometry(
		trunk.radiusTop,
		trunk.radiusBottom,
		trunk.height,
		MOBILE_VEGETATION_LOD_RUN136.trunkRadialSegments,
	);
	trunkGeometry.translate(0, trunk.height / 2, 0);

	let foliageGeometry;
	if (foliage.kind === 'cone') {
		foliageGeometry = new THREE.ConeGeometry(
			foliage.radius,
			foliage.height,
			MOBILE_VEGETATION_LOD_RUN136.coneRadialSegments,
		);
		foliageGeometry.translate(0, trunk.height + foliage.height / 2 - foliage.overlapMeters, 0);
	} else if (foliage.kind === 'sphere') {
		foliageGeometry = new THREE.SphereGeometry(
			foliage.radius,
			MOBILE_VEGETATION_LOD_RUN136.sphereWidthSegments,
			MOBILE_VEGETATION_LOD_RUN136.sphereHeightSegments,
		);
		foliageGeometry.translate(0, trunk.height + foliage.radius - foliage.overlapMeters, 0);
	} else {
		throw new Error(`world/vegetation.js: unknown mobile LOD foliage kind "${foliage.kind}" for species "${species.id}"`);
	}
	return { trunkGeometry, foliageGeometry };
}

const _createVegetationBeforeMobileLodRun136 = createVegetation;
createVegetation = function createVegetationWithMobileLodRun136(options) {
	const result = _createVegetationBeforeMobileLodRun136(options);
	const isMobileCoarsePointer = typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(pointer: coarse)').matches;
	if (!isMobileCoarsePointer || result.group.children.length === 0) return result;

	let desktopTriangles = 0;
	let mobileTriangles = 0;
	for (let speciesIndex = 0; speciesIndex < SPECIES.length; speciesIndex++) {
		const trunkMesh = result.group.children[speciesIndex * 2];
		const foliageMesh = result.group.children[speciesIndex * 2 + 1];
		desktopTriangles += geometryTriangleCountRun136(trunkMesh.geometry) * trunkMesh.count;
		desktopTriangles += geometryTriangleCountRun136(foliageMesh.geometry) * foliageMesh.count;

		const oldTrunkGeometry = trunkMesh.geometry;
		const oldFoliageGeometry = foliageMesh.geometry;
		const mobileGeometry = buildMobileVegetationGeometryRun136(SPECIES[speciesIndex]);
		trunkMesh.geometry = mobileGeometry.trunkGeometry;
		foliageMesh.geometry = mobileGeometry.foliageGeometry;
		oldTrunkGeometry.dispose();
		oldFoliageGeometry.dispose();

		mobileTriangles += geometryTriangleCountRun136(trunkMesh.geometry) * trunkMesh.count;
		mobileTriangles += geometryTriangleCountRun136(foliageMesh.geometry) * foliageMesh.count;
	}

	result.group.userData.mobileVegetationLodRun136 = Object.freeze({
		active: true,
		desktopTriangles,
		mobileTriangles,
		reductionRatio: desktopTriangles > 0 ? 1 - mobileTriangles / desktopTriangles : 0,
		placedCount: result.placedCount,
	});
	return result;
};

/** Read-only diagnostics used by the Run 136 mobile vegetation regression gate. */
export function getMobileVegetationLodStatsRun136(group) {
	return group?.userData?.mobileVegetationLodRun136 ?? null;
}

// Run 180 — dispose the bounded wind-grass resource through the existing vegetation teardown.
const _disposeVegetationBeforeWindGrassRun180 = disposeVegetation;
disposeVegetation = function disposeVegetationWithWindGrassRun180(group) {
	const grass = group?.userData?.run180GrassGroup;
	if (grass) {
		grass.parent?.remove(grass);
		for (const mesh of grass.children) {
			mesh.geometry?.dispose();
			mesh.material?.dispose();
		}
		delete group.userData.run180GrassGroup;
	}
	return _disposeVegetationBeforeWindGrassRun180(group);
};
