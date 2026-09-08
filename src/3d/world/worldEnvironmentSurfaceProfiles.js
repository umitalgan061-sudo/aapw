/**
 * Environment surface response profiles.
 *
 * These profiles describe how an already-authoritative asset/material should respond to the local
 * surface context. They do not manufacture geography, classify map cells, choose settlements, or
 * replace the shared MaterialAssignmentCore. The purpose is to prevent the old one-color environment
 * failure where rock, vegetation, wet shore and snow all inherited the same generic response.
 *
 * The values are intentionally expressed as ranges and normalized response curves. A caller can map
 * them onto an imported material without changing the source asset or inventing a new texture.
 * Runtime placement remains owned by WorldAssetPlacementPipeline; this module only supplies the
 * surface-facing visual contract used by that placement result.
 *
 * @module world/worldEnvironmentSurfaceProfiles
 */

export const ENVIRONMENT_SURFACE_PROFILE_POLICY = Object.freeze({
	id: 'environment-surface-response-profiles-2026-09-07-v1',
	assetTextureAuthority: 'shared-material-assignment-core',
	placementAuthority: 'world-asset-placement-pipeline',
	geographyAuthority: 'caller-supplied-canonical-surface-context',
	inventNewGeography: false,
	inventNewAssets: false,
	allowSourceMaterialPreservation: true,
});

export const SURFACE_RESPONSE_CLASSES = Object.freeze({
	GRASS: 'grass',
	SOIL: 'soil',
	MUD: 'mud',
	ROCK: 'rock',
	SCREE: 'scree',
	SNOW: 'snow',
	WET: 'wet',
	BARK: 'bark',
	LEAVES: 'leaves',
	WALL: 'wall',
	ROOF: 'roof',
	METAL: 'metal',
	WATERLINE: 'waterline',
});

const freezeDeep = (value) => {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) freezeDeep(child);
	return Object.freeze(value);
};

const PROFILE_DATA = {
	grass: {
	label: 'grass-covered ground',
	albedo: { luminanceMin: 0.08, luminanceMax: 0.46, saturationMin: 0.16, saturationMax: 0.58 },
	roughness: { min: 0.68, max: 0.94, wetMin: 0.56, wetMax: 0.82 },
	normal: { amplitudeMin: 0.18, amplitudeMax: 0.46, macroMetersMin: 2.5, macroMetersMax: 18, microMetersMin: 0.08, microMetersMax: 0.5 },
	moistureResponse: { dryDarken: -0.03, wetDarken: -0.13, wetRoughnessDelta: -0.16, wetSpecularDelta: 0.03 },
	slopeResponse: { maxPreferredDegrees: 38, fadeStartDegrees: 22, rockBlendStartDegrees: 28, snowBlendStartDegrees: 42 },
	heightResponse: { lowlandBias: 1.08, uplandBias: 0.92, treelineFadeStartMeters: 640, treelineFadeEndMeters: 1180 },
	macroPattern: { scaleMeters: 45, contrast: 0.18, breakupOctaves: 3, triplanar: true },
	microPattern: { scaleMeters: 0.75, contrast: 0.09, breakupOctaves: 2, antiTilingRotation: true },
	vegetationCompanion: { shrub: 0.85, tree: 0.7, grass: 1.0, rock: 0.12 },
	grounding: { sinkToleranceMeters: 0.02, floatToleranceMeters: 0.08, slopeNormalBias: 0.2 },
	textureChannels: { albedo: true, normal: true, roughness: true, ao: true },
	fallback: { permitVertexColor: true, permitProceduralMicro: true },
},
	soil: {
		label: 'dry exposed soil',
		albedo: { luminanceMin: 0.06, luminanceMax: 0.32, saturationMin: 0.08, saturationMax: 0.42 },
		roughness: { min: 0.62, max: 0.9, wetMin: 0.48, wetMax: 0.76 },
		normal: { amplitudeMin: 0.22, amplitudeMax: 0.52, macroMetersMin: 2, macroMetersMax: 20, microMetersMin: 0.05, microMetersMax: 0.42 },
		moistureResponse: { dryDarken: 0.0, wetDarken: -0.16, wetRoughnessDelta: -0.24, wetSpecularDelta: 0.05 },
		slopeResponse: { maxPreferredDegrees: 52, fadeStartDegrees: 34, rockBlendStartDegrees: 44, snowBlendStartDegrees: 58 },
		heightResponse: { lowlandBias: 0.98, uplandBias: 1.02, treelineFadeStartMeters: 800, treelineFadeEndMeters: 1350 },
		macroPattern: { scaleMeters: 55, contrast: 0.24, breakupOctaves: 4, triplanar: true },
		microPattern: { scaleMeters: 0.58, contrast: 0.11, breakupOctaves: 3, antiTilingRotation: true },
		vegetationCompanion: { shrub: 0.38, tree: 0.28, grass: 0.4, rock: 0.45 },
		grounding: { sinkToleranceMeters: 0.015, floatToleranceMeters: 0.06, slopeNormalBias: 0.3 },
		textureChannels: { albedo: true, normal: true, roughness: true, ao: true },
		fallback: { permitVertexColor: true, permitProceduralMicro: true },
	},
	mud: {
		label: 'moist mud and churned ground',
		albedo: { luminanceMin: 0.035, luminanceMax: 0.23, saturationMin: 0.05, saturationMax: 0.34 },
		roughness: { min: 0.34, max: 0.74, wetMin: 0.18, wetMax: 0.54 },
		normal: { amplitudeMin: 0.12, amplitudeMax: 0.42, macroMetersMin: 1.2, macroMetersMax: 12, microMetersMin: 0.03, microMetersMax: 0.35 },
		moistureResponse: { dryDarken: -0.02, wetDarken: -0.11, wetRoughnessDelta: -0.24, wetSpecularDelta: 0.08 },
		slopeResponse: { maxPreferredDegrees: 30, fadeStartDegrees: 18, rockBlendStartDegrees: 26, snowBlendStartDegrees: 40 },
		heightResponse: { lowlandBias: 1.18, uplandBias: 0.72, treelineFadeStartMeters: 500, treelineFadeEndMeters: 850 },
		macroPattern: { scaleMeters: 26, contrast: 0.26, breakupOctaves: 4, triplanar: true },
		microPattern: { scaleMeters: 0.34, contrast: 0.14, breakupOctaves: 3, antiTilingRotation: true },
		vegetationCompanion: { shrub: 0.5, tree: 0.22, grass: 0.55, rock: 0.18 },
		grounding: { sinkToleranceMeters: 0.01, floatToleranceMeters: 0.045, slopeNormalBias: 0.38 },
		textureChannels: { albedo: true, normal: true, roughness: true, ao: true },
		fallback: { permitVertexColor: true, permitProceduralMicro: true },
	},
	rock: {
		label: 'exposed bedrock and large rock',
		albedo: { luminanceMin: 0.07, luminanceMax: 0.5, saturationMin: 0.02, saturationMax: 0.28 },
		roughness: { min: 0.58, max: 0.92, wetMin: 0.36, wetMax: 0.7 },
		normal: { amplitudeMin: 0.42, amplitudeMax: 0.88, macroMetersMin: 0.8, macroMetersMax: 12, microMetersMin: 0.03, microMetersMax: 0.28 },
		moistureResponse: { dryDarken: 0.02, wetDarken: -0.09, wetRoughnessDelta: -0.2, wetSpecularDelta: 0.06 },
		slopeResponse: { maxPreferredDegrees: 90, fadeStartDegrees: 12, rockBlendStartDegrees: 18, snowBlendStartDegrees: 66 },
		heightResponse: { lowlandBias: 0.86, uplandBias: 1.2, treelineFadeStartMeters: 520, treelineFadeEndMeters: 1400 },
		macroPattern: { scaleMeters: 18, contrast: 0.32, breakupOctaves: 5, triplanar: true },
		microPattern: { scaleMeters: 0.24, contrast: 0.17, breakupOctaves: 3, antiTilingRotation: true },
		vegetationCompanion: { shrub: 0.08, tree: 0.03, grass: 0.16, rock: 1.0 },
		grounding: { sinkToleranceMeters: 0.02, floatToleranceMeters: 0.04, slopeNormalBias: 0.52 },
		textureChannels: { albedo: true, normal: true, roughness: true, ao: true },
		fallback: { permitVertexColor: true, permitProceduralMicro: true },
	},
	scree: {
		label: 'talus and scree field',
		albedo: { luminanceMin: 0.055, luminanceMax: 0.38, saturationMin: 0.015, saturationMax: 0.26 },
		roughness: { min: 0.62, max: 0.96, wetMin: 0.48, wetMax: 0.82 },
		normal: { amplitudeMin: 0.48, amplitudeMax: 0.92, macroMetersMin: 0.32, macroMetersMax: 5.5, microMetersMin: 0.025, microMetersMax: 0.22 },
		moistureResponse: { dryDarken: 0.01, wetDarken: -0.07, wetRoughnessDelta: -0.14, wetSpecularDelta: 0.025 },
		slopeResponse: { maxPreferredDegrees: 62, fadeStartDegrees: 26, rockBlendStartDegrees: 38, snowBlendStartDegrees: 62 },
		heightResponse: { lowlandBias: 0.74, uplandBias: 1.24, treelineFadeStartMeters: 420, treelineFadeEndMeters: 1120 },
		macroPattern: { scaleMeters: 10, contrast: 0.34, breakupOctaves: 4, triplanar: true },
		microPattern: { scaleMeters: 0.18, contrast: 0.2, breakupOctaves: 3, antiTilingRotation: true },
		vegetationCompanion: { shrub: 0.12, tree: 0.02, grass: 0.08, rock: 0.92 },
		grounding: { sinkToleranceMeters: 0.025, floatToleranceMeters: 0.04, slopeNormalBias: 0.58 },
		textureChannels: { albedo: true, normal: true, roughness: true, ao: true },
		fallback: { permitVertexColor: true, permitProceduralMicro: true },
	},
	snow: {
		label: 'snow cover with exposed substrate',
		albedo: { luminanceMin: 0.62, luminanceMax: 0.96, saturationMin: 0.0, saturationMax: 0.1 },
		roughness: { min: 0.42, max: 0.82, wetMin: 0.18, wetMax: 0.56 },
		normal: { amplitudeMin: 0.1, amplitudeMax: 0.42, macroMetersMin: 0.7, macroMetersMax: 16, microMetersMin: 0.05, microMetersMax: 0.36 },
		moistureResponse: { dryDarken: 0.0, wetDarken: -0.05, wetRoughnessDelta: -0.2, wetSpecularDelta: 0.06 },
		slopeResponse: { maxPreferredDegrees: 72, fadeStartDegrees: 38, rockBlendStartDegrees: 48, snowBlendStartDegrees: 76 },
		heightResponse: { lowlandBias: 0.38, uplandBias: 1.3, treelineFadeStartMeters: 320, treelineFadeEndMeters: 860 },
		macroPattern: { scaleMeters: 36, contrast: 0.2, breakupOctaves: 4, triplanar: true },
		microPattern: { scaleMeters: 0.48, contrast: 0.07, breakupOctaves: 2, antiTilingRotation: true },
		vegetationCompanion: { shrub: 0.18, tree: 0.1, grass: 0.14, rock: 0.42 },
		grounding: { sinkToleranceMeters: 0.035, floatToleranceMeters: 0.05, slopeNormalBias: 0.36 },
		textureChannels: { albedo: true, normal: true, roughness: true, ao: false },
		fallback: { permitVertexColor: true, permitProceduralMicro: true },
	},
	wet: {
		label: 'wet shoreline and saturated ground',
		albedo: { luminanceMin: 0.035, luminanceMax: 0.3, saturationMin: 0.04, saturationMax: 0.38 },
		roughness: { min: 0.12, max: 0.54, wetMin: 0.08, wetMax: 0.36 },
		normal: { amplitudeMin: 0.08, amplitudeMax: 0.3, macroMetersMin: 1.5, macroMetersMax: 14, microMetersMin: 0.04, microMetersMax: 0.3 },
		moistureResponse: { dryDarken: 0.0, wetDarken: -0.12, wetRoughnessDelta: -0.28, wetSpecularDelta: 0.11 },
		slopeResponse: { maxPreferredDegrees: 20, fadeStartDegrees: 8, rockBlendStartDegrees: 14, snowBlendStartDegrees: 24 },
		heightResponse: { lowlandBias: 1.42, uplandBias: 0.36, treelineFadeStartMeters: 260, treelineFadeEndMeters: 500 },
		macroPattern: { scaleMeters: 22, contrast: 0.12, breakupOctaves: 3, triplanar: true },
		microPattern: { scaleMeters: 0.42, contrast: 0.09, breakupOctaves: 2, antiTilingRotation: true },
		vegetationCompanion: { shrub: 0.38, tree: 0.18, grass: 0.64, rock: 0.22 },
		grounding: { sinkToleranceMeters: 0.012, floatToleranceMeters: 0.04, slopeNormalBias: 0.24 },
		textureChannels: { albedo: true, normal: true, roughness: true, ao: false },
		fallback: { permitVertexColor: true, permitProceduralMicro: true },
	},
	bark: {
		label: 'tree bark and trunk surface',
		albedo: { luminanceMin: 0.035, luminanceMax: 0.3, saturationMin: 0.03, saturationMax: 0.36 },
		roughness: { min: 0.66, max: 0.95, wetMin: 0.46, wetMax: 0.8 },
		normal: { amplitudeMin: 0.3, amplitudeMax: 0.72, macroMetersMin: 0.05, macroMetersMax: 0.55, microMetersMin: 0.004, microMetersMax: 0.08 },
		moistureResponse: { dryDarken: 0.02, wetDarken: -0.09, wetRoughnessDelta: -0.12, wetSpecularDelta: 0.02 },
		slopeResponse: { maxPreferredDegrees: 90, fadeStartDegrees: 90, rockBlendStartDegrees: 90, snowBlendStartDegrees: 90 },
		heightResponse: { lowlandBias: 0.9, uplandBias: 1.0, treelineFadeStartMeters: 700, treelineFadeEndMeters: 1200 },
		macroPattern: { scaleMeters: 0.36, contrast: 0.28, breakupOctaves: 3, triplanar: false },
		microPattern: { scaleMeters: 0.04, contrast: 0.16, breakupOctaves: 2, antiTilingRotation: true },
		vegetationCompanion: { shrub: 0.0, tree: 1.0, grass: 0.0, rock: 0.0 },
		grounding: { sinkToleranceMeters: 0.01, floatToleranceMeters: 0.02, slopeNormalBias: 0.08 },
		textureChannels: { albedo: true, normal: true, roughness: true, ao: true },
		fallback: { permitVertexColor: false, permitProceduralMicro: true },
	},
	leaves: {
		label: 'foliage canopy surface',
		albedo: { luminanceMin: 0.04, luminanceMax: 0.38, saturationMin: 0.14, saturationMax: 0.62 },
		roughness: { min: 0.48, max: 0.9, wetMin: 0.32, wetMax: 0.7 },
		normal: { amplitudeMin: 0.05, amplitudeMax: 0.3, macroMetersMin: 0.08, macroMetersMax: 0.85, microMetersMin: 0.01, microMetersMax: 0.08 },
		moistureResponse: { dryDarken: 0.0, wetDarken: -0.04, wetRoughnessDelta: -0.11, wetSpecularDelta: 0.01 },
		slopeResponse: { maxPreferredDegrees: 90, fadeStartDegrees: 90, rockBlendStartDegrees: 90, snowBlendStartDegrees: 90 },
		heightResponse: { lowlandBias: 1.05, uplandBias: 0.72, treelineFadeStartMeters: 600, treelineFadeEndMeters: 1250 },
		macroPattern: { scaleMeters: 1.8, contrast: 0.16, breakupOctaves: 3, triplanar: false },
		microPattern: { scaleMeters: 0.07, contrast: 0.07, breakupOctaves: 2, antiTilingRotation: true },
		vegetationCompanion: { shrub: 0.8, tree: 1.0, grass: 0.18, rock: 0.0 },
		grounding: { sinkToleranceMeters: 0.02, floatToleranceMeters: 0.05, slopeNormalBias: 0.04 },
		textureChannels: { albedo: true, normal: true, roughness: true, ao: false },
		fallback: { permitVertexColor: false, permitProceduralMicro: true },
	},
	wall: {
		label: 'stone or masonry wall surface',
		albedo: { luminanceMin: 0.08, luminanceMax: 0.5, saturationMin: 0.0, saturationMax: 0.26 },
		roughness: { min: 0.62, max: 0.96, wetMin: 0.46, wetMax: 0.82 },
		normal: { amplitudeMin: 0.34, amplitudeMax: 0.74, macroMetersMin: 0.3, macroMetersMax: 2.6, microMetersMin: 0.02, microMetersMax: 0.18 },
		moistureResponse: { dryDarken: 0.01, wetDarken: -0.06, wetRoughnessDelta: -0.15, wetSpecularDelta: 0.03 },
		slopeResponse: { maxPreferredDegrees: 90, fadeStartDegrees: 90, rockBlendStartDegrees: 90, snowBlendStartDegrees: 90 },
		heightResponse: { lowlandBias: 1.0, uplandBias: 1.0, treelineFadeStartMeters: 9999, treelineFadeEndMeters: 9999 },
		macroPattern: { scaleMeters: 2.7, contrast: 0.28, breakupOctaves: 3, triplanar: false },
		microPattern: { scaleMeters: 0.2, contrast: 0.11, breakupOctaves: 2, antiTilingRotation: true },
		vegetationCompanion: { shrub: 0.22, tree: 0.1, grass: 0.08, rock: 0.38 },
		grounding: { sinkToleranceMeters: 0.01, floatToleranceMeters: 0.025, slopeNormalBias: 0.02 },
		textureChannels: { albedo: true, normal: true, roughness: true, ao: true },
		fallback: { permitVertexColor: false, permitProceduralMicro: true },
	},
	roof: {
		label: 'roof and weathered roofing surface',
		albedo: { luminanceMin: 0.04, luminanceMax: 0.34, saturationMin: 0.0, saturationMax: 0.3 },
		roughness: { min: 0.48, max: 0.9, wetMin: 0.28, wetMax: 0.7 },
		normal: { amplitudeMin: 0.3, amplitudeMax: 0.62, macroMetersMin: 0.12, macroMetersMax: 1.5, microMetersMin: 0.015, microMetersMax: 0.12 },
		moistureResponse: { dryDarken: 0.01, wetDarken: -0.05, wetRoughnessDelta: -0.14, wetSpecularDelta: 0.025 },
		slopeResponse: { maxPreferredDegrees: 90, fadeStartDegrees: 90, rockBlendStartDegrees: 90, snowBlendStartDegrees: 90 },
		heightResponse: { lowlandBias: 1.0, uplandBias: 1.0, treelineFadeStartMeters: 9999, treelineFadeEndMeters: 9999 },
		macroPattern: { scaleMeters: 1.2, contrast: 0.24, breakupOctaves: 3, triplanar: false },
		microPattern: { scaleMeters: 0.12, contrast: 0.12, breakupOctaves: 2, antiTilingRotation: true },
		vegetationCompanion: { shrub: 0.12, tree: 0.08, grass: 0.03, rock: 0.04 },
		grounding: { sinkToleranceMeters: 0.01, floatToleranceMeters: 0.025, slopeNormalBias: 0.01 },
		textureChannels: { albedo: true, normal: true, roughness: true, ao: true },
		fallback: { permitVertexColor: false, permitProceduralMicro: true },
	},
	metal: {
		label: 'weathered metal accent',
		albedo: { luminanceMin: 0.08, luminanceMax: 0.46, saturationMin: 0.0, saturationMax: 0.26 },
		roughness: { min: 0.22, max: 0.84, wetMin: 0.12, wetMax: 0.6 },
		normal: { amplitudeMin: 0.06, amplitudeMax: 0.32, macroMetersMin: 0.04, macroMetersMax: 0.5, microMetersMin: 0.004, microMetersMax: 0.04 },
		moistureResponse: { dryDarken: 0.0, wetDarken: -0.04, wetRoughnessDelta: -0.12, wetSpecularDelta: 0.04 },
		slopeResponse: { maxPreferredDegrees: 90, fadeStartDegrees: 90, rockBlendStartDegrees: 90, snowBlendStartDegrees: 90 },
		heightResponse: { lowlandBias: 1.0, uplandBias: 1.0, treelineFadeStartMeters: 9999, treelineFadeEndMeters: 9999 },
		macroPattern: { scaleMeters: 0.48, contrast: 0.18, breakupOctaves: 2, triplanar: false },
		microPattern: { scaleMeters: 0.03, contrast: 0.08, breakupOctaves: 2, antiTilingRotation: true },
		vegetationCompanion: { shrub: 0.0, tree: 0.0, grass: 0.0, rock: 0.0 },
		grounding: { sinkToleranceMeters: 0.004, floatToleranceMeters: 0.015, slopeNormalBias: 0.01 },
		textureChannels: { albedo: true, normal: true, roughness: true, ao: false },
		fallback: { permitVertexColor: false, permitProceduralMicro: true },
	},
	waterline: {
		label: 'wet-to-dry shoreline transition',
		albedo: { luminanceMin: 0.035, luminanceMax: 0.38, saturationMin: 0.0, saturationMax: 0.34 },
		roughness: { min: 0.14, max: 0.68, wetMin: 0.08, wetMax: 0.44 },
		normal: { amplitudeMin: 0.08, amplitudeMax: 0.32, macroMetersMin: 1.2, macroMetersMax: 12, microMetersMin: 0.025, microMetersMax: 0.22 },
		moistureResponse: { dryDarken: 0.0, wetDarken: -0.13, wetRoughnessDelta: -0.3, wetSpecularDelta: 0.12 },
		slopeResponse: { maxPreferredDegrees: 18, fadeStartDegrees: 4, rockBlendStartDegrees: 12, snowBlendStartDegrees: 22 },
		heightResponse: { lowlandBias: 1.5, uplandBias: 0.2, treelineFadeStartMeters: 250, treelineFadeEndMeters: 400 },
		macroPattern: { scaleMeters: 12, contrast: 0.14, breakupOctaves: 3, triplanar: true },
		microPattern: { scaleMeters: 0.34, contrast: 0.08, breakupOctaves: 2, antiTilingRotation: true },
		vegetationCompanion: { shrub: 0.32, tree: 0.05, grass: 0.42, rock: 0.18 },
		grounding: { sinkToleranceMeters: 0.009, floatToleranceMeters: 0.038, slopeNormalBias: 0.22 },
		textureChannels: { albedo: true, normal: true, roughness: true, ao: false },
		fallback: { permitVertexColor: true, permitProceduralMicro: true },
	},
};

export const ENVIRONMENT_SURFACE_PROFILES = freezeDeep(PROFILE_DATA);

function clamp01(value) {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function finiteOr(value, fallback) {
	return Number.isFinite(value) ? value : fallback;
}

function normalizeClass(surfaceClass) {
	const key = String(surfaceClass ?? '').trim().toLowerCase();
	if (ENVIRONMENT_SURFACE_PROFILES[key]) return key;
	if (key.includes('water') || key.includes('shore')) return 'waterline';
	if (key.includes('snow') || key.includes('ice')) return 'snow';
	if (key.includes('scree') || key.includes('talus')) return 'scree';
	if (key.includes('rock') || key.includes('stone') || key.includes('cliff')) return 'rock';
	if (key.includes('mud') || key.includes('marsh')) return 'mud';
	if (key.includes('soil') || key.includes('dirt')) return 'soil';
	if (key.includes('grass')) return 'grass';
	if (key.includes('bark') || key.includes('trunk')) return 'bark';
	if (key.includes('leaf') || key.includes('foliage')) return 'leaves';
	if (key.includes('roof') || key.includes('slate')) return 'roof';
	if (key.includes('metal')) return 'metal';
	return 'wall';
}

export function normalizeEnvironmentSurfaceClass(surfaceClass) {
	return normalizeClass(surfaceClass);
}

export function getEnvironmentSurfaceProfile(surfaceClass) {
	return ENVIRONMENT_SURFACE_PROFILES[normalizeClass(surfaceClass)];
}

export function surfaceUsesTriplanar(surfaceClass) {
	return Boolean(getEnvironmentSurfaceProfile(surfaceClass)?.macroPattern?.triplanar);
}

export function surfaceTextureChannels(surfaceClass) {
	return Object.freeze({ ...(getEnvironmentSurfaceProfile(surfaceClass)?.textureChannels ?? {}) });
}

export function surfaceNormalAmplitude(surfaceClass, { detail = 1, distanceFactor = 1 } = {}) {
	const profile = getEnvironmentSurfaceProfile(surfaceClass);
	if (!profile) return 0;
	const t = clamp01((finiteOr(detail, 1) + finiteOr(distanceFactor, 1)) * 0.5);
	return profile.normal.amplitudeMin + (profile.normal.amplitudeMax - profile.normal.amplitudeMin) * t;
}

export function surfaceRoughness(surfaceClass, { moisture = 0, detail = 1 } = {}) {
	const profile = getEnvironmentSurfaceProfile(surfaceClass);
	if (!profile) return 0.8;
	const wet = clamp01(moisture);
	const base = profile.roughness.min + (profile.roughness.max - profile.roughness.min) * clamp01(detail);
	return clamp(base + (profile.moistureResponse.wetRoughnessDelta * wet), 0, 1);
}

export function surfaceLuminanceResponse(surfaceClass, { moisture = 0, macro = 0 } = {}) {
	const profile = getEnvironmentSurfaceProfile(surfaceClass);
	if (!profile) return 0.2;
	const normalizedMacro = clamp(macro, -1, 1);
	const center = (profile.albedo.luminanceMin + profile.albedo.luminanceMax) * 0.5;
	const half = (profile.albedo.luminanceMax - profile.albedo.luminanceMin) * 0.5;
	const moistureBias = profile.moistureResponse.dryDarken +
		(profile.moistureResponse.wetDarken - profile.moistureResponse.dryDarken) * clamp01(moisture);
	return clamp(center + half * normalizedMacro + moistureBias, 0, 1);
}

export function surfaceNormalScaleForBand(surfaceClass, bandFactor = 1) {
	const profile = getEnvironmentSurfaceProfile(surfaceClass);
	if (!profile) return 1;
	return clamp(profile.normal.amplitudeMin + (profile.normal.amplitudeMax - profile.normal.amplitudeMin) * clamp01(bandFactor), 0.05, 1.5);
}

export function surfaceBlendWeights(surfaceClass, {
	slopeDegrees = 0,
	moisture = 0,
	heightMeters = 0,
	waterDistanceMeters = 999999,
} = {}) {
	const profile = getEnvironmentSurfaceProfile(surfaceClass);
	const slope = clamp(finiteOr(slopeDegrees, 0), 0, 90);
	const wet = clamp01(moisture);
	const height = finiteOr(heightMeters, 0);
	const waterDistance = Math.max(0, finiteOr(waterDistanceMeters, 999999));
	const slopeFade = clamp01((profile.slopeResponse.fadeStartDegrees - slope) / Math.max(1, profile.slopeResponse.fadeStartDegrees));
	const wetBoost = wet * 0.7;
	const waterBoost = 1 - clamp01(waterDistance / 40);
	const heightMid = profile.heightResponse.treelineFadeStartMeters;
	const heightEnd = Math.max(heightMid + 1, profile.heightResponse.treelineFadeEndMeters);
	const heightFade = clamp01(1 - (height - heightMid) / (heightEnd - heightMid));
	const base = clamp01(0.5 * slopeFade + 0.3 * wetBoost + 0.2 * heightFade);
	return Object.freeze({
		base,
		wetBoost,
		waterBoost,
		heightFade,
		slopeFade,
	});
}

export function recommendedEnvironmentSurfaceResponse(surfaceClass, context = {}) {
	const normalized = normalizeClass(surfaceClass);
	const profile = getEnvironmentSurfaceProfile(normalized);
	const blend = surfaceBlendWeights(normalized, context);
	const moisture = clamp01(context.moisture);
	const distanceFactor = clamp01(context.distanceFactor ?? 1);
	const detailFactor = clamp01(context.detailFactor ?? distanceFactor);
	const roughness = surfaceRoughness(normalized, { moisture, detail: detailFactor });
	const luminance = surfaceLuminanceResponse(normalized, { moisture, macro: context.macroSignal ?? 0 });
	const normalScale = surfaceNormalScaleForBand(normalized, detailFactor);
	return Object.freeze({
		policyId: ENVIRONMENT_SURFACE_PROFILE_POLICY.id,
		surfaceClass: normalized,
		label: profile.label,
		blend,
		luminance,
		roughness,
		normalScale,
		triplanar: profile.macroPattern.triplanar,
		textureChannels: surfaceTextureChannels(normalized),
		allowVertexColorFallback: profile.fallback.permitVertexColor,
		allowProceduralMicro: profile.fallback.permitProceduralMicro,
	});
}

export function validateEnvironmentSurfaceResponse(response) {
	const reasons = [];
	if (!response || typeof response !== 'object') return Object.freeze({ valid: false, reasons: ['missing-response'] });
	if (!ENVIRONMENT_SURFACE_PROFILES[response.surfaceClass]) reasons.push('unknown-surface');
	if (!Number.isFinite(response.luminance) || response.luminance < 0 || response.luminance > 1) reasons.push('invalid-luminance');
	if (!Number.isFinite(response.roughness) || response.roughness < 0 || response.roughness > 1) reasons.push('invalid-roughness');
	if (!Number.isFinite(response.normalScale) || response.normalScale <= 0) reasons.push('invalid-normal-scale');
	if (!response.textureChannels?.albedo) reasons.push('missing-albedo-contract');
	return Object.freeze({ valid: reasons.length === 0, reasons });
}

export function validateEnvironmentSurfaceProfile(surfaceClass) {
	const profile = getEnvironmentSurfaceProfile(surfaceClass);
	const reasons = [];
	if (!profile) return Object.freeze({ valid: false, reasons: ['unknown-surface'] });
	const rangePairs = [
		['albedo', profile.albedo.luminanceMin, profile.albedo.luminanceMax],
		['roughness', profile.roughness.min, profile.roughness.max],
		['normal', profile.normal.amplitudeMin, profile.normal.amplitudeMax],
		['slope', profile.slopeResponse.fadeStartDegrees, profile.slopeResponse.maxPreferredDegrees],
	];
	for (const [name, min, max] of rangePairs) {
		if (!(Number.isFinite(min) && Number.isFinite(max) && min <= max)) reasons.push(`invalid-range:${name}`);
	}
	if (!profile.textureChannels.albedo) reasons.push('albedo-required');
	if (!profile.textureChannels.normal) reasons.push('normal-required');
	if (!profile.textureChannels.roughness) reasons.push('roughness-required');
	if (profile.grounding.sinkToleranceMeters < 0 || profile.grounding.floatToleranceMeters < 0) reasons.push('invalid-grounding');
	return Object.freeze({ valid: reasons.length === 0, reasons });
}

export function validateAllEnvironmentSurfaceProfiles() {
	const reports = {};
	for (const key of Object.keys(ENVIRONMENT_SURFACE_PROFILES)) reports[key] = validateEnvironmentSurfaceProfile(key);
	const failures = Object.entries(reports).filter(([, report]) => !report.valid).map(([key]) => key);
	return Object.freeze({ valid: failures.length === 0, failures, reports: Object.freeze(reports) });
}

export function environmentSurfaceProfileDigest() {
	const keys = Object.keys(ENVIRONMENT_SURFACE_PROFILES).sort();
	let hash = 2166136261 >>> 0;
	for (const key of keys) {
		const source = JSON.stringify(ENVIRONMENT_SURFACE_PROFILES[key]);
		for (let index = 0; index < source.length; index += 1) {
			hash ^= source.charCodeAt(index);
			hash = Math.imul(hash, 16777619) >>> 0;
		}
	}
	return `${ENVIRONMENT_SURFACE_PROFILE_POLICY.id}:${hash.toString(16).padStart(8, '0')}`;
}

export const ENVIRONMENT_SURFACE_PROFILE_DIGEST = environmentSurfaceProfileDigest();
