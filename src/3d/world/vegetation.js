/**
 * Deterministic instanced vegetation. Placement/species authority remains map-aligned; base scatter
 * uses deterministic ecological groves and clearings while surface realism stays render-only.
 * @module world/vegetation
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './terrain.js';
import { northClimateWeightsAtWorldZ, resolveTerrainForestSuitability } from './terrainBiomeShading.js';
import { northReferenceCryosphereAtWorldXZ } from './northReferenceCryosphere.js';

const SPECIES = [
	{
		id: 'pine',
		weight: 0.6,
		trunk: { radiusTop: 0.22, radiusBottom: 0.38, height: 3.4, radialSegments: 6, color: 0x514338 },
		foliage: { kind: 'cone', radius: 2.15, height: 5.6, radialSegments: 7, overlapMeters: 0.3, color: 0x35523a },
	},
	{
		id: 'round',
		weight: 0.4,
		trunk: { radiusTop: 0.2, radiusBottom: 0.34, height: 2.8, radialSegments: 6, color: 0x514338 },
		foliage: { kind: 'sphere', radius: 2.4, widthSegments: 7, heightSegments: 6, overlapMeters: 0.7, color: 0x536b3f },
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

export const VEGETATION_SPATIAL_PATTERN_POLICY = Object.freeze({
	id: 'vegetation-ecological-grove-scatter-2026-09-01-v4-habitat-species',
	climateAuthority: VEGETATION_NORTH_CLIMATE_POLICY.climateAuthority,
	temperateHabitatAuthority: 'terrainBiomeShading.resolveTerrainForestSuitability',
	temperateSpeciesCompositionAuthority: 'terrainBiomeShading.resolveTerrainForestSuitability',
	temperateHabitatAcceptanceFloor: 0.12,
	temperateHabitatAcceptanceGain: 0.88,
	// Keep the historical 40% broadleaf share only in the strongest visible forest habitat. Sparse
	// meadow/heath and treeline survivors become pine-dominant instead of looking botanically uniform.
	temperateBroadleafSparseHabitatChance: 0.08,
	temperateBroadleafStrongHabitatChance: 0.40,
	coldClimateHabitatPreserved: true,
	groveTreeCountMin: 9,
	groveTreeCountMax: 17,
	temperateGroveRadiusMeters: 170,
	coldGroveRadiusMeters: 125,
	temperateBackgroundChance: 0.26,
	coldBackgroundChance: 0.18,
	settlementGroveCountMin: 2,
	settlementGroveCountMax: 4,
	settlementGroveCenterMinMeters: 165,
	settlementGroveCenterMaxMeters: 235,
	settlementGroveRadiusMinMeters: 44,
	settlementGroveRadiusMaxMeters: 72,
	settlementTreeBudgetMin: 32,
	settlementTreeBudgetMax: 46,
	settlementGoldenAngleRadians: Math.PI * (3 - Math.sqrt(5)),
});

export const VEGETATION_SILHOUETTE_POLICY = Object.freeze({
	id: 'vegetation-organic-silhouette-2026-09-01-v3',
	drawCallPreserving: true,
	placementAuthorityChanged: false,
	geometryDeterministic: true,
	desktopOrganicGeometry: true,
	mobilePrimitiveLodPreserved: true,
	evergreenProfileRingCount: 11,
	evergreenRadialSegments: 10,
	broadleafLobeCount: 7,
	broadleafForkCount: 3,
});

const TARGET_DENSITY_PER_KM2 = 30;
const MAX_ATTEMPTS_PER_TREE = 8;
const SEAT_EXCLUSION_RADIUS_METERS = 90;
const ROAD_EXCLUSION_RADIUS_METERS = 10;
const SHORE_MARGIN_METERS = 1.5;
const MAX_GROUND_SLOPE_DEGREES = 45;
const SLOPE_SAMPLE_OFFSET_METERS = 3;
const SCALE_MIN = 0.75;
const SCALE_MAX = 1.35;

const VEGETATION_SURFACE_FABRIC_KEY = 'vegetation-world-surface-fabric-v1';

/**
 * Render-only vegetation weathering. This does not touch scatter, climate ownership, height,
 * hydrology or colliders. Macro/meso/fine fields are sampled in world space so adjacent trees do
 * not restart the same texture pattern. A tiny finite-difference normal perturbation plus roughness
 * modulation removes the old single-color/single-roughness plastic read without extra draw calls.
 */
function applyVegetationSurfaceFabric(material, { surface, snow = false }) {
	material.userData.vegetationSurfaceFabric = Object.freeze({
		key: VEGETATION_SURFACE_FABRIC_KEY,
		surface,
		worldSpace: true,
		multiScaleAlbedo: true,
		microNormal: true,
		roughnessVariation: true,
		snowShelterVariation: snow,
	});

	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nvarying vec3 vVegetationWorldPosition;',
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
vec4 vegetationWorldPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
vegetationWorldPosition = instanceMatrix * vegetationWorldPosition;
#endif
vVegetationWorldPosition = (modelMatrix * vegetationWorldPosition).xyz;`,
			);

		const surfaceGain = surface === 'trunk' ? 0.22 : snow ? 0.16 : 0.19;
		const roughBase = surface === 'trunk' ? 0.93 : snow ? 0.82 : 0.86;
		const snowMix = snow
			? 'float vegetationShelter = smoothstep(0.40, 0.74, vegetationMeso * 0.68 + vegetationFine * 0.32);\ndiffuseColor.rgb *= mix(vec3(0.76, 0.80, 0.79), vec3(1.07, 1.08, 1.06), vegetationShelter);'
			: `diffuseColor.rgb *= 1.0 + (vegetationMacro - 0.5) * ${surfaceGain.toFixed(2)} + (vegetationMeso - 0.5) * 0.11 + (vegetationFine - 0.5) * 0.05;`;

		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
varying vec3 vVegetationWorldPosition;
float vegetationHash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
float vegetationNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = vegetationHash(i);
	float b = vegetationHash(i + vec2(1.0, 0.0));
	float c = vegetationHash(i + vec2(0.0, 1.0));
	float d = vegetationHash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`,
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
vec2 vegetationWorldXZ = vVegetationWorldPosition.xz;
float vegetationMacro = vegetationNoise(vegetationWorldXZ * 0.018);
float vegetationMeso = vegetationNoise(vegetationWorldXZ * 0.115 + vec2(13.7, -8.3));
float vegetationFine = vegetationNoise(vegetationWorldXZ * 0.62 + vec2(-31.2, 17.9));
${snowMix}`,
			)
			.replace(
				'#include <normal_fragment_maps>',
				`#include <normal_fragment_maps>
vec2 vegetationMicroP = vegetationWorldXZ * ${surface === 'trunk' ? '1.55' : '0.92'};
float vegetationNx = vegetationNoise(vegetationMicroP + vec2(0.13, 0.0)) - vegetationNoise(vegetationMicroP - vec2(0.13, 0.0));
float vegetationNz = vegetationNoise(vegetationMicroP + vec2(0.0, 0.13)) - vegetationNoise(vegetationMicroP - vec2(0.0, 0.13));
normal = normalize(normal + mat3(viewMatrix) * vec3(vegetationNx, 0.0, vegetationNz) * ${surface === 'trunk' ? '0.12' : '0.075'});`,
			)
			.replace(
				'#include <roughnessmap_fragment>',
				`#include <roughnessmap_fragment>
roughnessFactor = clamp(${roughBase.toFixed(2)} + (vegetationMeso - 0.5) * 0.18 + (vegetationFine - 0.5) * 0.10, 0.62, 1.0);`,
			);
	};
	material.customProgramCacheKey = () => `${VEGETATION_SURFACE_FABRIC_KEY}:${surface}:${snow ? 'snow' : 'temperate'}`;
}

export function distancePointToSegment2D(px, pz, ax, az, bx, bz) {
	const abx = bx - ax;
	const abz = bz - az;
	const lengthSquared = abx * abx + abz * abz;
	if (lengthSquared === 0) return Math.hypot(px - ax, pz - az);
	let t = ((px - ax) * abx + (pz - az)) / lengthSquared;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

export function isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges, outSite = null }) {
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
	const slopeDegrees = Math.max(gradeXDegrees, gradeZDegrees);
	if (outSite && typeof outSite === 'object') {
		outSite.groundY = groundY;
		outSite.heightAboveSeaMeters = groundY - seaLevelMeters;
		outSite.slopeDegrees = slopeDegrees;
	}
	return slopeDegrees <= MAX_GROUND_SLOPE_DEGREES;
}

export function pickSpeciesIndex(roll) {
	const totalWeight = SPECIES.slice(0, TEMPERATE_SPECIES_COUNT).reduce((sum, species) => sum + species.weight, 0);
	let cumulative = 0;
	for (let i = 0; i < TEMPERATE_SPECIES_COUNT; i++) {
		cumulative += SPECIES[i].weight / totalWeight;
		if (roll < cumulative) return i;
	}
	return TEMPERATE_SPECIES_COUNT - 1;
}

/**
 * Keeps the historical 60/40 picker as the strongest-habitat endpoint, but makes accepted sparse
 * temperate/treeline survivors conifer-dominant. This consumes the same terrain forest answer that
 * already decides candidate acceptance, so visible ground and tree composition share one ecology.
 */
export function pickTemperateSpeciesIndexForHabitat(roll, habitat = {}) {
	const suitability = Number.isFinite(habitat?.suitability)
		? Math.max(0, Math.min(1, habitat.suitability))
		: 1;
	const policy = VEGETATION_SPATIAL_PATTERN_POLICY;
	const broadleafChance = policy.temperateBroadleafSparseHabitatChance
		+ (policy.temperateBroadleafStrongHabitatChance - policy.temperateBroadleafSparseHabitatChance) * suitability;
	return roll < 1 - broadleafChance ? 0 : 1;
}

function pickSpeciesIndexForClimate(roll, climate, temperateHabitat = null) {
	const policy = VEGETATION_NORTH_CLIMATE_POLICY;
	if (climate.permanentIce >= policy.permanentIceSnowOnlyThreshold) return SNOW_PINE_SPECIES_INDEX;
	if (Math.max(climate.permanentIce, climate.tundra) >= policy.tundraClimateThreshold) {
		const snowChance = Math.min(1,
			policy.tundraBaseSnowChance
			+ climate.tundra * policy.tundraSnowGain
			+ climate.permanentIce * policy.iceSnowGain);
		return roll < snowChance ? SNOW_PINE_SPECIES_INDEX : 0;
	}
	return temperateHabitat ? pickTemperateSpeciesIndexForHabitat(roll, temperateHabitat) : pickSpeciesIndex(roll);
}

export function pickSpeciesIndexForWorldZ(roll, worldZ) {
	return pickSpeciesIndexForClimate(roll, northClimateWeightsAtWorldZ(worldZ));
}

export function pickSpeciesIndexForWorldXZ(roll, worldX, worldZ) {
	return pickSpeciesIndexForClimate(roll, northReferenceCryosphereAtWorldXZ(worldX, worldZ));
}

export function vegetationSpeciesId(index) {
	return SPECIES[index]?.id ?? null;
}

export function sampleAnnulusPoint(rng, centerX, centerZ, innerRadius, outerRadius) {
	const angle = rng() * Math.PI * 2;
	const radius = Math.sqrt(rng() * (outerRadius * outerRadius - innerRadius * innerRadius) + innerRadius * innerRadius);
	return { x: centerX + Math.cos(angle) * radius, z: centerZ + Math.sin(angle) * radius };
}

export function vegetationGrovePatternForClimate(climate = {}) {
	const tundra = Number.isFinite(climate.tundra) ? climate.tundra : 0;
	const permanentIce = Number.isFinite(climate.permanentIce) ? climate.permanentIce : 0;
	const coldness = Math.max(0, Math.min(1, Math.max(tundra, permanentIce)));
	const policy = VEGETATION_SPATIAL_PATTERN_POLICY;
	return {
		coldness,
		groveRadiusMeters: policy.temperateGroveRadiusMeters
			+ (policy.coldGroveRadiusMeters - policy.temperateGroveRadiusMeters) * coldness,
		backgroundChance: policy.temperateBackgroundChance
			+ (policy.coldBackgroundChance - policy.temperateBackgroundChance) * coldness,
	};
}

function createSettlementWoodlandLayout(seat, rng) {
	const policy = VEGETATION_SPATIAL_PATTERN_POLICY;
	const climatePattern = vegetationGrovePatternForClimate(northReferenceCryosphereAtWorldXZ(seat.x, seat.z));
	const climateRadiusScale = climatePattern.groveRadiusMeters / policy.temperateGroveRadiusMeters;
	const groveCount = policy.settlementGroveCountMin
		+ Math.floor(rng() * (policy.settlementGroveCountMax - policy.settlementGroveCountMin + 1));
	const treeBudget = policy.settlementTreeBudgetMin
		+ Math.floor(rng() * (policy.settlementTreeBudgetMax - policy.settlementTreeBudgetMin + 1));
	const phase = rng() * Math.PI * 2;
	const groves = [];
	let totalWeight = 0;
	for (let index = 0; index < groveCount; index++) {
		const angle = phase
			+ index * policy.settlementGoldenAngleRadians
			+ (rng() - 0.5) * 0.52;
		const centerDistance = policy.settlementGroveCenterMinMeters
			+ rng() * (policy.settlementGroveCenterMaxMeters - policy.settlementGroveCenterMinMeters);
		const radius = (policy.settlementGroveRadiusMinMeters
			+ rng() * (policy.settlementGroveRadiusMaxMeters - policy.settlementGroveRadiusMinMeters))
			* climateRadiusScale;
		const weight = 0.72 + rng() * 0.56;
		groves.push({
			x: seat.x + Math.cos(angle) * centerDistance,
			z: seat.z + Math.sin(angle) * centerDistance,
			radius,
			weight,
		});
		totalWeight += weight;
	}
	return { seat, treeBudget, groves, totalWeight };
}

function pickSettlementWoodlandGrove(layout, rng) {
	let threshold = rng() * layout.totalWeight;
	for (const grove of layout.groves) {
		threshold -= grove.weight;
		if (threshold <= 0) return grove;
	}
	return layout.groves[layout.groves.length - 1];
}

function silhouetteTriangleCount(geometry) {
	if (geometry.index) return geometry.index.count / 3;
	const positions = geometry.getAttribute('position');
	return positions ? positions.count / 3 : 0;
}

function warpVegetationSilhouette(geometry, phase, strength) {
	const positions = geometry.getAttribute('position');
	for (let index = 0; index < positions.count; index++) {
		const x = positions.getX(index);
		const y = positions.getY(index);
		const z = positions.getZ(index);
		const radial = Math.hypot(x, z);
		if (radial < 1e-5) continue;
		const angle = Math.atan2(z, x);
		const angular = Math.sin(angle * 3 + phase) * 0.62
			+ Math.sin(angle * 5 - phase * 0.73) * 0.38;
		const vertical = 0.78 + Math.sin(y * 1.71 + phase * 0.43) * 0.22;
		const scale = 1 + angular * vertical * strength;
		positions.setXYZ(index, x * scale, y, z * scale);
	}
	positions.needsUpdate = true;
	geometry.computeVertexNormals();
	return geometry;
}

function mergeVegetationGeometry(parts, metadata) {
	const merged = mergeGeometries(parts, false);
	for (const part of parts) part.dispose();
	if (!merged) throw new Error(`world/vegetation.js: failed to merge ${metadata.profile} geometry`);
	merged.computeBoundingBox();
	merged.computeBoundingSphere();
	merged.userData.vegetationSilhouette = Object.freeze({
		policyId: VEGETATION_SILHOUETTE_POLICY.id,
		drawCallPreserving: VEGETATION_SILHOUETTE_POLICY.drawCallPreserving,
		...metadata,
		triangles: silhouetteTriangleCount(merged),
	});
	return merged;
}

function finalizeVegetationGeometry(geometry, metadata) {
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	geometry.userData.vegetationSilhouette = Object.freeze({
		policyId: VEGETATION_SILHOUETTE_POLICY.id,
		drawCallPreserving: VEGETATION_SILHOUETTE_POLICY.drawCallPreserving,
		...metadata,
		triangles: silhouetteTriangleCount(geometry),
	});
	return geometry;
}

function buildOrganicTrunkGeometry(species) {
	const { trunk } = species;
	const parts = [];
	const main = new THREE.CylinderGeometry(trunk.radiusTop, trunk.radiusBottom, trunk.height, trunk.radialSegments);
	main.translate(0, trunk.height / 2, 0);
	warpVegetationSilhouette(main, species.id === 'round' ? 1.73 : 0.64, 0.035);
	parts.push(main);

	if (species.id === 'round') {
		const forks = [
			{ yaw: 0.20, tilt: -0.72, x: -0.31, y: trunk.height * 0.92, z: 0.03, height: 1.50 },
			{ yaw: 2.25, tilt: 0.66, x: 0.29, y: trunk.height * 0.96, z: -0.11, height: 1.42 },
			{ yaw: 4.35, tilt: -0.54, x: 0.04, y: trunk.height * 1.02, z: 0.29, height: 1.26 },
		];
		for (let index = 0; index < forks.length; index++) {
			const fork = forks[index];
			const branch = new THREE.CylinderGeometry(0.055, 0.105, fork.height, 5);
			warpVegetationSilhouette(branch, 1.2 + index * 1.1, 0.028);
			branch.rotateZ(fork.tilt);
			branch.rotateY(fork.yaw);
			branch.translate(fork.x, fork.y, fork.z);
			parts.push(branch);
		}
		return mergeVegetationGeometry(parts, {
			profile: 'forked-broadleaf-trunk',
			componentCount: parts.length,
			minTriangles: 30,
			maxTriangles: 180,
		});
	}

	const upperHeight = trunk.height * 0.72;
	const upperStem = new THREE.CylinderGeometry(0.05, Math.max(0.10, trunk.radiusTop * 0.58), upperHeight, Math.max(5, trunk.radialSegments - 1));
	warpVegetationSilhouette(upperStem, species.id === 'snow-pine' ? 2.7 : 2.1, 0.04);
	upperStem.translate(0.025, trunk.height + upperHeight * 0.30, -0.018);
	parts.push(upperStem);
	return mergeVegetationGeometry(parts, {
		profile: 'tapered-evergreen-trunk',
		componentCount: parts.length,
		minTriangles: 20,
		maxTriangles: 120,
	});
}

/**
 * One connected conifer crown replaces the old stack of independent cones. The radius profile
 * carries broad branch shelves and recesses, while each ring has a small deterministic angular
 * offset and 3/5-lobed radial perturbation. This keeps the characteristic evergreen taper without
 * visible horizontal seams or extra draw calls.
 */
function buildContinuousEvergreenFoliageGeometry(species) {
	const { trunk, foliage } = species;
	const crownBase = trunk.height - foliage.overlapMeters;
	const radialSegments = VEGETATION_SILHOUETTE_POLICY.evergreenRadialSegments;
	const profile = [
		{ t: 0.00, r: 0.86 },
		{ t: 0.08, r: 1.00 },
		{ t: 0.18, r: 0.82 },
		{ t: 0.28, r: 0.89 },
		{ t: 0.39, r: 0.69 },
		{ t: 0.50, r: 0.74 },
		{ t: 0.61, r: 0.53 },
		{ t: 0.71, r: 0.55 },
		{ t: 0.81, r: 0.35 },
		{ t: 0.91, r: 0.22 },
		{ t: 1.00, r: 0.015 },
	];
	const positions = [];
	const indices = [];
	const phase = species.id === 'snow-pine' ? 1.47 : 0.62;
	for (let ringIndex = 0; ringIndex < profile.length; ringIndex++) {
		const ring = profile[ringIndex];
		const ringAngleOffset = ringIndex * 0.083 + Math.sin(ringIndex * 1.91 + phase) * 0.035;
		const centerX = Math.sin(ringIndex * 1.37 + phase) * foliage.radius * 0.020;
		const centerZ = Math.cos(ringIndex * 1.13 - phase) * foliage.radius * 0.018;
		for (let segment = 0; segment < radialSegments; segment++) {
			const angle = (segment / radialSegments) * Math.PI * 2 + ringAngleOffset;
			const angular = Math.sin(angle * 3 + phase + ringIndex * 0.17) * 0.62
				+ Math.sin(angle * 5 - phase * 0.71 + ringIndex * 0.11) * 0.38;
			const radialScale = 1 + angular * (0.045 + ring.t * 0.014);
			const radius = foliage.radius * ring.r * radialScale;
			positions.push(
				centerX + Math.cos(angle) * radius,
				crownBase + foliage.height * ring.t,
				centerZ + Math.sin(angle) * radius,
			);
		}
	}
	for (let ringIndex = 0; ringIndex < profile.length - 1; ringIndex++) {
		for (let segment = 0; segment < radialSegments; segment++) {
			const nextSegment = (segment + 1) % radialSegments;
			const a = ringIndex * radialSegments + segment;
			const b = ringIndex * radialSegments + nextSegment;
			const c = (ringIndex + 1) * radialSegments + segment;
			const d = (ringIndex + 1) * radialSegments + nextSegment;
			indices.push(a, c, b, b, c, d);
		}
	}
	const bottomCenter = positions.length / 3;
	positions.push(0, crownBase + 0.015, 0);
	for (let segment = 0; segment < radialSegments; segment++) {
		indices.push(bottomCenter, (segment + 1) % radialSegments, segment);
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setIndex(indices);
	return finalizeVegetationGeometry(geometry, {
		profile: 'continuous-evergreen-crown',
		componentCount: 1,
		connectedSurface: true,
		profileRingCount: profile.length,
		radialSegments,
		minTriangles: 180,
		maxTriangles: 260,
	});
}

function buildLobedBroadleafFoliageGeometry(species) {
	const { trunk, foliage } = species;
	const centerY = trunk.height + foliage.radius - foliage.overlapMeters;
	const lobes = [
		{ x: 0.00, y: 0.11, z: 0.00, sx: 0.66, sy: 0.72, sz: 0.63 },
		{ x: -0.43, y: 0.04, z: 0.04, sx: 0.55, sy: 0.59, sz: 0.52 },
		{ x: 0.40, y: 0.10, z: -0.14, sx: 0.57, sy: 0.61, sz: 0.54 },
		{ x: -0.10, y: 0.29, z: -0.35, sx: 0.52, sy: 0.56, sz: 0.49 },
		{ x: 0.14, y: -0.05, z: 0.36, sx: 0.51, sy: 0.55, sz: 0.48 },
		{ x: -0.02, y: 0.43, z: 0.03, sx: 0.48, sy: 0.53, sz: 0.47 },
		{ x: -0.31, y: 0.22, z: 0.27, sx: 0.46, sy: 0.50, sz: 0.44 },
	];
	const parts = lobes.map((lobe, index) => {
		const geometry = new THREE.SphereGeometry(1, foliage.widthSegments + 1, foliage.heightSegments + 1);
		geometry.scale(
			foliage.radius * lobe.sx,
			foliage.radius * lobe.sy,
			foliage.radius * lobe.sz,
		);
		warpVegetationSilhouette(geometry, 0.51 + index * 0.91, 0.06);
		geometry.rotateY(index * 0.37);
		geometry.translate(
			foliage.radius * lobe.x,
			centerY + foliage.radius * lobe.y,
			foliage.radius * lobe.z,
		);
		return geometry;
	});
	return mergeVegetationGeometry(parts, {
		profile: 'lobed-broadleaf',
		componentCount: parts.length,
		minTriangles: 560,
		maxTriangles: 820,
	});
}

function buildSpeciesAssets(species) {
	const { trunk, foliage } = species;
	const trunkGeometry = buildOrganicTrunkGeometry(species);
	let foliageGeometry;
	if (foliage.kind === 'cone') {
		foliageGeometry = buildContinuousEvergreenFoliageGeometry(species);
	} else if (foliage.kind === 'sphere') {
		foliageGeometry = buildLobedBroadleafFoliageGeometry(species);
	} else {
		throw new Error(`world/vegetation.js: unknown foliage kind "${foliage.kind}" for species "${species.id}"`);
	}

	const trunkMaterial = new THREE.MeshStandardMaterial({ color: trunk.color, roughness: 0.93, metalness: 0 });
	const foliageMaterial = new THREE.MeshStandardMaterial({ color: foliage.color, roughness: species.id === 'snow-pine' ? 0.82 : 0.86, metalness: 0 });
	applyVegetationSurfaceFabric(trunkMaterial, { surface: 'trunk' });
	applyVegetationSurfaceFabric(foliageMaterial, { surface: 'foliage', snow: species.id === 'snow-pine' });
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

export function createVegetation({ sampleHeightMeters, seaLevelMeters, seed, seats, roadEdges, radiusMeters, densityPerKm2 = TARGET_DENSITY_PER_KM2 }) {
	const group = new THREE.Group();
	const areaKm2 = (Math.PI * radiusMeters * radiusMeters) / 1_000_000;
	const baseTargetCount = Math.max(0, Math.round(areaKm2 * densityPerKm2));
	const spatialPolicy = VEGETATION_SPATIAL_PATTERN_POLICY;
	const settlementMaxReach = spatialPolicy.settlementGroveCenterMaxMeters + spatialPolicy.settlementGroveRadiusMaxMeters;
	const clusterSeats = seats.filter((seat) => Math.hypot(seat.x, seat.z) + settlementMaxReach <= radiusMeters);
	const clusterRng = mulberry32(seed ^ 0x434c5354);
	const settlementWoodlands = clusterSeats.map((seat) => createSettlementWoodlandLayout(seat, clusterRng));
	const clusterTargetTotal = settlementWoodlands.reduce((sum, layout) => sum + layout.treeBudget, 0);
	const targetCount = baseTargetCount + clusterTargetTotal;
	if (targetCount === 0) {
		return {
			group,
			targetCount: 0,
			placedCount: 0,
			clusterSeatCount: 0,
			settlementWoodlandSeatCount: 0,
			winterTreeCount: 0,
		};
	}

	const rng = mulberry32(seed ^ 0x56454745);
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
	let groveCenterX = 0;
	let groveCenterZ = 0;
	let groveHasCenter = false;
	let groveTreesRemaining = 0;
	let groveRadiusMeters = spatialPolicy.temperateGroveRadiusMeters;
	let groveBackgroundChance = spatialPolicy.temperateBackgroundChance;
	let baseHabitatRejected = 0;

	for (let treeIndex = 0; treeIndex < baseTargetCount; treeIndex++) {
		if (groveTreesRemaining <= 0) {
			groveHasCenter = false;
			groveTreesRemaining = spatialPolicy.groveTreeCountMin
				+ Math.floor(rng() * (spatialPolicy.groveTreeCountMax - spatialPolicy.groveTreeCountMin + 1));
		}
		for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TREE; attempt++) {
			const candidate = !groveHasCenter || rng() < groveBackgroundChance
				? sampleAnnulusPoint(rng, 0, 0, 0, radiusMeters)
				: sampleAnnulusPoint(rng, groveCenterX, groveCenterZ, 0, groveRadiusMeters);
			const { x, z } = candidate;
			if (Math.hypot(x, z) > radiusMeters) continue;
			const site = {};
			if (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges, outSite: site })) continue;
			const climate = northReferenceCryosphereAtWorldXZ(x, z);
			let habitat = null;
			if (Math.max(climate.permanentIce, climate.tundra) < VEGETATION_NORTH_CLIMATE_POLICY.tundraClimateThreshold) {
				habitat = resolveTerrainForestSuitability({
					heightAboveSeaMeters: site.heightAboveSeaMeters,
					slopeDegrees: site.slopeDegrees,
					worldX: x,
					worldZ: z,
				});
				const habitatChance = Math.min(1, spatialPolicy.temperateHabitatAcceptanceFloor
					+ habitat.suitability * spatialPolicy.temperateHabitatAcceptanceGain);
				if (rng() > habitatChance) {
					baseHabitatRejected++;
					continue;
				}
			}
			if (!groveHasCenter) {
				groveHasCenter = true;
				groveCenterX = x;
				groveCenterZ = z;
				const pattern = vegetationGrovePatternForClimate(climate);
				groveRadiusMeters = pattern.groveRadiusMeters;
				groveBackgroundChance = pattern.backgroundChance;
			}
			const entry = perSpecies[pickSpeciesIndexForClimate(rng(), climate, habitat)];
			placeTreeInstance(entry, x, z, sampleHeightMeters, rng, up, matrix, position, quaternion, scaleVector);
			placedCount++;
			break;
		}
		groveTreesRemaining--;
	}

	for (const layout of settlementWoodlands) {
		for (let treeIndex = 0; treeIndex < layout.treeBudget; treeIndex++) {
			for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TREE; attempt++) {
				const grove = pickSettlementWoodlandGrove(layout, clusterRng);
				const { x, z } = sampleAnnulusPoint(clusterRng, grove.x, grove.z, 0, grove.radius);
				if (Math.hypot(x, z) > radiusMeters) continue;
				const site = {};
				if (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges, outSite: site })) continue;
				const climate = northReferenceCryosphereAtWorldXZ(x, z);
				const habitat = Math.max(climate.permanentIce, climate.tundra) < VEGETATION_NORTH_CLIMATE_POLICY.tundraClimateThreshold
					? resolveTerrainForestSuitability({
						heightAboveSeaMeters: site.heightAboveSeaMeters,
						slopeDegrees: site.slopeDegrees,
						worldX: x,
						worldZ: z,
					})
					: null;
				const entry = perSpecies[pickSpeciesIndexForClimate(clusterRng(), climate, habitat)];
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
	group.userData.vegetationSpatialPattern = Object.freeze({
		policyId: spatialPolicy.id,
		deterministic: true,
		climateAuthority: spatialPolicy.climateAuthority,
		baseDensityPerKm2: densityPerKm2,
		temperateHabitatAuthority: spatialPolicy.temperateHabitatAuthority,
		temperateSpeciesCompositionAuthority: spatialPolicy.temperateSpeciesCompositionAuthority,
		temperateHabitatAcceptanceFloor: spatialPolicy.temperateHabitatAcceptanceFloor,
		temperateBroadleafSparseHabitatChance: spatialPolicy.temperateBroadleafSparseHabitatChance,
		temperateBroadleafStrongHabitatChance: spatialPolicy.temperateBroadleafStrongHabitatChance,
		baseHabitatRejected,
		coldClimateHabitatPreserved: spatialPolicy.coldClimateHabitatPreserved,
		groveTreeCountMin: spatialPolicy.groveTreeCountMin,
		groveTreeCountMax: spatialPolicy.groveTreeCountMax,
		settlementPattern: 'asymmetric-woodland-pockets',
		settlementGroveCountMin: spatialPolicy.settlementGroveCountMin,
		settlementGroveCountMax: spatialPolicy.settlementGroveCountMax,
		settlementTreeBudgetMin: spatialPolicy.settlementTreeBudgetMin,
		settlementTreeBudgetMax: spatialPolicy.settlementTreeBudgetMax,
	});
	group.userData.vegetationSurfaceFabric = Object.freeze({ key: VEGETATION_SURFACE_FABRIC_KEY, worldSpace: true, multiScale: true });
	group.userData.vegetationSilhouette = Object.freeze({
		policyId: VEGETATION_SILHOUETTE_POLICY.id,
		drawCallPreserving: true,
		placementAuthorityChanged: false,
	});
	return {
		group,
		targetCount,
		placedCount,
		clusterSeatCount: clusterSeats.length,
		settlementWoodlandSeatCount: clusterSeats.length,
		winterTreeCount,
		baseHabitatRejected,
	};
}

export function disposeVegetation(group) {
	for (const mesh of group.children) {
		mesh.geometry.dispose();
		mesh.material.dispose();
	}
}

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
		foliageGeometry = new THREE.ConeGeometry(foliage.radius, foliage.height, MOBILE_VEGETATION_LOD_RUN136.coneRadialSegments);
		foliageGeometry.translate(0, trunk.height + foliage.height / 2 - foliage.overlapMeters, 0);
	} else if (foliage.kind === 'sphere') {
		foliageGeometry = new THREE.SphereGeometry(foliage.radius, MOBILE_VEGETATION_LOD_RUN136.sphereWidthSegments, MOBILE_VEGETATION_LOD_RUN136.sphereHeightSegments);
		foliageGeometry.translate(0, trunk.height + foliage.radius - foliage.overlapMeters, 0);
	} else {
		throw new Error(`world/vegetation.js: unknown mobile LOD foliage kind "${foliage.kind}" for species "${species.id}"`);
	}
	return { trunkGeometry, foliageGeometry };
}

const _createVegetationBeforeMobileLodRun136 = createVegetation;
createVegetation = function createVegetationWithMobileLodRun136(options) {
	const result = _createVegetationBeforeMobileLodRun136(options);
	const isMobileCoarsePointer = typeof window !== 'undefined'
		&& typeof window.matchMedia === 'function'
		&& window.matchMedia('(pointer: coarse)').matches;
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

export function getMobileVegetationLodStatsRun136(group) {
	return group?.userData?.mobileVegetationLodRun136 ?? null;
}

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