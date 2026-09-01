/**
 * Deterministic world-space material naturalisation for the canonical terrain mesh.
 * This module only modifies fragment albedo, normal response and roughness. It never writes
 * positions, height samples, water classification, shoreline masks or collider data.
 * @module world/naturalSurfaceMaterial
 */

import { WORLD_DEFAULTS, WORLD_SCALE } from '../config.js';
import { VALYRIA_GEOLOGY_POLICY } from './valyriaGeology.js';

export const NATURAL_SURFACE_MATERIAL_POLICY = Object.freeze({
	id: 'natural-surface-material-2026-09-01-v9-bounded-valyria-normal-energy',
	renderOnly: true,
	deterministic: true,
	canonicalHeightUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalColliderUnchanged: true,
	canonicalCoastlineUnchanged: true,
	newGeographyIntroduced: false,
	valyriaAuthorityPolicyId: VALYRIA_GEOLOGY_POLICY.id,
	valyriaMaterials: Object.freeze(['basalt', 'obsidian', 'ash', 'pumice', 'oxidation', 'sulfuric-weathering']),
	valyriaMorphologyAligned: true,
	faultStrikeAlignedSurface: true,
	drainageAlignedSurface: true,
	calderaShoulderAlignedSurface: true,
	erosionGullyAlignedSurface: true,
	worldSpaceAlbedoVariation: true,
	worldSpaceNormalVariation: true,
	worldSpaceRoughnessVariation: true,
	allWorldMacroNormalVariation: true,
	allWorldMacroRoughnessVariation: true,
	lowlandHighPassMosaic: true,
	lowlandMaterialDepth: true,
	lowlandDirectionalDepositionalFabric: true,
	lowlandDirectionalNormalVariation: true,
	lowlandDirectionalRoughnessVariation: true,
	ridgeFacetRecovery: true,
	patchyIntertidalTransition: true,
	valyriaLithologicBreakup: true,
	valyriaDrainageRecessWeathering: true,
	sparseCoolingFractures: true,
	anisotropicLavaFlowFabric: true,
	basaltLithicFacetFabric: true,
	regionalLithicNormalRecovery: true,
	valyriaLinearWeatheringPatina: true,
	valyriaPatchyLithicExposure: true,
	valyriaLinearCarrierRoughnessResponse: true,
	lowlandMesoscaleReliefRecovery: true,
	valyriaMacroNormalEnergyBounded: true,
	valyriaMacroNormalBlendMax: 0.16,
});

const F = (value) => Number(value).toFixed(8);
const P = VALYRIA_GEOLOGY_POLICY;
const GLSL = Object.freeze({
	worldWidth: F(WORLD_SCALE.WORLD_WIDTH_METERS),
	worldDepth: F(WORLD_SCALE.WORLD_DEPTH_METERS),
	water: F(WORLD_DEFAULTS.WATER_LEVEL_METERS),
	falloff: F(P.falloff),
	coreX: F(P.coreCenter.nx),
	coreY: F(P.coreCenter.ny),
	coreRadiusX: F(P.coreRadius.nx),
	coreRadiusY: F(P.coreRadius.ny),
	neckX: F(P.neckCenter.nx),
	neckY: F(P.neckCenter.ny),
	neckRadiusX: F(P.neckRadius.nx),
	neckRadiusY: F(P.neckRadius.ny),
	faultStrike: F(P.faultStrikeRadians),
	faultAlongFrequency: F(P.faultScarpAlongFrequency),
	faultAcrossFrequency: F(P.faultScarpAcrossFrequency),
	calderaFrequency: F(P.calderaFrequency),
	lavaDrainageFrequency: F(P.lavaDrainageFrequency),
	erosionGullyFrequency: F(P.erosionGullyFrequency),
});

const NATURAL_SURFACE_FUNCTIONS = `
varying vec3 vNaturalSurfaceWorldPosition;
varying vec3 vNaturalSurfaceWorldNormal;
float naturalSurfaceHash(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
float naturalSurfaceNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(naturalSurfaceHash(i), naturalSurfaceHash(i + vec2(1.0, 0.0)), f.x),
		mix(naturalSurfaceHash(i + vec2(0.0, 1.0)), naturalSurfaceHash(i + vec2(1.0)), f.x), f.y);
}
float naturalSurfaceFbm(vec2 p) {
	float value = 0.0;
	float amplitude = 0.54;
	for (int octave = 0; octave < 5; octave++) {
		value += naturalSurfaceNoise(p) * amplitude;
		p = mat2(0.80, -0.60, 0.60, 0.80) * p * 2.03 + vec2(13.17, -9.41);
		amplitude *= 0.47;
	}
	return value / 1.0364;
}
float naturalSurfaceRidge(vec2 p) {
	return 1.0 - abs(naturalSurfaceFbm(p) * 2.0 - 1.0);
}
float naturalSurfaceAllWorldRelief(vec2 worldXZ) {
	float broad = naturalSurfaceFbm(worldXZ / 920.0 + vec2(4.1, -11.3));
	float landform = naturalSurfaceFbm(worldXZ / 285.0 + vec2(-17.9, 8.6));
	float meso = naturalSurfaceFbm(worldXZ / 82.0 + vec2(23.7, 6.2));
	float grain = naturalSurfaceNoise(worldXZ / 31.0 + vec2(-7.2, 19.5));
	return (broad - 0.5) * 0.43 + (landform - 0.5) * 0.36 + (meso - 0.5) * 0.16 + (grain - 0.5) * 0.05;
}
vec3 naturalSurfaceLowlandDepositionalFabric(vec2 worldXZ) {
	float domainWarp = naturalSurfaceFbm(worldXZ / 760.0 + vec2(6.2, -14.8)) - 0.5;
	vec2 frame = mat2(0.9238795, -0.3826834, 0.3826834, 0.9238795) * worldXZ;
	vec2 swaleCoordinates = vec2(frame.x / 138.0, frame.y / 520.0) + vec2(domainWarp * 0.42, -domainWarp * 0.17);
	vec2 benchCoordinates = vec2(frame.x / 410.0, frame.y / 104.0) + vec2(-domainWarp * 0.16, domainWarp * 0.38);
	float swale = naturalSurfaceFbm(swaleCoordinates + vec2(8.7, -5.1));
	float bench = naturalSurfaceFbm(benchCoordinates + vec2(-12.3, 19.4));
	float stoneLag = naturalSurfaceRidge(vec2(frame.x / 82.0, frame.y / 246.0) + vec2(21.6, -7.9));
	return vec3(swale, bench, stoneLag);
}
vec2 naturalSurfaceOwnerUv(vec2 worldXZ) {
	return vec2(worldXZ.x / ${GLSL.worldWidth} + 0.5, worldXZ.y / ${GLSL.worldDepth} + 0.5);
}
float naturalSurfaceEllipse(vec2 uv, vec2 center, vec2 radius) {
	float distanceFromCenter = length((uv - center) / radius);
	return 1.0 - smoothstep(1.0, ${GLSL.falloff}, distanceFromCenter);
}
float naturalSurfaceValyriaInfluence(vec3 worldPosition) {
	vec2 uv = naturalSurfaceOwnerUv(worldPosition.xz);
	float core = naturalSurfaceEllipse(uv, vec2(${GLSL.coreX}, ${GLSL.coreY}), vec2(${GLSL.coreRadiusX}, ${GLSL.coreRadiusY}));
	float neck = naturalSurfaceEllipse(uv, vec2(${GLSL.neckX}, ${GLSL.neckY}), vec2(${GLSL.neckRadiusX}, ${GLSL.neckRadiusY}));
	float canonicalDry = smoothstep(${GLSL.water} + 0.35, ${GLSL.water} + 4.5, worldPosition.y);
	return max(core, neck) * canonicalDry;
}
float naturalSurfaceCoolingFracture(vec2 worldXZ) {
	vec2 flowDirection = normalize(vec2(0.84, 0.54));
	vec2 crossDirection = vec2(-flowDirection.y, flowDirection.x);
	float macroWarp = naturalSurfaceFbm(worldXZ / 460.0 + vec2(-3.2, 6.1)) - 0.5;
	vec2 p = worldXZ / 168.0 + vec2(macroWarp * 0.42, -macroWarp * 0.28);
	float flowShear = abs(naturalSurfaceFbm(p + flowDirection * 0.18) - naturalSurfaceFbm(p - flowDirection * 0.18));
	float crossShear = abs(naturalSurfaceFbm(p + crossDirection * 0.16) - naturalSurfaceFbm(p - crossDirection * 0.16));
	float primary = smoothstep(0.065, 0.155, flowShear);
	float crossJoint = smoothstep(0.075, 0.165, crossShear);
	float exposure = smoothstep(0.58, 0.79, naturalSurfaceFbm(worldXZ / 330.0 + vec2(7.4, -5.9)));
	float interruption = smoothstep(0.58, 0.77, naturalSurfaceFbm(worldXZ / 52.0 + vec2(-8.6, 3.1)));
	float jointPocket = smoothstep(0.70, 0.86, naturalSurfaceFbm(worldXZ / 210.0 + vec2(4.2, 8.3)));
	return clamp(primary * exposure * interruption * 0.78 + crossJoint * exposure * jointPocket * interruption * 0.18, 0.0, 1.0);
}
float naturalSurfaceLavaFlowFabric(vec2 worldXZ) {
	float macroWarp = naturalSurfaceFbm(worldXZ / 540.0 + vec2(5.6, -9.4)) - 0.5;
	vec2 elongated = vec2(
		worldXZ.x / 235.0 + worldXZ.y / 920.0 + macroWarp * 0.62,
		worldXZ.y / 72.0 - worldXZ.x / 1180.0 - macroWarp * 0.35
	);
	float flow = naturalSurfaceFbm(elongated + vec2(11.7, -4.3));
	float shoulder = naturalSurfaceFbm(vec2(worldXZ.x / 104.0 - worldXZ.y / 520.0, worldXZ.y / 315.0 + worldXZ.x / 760.0) + vec2(-5.2, 9.8));
	return clamp(flow * 0.72 + shoulder * 0.28, 0.0, 1.0);
}
float naturalSurfaceBasaltFacet(vec2 worldXZ) {
	float broad = naturalSurfaceFbm(mat2(0.91, -0.41, 0.41, 0.91) * worldXZ / 238.0 + vec2(-7.8, 12.6));
	float chips = naturalSurfaceRidge(mat2(0.63, -0.78, 0.78, 0.63) * worldXZ / 61.0 + vec2(14.2, -3.7));
	float grain = naturalSurfaceNoise(worldXZ / 21.0 + vec2(-11.4, 18.3));
	return clamp(0.50 + (broad - 0.5) * 0.34 + (chips - 0.5) * 0.48 + (grain - 0.5) * 0.18, 0.0, 1.0);
}

// Exact hash/value-noise family used by valyriaGeology.js. The material therefore follows the same
// province-scale fault, caldera, drainage and gully carriers as the canonical height field instead of
// painting an unrelated FBM pattern over the geometry.
float naturalSurfaceValyriaHash(vec2 cell) {
	return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453123);
}
float naturalSurfaceValyriaNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	float a = naturalSurfaceValyriaHash(i);
	float b = naturalSurfaceValyriaHash(i + vec2(1.0, 0.0));
	float c = naturalSurfaceValyriaHash(i + vec2(0.0, 1.0));
	float d = naturalSurfaceValyriaHash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float naturalSurfaceValyriaSignedFbm2(vec2 p) {
	float total = 0.0;
	float amplitude = 0.5;
	float norm = 0.0;
	float frequency = 1.0;
	for (int octave = 0; octave < 2; octave++) {
		total += (naturalSurfaceValyriaNoise(p * frequency) * 2.0 - 1.0) * amplitude;
		norm += amplitude;
		amplitude *= 0.5;
		frequency *= 2.03;
	}
	return total / norm;
}
float naturalSurfaceValyriaSignedFbm3(vec2 p) {
	float total = 0.0;
	float amplitude = 0.5;
	float norm = 0.0;
	float frequency = 1.0;
	for (int octave = 0; octave < 3; octave++) {
		total += (naturalSurfaceValyriaNoise(p * frequency) * 2.0 - 1.0) * amplitude;
		norm += amplitude;
		amplitude *= 0.5;
		frequency *= 2.03;
	}
	return total / norm;
}
vec2 naturalSurfaceValyriaFrame(vec2 uv) {
	vec2 delta = (uv - vec2(${GLSL.coreX}, ${GLSL.coreY})) / vec2(${GLSL.coreRadiusX}, ${GLSL.coreRadiusY});
	float c = cos(${GLSL.faultStrike});
	float s = sin(${GLSL.faultStrike});
	return vec2(delta.x * c + delta.y * s, -delta.x * s + delta.y * c);
}
vec4 naturalSurfaceValyriaMorphology(vec2 uv) {
	vec2 frame = naturalSurfaceValyriaFrame(uv);
	float collapseA = 1.0 - abs(naturalSurfaceValyriaSignedFbm2(uv * ${GLSL.calderaFrequency} + vec2(7.1, -13.6)));
	float collapseB = 1.0 - abs(naturalSurfaceValyriaSignedFbm2(vec2(
		uv.x * (${GLSL.calderaFrequency} * 0.73) - 21.4,
		uv.y * (${GLSL.calderaFrequency} * 0.91) + 17.2)));
	float collapseField = clamp(collapseA * 0.58 + collapseB * 0.42, 0.0, 1.0);
	float shoulderBand = smoothstep(0.49, 0.73, collapseField) * (1.0 - smoothstep(0.74, 0.92, collapseField));
	float shoulderBreakup = 0.42 + 0.58 * clamp(0.5 + naturalSurfaceValyriaSignedFbm2(uv * vec2(51.7, 43.1) + vec2(-3.2, 8.4)) * 0.5, 0.0, 1.0);
	float brokenShoulder = shoulderBand * shoulderBreakup;

	float faultWarp = naturalSurfaceValyriaSignedFbm2(vec2(frame.x * 1.37 + 5.2, frame.y * 1.11 - 2.7)) * 0.22;
	float faultCarrier = naturalSurfaceValyriaSignedFbm2(vec2(
		(frame.x + faultWarp) * ${GLSL.faultAlongFrequency} + 11.3,
		frame.y * ${GLSL.faultAcrossFrequency} - 7.9));
	float faultEdge = smoothstep(0.58, 0.90, 1.0 - abs(faultCarrier));
	float faultActivity = faultEdge * (0.55 + 0.45 * abs(naturalSurfaceValyriaSignedFbm2(uv * vec2(37.2, 29.8))));

	float lavaWarp = naturalSurfaceValyriaSignedFbm2(uv * vec2(12.7, 10.9) + vec2(3.9, -5.1)) * 0.014;
	float lavaField = naturalSurfaceValyriaSignedFbm3(vec2(
		(uv.x + lavaWarp) * ${GLSL.lavaDrainageFrequency} + 19.1,
		(uv.y - lavaWarp * 0.73) * (${GLSL.lavaDrainageFrequency} * 0.77) - 28.6));
	float lavaCore = smoothstep(0.78, 0.965, 1.0 - abs(lavaField));
	float lavaBreakup = smoothstep(0.28, 0.78, naturalSurfaceValyriaNoise(uv * vec2(71.3, 59.7) + vec2(-8.2, 13.4)));
	float lavaDrainage = lavaCore * (0.38 + 0.62 * lavaBreakup);

	float gullyWarp = naturalSurfaceValyriaSignedFbm2(uv * vec2(18.2, 21.6) + vec2(-7.1, 4.6)) * 0.009;
	float gullyField = naturalSurfaceValyriaSignedFbm2(vec2(
		(uv.x + gullyWarp) * ${GLSL.erosionGullyFrequency} + 41.6,
		(uv.y - gullyWarp) * (${GLSL.erosionGullyFrequency} * 0.83) - 12.8));
	float erosionGully = smoothstep(0.86, 0.985, 1.0 - abs(gullyField));
	return vec4(faultActivity, lavaDrainage, erosionGully, brokenShoulder);
}
float naturalSurfaceValyriaStructuralRelief(vec2 uv) {
	vec4 morphology = naturalSurfaceValyriaMorphology(uv);
	return morphology.x * 0.70 - morphology.y * 0.48 - morphology.z * 0.28 + morphology.w * 0.24;
}
`;

const NATURAL_SURFACE_COLOR = `
vec3 naturalSurfacePosition = vNaturalSurfaceWorldPosition;
vec2 naturalSurfaceXZ = naturalSurfacePosition.xz;
vec3 naturalSurfaceNormalWorld = normalize(vNaturalSurfaceWorldNormal);
float naturalSurfaceSlope = 1.0 - clamp(abs(naturalSurfaceNormalWorld.y), 0.0, 1.0);
float naturalSurfaceLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
float naturalSurfaceSnow = smoothstep(0.57, 0.80, naturalSurfaceLuma);

float naturalSurfaceMacro = naturalSurfaceFbm(naturalSurfaceXZ / 1180.0 + vec2(4.7, -8.2));
float naturalSurfacePatch = naturalSurfaceFbm(naturalSurfaceXZ / 340.0 + vec2(-12.4, 6.9));
float naturalSurfaceMeso = naturalSurfaceFbm(naturalSurfaceXZ / 128.0 + vec2(21.3, 14.1));
float naturalSurfaceFine = naturalSurfaceNoise(naturalSurfaceXZ / 41.0 + vec2(-5.8, 17.2));
float naturalSurfaceLowland = (1.0 - smoothstep(${GLSL.water} + 58.0, ${GLSL.water} + 210.0, naturalSurfacePosition.y))
	* smoothstep(${GLSL.water} + 2.5, ${GLSL.water} + 16.0, naturalSurfacePosition.y) * (1.0 - naturalSurfaceSnow);
float naturalSurfaceHighPass = (naturalSurfaceMeso - naturalSurfacePatch) * 0.145 + (naturalSurfaceFine - 0.5) * 0.070;
diffuseColor.rgb *= 1.0 + naturalSurfaceHighPass * naturalSurfaceLowland;

float naturalSurfaceDomainA = naturalSurfaceLowland * smoothstep(0.55, 0.70, naturalSurfacePatch + (naturalSurfaceMeso - 0.5) * 0.22);
float naturalSurfaceDomainB = naturalSurfaceLowland * smoothstep(0.58, 0.76, 1.0 - naturalSurfacePatch + (naturalSurfaceFine - 0.5) * 0.18);
vec3 naturalSurfaceLowlandStone = vec3(0.205, 0.199, 0.176);
vec3 naturalSurfaceLowlandEarth = vec3(0.248, 0.214, 0.164);
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfaceLowlandStone, naturalSurfaceDomainA * 0.075);
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfaceLowlandEarth, naturalSurfaceDomainB * 0.065);
float naturalSurfaceLowlandMosaic = naturalSurfaceLowland
	* smoothstep(0.40, 0.66, naturalSurfacePatch * 0.55 + naturalSurfaceMeso * 0.45);
diffuseColor.rgb *= 1.0 + naturalSurfaceLowland * ((naturalSurfaceMeso - naturalSurfaceMacro) * 0.100 + (naturalSurfaceFine - 0.5) * 0.055);
diffuseColor.rgb = mix(diffuseColor.rgb, mix(naturalSurfaceLowlandStone, naturalSurfaceLowlandEarth, naturalSurfaceFine), naturalSurfaceLowlandMosaic * 0.080);
float naturalSurfaceRegionalGrain = naturalSurfaceFbm(naturalSurfaceXZ / 540.0 + vec2(37.1, -18.6));
float naturalSurfaceRegionalBed = naturalSurfaceFbm(mat2(0.88, -0.47, 0.47, 0.88) * naturalSurfaceXZ / 980.0 + vec2(-6.4, 23.7));
float naturalSurfaceRegionalHighPass = (naturalSurfaceRegionalGrain - naturalSurfaceRegionalBed) * 0.165;
float naturalSurfaceRegionalGrainMask = naturalSurfaceLowland * (1.0 - naturalSurfaceSnow * 0.86);
diffuseColor.rgb *= 1.0 + naturalSurfaceRegionalHighPass * naturalSurfaceRegionalGrainMask;
vec3 naturalSurfaceDryAlluvium = vec3(0.285, 0.248, 0.190);
vec3 naturalSurfaceWeatheredStone = vec3(0.226, 0.226, 0.207);
float naturalSurfaceRegionalLithology = smoothstep(0.38, 0.70,
	naturalSurfaceRegionalGrain * 0.58 + naturalSurfaceMeso * 0.42);
diffuseColor.rgb = mix(diffuseColor.rgb,
	mix(naturalSurfaceWeatheredStone, naturalSurfaceDryAlluvium, naturalSurfaceRegionalBed),
	naturalSurfaceRegionalGrainMask * naturalSurfaceRegionalLithology * 0.070);
vec3 naturalSurfaceDepositionalFabric = naturalSurfaceLowlandDepositionalFabric(naturalSurfaceXZ);
float naturalSurfaceSwale = naturalSurfaceRegionalGrainMask
	* smoothstep(0.56, 0.78, naturalSurfaceDepositionalFabric.x)
	* (1.0 - smoothstep(0.20, 0.55, naturalSurfaceSlope));
float naturalSurfaceDryBench = naturalSurfaceRegionalGrainMask
	* smoothstep(0.55, 0.79, naturalSurfaceDepositionalFabric.y)
	* (1.0 - naturalSurfaceSwale * 0.55);
float naturalSurfaceStoneLag = naturalSurfaceRegionalGrainMask
	* smoothstep(0.61, 0.86, naturalSurfaceDepositionalFabric.z)
	* (0.55 + naturalSurfaceDryBench * 0.45);
vec3 naturalSurfaceSwaleSoil = vec3(0.125, 0.151, 0.112);
vec3 naturalSurfaceBenchSoil = vec3(0.305, 0.264, 0.199);
vec3 naturalSurfaceLagStone = vec3(0.245, 0.246, 0.225);
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfaceSwaleSoil, naturalSurfaceSwale * 0.090);
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfaceBenchSoil, naturalSurfaceDryBench * 0.082);
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfaceLagStone, naturalSurfaceStoneLag * 0.074);
diffuseColor.rgb *= 1.0 + naturalSurfaceRegionalGrainMask
	* ((naturalSurfaceDepositionalFabric.y - naturalSurfaceDepositionalFabric.x) * 0.065
	+ (naturalSurfaceDepositionalFabric.z - 0.5) * 0.045);

float naturalSurfaceFacet = naturalSurfaceRidge(naturalSurfaceXZ / 145.0 + vec2(naturalSurfaceMacro * 2.4, naturalSurfacePatch * -1.8));
float naturalSurfaceRidgeMask = smoothstep(0.18, 0.62, naturalSurfaceSlope) * (1.0 - naturalSurfaceSnow * 0.72);
float naturalSurfaceDarkRecovery = naturalSurfaceRidgeMask * smoothstep(0.18, 0.055, naturalSurfaceLuma);
vec3 naturalSurfaceFacetStone = mix(vec3(0.205, 0.216, 0.216), vec3(0.310, 0.292, 0.263), naturalSurfaceFacet);
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfaceFacetStone, naturalSurfaceDarkRecovery * 0.34);
diffuseColor.rgb *= 1.0 + naturalSurfaceRidgeMask * (naturalSurfaceFacet - 0.5) * 0.105;
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfaceFacetStone,
	naturalSurfaceRidgeMask * (0.032 + smoothstep(0.56, 0.86, naturalSurfaceFacet) * 0.058));
diffuseColor.rgb *= 1.0 + naturalSurfaceRidgeMask * (naturalSurfaceMeso - naturalSurfacePatch) * 0.095;
float naturalSurfaceStrata = 1.0 - abs(fract((naturalSurfacePosition.y
	+ naturalSurfaceFbm(naturalSurfaceXZ / 610.0) * 48.0) / 72.0) * 2.0 - 1.0);
float naturalSurfaceStrataMask = naturalSurfaceRidgeMask * smoothstep(0.30, 0.72, naturalSurfaceSlope);
diffuseColor.rgb *= 1.0 + (naturalSurfaceStrata - 0.5) * naturalSurfaceStrataMask * 0.095;
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfaceFacetStone,
	naturalSurfaceStrataMask * smoothstep(0.62, 0.91, naturalSurfaceStrata) * 0.082);

float naturalSurfaceCoastHeight = naturalSurfacePosition.y - ${GLSL.water};
float naturalSurfaceIntertidalEnvelope = (1.0 - smoothstep(0.15, 6.5, naturalSurfaceCoastHeight)) * (1.0 - naturalSurfaceSnow);
float naturalSurfaceSprayEnvelope = (1.0 - smoothstep(1.0, 15.0, naturalSurfaceCoastHeight)) * (1.0 - naturalSurfaceIntertidalEnvelope);
float naturalSurfaceTidePatch = smoothstep(0.50, 0.77, naturalSurfaceFbm(naturalSurfaceXZ / 86.0 + vec2(18.2, -3.4)));
float naturalSurfaceMineralPatch = smoothstep(0.64, 0.86, naturalSurfaceFbm(naturalSurfaceXZ / 47.0 + vec2(-9.1, 27.5)));
float naturalSurfaceWetTide = naturalSurfaceIntertidalEnvelope * naturalSurfaceTidePatch;
float naturalSurfaceSaltEdge = naturalSurfaceSprayEnvelope * naturalSurfaceMineralPatch;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.092, 0.103, 0.098), naturalSurfaceWetTide * 0.31);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.286, 0.282, 0.254), naturalSurfaceSaltEdge * 0.11);
float naturalSurfaceNarrowWetEdge = (1.0 - smoothstep(0.25, 3.8, naturalSurfaceCoastHeight))
	* (0.34 + naturalSurfaceTidePatch * 0.38) * (1.0 - naturalSurfaceSnow);
vec3 naturalSurfaceNeutralWetRock = vec3(0.116, 0.124, 0.119);
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfaceNeutralWetRock, naturalSurfaceNarrowWetEdge * 0.34);

vec3 naturalSurfacePreValyriaColor = diffuseColor.rgb;
float naturalSurfaceValyria = naturalSurfaceValyriaInfluence(naturalSurfacePosition);
vec2 naturalSurfaceValyriaUv = naturalSurfaceOwnerUv(naturalSurfaceXZ);
vec4 naturalSurfaceValyriaMorph = naturalSurfaceValyriaMorphology(naturalSurfaceValyriaUv);
float naturalSurfaceFault = naturalSurfaceValyriaMorph.x;
float naturalSurfaceDrainage = naturalSurfaceValyriaMorph.y;
float naturalSurfaceGully = naturalSurfaceValyriaMorph.z;
float naturalSurfaceCalderaShoulder = naturalSurfaceValyriaMorph.w;
float naturalSurfaceFracture = clamp(naturalSurfaceCoolingFracture(naturalSurfaceXZ) * 0.30 + naturalSurfaceFault * 0.72, 0.0, 1.0);
float naturalSurfaceLavaFabric = naturalSurfaceLavaFlowFabric(naturalSurfaceXZ);
float naturalSurfaceLithicFacet = naturalSurfaceBasaltFacet(naturalSurfaceXZ);
// Independent noise survives only at deposition/granule scale. Province-scale material boundaries
// follow the same canonical morphology that cuts/lifts the actual terrain.
float naturalSurfaceVolcanicMacro = naturalSurfaceFbm(naturalSurfaceXZ / 760.0 + vec2(-7.6, 12.3));
float naturalSurfaceVolcanicMeso = naturalSurfaceFbm(naturalSurfaceXZ / 190.0 + vec2(16.7, -4.5));
float naturalSurfaceVolcanicFine = naturalSurfaceFbm(naturalSurfaceXZ / 54.0 + vec2(-22.8, 31.6));
float naturalSurfaceVolcanicGrain = naturalSurfaceNoise(naturalSurfaceXZ / 17.0 + vec2(8.4, -27.1));
float naturalSurfaceAsh = smoothstep(0.40, 0.72, naturalSurfaceVolcanicMacro * 0.58 + (1.0 - naturalSurfaceDrainage) * 0.20 + naturalSurfaceGully * 0.22)
	* (1.0 - naturalSurfaceSlope * 0.52);
float naturalSurfacePumice = smoothstep(0.48, 0.83, naturalSurfaceVolcanicMeso * 0.50 + naturalSurfaceCalderaShoulder * 0.62)
	* (1.0 - naturalSurfaceDrainage * 0.56);
float naturalSurfaceObsidian = smoothstep(0.22, 0.78, naturalSurfaceDrainage * 0.86 + naturalSurfaceFault * 0.26)
	* (1.0 - naturalSurfaceAsh * 0.72) * (0.40 + naturalSurfaceSlope * 0.60);
float naturalSurfaceOxidation = smoothstep(0.55, 0.86, naturalSurfaceFault * 0.64 + naturalSurfaceFbm(naturalSurfaceXZ / 116.0 + vec2(31.2, 5.7)) * 0.36)
	* smoothstep(0.10, 0.52, naturalSurfaceSlope);
float naturalSurfaceSulfur = smoothstep(0.58, 0.88, naturalSurfaceFault * 0.48 + naturalSurfaceGully * 0.42
	+ naturalSurfaceFbm(naturalSurfaceXZ / 72.0 + vec2(-13.7, 24.9)) * 0.18) * (1.0 - naturalSurfaceSlope * 0.70);
float naturalSurfaceJointShadow = smoothstep(0.56, 0.90, naturalSurfaceFracture)
	* (0.48 + naturalSurfaceVolcanicFine * 0.34 + naturalSurfaceVolcanicGrain * 0.18);
float naturalSurfaceDrainageRecess = smoothstep(0.30, 0.78, naturalSurfaceDrainage * 0.84 + naturalSurfaceGully * 0.32)
	* (0.58 + (1.0 - naturalSurfaceVolcanicFine) * 0.42);
float naturalSurfaceFlowWeathering = smoothstep(0.53, 0.80, naturalSurfaceLavaFabric) * (1.0 - naturalSurfaceAsh * 0.58);
vec3 naturalSurfaceRevisedVolcanicColor = vec3(0.142, 0.135, 0.132);
naturalSurfaceRevisedVolcanicColor = mix(naturalSurfaceRevisedVolcanicColor, vec3(0.066, 0.071, 0.079), naturalSurfaceObsidian * 0.66);
naturalSurfaceRevisedVolcanicColor = mix(naturalSurfaceRevisedVolcanicColor, vec3(0.325, 0.310, 0.292), naturalSurfaceAsh * 0.44);
naturalSurfaceRevisedVolcanicColor = mix(naturalSurfaceRevisedVolcanicColor, vec3(0.470, 0.442, 0.397), naturalSurfacePumice * 0.25);
naturalSurfaceRevisedVolcanicColor = mix(naturalSurfaceRevisedVolcanicColor, vec3(0.255, 0.145, 0.092), naturalSurfaceOxidation * 0.16);
naturalSurfaceRevisedVolcanicColor = mix(naturalSurfaceRevisedVolcanicColor, vec3(0.285, 0.263, 0.142), naturalSurfaceSulfur * 0.08);
naturalSurfaceRevisedVolcanicColor = mix(naturalSurfaceRevisedVolcanicColor, vec3(0.088, 0.087, 0.089), naturalSurfaceFracture * 0.18);
naturalSurfaceRevisedVolcanicColor = mix(naturalSurfaceRevisedVolcanicColor, vec3(0.106, 0.111, 0.113), naturalSurfaceFlowWeathering * 0.11);
naturalSurfaceRevisedVolcanicColor *= 0.90
	+ (naturalSurfaceVolcanicMacro - 0.5) * 0.10
	+ (naturalSurfaceVolcanicMeso - 0.5) * 0.13
	+ (naturalSurfaceVolcanicFine - 0.5) * 0.11
	+ (naturalSurfaceVolcanicGrain - 0.5) * 0.050
	+ (naturalSurfaceLavaFabric - 0.5) * 0.12;
naturalSurfaceRevisedVolcanicColor = mix(naturalSurfaceRevisedVolcanicColor, vec3(0.050, 0.052, 0.050), naturalSurfaceJointShadow * 0.12);
naturalSurfaceRevisedVolcanicColor = mix(naturalSurfaceRevisedVolcanicColor, vec3(0.055, 0.061, 0.063), naturalSurfaceDrainageRecess * 0.18);
float naturalSurfaceValyriaMaterialBreakup = 0.34 + naturalSurfaceFault * 0.19 + naturalSurfaceDrainage * 0.17
	+ naturalSurfaceCalderaShoulder * 0.12 + naturalSurfaceGully * 0.08 + naturalSurfaceVolcanicMacro * 0.10;
float naturalSurfaceGeologicExposure = smoothstep(0.22, 0.72,
	naturalSurfaceFault * 0.42 + naturalSurfaceDrainage * 0.30 + naturalSurfaceCalderaShoulder * 0.22 + naturalSurfaceSlope * 0.34);
float naturalSurfaceDepositionalCover = smoothstep(0.24, 0.72,
	naturalSurfaceAsh * 0.58 + naturalSurfacePumice * 0.36 + (1.0 - naturalSurfaceDrainage) * naturalSurfaceVolcanicMacro * 0.18);
float naturalSurfaceLithicExposure = smoothstep(0.46, 0.80, naturalSurfaceLithicFacet)
	* naturalSurfaceGeologicExposure * (1.0 - naturalSurfaceAsh * 0.45);
naturalSurfaceRevisedVolcanicColor = mix(naturalSurfaceRevisedVolcanicColor, vec3(0.116, 0.114, 0.111), naturalSurfaceLithicExposure * 0.24);
naturalSurfaceRevisedVolcanicColor *= 1.0 + (naturalSurfaceLithicFacet - 0.5)
	* (0.100 + naturalSurfaceGeologicExposure * 0.090);
float naturalSurfaceBrokenBoundary = smoothstep(0.08, 0.60,
	naturalSurfaceValyria + (naturalSurfaceFault - 0.35) * 0.24 + (naturalSurfaceDrainage - 0.25) * 0.18
	+ (naturalSurfaceCalderaShoulder - 0.20) * 0.14 + (naturalSurfaceVolcanicMeso - 0.5) * 0.10);
float naturalSurfaceTerrainLedBlend = naturalSurfaceBrokenBoundary
	* clamp(0.20 + naturalSurfaceValyriaMaterialBreakup * 0.30 + naturalSurfaceGeologicExposure * 0.28
		+ naturalSurfaceDepositionalCover * 0.12 + naturalSurfaceValyria * 0.16, 0.16, 0.84);
diffuseColor.rgb = mix(naturalSurfacePreValyriaColor, naturalSurfaceRevisedVolcanicColor, naturalSurfaceTerrainLedBlend);
// Canonical drainage/fault carriers remain geometry authority, but their lit ridges must not read as
// continuous pale paint. Patchy basaltic patina breaks the carrier optically without moving vertices.
float naturalSurfaceLinearCarrier = clamp(naturalSurfaceDrainage * 0.58
	+ naturalSurfaceGully * 0.48 + naturalSurfaceFault * 0.22, 0.0, 1.0);
float naturalSurfaceLinearWeatheringBreakup = smoothstep(0.34, 0.77,
	naturalSurfaceVolcanicMeso * 0.31 + (1.0 - naturalSurfaceVolcanicFine) * 0.37
	+ naturalSurfaceLithicFacet * 0.22 + naturalSurfaceVolcanicGrain * 0.10);
float naturalSurfaceLinearWeatheringPatina = naturalSurfaceValyria
	* smoothstep(0.16, 0.76, naturalSurfaceLinearCarrier)
	* mix(0.26, 0.94, naturalSurfaceLinearWeatheringBreakup);
vec3 naturalSurfaceLinearPatinaColor = mix(vec3(0.052, 0.057, 0.058), vec3(0.148, 0.091, 0.061),
	clamp(naturalSurfaceOxidation * 0.72 + naturalSurfaceSulfur * 0.12, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfaceLinearPatinaColor,
	naturalSurfaceLinearWeatheringPatina * (0.36 + naturalSurfaceSlope * 0.16));
float naturalSurfacePatchyLithicExposure = naturalSurfaceValyria
	* smoothstep(0.50, 0.79, naturalSurfaceLithicFacet * 0.56 + naturalSurfaceVolcanicFine * 0.44)
	* (1.0 - naturalSurfaceAsh * 0.38) * (0.42 + naturalSurfaceSlope * 0.58);
vec3 naturalSurfacePatchyBasalt = mix(vec3(0.076, 0.079, 0.078), vec3(0.168, 0.119, 0.083),
	naturalSurfaceOxidation * 0.58);
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfacePatchyBasalt, naturalSurfacePatchyLithicExposure * 0.20);
diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.012), vec3(0.86));
`;

const NATURAL_SURFACE_ROUGHNESS = `
vec2 naturalSurfaceRoughXZ = vNaturalSurfaceWorldPosition.xz;
float naturalSurfaceRoughDry = smoothstep(${GLSL.water} + 1.5, ${GLSL.water} + 9.0, vNaturalSurfaceWorldPosition.y);
float naturalSurfaceRoughSlope = 1.0 - clamp(abs(normalize(vNaturalSurfaceWorldNormal).y), 0.0, 1.0);
float naturalSurfaceRoughLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
float naturalSurfaceRoughSnow = smoothstep(0.62, 0.84, naturalSurfaceRoughLuma);
float naturalSurfaceRoughLowland = (1.0 - smoothstep(${GLSL.water} + 70.0, ${GLSL.water} + 225.0, vNaturalSurfaceWorldPosition.y))
	* naturalSurfaceRoughDry * (1.0 - naturalSurfaceRoughSnow);
float naturalSurfaceRoughMacro = naturalSurfaceFbm(naturalSurfaceRoughXZ / 910.0 + vec2(8.4, -3.9));
float naturalSurfaceRoughLandform = naturalSurfaceFbm(naturalSurfaceRoughXZ / 270.0 + vec2(-14.6, 17.1));
float naturalSurfaceRoughMeso = naturalSurfaceFbm(naturalSurfaceRoughXZ / 86.0 + vec2(19.7, 4.4));
float naturalSurfaceRoughGrain = naturalSurfaceNoise(naturalSurfaceRoughXZ / 34.0 + vec2(-2.8, 21.5));
vec3 naturalSurfaceRoughFabric = naturalSurfaceLowlandDepositionalFabric(naturalSurfaceRoughXZ);
float naturalSurfaceLowlandWetPolish = naturalSurfaceRoughLowland * smoothstep(0.58, 0.80, 1.0 - naturalSurfaceRoughMacro)
	* smoothstep(0.52, 0.78, 1.0 - naturalSurfaceRoughLandform);
naturalSurfaceLowlandWetPolish += naturalSurfaceRoughLowland * smoothstep(0.59, 0.80, naturalSurfaceRoughFabric.x)
	* (1.0 - smoothstep(0.24, 0.62, naturalSurfaceRoughSlope)) * 0.52;
float naturalSurfaceLowlandGranular = naturalSurfaceRoughLowland * smoothstep(0.58, 0.82, naturalSurfaceRoughMacro)
	* smoothstep(0.54, 0.80, naturalSurfaceRoughMeso);
naturalSurfaceLowlandGranular += naturalSurfaceRoughLowland * smoothstep(0.62, 0.87, naturalSurfaceRoughFabric.z) * 0.46;
float naturalSurfaceWorldRoughTarget = 0.825
	+ (naturalSurfaceRoughMacro - 0.5) * 0.135
	+ (naturalSurfaceRoughLandform - 0.5) * 0.120
	+ (naturalSurfaceRoughMeso - 0.5) * 0.105
	+ (naturalSurfaceRoughGrain - 0.5) * 0.065
	+ (naturalSurfaceRoughFabric.y - naturalSurfaceRoughFabric.x) * naturalSurfaceRoughLowland * 0.090
	+ naturalSurfaceRoughSlope * 0.040
	- naturalSurfaceLowlandWetPolish * 0.105
	+ naturalSurfaceLowlandGranular * 0.095;
float naturalSurfaceWorldRoughMix = naturalSurfaceRoughDry
	* (0.08 + naturalSurfaceRoughSlope * 0.08 + naturalSurfaceRoughLowland * 0.22)
	* (1.0 - naturalSurfaceRoughSnow * 0.78);
roughnessFactor = mix(roughnessFactor, clamp(naturalSurfaceWorldRoughTarget, 0.47, 0.99), clamp(naturalSurfaceWorldRoughMix, 0.0, 0.40));

float naturalSurfaceRoughValyria = naturalSurfaceValyriaInfluence(vNaturalSurfaceWorldPosition);
vec2 naturalSurfaceRoughUv = naturalSurfaceOwnerUv(vNaturalSurfaceWorldPosition.xz);
vec4 naturalSurfaceRoughMorph = naturalSurfaceValyriaMorphology(naturalSurfaceRoughUv);
float naturalSurfaceRoughFracture = clamp(naturalSurfaceCoolingFracture(vNaturalSurfaceWorldPosition.xz) * 0.30 + naturalSurfaceRoughMorph.x * 0.66, 0.0, 1.0);
float naturalSurfaceRoughAsh = naturalSurfaceFbm(vNaturalSurfaceWorldPosition.xz / 190.0 + vec2(16.7, -4.5));
float naturalSurfaceRoughFine = naturalSurfaceFbm(vNaturalSurfaceWorldPosition.xz / 47.0 + vec2(-22.8, 31.6));
float naturalSurfaceRoughGrainVolcanic = naturalSurfaceNoise(vNaturalSurfaceWorldPosition.xz / 15.0 + vec2(8.4, -27.1));
float naturalSurfaceRoughObsidian = clamp(naturalSurfaceRoughMorph.y * 0.84 + naturalSurfaceRoughMorph.x * 0.16, 0.0, 1.0);
float naturalSurfaceRoughLava = naturalSurfaceLavaFlowFabric(vNaturalSurfaceWorldPosition.xz);
float naturalSurfaceRoughFacet = naturalSurfaceBasaltFacet(vNaturalSurfaceWorldPosition.xz);
float naturalSurfaceRoughTarget = 0.88 + naturalSurfaceRoughAsh * 0.070 + naturalSurfaceRoughFine * 0.060 + (naturalSurfaceRoughGrainVolcanic - 0.5) * 0.065
	+ naturalSurfaceRoughMorph.w * 0.035 - naturalSurfaceRoughObsidian * 0.24 + naturalSurfaceRoughFracture * 0.024
	+ (naturalSurfaceRoughLava - 0.5) * 0.085 + (naturalSurfaceRoughFacet - 0.5) * 0.160;
roughnessFactor = mix(roughnessFactor, clamp(naturalSurfaceRoughTarget, 0.46, 0.99), naturalSurfaceRoughValyria * 0.82);
float naturalSurfaceRoughLinearCarrier = clamp(naturalSurfaceRoughMorph.y * 0.58
	+ naturalSurfaceRoughMorph.z * 0.48 + naturalSurfaceRoughMorph.x * 0.22, 0.0, 1.0);
float naturalSurfaceRoughCarrierBreakup = smoothstep(0.34, 0.77,
	naturalSurfaceRoughAsh * 0.31 + (1.0 - naturalSurfaceRoughFine) * 0.37
	+ naturalSurfaceRoughFacet * 0.22 + naturalSurfaceRoughGrainVolcanic * 0.10);
float naturalSurfaceRoughLinearPatina = naturalSurfaceRoughValyria
	* smoothstep(0.16, 0.76, naturalSurfaceRoughLinearCarrier)
	* mix(0.26, 0.94, naturalSurfaceRoughCarrierBreakup);
float naturalSurfacePatinaRoughTarget = mix(0.91, 0.98, naturalSurfaceRoughCarrierBreakup)
	- naturalSurfaceRoughObsidian * 0.12;
roughnessFactor = mix(roughnessFactor, clamp(naturalSurfacePatinaRoughTarget, 0.62, 0.99),
	naturalSurfaceRoughLinearPatina * 0.30);
`;

const NATURAL_SURFACE_NORMAL = `
float naturalSurfaceNormalDry = smoothstep(${GLSL.water} + 1.5, ${GLSL.water} + 9.0, vNaturalSurfaceWorldPosition.y);
float naturalSurfaceNormalSlope = 1.0 - clamp(abs(normalize(vNaturalSurfaceWorldNormal).y), 0.0, 1.0);
float naturalSurfaceNormalLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
float naturalSurfaceNormalSnow = smoothstep(0.62, 0.84, naturalSurfaceNormalLuma);
float naturalSurfaceNormalLowland = (1.0 - smoothstep(${GLSL.water} + 70.0, ${GLSL.water} + 225.0, vNaturalSurfaceWorldPosition.y))
	* naturalSurfaceNormalDry * (1.0 - naturalSurfaceNormalSnow);
float naturalSurfaceNormalStep = 8.0;
float naturalSurfaceReliefCenter = naturalSurfaceAllWorldRelief(vNaturalSurfaceWorldPosition.xz);
float naturalSurfaceReliefX = naturalSurfaceAllWorldRelief(vNaturalSurfaceWorldPosition.xz + vec2(naturalSurfaceNormalStep, 0.0)) - naturalSurfaceReliefCenter;
float naturalSurfaceReliefZ = naturalSurfaceAllWorldRelief(vNaturalSurfaceWorldPosition.xz + vec2(0.0, naturalSurfaceNormalStep)) - naturalSurfaceReliefCenter;
vec3 naturalSurfaceFabricCenter = naturalSurfaceLowlandDepositionalFabric(vNaturalSurfaceWorldPosition.xz);
vec3 naturalSurfaceFabricX = naturalSurfaceLowlandDepositionalFabric(vNaturalSurfaceWorldPosition.xz + vec2(naturalSurfaceNormalStep, 0.0));
vec3 naturalSurfaceFabricZ = naturalSurfaceLowlandDepositionalFabric(vNaturalSurfaceWorldPosition.xz + vec2(0.0, naturalSurfaceNormalStep));
float naturalSurfaceFabricReliefCenter = (naturalSurfaceFabricCenter.y - naturalSurfaceFabricCenter.x) * 0.58 + (naturalSurfaceFabricCenter.z - 0.5) * 0.34;
float naturalSurfaceFabricReliefX = ((naturalSurfaceFabricX.y - naturalSurfaceFabricX.x) * 0.58 + (naturalSurfaceFabricX.z - 0.5) * 0.34) - naturalSurfaceFabricReliefCenter;
float naturalSurfaceFabricReliefZ = ((naturalSurfaceFabricZ.y - naturalSurfaceFabricZ.x) * 0.58 + (naturalSurfaceFabricZ.z - 0.5) * 0.34) - naturalSurfaceFabricReliefCenter;
float naturalSurfaceWorldNormalMix = naturalSurfaceNormalDry
	* (0.10 + naturalSurfaceNormalSlope * 0.08 + naturalSurfaceNormalLowland * 0.20)
	* (1.0 - naturalSurfaceNormalSnow * 0.72);
vec3 naturalSurfaceAllWorldPerturbedNormal = normalize(vNaturalSurfaceWorldNormal + vec3(
	-(naturalSurfaceReliefX * 1.32 + naturalSurfaceFabricReliefX * naturalSurfaceNormalLowland * 1.02),
	0.0,
	-(naturalSurfaceReliefZ * 1.32 + naturalSurfaceFabricReliefZ * naturalSurfaceNormalLowland * 1.02)
));
normal = normalize(mix(normal, normalize(mat3(viewMatrix) * naturalSurfaceAllWorldPerturbedNormal), clamp(naturalSurfaceWorldNormalMix, 0.0, 0.36)));

float naturalSurfaceNormalValyria = naturalSurfaceValyriaInfluence(vNaturalSurfaceWorldPosition);
if (naturalSurfaceNormalValyria > 0.001) {
	vec3 naturalSurfaceBaseNormal = normal;
	vec2 naturalSurfaceNormalUv = naturalSurfaceOwnerUv(vNaturalSurfaceWorldPosition.xz);
	vec2 naturalSurfaceUvStepX = vec2(3.0 / ${GLSL.worldWidth}, 0.0);
	vec2 naturalSurfaceUvStepZ = vec2(0.0, 3.0 / ${GLSL.worldDepth});
	float naturalSurfaceStructuralCenter = naturalSurfaceValyriaStructuralRelief(naturalSurfaceNormalUv);
	float naturalSurfaceStructuralX = naturalSurfaceValyriaStructuralRelief(naturalSurfaceNormalUv + naturalSurfaceUvStepX) - naturalSurfaceStructuralCenter;
	float naturalSurfaceStructuralZ = naturalSurfaceValyriaStructuralRelief(naturalSurfaceNormalUv + naturalSurfaceUvStepZ) - naturalSurfaceStructuralCenter;
	float naturalSurfaceCoolingCenter = naturalSurfaceCoolingFracture(vNaturalSurfaceWorldPosition.xz);
	float naturalSurfaceCoolingX = naturalSurfaceCoolingFracture(vNaturalSurfaceWorldPosition.xz + vec2(3.0, 0.0)) - naturalSurfaceCoolingCenter;
	float naturalSurfaceCoolingZ = naturalSurfaceCoolingFracture(vNaturalSurfaceWorldPosition.xz + vec2(0.0, 3.0)) - naturalSurfaceCoolingCenter;
	float naturalSurfaceLavaCenter = naturalSurfaceLavaFlowFabric(vNaturalSurfaceWorldPosition.xz);
	float naturalSurfaceLavaX = naturalSurfaceLavaFlowFabric(vNaturalSurfaceWorldPosition.xz + vec2(4.0, 0.0)) - naturalSurfaceLavaCenter;
	float naturalSurfaceLavaZ = naturalSurfaceLavaFlowFabric(vNaturalSurfaceWorldPosition.xz + vec2(0.0, 4.0)) - naturalSurfaceLavaCenter;
	float naturalSurfaceFacetCenter = naturalSurfaceBasaltFacet(vNaturalSurfaceWorldPosition.xz);
	float naturalSurfaceFacetX = naturalSurfaceBasaltFacet(vNaturalSurfaceWorldPosition.xz + vec2(3.2, 0.0)) - naturalSurfaceFacetCenter;
	float naturalSurfaceFacetZ = naturalSurfaceBasaltFacet(vNaturalSurfaceWorldPosition.xz + vec2(0.0, 3.2)) - naturalSurfaceFacetCenter;
	vec3 naturalSurfacePerturbedWorldNormal = normalize(vNaturalSurfaceWorldNormal + vec3(
		-(naturalSurfaceStructuralX * 0.58 + naturalSurfaceCoolingX * 0.20 + naturalSurfaceLavaX * 0.24 + naturalSurfaceFacetX * 0.58),
		0.0,
		-(naturalSurfaceStructuralZ * 0.58 + naturalSurfaceCoolingZ * 0.20 + naturalSurfaceLavaZ * 0.24 + naturalSurfaceFacetZ * 0.58)
	));
	normal = normalize(mix(naturalSurfaceBaseNormal, normalize(mat3(viewMatrix) * naturalSurfacePerturbedWorldNormal), naturalSurfaceNormalValyria * ${NATURAL_SURFACE_MATERIAL_POLICY.valyriaMacroNormalBlendMax.toFixed(2)}));
	float naturalSurfaceGranuleScale = 26.0;
	float naturalSurfaceGranuleCenter = naturalSurfaceFbm(vNaturalSurfaceWorldPosition.xz / naturalSurfaceGranuleScale + vec2(4.1, -8.7));
	float naturalSurfaceGranuleX = naturalSurfaceFbm((vNaturalSurfaceWorldPosition.xz + vec2(2.4, 0.0)) / naturalSurfaceGranuleScale + vec2(4.1, -8.7)) - naturalSurfaceGranuleCenter;
	float naturalSurfaceGranuleZ = naturalSurfaceFbm((vNaturalSurfaceWorldPosition.xz + vec2(0.0, 2.4)) / naturalSurfaceGranuleScale + vec2(4.1, -8.7)) - naturalSurfaceGranuleCenter;
	vec3 naturalSurfaceGranularWorldNormal = normalize(vNaturalSurfaceWorldNormal + vec3(-naturalSurfaceGranuleX * 0.40, 0.0, -naturalSurfaceGranuleZ * 0.40));
	normal = normalize(mix(normal, normalize(mat3(viewMatrix) * naturalSurfaceGranularWorldNormal), naturalSurfaceNormalValyria * 0.085));
}
`;

export function installNaturalSurfaceMaterial(material) {
	if (!material?.isMeshStandardMaterial) throw new TypeError('natural surface material requires MeshStandardMaterial');
	const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
	const previousCacheKey = material.customProgramCacheKey.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previousOnBeforeCompile(shader, renderer);
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vNaturalSurfaceWorldPosition;\nvarying vec3 vNaturalSurfaceWorldNormal;')
			.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvNaturalSurfaceWorldNormal = normalize(mat3(modelMatrix) * objectNormal);')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvNaturalSurfaceWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${NATURAL_SURFACE_FUNCTIONS}`)
			.replace('#include <color_fragment>', `#include <color_fragment>\n${NATURAL_SURFACE_COLOR}`)
			.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${NATURAL_SURFACE_ROUGHNESS}`)
			.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${NATURAL_SURFACE_NORMAL}`);
	};
	material.customProgramCacheKey = () => `${previousCacheKey()}|${NATURAL_SURFACE_MATERIAL_POLICY.id}`;
	material.userData.naturalSurfaceMaterial = NATURAL_SURFACE_MATERIAL_POLICY;
	return material;
}