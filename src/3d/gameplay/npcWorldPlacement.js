import { WORLD_DEFAULTS, WORLD_SCALE } from '../config.js';
import { analyzeMaterialSurfaces } from '../materials/MaterialAssignmentCore.js';
import {
	auditWorldAssetPlacement,
	evaluateWorldSurfacePlacement,
	prepareWorldAssetForPlacement,
} from '../world/WorldAssetPlacementPipeline.js';
import { REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from '../world/worldReferenceMap.js';
import { worldXZToNormalizedReference } from '../world/worldReferenceAlignment.js';
import { classifyReferenceBaseSurface } from '../world/worldReferenceSurfacePindexes.js';
import { referenceProtectionRadiiFromMeters, sampleSeatSafeReferenceHydrology } from '../world/worldReferenceHydrology.js';

const SLOPE_SAMPLE_RADIUS_METERS = 1.5;
const BIOME_INFLUENCE_FLOOR = 0.05;
const ROUTE_SAMPLE_SPACING_METERS = 4;
const MAX_ROUTE_SAMPLES = 12;
const MIN_KEEP_CLEARANCE_METERS = 10;
const MAX_KEEP_ENVELOPE_METERS = 30;
const MAX_RELOCATION_METERS = 8;
const RELOCATION_STEP_METERS = 2;
const SETTLEMENT_RING_STEP_METERS = 2;
const DIAGONAL_UNIT = Math.SQRT1_2;
const NPC_SEAT_PROTECTION_RADIUS_METERS = MAX_KEEP_ENVELOPE_METERS + SLOPE_SAMPLE_RADIUS_METERS;
const NPC_SEAT_PROTECTION_RADII = referenceProtectionRadiiFromMeters(
	NPC_SEAT_PROTECTION_RADIUS_METERS,
	WORLD_SCALE.METERS_PER_MAP_UNIT,
);

const SKIN_PALETTES = Object.freeze(['skin-fair', 'skin-olive', 'skin-brown', 'skin-deep']);
const HAIR_PALETTES = Object.freeze(['hair-black', 'hair-blonde', 'hair-red']);
const EYE_PALETTES = Object.freeze(['eye-brown', 'eye-blue', 'eye-green', 'eye-amber']);

const DEFAULT_GUARD_SURFACE_POLICY = Object.freeze({
	maxSlopeDegrees: 26,
	maxWaterDepth: 0.05,
	forbiddenBiomes: ['sea', 'lake'],
	forbiddenWaterTypes: ['sea', 'lake'],
});

const UNIFORM_PROFILE_BY_BIOME = Object.freeze({
	snow: Object.freeze({ id: 'winter-watch', tunic: 'tunic-blue', trousers: 'trousers-grey', armor: 'steel' }),
	'cold-grassland': Object.freeze({ id: 'northern-watch', tunic: 'tunic-blue', trousers: 'trousers-grey', armor: 'steel' }),
	mountain: Object.freeze({ id: 'mountain-watch', tunic: 'tunic-blue', trousers: 'trousers-grey', armor: 'steel' }),
	'rocky-hills': Object.freeze({ id: 'hill-watch', tunic: 'tunic-red', trousers: 'trousers-grey', armor: 'steel' }),
	'lust-grassland': Object.freeze({ id: 'field-watch', tunic: 'tunic-green', trousers: 'trousers-brown', armor: 'steel' }),
	'lush-grassland': Object.freeze({ id: 'field-watch', tunic: 'tunic-green', trousers: 'trousers-brown', armor: 'steel' }),
	desert: Object.freeze({ id: 'desert-watch', tunic: 'tunic-cream', trousers: 'trousers-brown', armor: 'steel' }),
	arid: Object.freeze({ id: 'arid-watch', tunic: 'tunic-cream', trousers: 'trousers-brown', armor: 'steel' }),
	steppe: Object.freeze({ id: 'steppe-watch', tunic: 'tunic-cream', trousers: 'trousers-brown', armor: 'steel' }),
	temperate_coast: Object.freeze({ id: 'coastal-watch', tunic: 'tunic-blue', trousers: 'trousers-brown', armor: 'steel' }),
	'temperate-coast': Object.freeze({ id: 'coastal-watch', tunic: 'tunic-blue', trousers: 'trousers-brown', armor: 'steel' }),
	jungle: Object.freeze({ id: 'green-watch', tunic: 'tunic-green', trousers: 'trousers-brown', armor: 'steel' }),
	marsh: Object.freeze({ id: 'marsh-watch', tunic: 'tunic-green', trousers: 'trousers-grey', armor: 'steel' }),
	soil: Object.freeze({ id: 'land-watch', tunic: 'tunic-red', trousers: 'trousers-brown', armor: 'steel' }),
	rock: Object.freeze({ id: 'stone-watch', tunic: 'tunic-red', trousers: 'trousers-grey', armor: 'steel' }),
});
const DEFAULT_UNIFORM_PROFILE = Object.freeze({ id: 'guard-watch', tunic: 'tunic-red', trousers: 'trousers-grey', armor: 'steel' });

const SLOT_PALETTE_KEYS = Object.freeze({
	skin: 'skin', hair: 'hair', eye: 'eye', tunic: 'tunic', trousers: 'trousers', boot: 'boot', belt: 'belt',
	cloak: 'tunic', armor: 'armor', helmet: 'armor', gear: 'armor',
});

function hashString(value) {
	let hash = 2166136261;
	for (const char of String(value ?? 'npc')) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash >>> 0;
}

function pickDeterministic(values, seed, salt) {
	const index = (seed + Math.imul(salt, 2654435761)) >>> 0;
	return values[index % values.length];
}

function finiteGroundHeight(sampleGroundHeight, x, z) {
	try {
		const height = sampleGroundHeight?.(x, z);
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

function resolveSeatSafeSurface(rawBaseSurface, normalized, protectedSeat) {
	const rawWaterType = rawBaseSurface === 'sea' || rawBaseSurface === 'lake' ? rawBaseSurface : 'none';
	if (!Number.isFinite(protectedSeat?.x) || !Number.isFinite(protectedSeat?.z)) {
		return { baseSurface: rawBaseSurface, waterType: rawWaterType, protectedLand: false, protectedLandWeight: 0 };
	}
	let seatNormalized;
	try {
		seatNormalized = worldXZToNormalizedReference(
			protectedSeat.x,
			protectedSeat.z,
			WORLD_SCALE.MAP_BOUNDS,
			WORLD_SCALE.METERS_PER_MAP_UNIT,
		);
	} catch {
		return { baseSurface: rawBaseSurface, waterType: rawWaterType, protectedLand: false, protectedLandWeight: 0 };
	}
	const hydrology = sampleSeatSafeReferenceHydrology(
		normalized.x,
		normalized.y,
		[seatNormalized],
		NPC_SEAT_PROTECTION_RADII,
	);
	const falseWater = hydrology.protectedLand && rawWaterType !== 'none';
	return {
		baseSurface: falseWater ? 'soil' : rawBaseSurface,
		waterType: falseWater ? 'none' : rawWaterType,
		protectedLand: hydrology.protectedLand,
		protectedLandWeight: hydrology.protectedLandWeight,
	};
}

export function sampleConfiguredNpcGeography(worldX, worldZ, sampleGroundHeight, protectedSeat = null) {
	if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return { ok: false, error: 'non-finite-position' };
	let normalized;
	try {
		normalized = worldXZToNormalizedReference(worldX, worldZ, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
	} catch {
		return { ok: false, error: 'reference-map-out-of-range' };
	}
	const height = finiteGroundHeight(sampleGroundHeight, worldX, worldZ);
	const west = finiteGroundHeight(sampleGroundHeight, worldX - SLOPE_SAMPLE_RADIUS_METERS, worldZ);
	const east = finiteGroundHeight(sampleGroundHeight, worldX + SLOPE_SAMPLE_RADIUS_METERS, worldZ);
	const north = finiteGroundHeight(sampleGroundHeight, worldX, worldZ - SLOPE_SAMPLE_RADIUS_METERS);
	const south = finiteGroundHeight(sampleGroundHeight, worldX, worldZ + SLOPE_SAMPLE_RADIUS_METERS);
	if ([height, west, east, north, south].some((value) => value === null)) return { ok: false, error: 'ground-sample-failed' };
	const rawBaseSurface = classifyReferenceBaseSurface(normalized.x, normalized.y);
	const seatSafe = resolveSeatSafeSurface(rawBaseSurface, normalized, protectedSeat);
	const baseSurface = seatSafe.baseSurface;
	const dominant = dominantBiomeAt(normalized.x, normalized.y, baseSurface);
	const gradientX = (east - west) / (SLOPE_SAMPLE_RADIUS_METERS * 2);
	const gradientZ = (south - north) / (SLOPE_SAMPLE_RADIUS_METERS * 2);
	const slopeDegrees = Math.atan(Math.hypot(gradientX, gradientZ)) * 180 / Math.PI;
	return {
		ok: true,
		surface: {
			height,
			slopeDegrees,
			waterDepth: seatSafe.waterType === 'none' ? 0 : Math.max(0, WORLD_DEFAULTS.WATER_LEVEL_METERS - height),
			biome: dominant.biome,
			waterType: seatSafe.waterType,
		},
		baseSurface,
		rawBaseSurface,
		seatProtectedLand: seatSafe.protectedLand,
		seatProtectedLandWeight: seatSafe.protectedLandWeight,
		zoneId: dominant.zoneId,
		biomeInfluence: dominant.influence,
		normalizedReference: Object.freeze({ x: normalized.x, y: normalized.y }),
	};
}

export function evaluateConfiguredNpcHabitat(worldX, worldZ, sampleGroundHeight, placementPolicy = DEFAULT_GUARD_SURFACE_POLICY, protectedSeat = null) {
	const geography = sampleConfiguredNpcGeography(worldX, worldZ, sampleGroundHeight, protectedSeat);
	if (!geography.ok) return geography;
	const evaluation = evaluateWorldSurfacePlacement(geography.surface, placementPolicy);
	if (!evaluation.ok) return { ok: false, error: `surface:${evaluation.errors.join(',')}`, geography, placementPolicy, evaluation };
	return { ok: true, geography, placementPolicy, evaluation };
}

function relocationOffsets(spawnId) {
	const offsets = [{ x: 0, z: 0 }];
	const seed = hashString(spawnId);
	for (let radius = RELOCATION_STEP_METERS; radius <= MAX_RELOCATION_METERS; radius += RELOCATION_STEP_METERS) {
		const diagonal = radius * DIAGONAL_UNIT;
		const ring = [
			{ x: radius, z: 0 }, { x: 0, z: radius }, { x: -radius, z: 0 }, { x: 0, z: -radius },
			{ x: diagonal, z: diagonal }, { x: -diagonal, z: diagonal }, { x: -diagonal, z: -diagonal }, { x: diagonal, z: -diagonal },
		];
		const shift = seed % ring.length;
		for (let index = 0; index < ring.length; index += 1) offsets.push(ring[(index + shift) % ring.length]);
	}
	return offsets;
}

function settlementRingCandidates(spawnId, seat) {
	const points = [];
	const seed = hashString(`${spawnId}:settlement-ring`);
	for (let radius = MIN_KEEP_CLEARANCE_METERS; radius <= MAX_KEEP_ENVELOPE_METERS; radius += SETTLEMENT_RING_STEP_METERS) {
		const diagonal = radius * DIAGONAL_UNIT;
		const ring = [
			{ x: radius, z: 0 }, { x: 0, z: radius }, { x: -radius, z: 0 }, { x: 0, z: -radius },
			{ x: diagonal, z: diagonal }, { x: -diagonal, z: diagonal }, { x: -diagonal, z: -diagonal }, { x: diagonal, z: -diagonal },
		];
		const shift = seed % ring.length;
		for (let index = 0; index < ring.length; index += 1) {
			const point = ring[(index + shift) % ring.length];
			points.push({ x: seat.x + point.x, z: seat.z + point.z });
		}
	}
	return points;
}

function safePlacementCandidate(x, z, desired, seat, sampleGroundHeight, relocationMode) {
	const seatDistanceMeters = Math.hypot(x - seat.x, z - seat.z);
	if (seatDistanceMeters < MIN_KEEP_CLEARANCE_METERS || seatDistanceMeters > MAX_KEEP_ENVELOPE_METERS) return null;
	const habitat = evaluateConfiguredNpcHabitat(x, z, sampleGroundHeight, DEFAULT_GUARD_SURFACE_POLICY, seat);
	if (!habitat.ok) return null;
	const displacementFromDesiredMeters = Math.hypot(x - desired.x, z - desired.z);
	const score = displacementFromDesiredMeters + habitat.geography.surface.slopeDegrees * 0.08;
	return { x, z, habitat, displacementFromDesiredMeters, seatDistanceMeters, relocationMode, score };
}

export function resolveConfiguredNpcSpawnPlacement({ spawn, seat, sampleGroundHeight } = {}) {
	if (!spawn || !seat) return { ok: false, error: 'missing-spawn-or-seat' };
	const desired = { x: seat.x + spawn.offsetXMeters, z: seat.z + spawn.offsetZMeters };
	if (!Number.isFinite(desired.x) || !Number.isFinite(desired.z)) return { ok: false, error: 'non-finite-position' };
	const localCandidates = [];
	for (const offset of relocationOffsets(spawn.id)) {
		const candidate = safePlacementCandidate(desired.x + offset.x, desired.z + offset.z, desired, seat, sampleGroundHeight, 'local');
		if (candidate) localCandidates.push(candidate);
	}
	let candidates = localCandidates;
	if (!candidates.length) {
		candidates = settlementRingCandidates(spawn.id, seat)
			.map((point) => safePlacementCandidate(point.x, point.z, desired, seat, sampleGroundHeight, 'settlement-ring'))
			.filter(Boolean);
	}
	if (!candidates.length) return { ok: false, error: 'no-safe-settlement-ground', desired };
	candidates.sort((a, b) => a.score - b.score || a.seatDistanceMeters - b.seatDistanceMeters || a.x - b.x || a.z - b.z);
	const chosen = candidates[0];
	return {
		ok: true,
		x: chosen.x,
		z: chosen.z,
		groundY: chosen.habitat.geography.surface.height,
		geography: chosen.habitat.geography,
		placementPolicy: chosen.habitat.placementPolicy,
		relocated: chosen.displacementFromDesiredMeters > 0,
		relocationMode: chosen.relocationMode,
		relocationMeters: chosen.relocationMode === 'local' ? chosen.displacementFromDesiredMeters : 0,
		displacementFromDesiredMeters: chosen.displacementFromDesiredMeters,
		seatDistanceMeters: chosen.seatDistanceMeters,
		protectedSeat: Object.freeze({ x: seat.x, z: seat.z }),
		desired,
	};
}

export function evaluateConfiguredNpcRoute(start, target, sampleGroundHeight, placementPolicy = DEFAULT_GUARD_SURFACE_POLICY, protectedSeat = null) {
	if (![start?.x, start?.z, target?.x, target?.z].every(Number.isFinite)) return { ok: false, error: 'non-finite-route' };
	const distanceMeters = Math.hypot(target.x - start.x, target.z - start.z);
	const sampleCount = Math.max(1, Math.min(MAX_ROUTE_SAMPLES, Math.ceil(distanceMeters / ROUTE_SAMPLE_SPACING_METERS)));
	let targetGeography = null;
	for (let index = 1; index <= sampleCount; index += 1) {
		const t = index / sampleCount;
		const x = start.x + (target.x - start.x) * t;
		const z = start.z + (target.z - start.z) * t;
		const habitat = evaluateConfiguredNpcHabitat(x, z, sampleGroundHeight, placementPolicy, protectedSeat);
		if (!habitat.ok) return { ...habitat, routeSampleIndex: index, routeSampleCount: sampleCount, distanceMeters };
		targetGeography = habitat.geography;
	}
	return { ok: true, targetGeography, routeSampleCount: sampleCount, distanceMeters };
}

export function resolveConfiguredNpcPatrol(spawn, seat, placement, sampleGroundHeight) {
	if (!spawn?.patrol || !placement?.ok) return { ok: true, waypoints: undefined, route: null };
	const relocationX = placement.x - placement.desired.x;
	const relocationZ = placement.z - placement.desired.z;
	const target = {
		x: seat.x + spawn.patrol.toOffsetXMeters + relocationX,
		z: seat.z + spawn.patrol.toOffsetZMeters + relocationZ,
	};
	const route = evaluateConfiguredNpcRoute(
		{ x: placement.x, z: placement.z },
		target,
		sampleGroundHeight,
		placement.placementPolicy,
		seat,
	);
	if (!route.ok) return { ok: true, waypoints: undefined, route: { ...route, disabled: true } };
	return { ok: true, waypoints: [{ x: placement.x, z: placement.z }, target], route: { ...route, disabled: false } };
}

function authoredMapCount(material) {
	return ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].reduce(
		(count, key) => count + (material?.[key]?.isTexture ? 1 : 0), 0,
	);
}

export function inspectConfiguredNpcMaterials(object) {
	const analysis = analyzeMaterialSurfaces(object);
	let authoredTextureSlots = 0;
	let highQualityAuthoredSlots = 0;
	for (const surface of analysis.surfaces) {
		const count = authoredMapCount(surface.material);
		if (count > 0) authoredTextureSlots += 1;
		if (count >= 2) highQualityAuthoredSlots += 1;
	}
	return { ...analysis, authoredTextureSlots, highQualityAuthoredSlots };
}

function resolveUniformProfile(spawn, geography) {
	const base = UNIFORM_PROFILE_BY_BIOME[geography?.surface?.biome] ?? DEFAULT_UNIFORM_PROFILE;
	const seed = hashString(`${spawn?.seatId ?? ''}:${spawn?.id ?? ''}`);
	return Object.freeze({
		...base,
		skin: pickDeterministic(SKIN_PALETTES, seed, 3),
		hair: pickDeterministic(HAIR_PALETTES, seed, 5),
		eye: pickDeterministic(EYE_PALETTES, seed, 7),
		boot: 'boot',
		belt: 'belt',
	});
}

export function createConfiguredNpcMaterialRecipe(object, spawn, geography) {
	const analysis = inspectConfiguredNpcMaterials(object);
	const profile = resolveUniformProfile(spawn, geography);
	if (analysis.namedSurfaceCount > 0) {
		const surfaceOverrides = {};
		for (const surface of analysis.surfaces) {
			const key = SLOT_PALETTE_KEYS[surface.slot];
			if (key && profile[key]) surfaceOverrides[surface.key] = profile[key];
		}
		if (Object.keys(surfaceOverrides).length > 0) {
			return { recipe: { version: 1, mode: 'surface', textureSize: 256, surfaceOverrides }, profile, analysis, mode: 'named-parts' };
		}
	}
	if (analysis.meshCount === 1) {
		return {
			recipe: {
				version: 1, mode: 'layers', basePaletteId: 'soldier', textureSize: 256, targetMeshIndex: 0,
				layers: [
					{ to: 0.10, palette: profile.boot }, { to: 0.44, palette: profile.trousers },
					{ to: 0.50, palette: profile.belt }, { to: 0.84, palette: profile.tunic },
					{ to: 0.91, palette: profile.skin }, { to: 1.00, palette: profile.hair },
				],
			},
			profile, analysis, mode: 'layered-fallback',
		};
	}
	return {
		recipe: { version: 1, mode: 'auto', basePaletteId: 'soldier', textureSize: 256, reason: 'multi-mesh-unnamed-fallback' },
		profile, analysis, mode: 'soldier-kit-fallback',
	};
}

export function prepareConfiguredNpcWorldAsset(object, { spawn, placement, sampleGroundHeight } = {}) {
	if (!object || !spawn || !placement?.ok) return { ok: false, error: 'missing-npc-placement-input' };
	const materialPlan = createConfiguredNpcMaterialRecipe(object, spawn, placement.geography);
	const prepared = prepareWorldAssetForPlacement(object, {
		metadata: { id: spawn.id, name: spawn.displayName, category: 'soldier', src: spawn.modelUrl },
		materialRecipe: materialPlan.recipe,
		position: { x: placement.x, y: placement.groundY, z: placement.z },
		rotation: { x: object.rotation.x, y: spawn.rotationYRadians ?? 0, z: object.rotation.z },
		surfaceQuery: (x, z) => sampleConfiguredNpcGeography(x, z, sampleGroundHeight, placement.protectedSeat).surface ?? null,
		placementPolicy: placement.placementPolicy,
		requireSurfaceContext: true,
		snapToGround: true,
		footprintGrounding: 'never',
		requireGeneratedTexture: true,
	});
	if (!prepared.ok) return prepared;
	const audit = auditWorldAssetPlacement(object);
	if (!audit.ok) return { ok: false, error: `audit:${audit.errors.join(',')}`, audit };
	object.userData.npcWorldPlacement = Object.freeze({
		baseSurface: placement.geography.baseSurface,
		rawBaseSurface: placement.geography.rawBaseSurface,
		seatProtectedLand: placement.geography.seatProtectedLand,
		seatProtectedLandWeight: Number(placement.geography.seatProtectedLandWeight.toFixed(4)),
		biome: placement.geography.surface.biome,
		zoneId: placement.geography.zoneId,
		biomeInfluence: Number(placement.geography.biomeInfluence.toFixed(4)),
		slopeDegrees: Number(placement.geography.surface.slopeDegrees.toFixed(3)),
		relocated: placement.relocated,
		relocationMode: placement.relocationMode,
		relocationMeters: Number(placement.relocationMeters.toFixed(3)),
		displacementFromDesiredMeters: Number(placement.displacementFromDesiredMeters.toFixed(3)),
		seatDistanceMeters: Number(placement.seatDistanceMeters.toFixed(3)),
		materialMode: materialPlan.mode,
		uniformProfileId: materialPlan.profile.id,
		meshCount: prepared.validation.meshCount,
		materialSlotCount: prepared.validation.materialSlotCount,
		generatedMaterialCount: prepared.validation.generatedMaterialCount,
		authoredTextureSlotsBeforeAssignment: materialPlan.analysis.authoredTextureSlots,
		highQualityAuthoredSlotsBeforeAssignment: materialPlan.analysis.highQualityAuthoredSlots,
	});
	return { ...prepared, audit, materialPlan };
}
