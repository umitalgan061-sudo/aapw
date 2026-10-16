/**
 * Deterministic render-only terrain surface breakup for full-world and near-ground readability.
 *
 * This module is intentionally a decision layer: it never edits canonical height, hydrology,
 * coastline, collider, road, settlement or biome authority. Callers supply already-resolved
 * geography and material context and receive bounded anti-tiling weights for their existing shader
 * or material path.
 * @module world/terrainSurfaceAntiTiling
 */

const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const saturate = clamp01;
const lerp = (a, b, t) => a + (b - a) * t;

export const TERRAIN_SURFACE_ANTI_TILING_POLICY = Object.freeze({
	id: 'terrain-surface-anti-tiling-2026-09-07-v1',
	renderOnly: true,
	canonicalHeightUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalColliderUnchanged: true,
	neverUniformGrid: true,
	worldSpaceOnly: true,
	macroMeters: Object.freeze([420, 890, 1730]),
	mesoMeters: Object.freeze([37, 83, 151]),
	microMeters: Object.freeze([2.4, 5.7, 11.3]),
	maxAlbedoGain: 0.13,
	maxRoughnessGain: 0.18,
	maxNormalGain: 0.21,
	coastFeatherMeters: 34,
	waterHaloSuppressionMeters: 21,
	farFadeStartMeters: 900,
	farFadeFullMeters: 4200,
});

function safeMeters(value, fallback = 0) {
	return Number.isFinite(value) ? value : fallback;
}

function hash2(x, z, seed = 0) {
	const n = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453123;
	return n - Math.floor(n);
}

function valueNoise(x, z, seed = 0) {
	const ix = Math.floor(x);
	const iz = Math.floor(z);
	const fx = x - ix;
	const fz = z - iz;
	const sx = fx * fx * (3 - 2 * fx);
	const sz = fz * fz * (3 - 2 * fz);
	const a = hash2(ix, iz, seed);
	const b = hash2(ix + 1, iz, seed);
	const c = hash2(ix, iz + 1, seed);
	const d = hash2(ix + 1, iz + 1, seed);
	return lerp(lerp(a, b, sx), lerp(c, d, sx), sz) * 2 - 1;
}

function fbm(worldX, worldZ, wavelengths, seed = 0) {
	let value = 0;
	let amplitude = 0;
	for (let index = 0; index < wavelengths.length; index += 1) {
		const wavelength = wavelengths[index];
		value += valueNoise(worldX / wavelength, worldZ / wavelength, seed + index * 17.31) / (index + 1);
		amplitude += 1 / (index + 1);
	}
	return amplitude > 0 ? value / amplitude : 0;
}

function smoothBand(value, start, end) {
	if (end <= start) return value >= end ? 1 : 0;
	const t = saturate((value - start) / (end - start));
	return t * t * (3 - 2 * t);
}

function edgeDamp(distanceMeters, featherMeters) {
	return smoothBand(Math.abs(safeMeters(distanceMeters)), 0, featherMeters);
}

function materialContextScore(context) {
	const slope = smoothBand(safeMeters(context.slopeDegrees), 8, 38);
	const elevation = smoothBand(safeMeters(context.elevationMeters), 20, 340);
	const moisture = saturate(context.moisture);
	const rock = saturate(context.rockWeight);
	const snow = saturate(context.snowWeight);
	const shoreline = 1 - edgeDamp(context.waterDistanceMeters, TERRAIN_SURFACE_ANTI_TILING_POLICY.coastFeatherMeters);
	return Object.freeze({
		slope,
		elevation,
		moisture,
		rock,
		snow,
		shoreline,
		land: 1 - saturate(context.waterWeight),
	});
}

export function terrainSurfaceAntiTilingAt(worldX, worldZ, context = {}) {
	const x = safeMeters(worldX);
	const z = safeMeters(worldZ);
	const geography = materialContextScore(context);
	const macro = fbm(x, z, TERRAIN_SURFACE_ANTI_TILING_POLICY.macroMeters, safeMeters(context.seed, 17));
	const meso = fbm(x + 173.2, z - 97.6, TERRAIN_SURFACE_ANTI_TILING_POLICY.mesoMeters, safeMeters(context.seed, 31));
	const micro = fbm(x - 13.7, z + 41.9, TERRAIN_SURFACE_ANTI_TILING_POLICY.microMeters, safeMeters(context.seed, 53));
	const strata = 0.5 + 0.5 * Math.sin((x * 0.0017) + (z * -0.0011) + macro * 2.2);
	const breakup = saturate(0.50 + macro * 0.22 + meso * 0.18 + micro * 0.10 + (strata - 0.5) * 0.14);
	const landWeight = geography.land;
	const shoreSuppression = 1 - geography.shoreline * smoothBand(safeMeters(context.waterDistanceMeters), 0, TERRAIN_SURFACE_ANTI_TILING_POLICY.waterHaloSuppressionMeters);
	const rockBias = saturate(geography.rock * 0.75 + geography.slope * 0.35 + geography.elevation * 0.18);
	const snowBias = saturate(geography.snow * 0.82 + geography.elevation * 0.20 - geography.slope * 0.20);
	const wetBias = saturate(geography.moisture * 0.72 + geography.shoreline * 0.28);
	const antiTile = saturate(breakup * landWeight * shoreSuppression);
	const distance = Math.hypot(x, z);
	const farFade = 1 - smoothBand(distance, TERRAIN_SURFACE_ANTI_TILING_POLICY.farFadeStartMeters, TERRAIN_SURFACE_ANTI_TILING_POLICY.farFadeFullMeters);
	return Object.freeze({
		macro,
		meso,
		micro,
		strata,
		breakup,
		antiTile,
		farFade,
		albedoVariation: antiTile * TERRAIN_SURFACE_ANTI_TILING_POLICY.maxAlbedoGain,
		roughnessVariation: saturate((antiTile * 0.70 + wetBias * 0.22 + rockBias * 0.18) * TERRAIN_SURFACE_ANTI_TILING_POLICY.maxRoughnessGain),
		normalVariation: saturate((antiTile * 0.62 + rockBias * 0.28 + snowBias * 0.10) * TERRAIN_SURFACE_ANTI_TILING_POLICY.maxNormalGain),
		soilWeight: saturate((1 - rockBias) * (1 - snowBias) * (0.65 + wetBias * 0.35)),
		rockWeight: rockBias,
		snowWeight: snowBias,
		wetWeight: wetBias,
		worldSpace: true,
		canonicalContextPreserved: true,
	});
}

export function buildTerrainSurfaceMaterialInputs(worldX, worldZ, context = {}) {
	const response = terrainSurfaceAntiTilingAt(worldX, worldZ, context);
	return Object.freeze({
		colorGain: response.albedoVariation * response.farFade,
		roughnessGain: response.roughnessVariation * response.farFade,
		normalGain: response.normalVariation * response.farFade,
		soilWeight: response.soilWeight,
		rockWeight: response.rockWeight,
		snowWeight: response.snowWeight,
		wetWeight: response.wetWeight,
		macroSignal: response.macro,
		mesoSignal: response.meso,
		microSignal: response.micro,
	});
}

export function terrainSurfaceAntiTilingFingerprint(worldX, worldZ, context = {}) {
	const input = buildTerrainSurfaceMaterialInputs(worldX, worldZ, context);
	return [
		input.colorGain,
		input.roughnessGain,
		input.normalGain,
		input.soilWeight,
		input.rockWeight,
		input.snowWeight,
		input.wetWeight,
	].map((value) => value.toFixed(6)).join('|');
}

export function validateTerrainSurfaceAntiTilingResponse(response) {
	const errors = [];
	for (const key of ['antiTile', 'farFade', 'colorGain', 'roughnessGain', 'normalGain', 'soilWeight', 'rockWeight', 'snowWeight', 'wetWeight']) {
		if (!Number.isFinite(response?.[key])) errors.push(`${key}:non-finite`);
	}
	if (response?.canonicalContextPreserved !== true) errors.push('canonical-context-not-preserved');
	if (response?.worldSpace !== true) errors.push('world-space-not-declared');
	if (response?.colorGain > TERRAIN_SURFACE_ANTI_TILING_POLICY.maxAlbedoGain + 1e-9) errors.push('color-gain-over-cap');
	if (response?.roughnessVariation > TERRAIN_SURFACE_ANTI_TILING_POLICY.maxRoughnessGain + 1e-9) errors.push('roughness-gain-over-cap');
	if (response?.normalVariation > TERRAIN_SURFACE_ANTI_TILING_POLICY.maxNormalGain + 1e-9) errors.push('normal-gain-over-cap');
	return Object.freeze({ ok: errors.length === 0, errors });
}

export const TERRAIN_SURFACE_ANTI_TILING_MANIFEST = Object.freeze({
	policyId: TERRAIN_SURFACE_ANTI_TILING_POLICY.id,
	authority: 'src/3d/world/terrain.js + src/3d/world/terrainBiomeShading.js',
	inputs: Object.freeze(['worldX', 'worldZ', 'elevationMeters', 'slopeDegrees', 'moisture', 'rockWeight', 'snowWeight', 'waterWeight', 'waterDistanceMeters']),
	outputs: Object.freeze(['colorGain', 'roughnessGain', 'normalGain', 'soilWeight', 'rockWeight', 'snowWeight', 'wetWeight']),
	forbidden: Object.freeze(['heightMutation', 'hydrologyMutation', 'colliderMutation', 'uniform-grid-instantiation', 'placeholder-geometry']),
});
