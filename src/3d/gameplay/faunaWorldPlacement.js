import { WORLD_DEFAULTS, WORLD_SCALE } from '../config.js';
import { analyzeMaterialSurfaces } from '../materials/MaterialAssignmentCore.js';
import { evaluateWorldSurfacePlacement, prepareWorldAssetForPlacement } from '../world/WorldAssetPlacementPipeline.js';
import { REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from '../world/worldReferenceMap.js';
import { worldXZToNormalizedReference } from '../world/worldReferenceAlignment.js';
import { classifyReferenceBaseSurface } from '../world/worldReferenceSurfacePindexes.js';

const SLOPE_SAMPLE_RADIUS_METERS = 1.5;
const BIOME_INFLUENCE_FLOOR = 0.05;
const ROUTE_SAMPLE_SPACING_METERS = 4;
const MAX_ROUTE_SAMPLES = 12;
const AUTHORED_PBR_MAP_FIELDS = Object.freeze([
	'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'lightMap', 'displacementMap',
]);

const FALLBACK_PALETTE_BY_SPECIES = Object.freeze({
	wolf: 'wolf', horse: 'horse-bay', cow: 'cow', bull: 'cow', deer: 'deer', stag: 'deer',
	fox: 'wolf', dog: 'dog', alpaca: 'sheep', zebra: 'horse-bay', sheep: 'sheep',
});

const DEFAULT_CONFIGURED_FAUNA_HABITAT_POLICY = Object.freeze({
	maxSlopeDegrees: 32,
	maxWaterDepth: 0.05,
	forbiddenBiomes: ['sea', 'lake'],
	forbiddenWaterTypes: ['sea', 'lake'],
});

export const CONFIGURED_FAUNA_HABITAT_POLICIES = Object.freeze({
	wolf: Object.freeze({ maxSlopeDegrees: 38, maxWaterDepth: 0.05, allowedBiomes: ['cold-grassland', 'snow', 'mountain', 'rocky-hills', 'soil', 'rock'], forbiddenWaterTypes: ['sea', 'lake'] }),
	horse: Object.freeze({ maxSlopeDegrees: 28, maxWaterDepth: 0.05, allowedBiomes: ['cold-grassland', 'lush-grassland', 'steppe', 'rocky-hills', 'temperate-coast', 'soil', 'rock'], forbiddenWaterTypes: ['sea', 'lake'] }),
	cow: Object.freeze({ maxSlopeDegrees: 22, maxWaterDepth: 0.05, allowedBiomes: ['lush-grassland', 'cold-grassland', 'steppe', 'soil'], forbiddenWaterTypes: ['sea', 'lake'] }),
	bull: Object.freeze({ maxSlopeDegrees: 24, maxWaterDepth: 0.05, allowedBiomes: ['lush-grassland', 'cold-grassland', 'steppe', 'rocky-hills', 'soil'], forbiddenWaterTypes: ['sea', 'lake'] }),
	deer: Object.freeze({ maxSlopeDegrees: 34, maxWaterDepth: 0.05, allowedBiomes: ['mountain', 'cold-grassland', 'rocky-hills', 'lush-grassland', 'soil', 'rock'], forbiddenWaterTypes: ['sea', 'lake'] }),
	stag: Object.freeze({ maxSlopeDegrees: 34, maxWaterDepth: 0.05, allowedBiomes: ['mountain', 'cold-grassland', 'rocky-hills', 'lush-grassland', 'soil', 'rock'], forbiddenWaterTypes: ['sea', 'lake'] }),
	fox: Object.freeze({ maxSlopeDegrees: 35, maxWaterDepth: 0.05, allowedBiomes: ['cold-grassland', 'lush-grassland', 'steppe', 'rocky-hills', 'temperate-coast', 'soil', 'rock'], forbiddenWaterTypes: ['sea', 'lake'] }),
	dog: Object.freeze({ maxSlopeDegrees: 32, maxWaterDepth: 0.05, allowedBiomes: ['snow', 'cold-grassland', 'mountain', 'soil', 'rock'], forbiddenWaterTypes: ['sea', 'lake'] }),
	alpaca: Object.freeze({ maxSlopeDegrees: 32, maxWaterDepth: 0.05, allowedBiomes: ['desert', 'steppe', 'arid', 'mountain', 'soil', 'rock'], forbiddenWaterTypes: ['sea', 'lake'] }),
	zebra: Object.freeze({ maxSlopeDegrees: 20, maxWaterDepth: 0.05, allowedBiomes: ['desert', 'steppe', 'arid', 'soil'], forbiddenWaterTypes: ['sea', 'lake'] }),
	sheep: Object.freeze({ maxSlopeDegrees: 26, maxWaterDepth: 0.05, allowedBiomes: ['lush-grassland', 'cold-grassland', 'steppe', 'rocky-hills', 'soil'], forbiddenWaterTypes: ['sea', 'lake'] }),
});

function finiteGroundHeight(groundCollider, x, z) {
	try {
		const height = groundCollider?.getGroundHeight?.(x, z);
		return Number.isFinite(height) ? height : null;
	} catch {
		return null;
	}
}

function dominantBiomeAt(normalizedX, normalizedY, baseSurface) {
	let bestZone = null;
	let bestInfluence = 0;
	for (const zone of REFERENCE_BIOME_ZONES) {
		const influence = sampleReferenceInfluence(normalizedX, normalizedY, zone);
		if (influence > bestInfluence) {
			bestInfluence = influence;
			bestZone = zone;
		}
	}
	return {
		biome: bestZone && bestInfluence >= BIOME_INFLUENCE_FLOOR ? bestZone.kind : baseSurface,
		zoneId: bestZone && bestInfluence >= BIOME_INFLUENCE_FLOOR ? bestZone.id : null,
		influence: bestInfluence,
	};
}

export function sampleConfiguredFaunaGeography(worldX, worldZ, groundCollider) {
	if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return { ok: false, error: 'non-finite-position' };
	const height = finiteGroundHeight(groundCollider, worldX, worldZ);
	const west = finiteGroundHeight(groundCollider, worldX - SLOPE_SAMPLE_RADIUS_METERS, worldZ);
	const east = finiteGroundHeight(groundCollider, worldX + SLOPE_SAMPLE_RADIUS_METERS, worldZ);
	const north = finiteGroundHeight(groundCollider, worldX, worldZ - SLOPE_SAMPLE_RADIUS_METERS);
	const south = finiteGroundHeight(groundCollider, worldX, worldZ + SLOPE_SAMPLE_RADIUS_METERS);
	if ([height, west, east, north, south].some((value) => value === null)) return { ok: false, error: 'ground-sample-failed' };
	let normalized;
	try {
		normalized = worldXZToNormalizedReference(worldX, worldZ, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
	} catch {
		return { ok: false, error: 'reference-map-out-of-range' };
	}
	const baseSurface = classifyReferenceBaseSurface(normalized.x, normalized.y);
	const dominant = dominantBiomeAt(normalized.x, normalized.y, baseSurface);
	const gradientX = (east - west) / (SLOPE_SAMPLE_RADIUS_METERS * 2);
	const gradientZ = (south - north) / (SLOPE_SAMPLE_RADIUS_METERS * 2);
	const slopeDegrees = Math.atan(Math.hypot(gradientX, gradientZ)) * 180 / Math.PI;
	const waterType = baseSurface === 'sea' || baseSurface === 'lake' ? baseSurface : 'none';
	return {
		ok: true,
		surface: {
			height,
			slopeDegrees,
			waterDepth: Math.max(0, WORLD_DEFAULTS.WATER_LEVEL_METERS - height),
			biome: dominant.biome,
			waterType,
		},
		baseSurface,
		zoneId: dominant.zoneId,
		biomeInfluence: dominant.influence,
		normalizedReference: Object.freeze({ x: normalized.x, y: normalized.y }),
	};
}

export function evaluateConfiguredFaunaHabitat(speciesId, worldX, worldZ, groundCollider) {
	const geography = sampleConfiguredFaunaGeography(worldX, worldZ, groundCollider);
	if (!geography.ok) return geography;
	const placementPolicy = CONFIGURED_FAUNA_HABITAT_POLICIES[speciesId] ?? DEFAULT_CONFIGURED_FAUNA_HABITAT_POLICY;
	const evaluation = evaluateWorldSurfacePlacement(geography.surface, placementPolicy);
	if (!evaluation.ok) {
		return { ok: false, error: `surface:${evaluation.errors.join(',')}`, geography, placementPolicy, evaluation };
	}
	return { ok: true, geography, placementPolicy, evaluation };
}

export function evaluateConfiguredFaunaRoute(speciesId, start, target, groundCollider) {
	if (![start?.x, start?.z, target?.x, target?.z].every(Number.isFinite)) return { ok: false, error: 'non-finite-route' };
	const distanceMeters = Math.hypot(target.x - start.x, target.z - start.z);
	const sampleCount = Math.max(1, Math.min(MAX_ROUTE_SAMPLES, Math.ceil(distanceMeters / ROUTE_SAMPLE_SPACING_METERS)));
	let targetHabitat = null;
	for (let index = 1; index <= sampleCount; index += 1) {
		const t = index / sampleCount;
		const x = start.x + (target.x - start.x) * t;
		const z = start.z + (target.z - start.z) * t;
		const habitat = evaluateConfiguredFaunaHabitat(speciesId, x, z, groundCollider);
		if (!habitat.ok) return { ...habitat, routeSampleIndex: index, routeSampleCount: sampleCount, distanceMeters };
		targetHabitat = habitat;
	}
	return { ok: true, targetHabitat, routeSampleCount: sampleCount, distanceMeters };
}

export function inspectConfiguredFaunaMaterials(object) {
	const analysis = analyzeMaterialSurfaces(object);
	const authoredPbrMapSlots = new Set();
	for (const surface of analysis.surfaces) {
		for (const field of AUTHORED_PBR_MAP_FIELDS) {
			if (surface.material?.[field]?.isTexture) authoredPbrMapSlots.add(field);
		}
	}
	return { ...analysis, authoredPbrMapSlots: [...authoredPbrMapSlots].sort() };
}

export function prepareConfiguredAnimalWorldAsset(object, {
	speciesId = 'wolf', assetId, modelUrl, worldX, worldZ, rotationYRadians = 0, groundCollider,
} = {}) {
	const habitat = evaluateConfiguredFaunaHabitat(speciesId, worldX, worldZ, groundCollider);
	if (!habitat.ok) return habitat;
	const { geography, placementPolicy } = habitat;
	const materialAnalysis = inspectConfiguredFaunaMaterials(object);
	const preserveAuthored = materialAnalysis.authoredPbrMapSlots.length > 0;
	const prepared = prepareWorldAssetForPlacement(object, {
		metadata: { id: assetId, name: speciesId, category: 'hayvan', src: modelUrl },
		materialRecipe: preserveAuthored ? { version: 1, mode: 'preserve', reason: 'authored-pbr' } : null,
		paletteId: preserveAuthored ? undefined : FALLBACK_PALETTE_BY_SPECIES[speciesId],
		textureSize: 256,
		position: { x: worldX, y: geography.surface.height, z: worldZ },
		rotation: { x: object.rotation.x, y: rotationYRadians, z: object.rotation.z },
		surfaceQuery: (x, z) => sampleConfiguredFaunaGeography(x, z, groundCollider).surface ?? null,
		placementPolicy,
		requireSurfaceContext: true,
		snapToGround: true,
		footprintGrounding: 'never',
		requireGeneratedTexture: !preserveAuthored,
	});
	if (!prepared.ok) return prepared;
	object.userData.faunaWorldPlacement = Object.freeze({
		speciesId,
		baseSurface: geography.baseSurface,
		biome: geography.surface.biome,
		zoneId: geography.zoneId,
		biomeInfluence: Number(geography.biomeInfluence.toFixed(4)),
		slopeDegrees: Number(geography.surface.slopeDegrees.toFixed(3)),
		materialMode: preserveAuthored ? 'preserve-authored' : 'generated-fallback',
		authoredPbrMapSlots: Object.freeze([...materialAnalysis.authoredPbrMapSlots]),
		meshCount: prepared.validation.meshCount,
		materialSlotCount: prepared.validation.materialSlotCount,
		generatedMaterialCount: prepared.validation.generatedMaterialCount,
	});
	return { ...prepared, geography, materialAnalysis };
}
