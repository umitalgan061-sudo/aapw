/** Production TypeScript owner for src/3d/world/terrainSurfaceFacies.js. Legacy .js remains compatibility-only. */
// @ts-nocheck
/**
 * Deterministic world-space terrain facies/material response.
 *
 * This module is strictly render-only. It consumes the already resolved terrain vertex/material
 * state; it never samples or writes height, shoreline, hydrology, roads, lakes or collider data.
 * The intent is to replace generic surface interpolation with bounded geological/ecological facies:
 * damp meadow, alluvial silt, dry shoulder, heath, scree, fractured rock, salt-weathered coast and
 * cryogenic crust. Each field is world-space and domain-warped, so adjacent chunks share exactly the
 * same answer and no UV tile boundary is visible.
 *
 * @module world/terrainSurfaceFacies
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (edge0, edge1, value) => {
	const t = clamp01((value - edge0) / Math.max(1e-9, edge1 - edge0));
	return t * t * (3 - 2 * t);
};

export const TERRAIN_FACIES_POLICY = Object.freeze({
	id: 'terrain-surface-facies-2026-09-14-v1-hydro-ecology-weathering',
	renderOnly: true,
	deterministic: true,
	canonicalHeightUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalCoastlineUnchanged: true,
	canonicalColliderUnchanged: true,
	newGeographyIntroduced: false,
	worldSpaceBandsMeters: Object.freeze([7, 19, 54, 112, 240, 520, 1100, 2400, 5200]),
	domainWarpMeters: 260,
	secondaryWarpMeters: 74,
	alluvialBandMeters: 150,
	coastBandMeters: 28,
	intertidalBandMeters: 5.2,
	saltSprayBandMeters: 18,
	slopeShoulderDegrees: Object.freeze([4, 20]),
	slopeCliffDegrees: Object.freeze([24, 48]),
	rockExposureDegrees: Object.freeze([18, 42]),
	forestElevationMeters: Object.freeze([20, 190, 340]),
	treeLineTransitionMeters: Object.freeze([170, 330]),
	snowTransitionMeters: Object.freeze([170, 390, 580]),
	snowCrustMeters: Object.freeze([0.6, 4.0]),
	vegetationChromaThreshold: Object.freeze([0.004, 0.085]),
	roughnessRange: Object.freeze([0.42, 0.985]),
	normalEnergyMax: 0.18,
	albedoEnergyMax: 0.23,
	coastalSaltEnergyMax: 0.08,
	wetPolishEnergyMax: 0.10,
	faciesCount: 11,
});

const FACIES_NAMES = Object.freeze([
	'neutral',
	'damp-meadow',
	'alluvial-silt',
	'dry-soil',
	'heath',
	'forest-floor',
	'stone-lag',
	'scree',
	'weathered-rock',
	'coastal-salt',
	'cryogenic-crust',
]);

export const TERRAIN_FACIES_NAMES = FACIES_NAMES;

function hash2D(ix, iy, seed) {
	let value = Math.imul((ix | 0) ^ seed, 0x27d4eb2d) ^ Math.imul((iy | 0) + seed, 0x165667b1);
	value ^= value >>> 15;
	value = Math.imul(value, 0x85ebca6b);
	value ^= value >>> 13;
	return (value >>> 0) / 4294967296;
}

function valueNoise2D(x, y, seed) {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const tx0 = x - x0;
	const ty0 = y - y0;
	const tx = tx0 * tx0 * (3 - 2 * tx0);
	const ty = ty0 * ty0 * (3 - 2 * ty0);
	const a = hash2D(x0, y0, seed);
	const b = hash2D(x0 + 1, y0, seed);
	const c = hash2D(x0, y0 + 1, seed);
	const d = hash2D(x0 + 1, y0 + 1, seed);
	return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function fbm2D(x, y, seed, octaves = 4) {
	let result = 0;
	let amplitude = 0.55;
	let weight = 0;
	for (let octave = 0; octave < octaves; octave += 1) {
		result += valueNoise2D(x, y, seed + octave * 137) * amplitude;
		weight += amplitude;
		x = x * 2.03 + 17.1;
		y = y * 2.03 - 9.7;
		amplitude *= 0.48;
	}
	return result / Math.max(weight, 1e-9);
}

function ridge2D(x, y, seed, octaves = 4) {
	return 1 - Math.abs(fbm2D(x, y, seed, octaves) * 2 - 1);
}

function domainWarp(worldX, worldZ) {
	const a = fbm2D(worldX / 980, worldZ / 980, 0x49ac, 4);
	const b = fbm2D(worldX / 760, worldZ / 760, 0x9e31, 4);
	return {
		x: worldX + (a - 0.5) * TERRAIN_FACIES_POLICY.domainWarpMeters,
		z: worldZ + (b - 0.5) * TERRAIN_FACIES_POLICY.domainWarpMeters,
	};
}

function secondaryWarp(worldX, worldZ) {
	const a = ridge2D(worldX / 240, worldZ / 240, 0x7123, 3);
	const b = ridge2D(worldX / 178, worldZ / 178, 0x34d1, 3);
	return {
		x: worldX + (a - 0.5) * TERRAIN_FACIES_POLICY.secondaryWarpMeters,
		z: worldZ + (b - 0.5) * TERRAIN_FACIES_POLICY.secondaryWarpMeters,
	};
}

function slopeFraction(slopeDegrees) {
	return smoothstep(
		TERRAIN_FACIES_POLICY.slopeShoulderDegrees[0],
		TERRAIN_FACIES_POLICY.slopeCliffDegrees[1],
		slopeDegrees,
	);
}

function exposureFraction(slopeDegrees) {
	return smoothstep(
		TERRAIN_FACIES_POLICY.rockExposureDegrees[0],
		TERRAIN_FACIES_POLICY.rockExposureDegrees[1],
		slopeDegrees,
	);
}

function vegetationSignal(color) {
	const maxChannel = Math.max(color.r, color.g, color.b);
	const minChannel = Math.min(color.r, color.g, color.b);
	const chroma = maxChannel - minChannel;
	const greenLead = color.g - Math.max(color.r, color.b);
	const green = smoothstep(
		TERRAIN_FACIES_POLICY.vegetationChromaThreshold[0],
		TERRAIN_FACIES_POLICY.vegetationChromaThreshold[1],
		greenLead,
	);
	return clamp01(green * (1 - smoothstep(0.62, 0.87, maxChannel)) * (0.55 + chroma * 2.0));
}

function snowSignal(color) {
	const luma = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
	const maxChannel = Math.max(color.r, color.g, color.b);
	const minChannel = Math.min(color.r, color.g, color.b);
	const chroma = maxChannel - minChannel;
	return clamp01(smoothstep(0.58, 0.87, luma) * (1 - smoothstep(0.08, 0.24, chroma)));
}

function rockSignal(color) {
	const maxChannel = Math.max(color.r, color.g, color.b);
	const minChannel = Math.min(color.r, color.g, color.b);
	const chroma = maxChannel - minChannel;
	return clamp01((1 - vegetationSignal(color)) * (1 - snowSignal(color)) * (1 - smoothstep(0.17, 0.34, chroma)) * (0.55 + maxChannel));
}

export function resolveTerrainSurfaceFacies({
	worldX,
	worldZ,
	heightMeters,
	slopeDegrees,
	coastHeightMeters,
	color = { r: 0.36, g: 0.43, b: 0.25 },
	canonicalSnow = 0,
	northness = 0,
}) {
	const warped = domainWarp(worldX, worldZ);
	const fine = secondaryWarp(warped.x, warped.z);
	const regional = fbm2D(warped.x / 5200, warped.z / 5200, 0x0a4f, 5);
	const broad = fbm2D(warped.x / 2100, warped.z / 2100, 0x19d2, 5);
	const macro = fbm2D(warped.x / 820, warped.z / 820, 0x31f2, 5);
	const meso = fbm2D(fine.x / 230, fine.z / 230, 0x81c4, 4);
	const grain = fbm2D(fine.x / 58, fine.z / 58, 0x6d1a, 4);
	const swale = ridge2D(fine.x / 128, fine.z / 410, 0x71ab, 4);
	const bench = ridge2D(fine.x / 390, fine.z / 102, 0x29e3, 4);
	const stoneLag = ridge2D(fine.x / 82, fine.z / 245, 0x92a1, 3);
	const drought = smoothstep(0.46, 0.84, broad) * smoothstep(0.48, 0.80, macro);
	const moisture = clamp01(0.52 + (0.5 - regional) * 0.42 + (0.5 - broad) * 0.32 + (0.5 - meso) * 0.18);
	const coastal = clamp01(1 - smoothstep(1.2, TERRAIN_FACIES_POLICY.coastBandMeters, coastHeightMeters));
	const intertidal = clamp01(1 - smoothstep(0.25, TERRAIN_FACIES_POLICY.intertidalBandMeters, coastHeightMeters));
	const saltSpray = coastal * (1 - intertidal * 0.70) * smoothstep(0.56, 0.82, grain);
	const shoulder = smoothstep(4, 20, slopeDegrees);
	const cliff = smoothstep(24, 48, slopeDegrees);
	const exposure = exposureFraction(slopeDegrees);
	const heightTundra = smoothstep(150, 340, heightMeters);
	const treeLine = 1 - smoothstep(170, 330, heightMeters);
	const vegetation = vegetationSignal(color);
	const rock = rockSignal(color);
	const snow = clamp01(Math.max(canonicalSnow, smoothstep(170, 580, heightMeters) * (0.74 + northness * 0.16)));
	const alluvial = (1 - cliff) * smoothstep(0.46, 0.84, 1 - drought) * swale * smoothstep(0.42, 0.77, moisture);
	const drySoil = (1 - cliff) * drought * bench * (1 - moisture * 0.42);
	const wetMeadow = (1 - exposure) * vegetation * swale * moisture * (1 - heightTundra * 0.78);
	const heath = vegetation * smoothstep(20, 75, heightMeters) * smoothstep(0.43, 0.82, macro) * (0.55 + heightTundra * 0.44);
	const forestFloor = vegetation * treeLine * smoothstep(0.54, 0.82, moisture) * (0.58 + swale * 0.42);
	const stoneLagAmount = (1 - snow) * stoneLag * (0.25 + shoulder * 0.48 + drought * 0.25) * (1 - wetMeadow * 0.66);
	const scree = (1 - snow) * exposure * smoothstep(0.44, 0.78, meso) * (0.38 + heightTundra * 0.62);
	const weatheredRock = (1 - snow) * Math.max(rock, cliff * (1 - vegetation * 0.64));
	const salt = coastal * (1 - snow) * (saltSpray * 0.70 + intertidal * 0.30) * (1 - cliff * 0.48);
	const cryo = snow * smoothstep(0, 4, TERRAIN_FACIES_POLICY.snowCrustMeters[1]) * (0.72 + northness * 0.22);
	const raw = [0.10, wetMeadow, alluvial, drySoil, heath, forestFloor, stoneLagAmount, scree, weatheredRock, salt, cryo];
	const total = raw.reduce((sum, value) => sum + value, 0);
	const weights = total > 1e-6 ? raw.map((value) => value / total) : [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
	let dominantIndex = 0;
	for (let i = 1; i < weights.length; i += 1) {
		if (weights[i] > weights[dominantIndex]) dominantIndex = i;
	}
	return Object.freeze({
		weights: Object.freeze(weights),
		dominant: FACIES_NAMES[dominantIndex],
		dominantIndex,
		regional,
		broad,
		macro,
		meso,
		grain,
		swales: swale,
		benches: bench,
		stoneLag: stoneLag,
		moisture,
		drought,
		coastal,
		intertidal,
		saltSpray,
		exposure,
		shoulder,
		cliff,
		heath,
		forestFloor,
		northness,
		snow,
	});
}

export function resolveTerrainSurfaceMaterialResponse({
	facies,
	baseColor,
	heightMeters,
	slopeDegrees,
	coastHeightMeters,
}) {
	const w = facies.weights;
	const [neutral, meadow, alluvial, drySoil, heath, forestFloor, stoneLag, scree, rock, salt, cryo] = w;
	const wetPolish = clamp01(meadow * 0.48 + alluvial * 0.34 + salt * 0.22 + facies.intertidal * 0.16);
	const aggregate = clamp01(stoneLag * 0.66 + scree * 0.82 + rock * 0.46 + drySoil * 0.32 + cryo * 0.24);
	const weathering = clamp01(
		facies.exposure * 0.42
		+ facies.shoulder * 0.22
		+ facies.cliff * 0.34
		+ Math.max(0, heightMeters - 60) / 520 * 0.18,
	);
	const valueShift = (facies.regional - 0.5) * 0.10
		+ (facies.broad - 0.5) * 0.075
		+ (facies.macro - 0.5) * 0.060
		+ (facies.meso - 0.5) * 0.040;
	const greenMute = clamp01(facies.drought * 0.26 + stoneLag * 0.14 + rock * 0.18);
	const moistureDarken = clamp01(wetPolish * 0.17);
	const saltLift = clamp01(salt * 0.065);
	const roughness = clamp01(
		0.78
		+ aggregate * 0.16
		+ weathering * 0.08
		- wetPolish * 0.15
		+ cryo * 0.08,
	);
	const normalStrength = clamp01(
		0.45
		+ aggregate * 0.72
		+ rock * 0.52
		+ scree * 0.34
		+ cryo * 0.22
	);
	const color = {
		r: clamp01(baseColor.r * (1 + valueShift - greenMute * 0.22 - moistureDarken) + saltLift),
		g: clamp01(baseColor.g * (1 + valueShift - greenMute * 0.11 - moistureDarken * 0.76) + saltLift * 0.84),
		b: clamp01(baseColor.b * (1 + valueShift * 0.72 - moistureDarken * 0.40 + saltLift * 0.48)),
	};
	if (facies.dominant === 'alluvial-silt') {
		color.r = lerp(color.r, 0.28, 0.20);
		color.g = lerp(color.g, 0.25, 0.16);
		color.b = lerp(color.b, 0.19, 0.18);
	}
	if (facies.dominant === 'dry-soil') {
		color.r = lerp(color.r, 0.34, 0.16);
		color.g = lerp(color.g, 0.27, 0.13);
		color.b = lerp(color.b, 0.18, 0.11);
	}
	if (facies.dominant === 'stone-lag' || facies.dominant === 'scree') {
		color.r = lerp(color.r, 0.38, 0.14);
		color.g = lerp(color.g, 0.37, 0.13);
		color.b = lerp(color.b, 0.35, 0.12);
	}
	if (facies.dominant === 'weathered-rock') {
		color.r = lerp(color.r, 0.31, 0.15);
		color.g = lerp(color.g, 0.33, 0.15);
		color.b = lerp(color.b, 0.34, 0.14);
	}
	if (facies.dominant === 'cryogenic-crust') {
		color.r = lerp(color.r, 0.67, 0.18);
		color.g = lerp(color.g, 0.72, 0.17);
		color.b = lerp(color.b, 0.74, 0.20);
	}
	if (coastHeightMeters < 0) {
		const submerged = smoothstep(-4, 0, coastHeightMeters);
		color.r = lerp(color.r, 0.20, submerged);
		color.g = lerp(color.g, 0.27, submerged);
		color.b = lerp(color.b, 0.28, submerged);
	}
	return Object.freeze({
		color: Object.freeze(color),
		roughness,
		normalStrength: Math.min(TERRAIN_FACIES_POLICY.normalEnergyMax, normalStrength * 0.18),
		wetPolish,
		aggregate,
		weathering,
	});
}

export function createTerrainFaciesDiagnostics(sample) {
	const facies = resolveTerrainSurfaceFacies(sample);
	const response = resolveTerrainSurfaceMaterialResponse({
		facies,
		baseColor: sample.color ?? { r: 0.36, g: 0.43, b: 0.25 },
		heightMeters: sample.heightMeters ?? 0,
		slopeDegrees: sample.slopeDegrees ?? 0,
		coastHeightMeters: sample.coastHeightMeters ?? 999,
	});
	const nonUniformity = 1 - Math.max(...facies.weights);
	return Object.freeze({
		policyId: TERRAIN_FACIES_POLICY.id,
		dominantFacies: facies.dominant,
		nonUniformity,
		color: response.color,
		roughness: response.roughness,
		normalStrength: response.normalStrength,
		worldSpaceBandsMeters: TERRAIN_FACIES_POLICY.worldSpaceBandsMeters,
		canonicalHeightUnchanged: TERRAIN_FACIES_POLICY.canonicalHeightUnchanged,
		canonicalHydrologyUnchanged: TERRAIN_FACIES_POLICY.canonicalHydrologyUnchanged,
		canonicalColliderUnchanged: TERRAIN_FACIES_POLICY.canonicalColliderUnchanged,
	});
}

export const TERRAIN_FACIES_GLSL = String.raw`
varying vec3 vTerrainFaciesWorldPosition;
varying vec3 vTerrainFaciesWorldNormal;

float terrainFaciesHash(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float terrainFaciesNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = terrainFaciesHash(i);
	float b = terrainFaciesHash(i + vec2(1.0, 0.0));
	float c = terrainFaciesHash(i + vec2(0.0, 1.0));
	float d = terrainFaciesHash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float terrainFaciesFbm(vec2 p) {
	float total = 0.0;
	float amplitude = 0.55;
	float weight = 0.0;
	for (int octave = 0; octave < 5; octave++) {
		total += terrainFaciesNoise(p) * amplitude;
		weight += amplitude;
		p = p * 2.03 + vec2(17.1, -9.7);
		amplitude *= 0.48;
	}
	return total / max(weight, 0.0001);
}

float terrainFaciesRidge(vec2 p) {
	return 1.0 - abs(terrainFaciesFbm(p) * 2.0 - 1.0);
}

vec2 terrainFaciesWarp(vec2 p) {
	float x = terrainFaciesFbm(p / 980.0 + vec2(4.1, -11.3));
	float y = terrainFaciesFbm(p / 760.0 + vec2(-8.2, 6.4));
	return p + (vec2(x, y) - 0.5) * 260.0;
}

vec2 terrainFaciesSecondaryWarp(vec2 p) {
	float x = terrainFaciesRidge(p / 240.0 + vec2(7.2, -12.4));
	float y = terrainFaciesRidge(p / 178.0 + vec2(-4.7, 21.1));
	return p + (vec2(x, y) - 0.5) * 74.0;
}

float terrainFaciesSlope(vec3 n) {
	return 1.0 - clamp(abs(n.y), 0.0, 1.0);
}

float terrainFaciesVegetation(vec3 base) {
	float mx = max(base.r, max(base.g, base.b));
	float greenLead = base.g - max(base.r, base.b);
	return smoothstep(0.004, 0.085, greenLead) * (1.0 - smoothstep(0.62, 0.87, mx));
}

float terrainFaciesSnow(vec3 base) {
	float luma = dot(base, vec3(0.2126, 0.7152, 0.0722));
	float chroma = max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b));
	return smoothstep(0.58, 0.87, luma) * (1.0 - smoothstep(0.08, 0.24, chroma));
}

float terrainFaciesRock(vec3 base) {
	float chroma = max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b));
	return (1.0 - terrainFaciesVegetation(base)) * (1.0 - terrainFaciesSnow(base))
		* (1.0 - smoothstep(0.17, 0.34, chroma));
}

float terrainFaciesCoastal(vec2 p, float height, float snow) {
	float coastHeight = height - 6.0;
	float macro = terrainFaciesFbm(p / 430.0 + vec2(29.1, -12.4));
	float meso = terrainFaciesFbm(p / 155.0 + vec2(-8.7, 31.2));
	float grain = terrainFaciesNoise(p / 47.0 + vec2(16.8, 5.3));
	float reach = (1.0 - smoothstep(1.2, 28.0, coastHeight)) * (1.0 - snow);
	float intertidal = 1.0 - smoothstep(0.25, 5.2, coastHeight);
	float salt = reach * (1.0 - intertidal * 0.70)
		* smoothstep(0.56, 0.82, meso)
		* smoothstep(0.44, 0.80, grain);
	return clamp(reach * mix(0.22, 1.0, smoothstep(0.36, 0.80, macro)) + salt * 0.18, 0.0, 1.0);
}

float terrainFaciesMoisture(vec2 p) {
	vec2 warped = terrainFaciesWarp(p);
	float regional = terrainFaciesFbm(warped / 5200.0 + vec2(2.1, -4.7));
	float broad = terrainFaciesFbm(warped / 2100.0 + vec2(-6.9, 7.4));
	float macro = terrainFaciesFbm(warped / 820.0 + vec2(13.2, -9.1));
	float meso = terrainFaciesFbm(terrainFaciesSecondaryWarp(warped) / 230.0 + vec2(17.2, 3.7));
	float returnValue = 0.52 + (0.5 - regional) * 0.42 + (0.5 - broad) * 0.32 + (0.5 - macro) * 0.14 + (0.5 - meso) * 0.12;
	return clamp(returnValue, 0.0, 1.0);
}

vec3 terrainFaciesWetGroundTone() {
	return vec3(0.050, 0.072, 0.044);
}

vec3 terrainFaciesDryGroundTone() {
	return vec3(0.244, 0.208, 0.132);
}

vec3 terrainFaciesSiltTone() {
	return vec3(0.275, 0.246, 0.194);
}

vec3 terrainFaciesStoneTone() {
	return vec3(0.345, 0.342, 0.323);
}

vec3 terrainFaciesSnowTone(float broad, float fine) {
	vec3 cold = vec3(0.640, 0.690, 0.720);
	vec3 sun = vec3(0.785, 0.800, 0.800);
	return mix(cold, sun, broad * 0.62 + fine * 0.38);
}

float terrainFaciesAlluvialDomain(vec2 p, float moisture, float cliff) {
	vec2 warped = terrainFaciesSecondaryWarp(terrainFaciesWarp(p));
	float swale = terrainFaciesRidge(warped / 128.0 + vec2(8.7, -5.1));
	float bench = terrainFaciesRidge(warped / 390.0 + vec2(-12.3, 19.4));
	float drainage = terrainFaciesFbm(warped / 260.0 + vec2(-17.4, 6.2));
	return (1.0 - cliff) * swale * bench
		* smoothstep(0.44, 0.82, moisture)
		* smoothstep(0.52, 0.84, 1.0 - drainage);
}

float terrainFaciesDryDomain(vec2 p, float moisture, float slope) {
	vec2 warped = terrainFaciesSecondaryWarp(terrainFaciesWarp(p));
	float bench = terrainFaciesRidge(warped / 102.0 + vec2(6.8, -11.9));
	float grain = terrainFaciesNoise(warped / 58.0 + vec2(-7.4, 19.6));
	return (1.0 - smoothstep(24.0, 48.0, slope))
		* bench * grain * smoothstep(0.47, 0.82, 1.0 - moisture);
}

float terrainFaciesRockDomain(vec2 p, float slope, float snow) {
	float exposure = smoothstep(0.31, 0.72, 1.0 - abs(normalize(vTerrainFaciesWorldNormal).y));
	float fracture = terrainFaciesRidge(p / 145.0 + vec2(3.2, -11.7));
	float mineral = terrainFaciesRidge(p / 58.0 + vec2(-14.2, 8.1));
	return exposure * (1.0 - snow) * (0.44 + fracture * 0.34 + mineral * 0.22);
}

void terrainFaciesApplyColor() {
	vec3 base = diffuseColor.rgb;
	vec2 p = vTerrainFaciesWorldPosition.xz;
	float height = vTerrainFaciesWorldPosition.y;
	vec3 n = normalize(vTerrainFaciesWorldNormal);
	float slope = terrainFaciesSlope(n);
	float slopeDegProxy = slope * 90.0;
	float vegetation = terrainFaciesVegetation(base);
	float snow = terrainFaciesSnow(base);
	float rock = terrainFaciesRock(base);
	vec2 warped = terrainFaciesWarp(p);
	vec2 detailed = terrainFaciesSecondaryWarp(warped);
	float regional = terrainFaciesFbm(warped / 5200.0 + vec2(11.7, -4.1));
	float broad = terrainFaciesFbm(warped / 2100.0 + vec2(-5.9, 8.6));
	float macro = terrainFaciesFbm(warped / 820.0 + vec2(-7.3, 14.9));
	float meso = terrainFaciesFbm(detailed / 230.0 + vec2(23.8, 3.6));
	float grain = terrainFaciesNoise(detailed / 58.0 + vec2(5.4, -18.2));
	float moisture = terrainFaciesMoisture(p);
	float lowland = 1.0 - smoothstep(22.0, 120.0, height);
	float alluvial = terrainFaciesAlluvialDomain(p, moisture, smoothstep(0.30, 0.78, slope));
	float dryDomain = terrainFaciesDryDomain(p, moisture, slopeDegProxy);
	float rockDomain = terrainFaciesRockDomain(p, slopeDegProxy, snow);
	float coastal = terrainFaciesCoastal(p, height, snow);
	float tide = 1.0 - smoothstep(0.25, 5.2, height - 6.0);
	float salt = coastal * (1.0 - tide * 0.72) * smoothstep(0.58, 0.84, grain);
	float wetMeadow = vegetation * lowland * smoothstep(0.55, 0.82, moisture) * alluvial;
	float dryGrass = vegetation * smoothstep(0.52, 0.82, 1.0 - moisture) * (0.35 + smoothstep(40.0, 260.0, height) * 0.65);
	float heath = vegetation * smoothstep(20.0, 80.0, height) * smoothstep(0.42, 0.80, macro);
	float forestFloor = vegetation * (1.0 - smoothstep(170.0, 330.0, height)) * smoothstep(0.55, 0.82, moisture);
	float stoneLag = (1.0 - snow) * terrainFaciesRidge(detailed / 82.0 + vec2(21.6, -7.9)) * (0.22 + slope * 0.42) * (1.0 - wetMeadow * 0.68);
	float scree = (1.0 - snow) * smoothstep(0.31, 0.72, slope) * smoothstep(0.44, 0.78, meso);
	float fracturedRock = max(rock, rockDomain * (1.0 - vegetation * 0.58));
	float cryo = snow * (0.72 + smoothstep(0.0, 0.35, n.y) * 0.15);
	float highPass = clamp((macro - broad) * 0.78 + (meso - macro) * 0.34, -0.46, 0.46);
	float value = 0.90 + (regional - 0.5) * 0.20 + (broad - 0.5) * 0.16 + (macro - 0.5) * 0.13 + (meso - 0.5) * 0.06 + highPass * lowland * 0.18;
	diffuseColor.rgb *= value;
	diffuseColor.rgb = mix(diffuseColor.rgb, terrainFaciesWetGroundTone(), wetMeadow * 0.24);
	diffuseColor.rgb = mix(diffuseColor.rgb, terrainFaciesSiltTone(), alluvial * 0.18);
	diffuseColor.rgb = mix(diffuseColor.rgb, terrainFaciesDryGroundTone(), dryDomain * 0.21 + dryGrass * 0.12);
	diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.186, 0.171, 0.137), heath * 0.18);
	diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.074, 0.096, 0.056), forestFloor * 0.17);
	diffuseColor.rgb = mix(diffuseColor.rgb, terrainFaciesStoneTone(), (stoneLag * 0.12 + scree * 0.16 + fracturedRock * 0.14));
	diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.089, 0.104, 0.096), coastal * 0.15);
	diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.318, 0.322, 0.296), salt * 0.075);
	float snowFine = terrainFaciesNoise(p / 2.6 + vec2(37.4, -12.8));
	float snowMeso = terrainFaciesFbm(p / 11.0 + vec2(-18.7, 41.2));
	float snowRidge = terrainFaciesRidge(vec2(p.x / 7.5 + p.y / 34.0, p.y / 18.0 - p.x / 52.0));
	vec3 snowTone = terrainFaciesSnowTone(broad, snowFine);
	diffuseColor.rgb = mix(diffuseColor.rgb, snowTone, cryo * 0.24);
	diffuseColor.rgb *= 1.0 + cryo * ((snowFine - 0.5) * 0.055 + (snowMeso - 0.5) * 0.065 + (snowRidge - 0.5) * 0.045);
	float desaturate = 0.035 + fracturedRock * 0.085 + vegetation * 0.055 + wetMeadow * 0.035;
	float luma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
	diffuseColor.rgb = mix(diffuseColor.rgb, vec3(luma), desaturate);
	diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.01), vec3(0.88));
}

void terrainFaciesApplyRoughness() {
	vec2 p = vTerrainFaciesWorldPosition.xz;
	float height = vTerrainFaciesWorldPosition.y;
	float slope = terrainFaciesSlope(normalize(vTerrainFaciesWorldNormal));
	float snow = terrainFaciesSnow(diffuseColor.rgb);
	float moisture = terrainFaciesMoisture(p);
	float meso = terrainFaciesFbm(terrainFaciesSecondaryWarp(p) / 230.0 + vec2(23.8, 3.6));
	float grain = terrainFaciesNoise(p / 58.0 + vec2(5.4, -18.2));
	float rock = terrainFaciesRock(diffuseColor.rgb);
	float vegetation = terrainFaciesVegetation(diffuseColor.rgb);
	float coastal = terrainFaciesCoastal(p, height, snow);
	float tide = 1.0 - smoothstep(0.25, 5.2, height - 6.0);
	float alluvial = terrainFaciesAlluvialDomain(p, moisture, smoothstep(0.30, 0.78, slope));
	float aggregate = smoothstep(0.48, 0.82, meso) * (0.22 + slope * 0.64);
	float wetPolish = alluvial * 0.055 + coastal * 0.032 + tide * 0.055 + moisture * vegetation * 0.022;
	float grainRough = (grain - 0.5) * 0.105;
	float snowRough = snow * ((terrainFaciesNoise(p / 2.6 + vec2(37.4, -12.8)) - 0.5) * 0.085);
	float elevationWeathering = smoothstep(45.0, 390.0, height) * smoothstep(0.16, 0.72, slope) * 0.055;
	roughnessFactor = clamp(roughnessFactor + aggregate * 0.105 + grainRough + snowRough + elevationWeathering - wetPolish - rock * moisture * 0.018, 0.42, 1.0);
}

void terrainFaciesApplyNormal() {
	vec2 p = vTerrainFaciesWorldPosition.xz;
	float slope = terrainFaciesSlope(normalize(vTerrainFaciesWorldNormal));
	float height = vTerrainFaciesWorldPosition.y;
	float snow = terrainFaciesSnow(diffuseColor.rgb);
	float moisture = terrainFaciesMoisture(p);
	float field = terrainFaciesRidge(p / 128.0 + vec2(9.2, -12.4));
	float fieldFine = terrainFaciesNoise(p / 19.0 + vec2(-4.1, 15.7));
	float rock = terrainFaciesRock(diffuseColor.rgb);
	float aggregate = (1.0 - snow) * (0.20 + slope * 0.58) * (0.35 + field * 0.45 + fieldFine * 0.20);
	float snowMicro = snow * (fieldFine - 0.5) * 0.065;
	float drainage = (0.5 - terrainFaciesFbm(terrainFaciesWarp(p) / 260.0 + vec2(-17.4, 6.2))) * moisture;
	vec2 gradient = vec2(fieldFine - field, drainage);
	vec3 perturbation = vec3(-gradient.x, 0.0, -gradient.y);
	normal = normalize(normal + mat3(viewMatrix) * perturbation * (aggregate * 0.82 + rock * 0.22 + snowMicro));
}
`;

export function installTerrainSurfaceFacies(material) {
	if (!material) throw new TypeError('terrain facies material hook requires a material');
	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nvarying vec3 vTerrainFaciesWorldPosition;\nvarying vec3 vTerrainFaciesWorldNormal;',
			)
			.replace(
				'#include <beginnormal_vertex>',
				'#include <beginnormal_vertex>\nvTerrainFaciesWorldNormal = normalize(mat3(modelMatrix) * objectNormal);',
			)
			.replace(
				'#include <begin_vertex>',
				'#include <begin_vertex>\nvTerrainFaciesWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
			);
		shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TERRAIN_FACIES_GLSL}`);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			'#include <color_fragment>\nterrainFaciesApplyColor();',
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <roughnessmap_fragment>',
			'#include <roughnessmap_fragment>\nterrainFaciesApplyRoughness();',
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <normal_fragment_maps>',
			'#include <normal_fragment_maps>\nterrainFaciesApplyNormal();',
		);
	};
	const previousProgramKey = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () => `${previousProgramKey ? previousProgramKey() : ''}|${TERRAIN_FACIES_POLICY.id}`;
	material.userData = {
		...material.userData,
		terrainSurfaceFacies: Object.freeze({
			policyId: TERRAIN_FACIES_POLICY.id,
			worldSpaceBandsMeters: TERRAIN_FACIES_POLICY.worldSpaceBandsMeters,
			faciesNames: TERRAIN_FACIES_NAMES,
			canonicalHeightUnchanged: true,
			canonicalHydrologyUnchanged: true,
			canonicalColliderUnchanged: true,
			newGeographyIntroduced: false,
			multiScaleAlbedo: true,
			multiScaleNormal: true,
			multiScaleRoughness: true,
			hydroEcologicalTransitions: true,
			coastalSaltWeathering: true,
			cryogenicCrust: true,
			screeAndRockFacies: true,
		}),
	};
	return material;
}
