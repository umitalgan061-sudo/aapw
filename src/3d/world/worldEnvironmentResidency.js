/**
 * Deterministic environment residency planner.
 *
 * This module owns only *when* environment work should be resident and at which visual budget it
 * should run. It deliberately does not own biome classification, canonical geography, asset
 * selection, terrain height, water classification, settlement coordinates, collider state, or any
 * other competing authority. Callers provide those facts; this module turns distance, quality and
 * device context into bounded residency bands and asset-fidelity requirements.
 *
 * The production gap addressed here is the old fixed-budget world partition: terrain chunks were
 * streamed, but the environment layer had no explicit distance budget, no stable near/mid/far band,
 * no asset texture budget, and no deterministic way to describe how much vegetation/rock/detail an
 * environment consumer should keep resident. The result was either too little visual density near
 * the player or too much expensive work at the edge of the active world.
 *
 * The contract is intentionally pure wherever possible. That makes it usable by runtime systems,
 * browser proofs and offline validation without constructing Three.js scenes.
 *
 * @module world/worldEnvironmentResidency
 */

export const WORLD_ENVIRONMENT_RESIDENCY_POLICY = Object.freeze({
	id: 'world-environment-residency-2026-09-07-v1',
	version: 1,
	coordinateAuthority: 'world/chunkManager',
	terrainAuthority: 'world/terrain',
	biomeAuthority: 'caller-supplied-canonical-context',
	assetSelectionAuthority: 'caller-supplied-shared-placement-core',
	materialAuthority: 'materials/MaterialAssignmentCore',
	placementAuthority: 'world/WorldAssetPlacementPipeline',
	selectionNeverInventsGeography: true,
	seamSafeByConstruction: true,
	deterministic: true,
});

export const ENVIRONMENT_RESIDENCY_BANDS = Object.freeze({
	NEAR: 'near',
	MID: 'mid',
	FAR: 'far',
	OUTER: 'outer',
});

export const ENVIRONMENT_VISUAL_TIERS = Object.freeze({
	HERO: 'hero',
	FULL: 'full',
	REDUCED: 'reduced',
	BOUNDARY: 'boundary',
});

export const ENVIRONMENT_SHADOW_MODES = Object.freeze({
	FULL: 'full',
	CONTACT_ONLY: 'contact-only',
	RECEIVE_ONLY: 'receive-only',
	OFF: 'off',
});

export const ENVIRONMENT_TEXTURE_TIERS = Object.freeze({
	ULTRA: 'ultra',
	HIGH: 'high',
	MEDIUM: 'medium',
	LOW: 'low',
});

const BAND_ORDER = Object.freeze([
	ENVIRONMENT_RESIDENCY_BANDS.NEAR,
	ENVIRONMENT_RESIDENCY_BANDS.MID,
	ENVIRONMENT_RESIDENCY_BANDS.FAR,
	ENVIRONMENT_RESIDENCY_BANDS.OUTER,
]);

const BAND_DISTANCE_LIMITS_METERS = Object.freeze({
	[ENVIRONMENT_RESIDENCY_BANDS.NEAR]: 750,
	[ENVIRONMENT_RESIDENCY_BANDS.MID]: 1500,
	[ENVIRONMENT_RESIDENCY_BANDS.FAR]: 3000,
	[ENVIRONMENT_RESIDENCY_BANDS.OUTER]: 4500,
});

const QUALITY_ORDER = Object.freeze({ ultra: 4, high: 3, medium: 2, low: 1 });

const QUALITY_FACTORS = Object.freeze({
	ultra: Object.freeze({ density: 1.0, texture: 1.0, shadow: 1.0, micro: 1.0, maxAssets: 1.0 }),
	high: Object.freeze({ density: 0.92, texture: 0.92, shadow: 0.85, micro: 0.86, maxAssets: 0.9 }),
	medium: Object.freeze({ density: 0.76, texture: 0.78, shadow: 0.65, micro: 0.67, maxAssets: 0.72 }),
	low: Object.freeze({ density: 0.56, texture: 0.56, shadow: 0.45, micro: 0.42, maxAssets: 0.52 }),
});

const BAND_FACTORS = Object.freeze({
	near: Object.freeze({ density: 1.0, texture: 1.0, micro: 1.0, shadow: 1.0, maxAssets: 1.0 }),
	mid: Object.freeze({ density: 0.72, texture: 0.78, micro: 0.62, shadow: 0.58, maxAssets: 0.72 }),
	far: Object.freeze({ density: 0.38, texture: 0.52, micro: 0.30, shadow: 0.18, maxAssets: 0.42 }),
	outer: Object.freeze({ density: 0.12, texture: 0.32, micro: 0.10, shadow: 0.0, maxAssets: 0.16 }),
});

const MOBILE_BAND_LIMITS_METERS = Object.freeze({
	near: 500,
	mid: 1000,
	far: 2000,
	outer: 3000,
});

const MOBILE_BAND_FACTORS = Object.freeze({
	near: Object.freeze({ density: 0.82, texture: 0.82, micro: 0.76, shadow: 0.68, maxAssets: 0.78 }),
	mid: Object.freeze({ density: 0.52, texture: 0.64, micro: 0.46, shadow: 0.34, maxAssets: 0.5 }),
	far: Object.freeze({ density: 0.2, texture: 0.42, micro: 0.18, shadow: 0.08, maxAssets: 0.22 }),
	outer: Object.freeze({ density: 0.05, texture: 0.28, micro: 0.04, shadow: 0.0, maxAssets: 0.08 }),
});

const FAMILY_DEFAULTS = Object.freeze({
	vegetation: Object.freeze({ densityPerKm2: 180, spacingMeters: 9, maxAssets: 900, textureTier: 'high' }),
	tree: Object.freeze({ densityPerKm2: 120, spacingMeters: 11, maxAssets: 600, textureTier: 'high' }),
	shrub: Object.freeze({ densityPerKm2: 420, spacingMeters: 4, maxAssets: 1200, textureTier: 'medium' }),
	grass: Object.freeze({ densityPerKm2: 1800, spacingMeters: 1.4, maxAssets: 4800, textureTier: 'medium' }),
	rock: Object.freeze({ densityPerKm2: 80, spacingMeters: 14, maxAssets: 300, textureTier: 'high' }),
	cliff: Object.freeze({ densityPerKm2: 24, spacingMeters: 18, maxAssets: 100, textureTier: 'high' }),
	prop: Object.freeze({ densityPerKm2: 40, spacingMeters: 16, maxAssets: 160, textureTier: 'medium' }),
	settlement: Object.freeze({ densityPerKm2: 10, spacingMeters: 22, maxAssets: 64, textureTier: 'high' }),
	bridge: Object.freeze({ densityPerKm2: 4, spacingMeters: 40, maxAssets: 16, textureTier: 'high' }),
});

const SURFACE_CLASS_TEXTURE_REQUIREMENTS = Object.freeze({
	grass: Object.freeze({ albedo: true, normal: true, roughness: true, ao: true, triplanarPreferred: true }),
	soil: Object.freeze({ albedo: true, normal: true, roughness: true, ao: true, triplanarPreferred: true }),
	mud: Object.freeze({ albedo: true, normal: true, roughness: true, ao: true, triplanarPreferred: true }),
	rock: Object.freeze({ albedo: true, normal: true, roughness: true, ao: true, triplanarPreferred: true }),
	scree: Object.freeze({ albedo: true, normal: true, roughness: true, ao: true, triplanarPreferred: true }),
	snow: Object.freeze({ albedo: true, normal: true, roughness: true, ao: false, triplanarPreferred: true }),
	wet: Object.freeze({ albedo: true, normal: true, roughness: true, ao: false, triplanarPreferred: true }),
	bark: Object.freeze({ albedo: true, normal: true, roughness: true, ao: true, triplanarPreferred: false }),
	leaves: Object.freeze({ albedo: true, normal: true, roughness: true, ao: false, triplanarPreferred: false }),
	wall: Object.freeze({ albedo: true, normal: true, roughness: true, ao: true, triplanarPreferred: false }),
	roof: Object.freeze({ albedo: true, normal: true, roughness: true, ao: true, triplanarPreferred: false }),
	metal: Object.freeze({ albedo: true, normal: true, roughness: true, ao: false, triplanarPreferred: false }),
});

function clamp01(value) {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function finiteOr(value, fallback) {
	return Number.isFinite(value) ? value : fallback;
}

function asFiniteInteger(value, fallback = 0) {
	if (!Number.isFinite(value)) return fallback;
	return Math.trunc(value);
}

function normalizeQuality(quality) {
	const normalized = String(quality ?? 'medium').toLowerCase();
	return QUALITY_FACTORS[normalized] ? normalized : 'medium';
}

function normalizeFamily(family) {
	const key = String(family ?? '').trim().toLowerCase();
	if (FAMILY_DEFAULTS[key]) return key;
	if (key.includes('tree')) return 'tree';
	if (key.includes('shrub')) return 'shrub';
	if (key.includes('grass')) return 'grass';
	if (key.includes('rock') || key.includes('boulder')) return 'rock';
	if (key.includes('cliff') || key.includes('talus')) return 'cliff';
	if (key.includes('bridge')) return 'bridge';
	if (key.includes('settlement') || key.includes('house') || key.includes('castle')) return 'settlement';
	return 'prop';
}

function normalizeTextureTier(tier) {
	const key = String(tier ?? '').toLowerCase();
	return ENVIRONMENT_TEXTURE_TIERS[key] ? key : ENVIRONMENT_TEXTURE_TIERS.MEDIUM;
}

function qualityScale(quality) {
	return QUALITY_FACTORS[normalizeQuality(quality)];
}

function bandLimitsFor({ mobile = false } = {}) {
	return mobile ? MOBILE_BAND_LIMITS_METERS : BAND_DISTANCE_LIMITS_METERS;
}

function bandFactorsFor({ mobile = false } = {}) {
	return mobile ? MOBILE_BAND_FACTORS : BAND_FACTORS;
}

export function normalizeChunkCoordinate(value) {
	return asFiniteInteger(value, 0);
}

export function normalizeChunkKey(chunkX, chunkZ) {
	return `${normalizeChunkCoordinate(chunkX)},${normalizeChunkCoordinate(chunkZ)}`;
}

export function chunkCenterWorldXZ(chunkX, chunkZ, chunkSizeMeters) {
	const x = normalizeChunkCoordinate(chunkX);
	const z = normalizeChunkCoordinate(chunkZ);
	const size = Math.max(1, finiteOr(chunkSizeMeters, 500));
	return Object.freeze({ x: x * size, z: z * size });
}

export function chunkDeltaDistanceMeters(chunkX, chunkZ, centerChunkX, centerChunkZ, chunkSizeMeters) {
	const dx = normalizeChunkCoordinate(chunkX) - normalizeChunkCoordinate(centerChunkX);
	const dz = normalizeChunkCoordinate(chunkZ) - normalizeChunkCoordinate(centerChunkZ);
	const size = Math.max(1, finiteOr(chunkSizeMeters, 500));
	return Math.hypot(dx * size, dz * size);
}

export function chebyshevChunkDistance(chunkX, chunkZ, centerChunkX, centerChunkZ) {
	return Math.max(
		Math.abs(normalizeChunkCoordinate(chunkX) - normalizeChunkCoordinate(centerChunkX)),
		Math.abs(normalizeChunkCoordinate(chunkZ) - normalizeChunkCoordinate(centerChunkZ)),
	);
}

export function classifyEnvironmentBand(distanceMeters, { mobile = false } = {}) {
	const distance = Math.max(0, finiteOr(distanceMeters, 0));
	const limits = bandLimitsFor({ mobile });
	if (distance <= limits.near) return ENVIRONMENT_RESIDENCY_BANDS.NEAR;
	if (distance <= limits.mid) return ENVIRONMENT_RESIDENCY_BANDS.MID;
	if (distance <= limits.far) return ENVIRONMENT_RESIDENCY_BANDS.FAR;
	return ENVIRONMENT_RESIDENCY_BANDS.OUTER;
}

export function compareBands(a, b) {
	const ai = BAND_ORDER.indexOf(a);
	const bi = BAND_ORDER.indexOf(b);
	return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
}

export function isBandAtLeastNear(band) {
	return compareBands(band, ENVIRONMENT_RESIDENCY_BANDS.NEAR) <= 0;
}

export function isBandResident(band) {
	return BAND_ORDER.includes(band);
}

export function bandDistanceCapMeters(band, { mobile = false } = {}) {
	const limits = bandLimitsFor({ mobile });
	return finiteOr(limits[band], 0);
}

export function stableHash32(...values) {
	let hash = 2166136261 >>> 0;
	for (const value of values) {
		const text = String(value ?? '');
		for (let index = 0; index < text.length; index += 1) {
			hash ^= text.charCodeAt(index);
			hash = Math.imul(hash, 16777619) >>> 0;
		}
		hash ^= 0x9e3779b9;
		hash = Math.imul(hash, 2246822519) >>> 0;
	}
	return hash >>> 0;
}

export function stableUnitFloat(...values) {
	return stableHash32(...values) / 0x100000000;
}

export function stableSignedJitter(seed, chunkX, chunkZ, slot = 0) {
	return stableUnitFloat(seed, chunkX, chunkZ, slot) * 2 - 1;
}

export function chunkSortScore({ chunkX, chunkZ, centerChunkX, centerChunkZ, chunkSizeMeters, seed = 0 }) {
	const distance = chunkDeltaDistanceMeters(chunkX, chunkZ, centerChunkX, centerChunkZ, chunkSizeMeters);
	const ring = chebyshevChunkDistance(chunkX, chunkZ, centerChunkX, centerChunkZ);
	const tie = stableUnitFloat(seed, chunkX, chunkZ, 'sort');
	return distance * 1000 + ring * 10 + tie;
}

export function getFamilyDefaults(family) {
	return FAMILY_DEFAULTS[normalizeFamily(family)];
}

export function getBandFactors(band, { mobile = false } = {}) {
	return bandFactorsFor({ mobile })[band] ?? BAND_FACTORS[ENVIRONMENT_RESIDENCY_BANDS.OUTER];
}

export function resolveTextureTier({ band, quality = 'medium', requestedTier = null, mobile = false } = {}) {
	const base = normalizeTextureTier(requestedTier ?? 'high');
	const qualityRank = QUALITY_ORDER[normalizeQuality(quality)];
	const mobilePenalty = mobile ? 1 : 0;
	const bandPenalty = band === ENVIRONMENT_RESIDENCY_BANDS.NEAR ? 0 : band === ENVIRONMENT_RESIDENCY_BANDS.MID ? 1 : band === ENVIRONMENT_RESIDENCY_BANDS.FAR ? 2 : 3;
	const requestedRank = QUALITY_ORDER[base] ?? 2;
	const resolvedRank = Math.max(1, Math.min(requestedRank, qualityRank - mobilePenalty, 4 - bandPenalty));
	if (resolvedRank >= 4) return ENVIRONMENT_TEXTURE_TIERS.ULTRA;
	if (resolvedRank === 3) return ENVIRONMENT_TEXTURE_TIERS.HIGH;
	if (resolvedRank === 2) return ENVIRONMENT_TEXTURE_TIERS.MEDIUM;
	return ENVIRONMENT_TEXTURE_TIERS.LOW;
}

export function resolveShadowMode({ band, mobile = false, quality = 'medium', hero = false } = {}) {
	if (hero || band === ENVIRONMENT_RESIDENCY_BANDS.NEAR) {
		if (!mobile && QUALITY_ORDER[normalizeQuality(quality)] >= 3) return ENVIRONMENT_SHADOW_MODES.FULL;
		return ENVIRONMENT_SHADOW_MODES.CONTACT_ONLY;
	}
	if (band === ENVIRONMENT_RESIDENCY_BANDS.MID) return mobile ? ENVIRONMENT_SHADOW_MODES.RECEIVE_ONLY : ENVIRONMENT_SHADOW_MODES.CONTACT_ONLY;
	return ENVIRONMENT_SHADOW_MODES.OFF;
}

export function resolveVisualTier({ band, surfaceContext = {}, assetFamily = 'prop', hero = false } = {}) {
	const family = normalizeFamily(assetFamily);
	const slope = clamp(finiteOr(surfaceContext.slopeDegrees, 0), 0, 90);
	const wetness = clamp01(surfaceContext.moisture);
	const waterDistance = Math.max(0, finiteOr(surfaceContext.waterDistanceMeters, 999999));
	const isRocky = family === 'rock' || family === 'cliff';
	const steepLandscape = slope >= 55;
	const wetBoundary = waterDistance <= 35 || wetness >= 0.85;
	if (hero) return ENVIRONMENT_VISUAL_TIERS.HERO;
	if (band === ENVIRONMENT_RESIDENCY_BANDS.NEAR) return ENVIRONMENT_VISUAL_TIERS.FULL;
	if (isRocky && steepLandscape && band === ENVIRONMENT_RESIDENCY_BANDS.MID) return ENVIRONMENT_VISUAL_TIERS.FULL;
	if (wetBoundary && band === ENVIRONMENT_RESIDENCY_BANDS.MID) return ENVIRONMENT_VISUAL_TIERS.FULL;
	if (band === ENVIRONMENT_RESIDENCY_BANDS.OUTER) return ENVIRONMENT_VISUAL_TIERS.BOUNDARY;
	return ENVIRONMENT_VISUAL_TIERS.REDUCED;
}

export function resolveSurfaceTextureRequirements(surfaceClass) {
	const key = String(surfaceClass ?? '').trim().toLowerCase();
	const result = SURFACE_CLASS_TEXTURE_REQUIREMENTS[key] ?? SURFACE_CLASS_TEXTURE_REQUIREMENTS.rock;
	return Object.freeze({ ...result, surfaceClass: key || 'rock' });
}

export function buildAssetFidelityRequirements({ family, surfaceClass, quality = 'medium', band, mobile = false } = {}) {
	const normalizedFamily = normalizeFamily(family);
	const defaults = getFamilyDefaults(normalizedFamily);
	const surface = resolveSurfaceTextureRequirements(surfaceClass ?? normalizedFamily);
	const textureTier = resolveTextureTier({ band, quality, requestedTier: defaults.textureTier, mobile });
	const minimumTextureResolution = textureTier === ENVIRONMENT_TEXTURE_TIERS.ULTRA
		? 2048
		: textureTier === ENVIRONMENT_TEXTURE_TIERS.HIGH
			? 1024
			: textureTier === ENVIRONMENT_TEXTURE_TIERS.MEDIUM
				? 512
				: 256;
	return Object.freeze({
		family: normalizedFamily,
		surfaceClass: surface.surfaceClass,
		textureTier,
		minimumTextureResolution,
		requireAlbedo: surface.albedo,
		requireNormal: surface.normal,
		requireRoughness: surface.roughness,
		requireAO: surface.ao,
		preferTriplanar: surface.triplanarPreferred,
		allowProceduralFallback: normalizedFamily !== 'settlement' && normalizedFamily !== 'bridge',
		singleColorMaterialForbidden: true,
		minimumDistinctPBRChannels: surface.normal && surface.roughness ? 3 : 2,
	});
}

export function validateAssetFidelityMetadata(metadata = {}, requirements = {}) {
	const reasons = [];
	const materialSlots = Array.isArray(metadata.materialSlots) ? metadata.materialSlots : [];
	const textureChannels = metadata.textureChannels && typeof metadata.textureChannels === 'object'
		? metadata.textureChannels
		: {};
	const hasAlbedo = Boolean(metadata.hasAlbedo ?? textureChannels.albedo);
	const hasNormal = Boolean(metadata.hasNormal ?? textureChannels.normal);
	const hasRoughness = Boolean(metadata.hasRoughness ?? textureChannels.roughness);
	const hasAO = Boolean(metadata.hasAO ?? textureChannels.ao);
	const distinctPBRChannels = [hasAlbedo, hasNormal, hasRoughness, hasAO].filter(Boolean).length;
	if (requirements.requireAlbedo && !hasAlbedo) reasons.push('missing-albedo');
	if (requirements.requireNormal && !hasNormal) reasons.push('missing-normal');
	if (requirements.requireRoughness && !hasRoughness) reasons.push('missing-roughness');
	if (requirements.requireAO && !hasAO) reasons.push('missing-ao');
	if (requirements.singleColorMaterialForbidden && metadata.singleColor === true) reasons.push('single-color-material');
	if (metadata.placeholder === true) reasons.push('placeholder-material');
	if (metadata.materialMismatch === true) reasons.push('material-mismatch');
	if (requirements.minimumDistinctPBRChannels && distinctPBRChannels < requirements.minimumDistinctPBRChannels) reasons.push('insufficient-pbr-channels');
	if (requirements.minimumTextureResolution && Number.isFinite(metadata.maxTextureResolution) && metadata.maxTextureResolution < requirements.minimumTextureResolution) reasons.push('texture-resolution-too-low');
	if (materialSlots.length === 0 && metadata.materialSlotCount === 0) reasons.push('no-material-slots');
	return Object.freeze({ valid: reasons.length === 0, reasons, distinctPBRChannels });
}

export function familyCapacityKm2({ family, band, quality = 'medium', mobile = false, biomeDensityMultiplier = 1 } = {}) {
	const defaults = getFamilyDefaults(family);
	const qualityInfo = qualityScale(quality);
	const bandInfo = getBandFactors(band, { mobile });
	return Math.max(
		1,
		Math.round(defaults.densityPerKm2 * qualityInfo.density * bandInfo.density * clamp(biomeDensityMultiplier, 0, 2)),
	);
}

export function familyMaxAssets({ family, band, quality = 'medium', mobile = false, biomeDensityMultiplier = 1 } = {}) {
	const defaults = getFamilyDefaults(family);
	const qualityInfo = qualityScale(quality);
	const bandInfo = getBandFactors(band, { mobile });
	return Math.max(
		0,
		Math.round(defaults.maxAssets * qualityInfo.maxAssets * bandInfo.maxAssets * clamp(biomeDensityMultiplier, 0, 2)),
	);
}

export function familySpacingMeters({ family, band, quality = 'medium', mobile = false } = {}) {
	const defaults = getFamilyDefaults(family);
	const bandInfo = getBandFactors(band, { mobile });
	const densityScale = Math.max(0.05, bandInfo.density * qualityScale(quality).density);
	return Math.max(0.75, defaults.spacingMeters / Math.sqrt(densityScale));
}

export function resolveEnvironmentBudget({
	family = 'prop',
	band = ENVIRONMENT_RESIDENCY_BANDS.FAR,
	quality = 'medium',
	mobile = false,
	biomeDensityMultiplier = 1,
	surfaceContext = {},
	hero = false,
} = {}) {
	const normalizedFamily = normalizeFamily(family);
	const qualityInfo = qualityScale(quality);
	const bandInfo = getBandFactors(band, { mobile });
	const familyDefaults = getFamilyDefaults(normalizedFamily);
	const densityMultiplier = clamp(biomeDensityMultiplier, 0, 2);
	const visualTier = resolveVisualTier({ band, surfaceContext, assetFamily: normalizedFamily, hero });
	const shadowMode = resolveShadowMode({ band, mobile, quality, hero });
	const textureTier = resolveTextureTier({ band, mobile, quality, requestedTier: familyDefaults.textureTier });
	const densityPerKm2 = Math.max(0, familyDefaults.densityPerKm2 * qualityInfo.density * bandInfo.density * densityMultiplier);
	const maxAssets = Math.max(0, Math.round(familyDefaults.maxAssets * qualityInfo.maxAssets * bandInfo.maxAssets * densityMultiplier));
	const microDetailStrength = clamp(qualityInfo.micro * bandInfo.micro, 0, 1);
	const shadowStrength = clamp(qualityInfo.shadow * bandInfo.shadow, 0, 1);
	const spacingMeters = familySpacingMeters({ family: normalizedFamily, band, quality, mobile });
	const requirements = buildAssetFidelityRequirements({ family: normalizedFamily, surfaceClass: surfaceContext.surfaceClass, quality, band, mobile });
	return Object.freeze({
		policyId: WORLD_ENVIRONMENT_RESIDENCY_POLICY.id,
		family: normalizedFamily,
		band,
		visualTier,
		shadowMode,
		textureTier,
		densityPerKm2,
		maxAssets,
		spacingMeters,
		microDetailStrength,
		shadowStrength,
		textureResolution: requirements.minimumTextureResolution,
		singleColorForbidden: requirements.singleColorMaterialForbidden,
		requirements,
	});
}

export function makeChunkResidencyEntry({
	chunkX,
	chunkZ,
	centerChunkX,
	centerChunkZ,
	chunkSizeMeters = 500,
	seed = 1337,
	quality = 'medium',
	mobile = false,
	families = Object.keys(FAMILY_DEFAULTS),
	worldContext = {},
} = {}) {
	const normalizedX = normalizeChunkCoordinate(chunkX);
	const normalizedZ = normalizeChunkCoordinate(chunkZ);
	const distanceMeters = chunkDeltaDistanceMeters(normalizedX, normalizedZ, centerChunkX, centerChunkZ, chunkSizeMeters);
	const band = classifyEnvironmentBand(distanceMeters, { mobile });
	const chebyshevDistance = chebyshevChunkDistance(normalizedX, normalizedZ, centerChunkX, centerChunkZ);
	const center = chunkCenterWorldXZ(normalizedX, normalizedZ, chunkSizeMeters);
	const contextByFamily = worldContext.families && typeof worldContext.families === 'object' ? worldContext.families : {};
	const budgets = {};
	for (const family of families) {
		const key = normalizeFamily(family);
		const context = contextByFamily[key] ?? worldContext.surfaceContext ?? {};
		budgets[key] = resolveEnvironmentBudget({
			family: key,
			band,
			quality,
			mobile,
			biomeDensityMultiplier: context.biomeDensityMultiplier ?? 1,
			surfaceContext: context.surfaceContext ?? context,
			hero: context.hero === true,
		});
	}
	const assetPriority = band === ENVIRONMENT_RESIDENCY_BANDS.NEAR
		? 'immediate'
		: band === ENVIRONMENT_RESIDENCY_BANDS.MID
			? 'deferred'
			: band === ENVIRONMENT_RESIDENCY_BANDS.FAR
				? 'opportunistic'
				: 'boundary';
	return Object.freeze({
		key: normalizeChunkKey(normalizedX, normalizedZ),
		chunkX: normalizedX,
		chunkZ: normalizedZ,
		centerWorldXZ: center,
		distanceMeters,
		chebyshevDistance,
		band,
		assetPriority,
		assetBudgets: Object.freeze(budgets),
		sortScore: chunkSortScore({ chunkX: normalizedX, chunkZ: normalizedZ, centerChunkX, centerChunkZ, chunkSizeMeters, seed }),
	});
}

export function planEnvironmentResidency({
	centerChunkX = 0,
	centerChunkZ = 0,
	radiusChunks = 2,
	chunkSizeMeters = 500,
	seed = 1337,
	quality = 'medium',
	mobile = false,
	families = Object.keys(FAMILY_DEFAULTS),
	worldContext = {},
} = {}) {
	const centerX = normalizeChunkCoordinate(centerChunkX);
	const centerZ = normalizeChunkCoordinate(centerChunkZ);
	const radius = Math.max(0, asFiniteInteger(radiusChunks, 0));
	const entries = [];
	for (let dz = -radius; dz <= radius; dz += 1) {
		for (let dx = -radius; dx <= radius; dx += 1) {
			entries.push(makeChunkResidencyEntry({
				chunkX: centerX + dx,
				chunkZ: centerZ + dz,
				centerChunkX: centerX,
				centerChunkZ: centerZ,
				chunkSizeMeters,
				seed,
				quality,
				mobile,
				families,
				worldContext,
			}));
		}
	}
	entries.sort((a, b) => a.sortScore - b.sortScore || a.key.localeCompare(b.key));
	const totals = {};
	for (const family of families) {
		const key = normalizeFamily(family);
		totals[key] = entries.reduce((sum, entry) => sum + (entry.assetBudgets[key]?.maxAssets ?? 0), 0);
	}
	return Object.freeze({
		policyId: WORLD_ENVIRONMENT_RESIDENCY_POLICY.id,
		centerChunkX: centerX,
		centerChunkZ: centerZ,
		radiusChunks: radius,
		chunkSizeMeters: Math.max(1, finiteOr(chunkSizeMeters, 500)),
		quality: normalizeQuality(quality),
		mobile: Boolean(mobile),
		entries: Object.freeze(entries),
		totalMaxAssetsByFamily: Object.freeze(totals),
		residentChunkCount: entries.length,
	});
}

export function selectAssetSlot({
	seed = 1337,
	chunkX = 0,
	chunkZ = 0,
	family = 'prop',
	slotIndex = 0,
	candidateCount = 1,
	acceptance = 1,
} = {}) {
	const count = Math.max(1, asFiniteInteger(candidateCount, 1));
	const p = clamp01(acceptance);
	const roll = stableUnitFloat(seed, chunkX, chunkZ, normalizeFamily(family), slotIndex, 'slot');
	if (roll > p) return -1;
	const rank = stableUnitFloat(seed, chunkX, chunkZ, normalizeFamily(family), slotIndex, 'rank');
	return Math.min(count - 1, Math.floor(rank * count));
}

export function buildDeterministicFamilySlots({
	seed = 1337,
	chunkX = 0,
	chunkZ = 0,
	family = 'prop',
	requestedCount = 0,
	candidateCount = 1,
	acceptance = 1,
} = {}) {
	const requested = Math.max(0, asFiniteInteger(requestedCount, 0));
	const slots = [];
	for (let slotIndex = 0; slotIndex < requested; slotIndex += 1) {
		const candidateIndex = selectAssetSlot({ seed, chunkX, chunkZ, family, slotIndex, candidateCount, acceptance });
		if (candidateIndex < 0) continue;
		slots.push(Object.freeze({ slotIndex, candidateIndex, family: normalizeFamily(family) }));
	}
	return Object.freeze(slots);
}

export function environmentChunkManifest(entry) {
	if (!entry || typeof entry !== 'object') throw new TypeError('environmentChunkManifest requires a residency entry');
	const families = Object.entries(entry.assetBudgets ?? {}).map(([family, budget]) => Object.freeze({
		family,
		visualTier: budget.visualTier,
		textureTier: budget.textureTier,
		shadowMode: budget.shadowMode,
		maxAssets: budget.maxAssets,
		spacingMeters: budget.spacingMeters,
		requirements: budget.requirements,
	}));
	return Object.freeze({
		policyId: WORLD_ENVIRONMENT_RESIDENCY_POLICY.id,
		chunkKey: entry.key,
		band: entry.band,
		assetPriority: entry.assetPriority,
		families: Object.freeze(families),
	});
}

export function validateResidencyPlan(plan) {
	const reasons = [];
	if (!plan || !Array.isArray(plan.entries)) return Object.freeze({ valid: false, reasons: ['missing-plan'] });
	const keys = new Set();
	let previousScore = -Infinity;
	for (const entry of plan.entries) {
		if (keys.has(entry.key)) reasons.push(`duplicate-key:${entry.key}`);
		keys.add(entry.key);
		if (entry.sortScore < previousScore) reasons.push(`unsorted:${entry.key}`);
		previousScore = entry.sortScore;
		if (!isBandResident(entry.band)) reasons.push(`invalid-band:${entry.key}`);
		if (!Number.isFinite(entry.distanceMeters)) reasons.push(`invalid-distance:${entry.key}`);
		if (!Number.isFinite(entry.centerWorldXZ?.x) || !Number.isFinite(entry.centerWorldXZ?.z)) reasons.push(`invalid-center:${entry.key}`);
		for (const [family, budget] of Object.entries(entry.assetBudgets ?? {})) {
			if (!(budget.maxAssets >= 0)) reasons.push(`negative-max-assets:${entry.key}:${family}`);
			if (!(budget.spacingMeters > 0)) reasons.push(`invalid-spacing:${entry.key}:${family}`);
			if (!Object.values(ENVIRONMENT_VISUAL_TIERS).includes(budget.visualTier)) reasons.push(`invalid-tier:${entry.key}:${family}`);
			if (!Object.values(ENVIRONMENT_TEXTURE_TIERS).includes(budget.textureTier)) reasons.push(`invalid-texture-tier:${entry.key}:${family}`);
		}
	}
	if (plan.residentChunkCount !== plan.entries.length) reasons.push('resident-count-mismatch');
	return Object.freeze({ valid: reasons.length === 0, reasons });
}

export function compareResidencyPlans(a, b) {
	if (!a || !b) return Object.freeze({ same: false, reasons: ['missing-plan'] });
	const reasons = [];
	if (a.policyId !== b.policyId) reasons.push('policy-id');
	if (a.centerChunkX !== b.centerChunkX || a.centerChunkZ !== b.centerChunkZ) reasons.push('center');
	if (a.entries?.length !== b.entries?.length) reasons.push('entry-count');
	const count = Math.min(a.entries?.length ?? 0, b.entries?.length ?? 0);
	for (let index = 0; index < count; index += 1) {
		const left = a.entries[index];
		const right = b.entries[index];
		if (JSON.stringify(left) !== JSON.stringify(right)) reasons.push(`entry:${index}`);
	}
	return Object.freeze({ same: reasons.length === 0, reasons });
}

export function computeResidentAssetBudget(plan) {
	const result = {};
	if (!plan?.entries) return Object.freeze(result);
	for (const entry of plan.entries) {
		for (const [family, budget] of Object.entries(entry.assetBudgets ?? {})) {
			result[family] = (result[family] ?? 0) + (budget.maxAssets ?? 0);
		}
	}
	return Object.freeze(result);
}

export function resolveChunkMaterialDistancePreset({ band, quality = 'medium', mobile = false } = {}) {
	const normalizedQuality = normalizeQuality(quality);
	const q = qualityScale(normalizedQuality);
	const factors = getBandFactors(band, { mobile });
	const normalScale = clamp(0.28 + 0.72 * q.micro * factors.micro, 0.15, 1);
	const roughnessBias = clamp(0.02 + (1 - factors.texture) * 0.08 + (1 - q.texture) * 0.05, 0, 0.2);
	const exposureBias = clamp((1 - factors.texture) * -0.015, -0.05, 0);
	return Object.freeze({
		band,
		normalScale,
		roughnessBias: roughnessBias,
		exposureBias,
		receiveShadow: band !== ENVIRONMENT_RESIDENCY_BANDS.OUTER,
		castShadow: false,
	});
}

export function applyDistancePresetToMaterial(material, preset) {
	if (!material || typeof material !== 'object' || !preset) return false;
	if (material.userData) {
		if (!Number.isFinite(material.userData.environmentBaseRoughness) && Number.isFinite(material.roughness)) {
			material.userData.environmentBaseRoughness = material.roughness;
		}
		if (!Number.isFinite(material.userData.environmentBaseNormalScale) && material.normalScale?.x != null) {
			material.userData.environmentBaseNormalScale = material.normalScale.x;
		}
	}
	if (Number.isFinite(material.userData?.environmentBaseRoughness) && Number.isFinite(material.roughness)) {
		material.roughness = clamp(material.userData.environmentBaseRoughness + preset.troughnessBias, 0, 1);
	}
	if (material.normalScale?.set && Number.isFinite(material.userData?.environmentBaseNormalScale)) {
		material.normalScale.set(material.userData.environmentBaseNormalScale * preset.normalScale, material.userData.environmentBaseNormalScale * preset.normalScale);
	}
	return true;
}

export function applyResidencyToChunkMesh(mesh, entry, { quality = 'medium', mobile = false } = {}) {
	if (!mesh || !entry) return false;
	const preset = resolveChunkMaterialDistancePreset({ band: entry.band, quality, mobile });
	mesh.userData = mesh.userData ?? {};
	mesh.userData.environmentResidency = environmentChunkManifest(entry);
	mesh.userData.environmentResidencyPolicyId = WORLD_ENVIRONMENT_RESIDENCY_POLICY.id;
	mesh.userData.environmentResidencyBand = entry.band;
	mesh.userData.environmentResidencyDistanceMeters = entry.distanceMeters;
	mesh.receiveShadow = preset.receiveShadow;
	mesh.castShadow = preset.castShadow;
	if (Array.isArray(mesh.material)) {
		for (const material of mesh.material) applyDistancePresetToMaterial(material, preset);
	} else {
		applyDistancePresetToMaterial(mesh.material, preset);
	}
	return true;
}

export function residencyStats(plan) {
	if (!plan?.entries) return Object.freeze({});
	const stats = {
		near: 0,
		mid: 0,
		far: 0,
		outer: 0,
		maxAssets: 0,
	};
	for (const entry of plan.entries) {
		stats[entry.band] = (stats[entry.band] ?? 0) + 1;
		for (const budget of Object.values(entry.assetBudgets ?? {})) stats.maxAssets += budget.maxAssets ?? 0;
	}
	return Object.freeze(stats);
}

export function buildResidencyAuditSnapshot({ plan, frameId = 0, cameraWorld = null } = {}) {
	const validation = validateResidencyPlan(plan);
	return Object.freeze({
		policyId: WORLD_ENVIRONMENT_RESIDENCY_POLICY.id,
		frameId: asFiniteInteger(frameId, 0),
		cameraWorld: cameraWorld && Number.isFinite(cameraWorld.x) && Number.isFinite(cameraWorld.z)
			? Object.freeze({ x: cameraWorld.x, z: cameraWorld.z })
			: null,
		validation,
		stats: residencyStats(plan),
		residentAssetBudget: computeResidentAssetBudget(plan),
	});
}

export function expectedBandCounts(radiusChunks, chunkSizeMeters = 500, { mobile = false } = {}) {
	const radius = Math.max(0, asFiniteInteger(radiusChunks, 0));
	const result = Object.fromEntries(BAND_ORDER.map((band) => [band, 0]));
	for (let dz = -radius; dz <= radius; dz += 1) {
		for (let dx = -radius; dx <= radius; dx += 1) {
			const distance = Math.hypot(dx * chunkSizeMeters, dz * chunkSizeMeters);
			result[classifyEnvironmentBand(distance, { mobile })] += 1;
		}
	}
	return Object.freeze(result);
}

export function worldEnvironmentResidencyContract() {
	return Object.freeze({
		policy: WORLD_ENVIRONMENT_RESIDENCY_POLICY,
		bands: ENVIRONMENT_RESIDENCY_BANDS,
		visualTiers: ENVIRONMENT_VISUAL_TIERS,
		textureTiers: ENVIRONMENT_TEXTURE_TIERS,
		shadowModes: ENVIRONMENT_SHADOW_MODES,
		bandDistanceLimitsMeters: BAND_DISTANCE_LIMITS_METERS,
		mobileBandDistanceLimitsMeters: MOBILE_BAND_LIMITS_METERS,
		familyDefaults: FAMILY_DEFAULTS,
		functions: Object.freeze([
			'classifyEnvironmentBand',
			'planEnvironmentResidency',
			'resolveEnvironmentBudget',
			'buildAssetFidelityRequirements',
			'validateAssetFidelityMetadata',
			'applyResidencyToChunkMesh',
			'validateResidencyPlan',
		]),
	});
}

export const WORLD_ENVIRONMENT_RESIDENCY_CONTRACT = worldEnvironmentResidencyContract();
