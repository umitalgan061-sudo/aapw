/**
 * Biome-aware surface recipe helper for world assets.
 *
 * This is intentionally not a second material application engine. It creates semantic surface
 * descriptors that can be fed into the existing MaterialAssignmentCore and WorldAssetPlacementPipeline.
 * The goal is to stop one shared model from looking chemically identical in snow, desert, jungle,
 * coast, and volcanic regions while keeping model geometry and placement ownership untouched.
 *
 * The recipes are deliberately modest: base palette + roughness family + weathering + dirt/wetness/
 * snow response. Texture generation remains the responsibility of the established shared material
 * machinery. A model can therefore keep imported materials when a regional recipe is not appropriate.
 *
 * @module materials/biomeSurfaceFabric
 */

import { BIOME_ASSET_PROFILES } from '../world/biomeAssetDistribution.js';

const VERSION = '2026-09-07-v1';
const DEFAULT_TEXTURE_SIZE = 256;
const MIN_ROUGHNESS = 0.02;
const MAX_ROUGHNESS = 1;

function clamp01(value) {
	return Math.max(0, Math.min(1, Number(value) || 0));
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, Number(value) || 0));
}

function freezeObject(value) {
	return Object.freeze({ ...value });
}

function freezeArray(values) {
	return Object.freeze(values.map((value) => Object.freeze({ ...value })));
}

export const BIOME_SURFACE_FABRIC_POLICY = Object.freeze({
	id: `biome-surface-fabric-${VERSION}`,
	version: VERSION,
	textureSize: DEFAULT_TEXTURE_SIZE,
	deterministic: true,
	sharedMaterialCoreRequired: true,
	editorRuntimeAllowed: false,
	maxAdditionalTextureLayers: 4,
});

const FAMILY_BASES = Object.freeze({
	'snow-cold': Object.freeze({ baseColor: '#dce8ed', roughness: 0.88, normalStrength: 0.30, dirt: 0.04, wetness: 0.24, snow: 0.92 }),
	'heath-green': Object.freeze({ baseColor: '#66705c', roughness: 0.91, normalStrength: 0.34, dirt: 0.18, wetness: 0.26, snow: 0.18 }),
	'wet-marsh': Object.freeze({ baseColor: '#4d5e50', roughness: 0.95, normalStrength: 0.38, dirt: 0.28, wetness: 0.78, snow: 0.10 }),
	'mountain-heath': Object.freeze({ baseColor: '#65665d', roughness: 0.92, normalStrength: 0.42, dirt: 0.22, wetness: 0.28, snow: 0.28 }),
	'dry-heather': Object.freeze({ baseColor: '#776d49', roughness: 0.90, normalStrength: 0.34, dirt: 0.24, wetness: 0.10, snow: 0.05 }),
	'meadow-green': Object.freeze({ baseColor: '#71844c', roughness: 0.84, normalStrength: 0.28, dirt: 0.14, wetness: 0.34, snow: 0.02 }),
	'warm-sand': Object.freeze({ baseColor: '#c5ae7c', roughness: 0.94, normalStrength: 0.22, dirt: 0.12, wetness: 0.05, snow: 0 }),
	'dry-gold': Object.freeze({ baseColor: '#ad934f', roughness: 0.93, normalStrength: 0.24, dirt: 0.14, wetness: 0.06, snow: 0 }),
	'red-sand': Object.freeze({ baseColor: '#a96d46', roughness: 0.94, normalStrength: 0.25, dirt: 0.12, wetness: 0.06, snow: 0 }),
	'salt-green': Object.freeze({ baseColor: '#71817c', roughness: 0.88, normalStrength: 0.30, dirt: 0.20, wetness: 0.62, snow: 0.05 }),
	'neutral-meadow': Object.freeze({ baseColor: '#7b8354', roughness: 0.87, normalStrength: 0.30, dirt: 0.15, wetness: 0.25, snow: 0.04 }),
	'humid-green': Object.freeze({ baseColor: '#385c3a', roughness: 0.90, normalStrength: 0.40, dirt: 0.22, wetness: 0.86, snow: 0 }),
	'dry-ochre': Object.freeze({ baseColor: '#9e7546', roughness: 0.93, normalStrength: 0.28, dirt: 0.16, wetness: 0.05, snow: 0 }),
	'ash-black': Object.freeze({ baseColor: '#3f403d', roughness: 0.91, normalStrength: 0.44, dirt: 0.32, wetness: 0.22, snow: 0 }),
	'desert-ochre': Object.freeze({ baseColor: '#8c684b', roughness: 0.92, normalStrength: 0.34, dirt: 0.18, wetness: 0.04, snow: 0 }),
	'iron-earth': Object.freeze({ baseColor: '#765442', roughness: 0.90, normalStrength: 0.43, dirt: 0.26, wetness: 0.08, snow: 0 }),
	'basalt-wet': Object.freeze({ baseColor: '#4c4c49', roughness: 0.78, normalStrength: 0.48, dirt: 0.22, wetness: 0.62, snow: 0.02 }),
	'granite-shadow': Object.freeze({ baseColor: '#747872', roughness: 0.83, normalStrength: 0.46, dirt: 0.20, wetness: 0.32, snow: 0.16 }),
	'granite-sunlit': Object.freeze({ baseColor: '#847e73', roughness: 0.81, normalStrength: 0.44, dirt: 0.18, wetness: 0.22, snow: 0.12 }),
	'coastal-grey': Object.freeze({ baseColor: '#7d8582', roughness: 0.86, normalStrength: 0.39, dirt: 0.21, wetness: 0.68, snow: 0.05 }),
	'sun-baked': Object.freeze({ baseColor: '#876e50', roughness: 0.91, normalStrength: 0.38, dirt: 0.21, wetness: 0.04, snow: 0 }),
	'weathered-oak': Object.freeze({ baseColor: '#6d4f35', roughness: 0.88, normalStrength: 0.34, dirt: 0.18, wetness: 0.22, snow: 0.03 }),
	'aged-pine': Object.freeze({ baseColor: '#654a36', roughness: 0.91, normalStrength: 0.35, dirt: 0.24, wetness: 0.30, snow: 0.22 }),
	'mountain-pine': Object.freeze({ baseColor: '#51412f', roughness: 0.92, normalStrength: 0.38, dirt: 0.24, wetness: 0.22, snow: 0.14 }),
	'green-oak': Object.freeze({ baseColor: '#654832', roughness: 0.88, normalStrength: 0.32, dirt: 0.16, wetness: 0.30, snow: 0.03 }),
	'weathered-raw': Object.freeze({ baseColor: '#765b42', roughness: 0.94, normalStrength: 0.28, dirt: 0.30, wetness: 0.12, snow: 0 }),
	'sun-bleached': Object.freeze({ baseColor: '#8b765e', roughness: 0.92, normalStrength: 0.30, dirt: 0.26, wetness: 0.04, snow: 0 }),
	'salt-weathered': Object.freeze({ baseColor: '#756d5c', roughness: 0.90, normalStrength: 0.32, dirt: 0.24, wetness: 0.58, snow: 0.04 }),
	'mixed-hardwood': Object.freeze({ baseColor: '#604732', roughness: 0.89, normalStrength: 0.33, dirt: 0.18, wetness: 0.26, snow: 0.04 }),
	'rain-darkened': Object.freeze({ baseColor: '#4e493d', roughness: 0.91, normalStrength: 0.41, dirt: 0.27, wetness: 0.84, snow: 0 }),
	'charred-timber': Object.freeze({ baseColor: '#2f2d29', roughness: 0.95, normalStrength: 0.45, dirt: 0.45, wetness: 0.16, snow: 0 }),
	'dark-forged-iron': Object.freeze({ baseColor: '#313230', roughness: 0.56, normalStrength: 0.30, dirt: 0.12, wetness: 0.18, snow: 0.02 }),
	'oxidized-copper': Object.freeze({ baseColor: '#665b49', roughness: 0.65, normalStrength: 0.26, dirt: 0.16, wetness: 0.26, snow: 0 }),
	'patina-bronze': Object.freeze({ baseColor: '#56675c', roughness: 0.62, normalStrength: 0.28, dirt: 0.15, wetness: 0.38, snow: 0 }),
	'clean-iron': Object.freeze({ baseColor: '#454846', roughness: 0.60, normalStrength: 0.26, dirt: 0.08, wetness: 0.18, snow: 0 }),
	'dark-iron': Object.freeze({ baseColor: '#373a39', roughness: 0.66, normalStrength: 0.28, dirt: 0.18, wetness: 0.26, snow: 0.02 }),
	'aged-iron': Object.freeze({ baseColor: '#5a554c', roughness: 0.73, normalStrength: 0.31, dirt: 0.20, wetness: 0.30, snow: 0.06 }),
	'rusted-iron': Object.freeze({ baseColor: '#6a5144', roughness: 0.79, normalStrength: 0.36, dirt: 0.24, wetness: 0.44, snow: 0.02 }),
});

const REGION_WEATHER = Object.freeze({
	snow: Object.freeze({ wind: 0.78, rain: 0.16, frost: 0.94, dust: 0.02 }),
	coldGrassland: Object.freeze({ wind: 0.62, rain: 0.36, frost: 0.55, dust: 0.05 }),
	marsh: Object.freeze({ wind: 0.38, rain: 0.82, frost: 0.16, dust: 0.03 }),
	mountain: Object.freeze({ wind: 0.86, rain: 0.44, frost: 0.42, dust: 0.04 }),
	rockyHills: Object.freeze({ wind: 0.46, rain: 0.45, frost: 0.12, dust: 0.10 }),
	lush: Object.freeze({ wind: 0.28, rain: 0.74, frost: 0.05, dust: 0.04 }),
	desert: Object.freeze({ wind: 0.72, rain: 0.06, frost: 0.01, dust: 0.72 }),
	steppe: Object.freeze({ wind: 0.80, rain: 0.18, frost: 0.16, dust: 0.46 }),
	arid: Object.freeze({ wind: 0.84, rain: 0.04, frost: 0.01, dust: 0.88 }),
	coast: Object.freeze({ wind: 0.74, rain: 0.70, frost: 0.06, dust: 0.08 }),
	temperate: Object.freeze({ wind: 0.38, rain: 0.55, frost: 0.08, dust: 0.06 }),
	jungle: Object.freeze({ wind: 0.22, rain: 0.94, frost: 0, dust: 0.02 }),
	aridSteppe: Object.freeze({ wind: 0.78, rain: 0.12, frost: 0.06, dust: 0.66 }),
	valyria: Object.freeze({ wind: 0.92, rain: 0.22, frost: 0, dust: 0.62 }),
});

const REGION_PROFILE_MAP = Object.freeze({
	snow: 'snow',
	coldGrassland: 'coldGrassland',
	marsh: 'marsh',
	mountain: 'mountain',
	rockyHills: 'rockyHills',
	lush: 'lush',
	desert: 'desert',
	steppe: 'steppe',
	arid: 'arid',
	coast: 'coast',
	temperate: 'temperate',
	jungle: 'jungle',
	aridSteppe: 'aridSteppe',
	valyria: 'valyria',
});

function normalizeProfileId(profileId) {
	if (BIOME_ASSET_PROFILES[profileId]) return profileId;
	return REGION_PROFILE_MAP[profileId] || 'temperate';
}

function baseForSignal(signal, fallback) {
	return FAMILY_BASES[signal] || FAMILY_BASES[fallback] || FAMILY_BASES['neutral-meadow'];
}

function surfaceRecipe(profileId, role, signal, options = {}) {
	const normalizedProfile = normalizeProfileId(profileId);
	const profileData = BIOME_ASSET_PROFILES[normalizedProfile] || BIOME_ASSET_PROFILES.temperate;
	const weather = REGION_WEATHER[normalizedProfile] || REGION_WEATHER.temperate;
	const selectedSignal = signal || profileData.materialSignals.ground;
	const base = baseForSignal(selectedSignal, profileData.materialSignals.ground);
	const roleText = String(role || 'ground').toLowerCase();
	const roleMultiplier = roleText.includes('metal') ? 0.74 : roleText.includes('wood') || roleText.includes('timber') ? 0.90 : roleText.includes('roof') ? 0.98 : 1;
	const slope = clamp01(options.slopeDegrees / 45);
	const wetnessBoost = clamp01((options.waterDistanceMeters !== undefined && options.waterDistanceMeters < 20) ? (1 - options.waterDistanceMeters / 20) : 0);
	const exposure = clamp01((options.windExposure ?? weather.wind) * 0.72 + slope * 0.28);
	const dirt = clamp01(base.dirt + exposure * 0.11 + weather.dust * 0.18);
	const wetness = clamp01(base.wetness + weather.rain * 0.10 + wetnessBoost * 0.24);
	const snow = clamp01(base.snow + weather.frost * 0.10 - slope * 0.10);
	const roughness = clamp(clamp(base.roughness + (wetness - 0.4) * 0.08 + exposure * 0.03, MIN_ROUGHNESS, MAX_ROUGHNESS) * roleMultiplier, 0.18, 0.98);
	return Object.freeze({
		profileId: normalizedProfile,
		role: roleText,
		signal: selectedSignal,
		baseColor: base.baseColor,
		textureSize: Number.isInteger(options.textureSize) ? options.textureSize : DEFAULT_TEXTURE_SIZE,
		roughness: Number(roughness.toFixed(4)),
		normalStrength: Number((base.normalStrength * (0.90 + exposure * 0.20)).toFixed(4)),
		dirtAmount: Number(dirt.toFixed(4)),
		wetnessAmount: Number(wetness.toFixed(4)),
		snowAmount: Number(snow.toFixed(4)),
		weathering: Object.freeze({
			wind: weather.wind,
			rain: weather.rain,
			frost: weather.frost,
			dust: weather.dust,
			exposure: Number(exposure.toFixed(4)),
		}),
		generatedLayers: Object.freeze([
			'diffuse-macro',
			'diffuse-meso',
			'normal-micro',
			'roughness-variation',
		].slice(0, BIOME_SURFACE_FABRIC_POLICY.maxAdditionalTextureLayers)),
	});
}

export function resolveBiomeSurfaceFabric(profileId, role = 'ground', options = {}) {
	const normalizedProfile = normalizeProfileId(profileId);
	const profileData = BIOME_ASSET_PROFILES[normalizedProfile] || BIOME_ASSET_PROFILES.temperate;
	let signal = profileData.materialSignals.ground;
	const roleText = String(role).toLowerCase();
	if (roleText.includes('rock') || roleText.includes('stone')) signal = profileData.materialSignals.rock;
	else if (roleText.includes('metal') || roleText.includes('iron') || roleText.includes('copper') || roleText.includes('bronze')) signal = profileData.materialSignals.metal;
	else if (roleText.includes('wood') || roleText.includes('timber') || roleText.includes('plank')) signal = profileData.materialSignals.wood;
	else if (roleText.includes('ground') || roleText.includes('floor')) signal = profileData.materialSignals.ground;
	return surfaceRecipe(normalizedProfile, roleText, signal, options);
}

export function resolveAssetFamilySurfaceFabric(profileId, family, options = {}) {
	const profileData = BIOME_ASSET_PROFILES[normalizeProfileId(profileId)] || BIOME_ASSET_PROFILES.temperate;
	const familyText = String(family || '').toLowerCase();
	let role = 'ground';
	if (familyText.includes('tree') || familyText.includes('wood') || familyText.includes('shrub') || familyText.includes('broadleaf') || familyText.includes('palm') || familyText.includes('reed') || familyText.includes('fern')) role = 'wood';
	else if (familyText.includes('rock') || familyText.includes('boulder') || familyText.includes('stone') || familyText.includes('outcrop') || familyText.includes('talus') || familyText.includes('rubble') || familyText.includes('scree')) role = 'rock';
	else if (familyText.includes('grass') || familyText.includes('heather') || familyText.includes('sand') || familyText.includes('scrub') || familyText.includes('shrub')) role = 'ground';
	const recipe = resolveBiomeSurfaceFabric(normalizeProfileId(profileId), role, options);
	return Object.freeze({ ...recipe, assetFamily: family, semanticRole: role, profileMaterialSignal: profileData.materialSignals[role === 'rock' ? 'rock' : role === 'wood' ? 'wood' : 'ground'] });
}

export function resolveAssetWeathering(profileId, family, options = {}) {
	const recipe = resolveAssetFamilySurfaceFabric(profileId, family, options);
	return Object.freeze({
		profileId: recipe.profileId,
		family,
		wind: recipe.weathering.wind,
		rain: recipe.weathering.rain,
		frost: recipe.weathering.frost,
		dust: recipe.weathering.dust,
		wetness: recipe.wetnessAmount,
		snow: recipe.snowAmount,
		dirt: recipe.dirtAmount,
	});
}

export function buildSharedMaterialSemanticManifest({ assetId, assetFamily, profileId, surfaces = [], options = {} } = {}) {
	const manifestSurfaces = (Array.isArray(surfaces) ? surfaces : ['ground']).map((surface) => resolveBiomeSurfaceFabric(profileId, surface, options));
	return Object.freeze({
		version: VERSION,
		policyId: BIOME_SURFACE_FABRIC_POLICY.id,
		assetId: String(assetId || ''),
		assetFamily: String(assetFamily || ''),
		profileId: normalizeProfileId(profileId),
		textureSize: Number.isInteger(options.textureSize) ? options.textureSize : DEFAULT_TEXTURE_SIZE,
		sharedMaterialCoreRequired: true,
		editorRuntimeImportAllowed: false,
		surfaces: Object.freeze(manifestSurfaces),
	});
}

export function validateBiomeSurfaceFabric(recipe) {
	const errors = [];
	if (!recipe || typeof recipe !== 'object') errors.push('recipe-missing');
	if (recipe && recipe.policyId !== BIOME_SURFACE_FABRIC_POLICY.id) errors.push('policy-id-mismatch');
	if (recipe && (!Number.isInteger(recipe.textureSize) || recipe.textureSize < 64 || recipe.textureSize > 4096)) errors.push('texture-size-invalid');
	if (recipe && (!Number.isFinite(recipe.roughness) || recipe.roughness < MIN_ROUGHNESS || recipe.roughness > MAX_ROUGHNESS)) errors.push('roughness-invalid');
	if (recipe && (!Number.isFinite(recipe.normalStrength) || recipe.normalStrength < 0 || recipe.normalStrength > 2)) errors.push('normal-strength-invalid');
	if (recipe && (!Number.isFinite(recipe.dirtAmount) || recipe.dirtAmount < 0 || recipe.dirtAmount > 1)) errors.push('dirt-invalid');
	if (recipe && (!Number.isFinite(recipe.wetnessAmount) || recipe.wetnessAmount < 0 || recipe.wetnessAmount > 1)) errors.push('wetness-invalid');
	if (recipe && (!Number.isFinite(recipe.snowAmount) || recipe.snowAmount < 0 || recipe.snowAmount > 1)) errors.push('snow-invalid');
	return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function compareBiomeSurfaceRecipes(leftProfileId, rightProfileId, role = 'ground', options = {}) {
	const left = resolveBiomeSurfaceFabric(leftProfileId, role, options);
	const right = resolveBiomeSurfaceFabric(rightProfileId, role, options);
	return Object.freeze({
		left,
		right,
		baseColorChanged: left.baseColor !== right.baseColor,
		roughnessDelta: Number((right.roughness - left.roughness).toFixed(4)),
		wetnessDelta: Number((right.wetnessAmount - left.wetnessAmount).toFixed(4)),
		snowDelta: Number((right.snowAmount - left.snowAmount).toFixed(4)),
		dirtDelta: Number((right.dirtAmount - left.dirtAmount).toFixed(4)),
	});
}

export function surfaceFabricDigest(recipe) {
	const value = [
		recipe?.policyId,
		recipe?.profileId,
		recipe?.role,
		recipe?.signal,
		recipe?.baseColor,
		recipe?.roughness,
		recipe?.normalStrength,
		recipe?.dirtAmount,
		recipe?.wetnessAmount,
		recipe?.snowAmount,
	].join('|');
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export function resolveSurfaceForSlopeAndWater(profileId, role, { slopeDegrees = 0, waterDistanceMeters = Infinity, textureSize = DEFAULT_TEXTURE_SIZE } = {}) {
	return resolveBiomeSurfaceFabric(profileId, role, { slopeDegrees, waterDistanceMeters, textureSize });
}

export function listSurfaceSignalFamilies() {
	return Object.freeze(Object.keys(FAMILY_BASES).sort());
}

export function auditBiomeSurfaceFabricCatalog() {
	const errors = [];
	for (const profileId of Object.keys(BIOME_ASSET_PROFILES)) {
		const profileData = BIOME_ASSET_PROFILES[profileId];
		for (const role of ['ground', 'rock', 'wood', 'metal']) {
			const recipe = resolveBiomeSurfaceFabric(profileId, role);
			const validation = validateBiomeSurfaceFabric(recipe);
			if (!validation.ok) errors.push(...validation.errors.map((error) => `${profileId}:${role}:${error}`));
			if (!recipe.baseColor) errors.push(`${profileId}:${role}:missing-color`);
		}
	}
	return Object.freeze({
		ok: errors.length === 0,
		errors: Object.freeze(errors),
		profilesChecked: Object.keys(BIOME_ASSET_PROFILES).length,
		surfaceSignals: listSurfaceSignalFamilies().length,
	});
}
