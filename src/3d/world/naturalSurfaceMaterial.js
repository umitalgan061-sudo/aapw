/**
 * Deterministic world-space material naturalisation for the canonical terrain mesh.
 * This module only modifies fragment albedo, normal response and roughness. It never writes
 * positions, height samples, water classification, shoreline masks or collider data.
 * @module world/naturalSurfaceMaterial
 */

import { WORLD_DEFAULTS, WORLD_SCALE } from '../config.js';
import { VALYRIA_GEOLOGY_POLICY } from './valyriaGeology.js';

export const NATURAL_SURFACE_MATERIAL_POLICY = Object.freeze({
	id: 'natural-surface-material-2026-08-31-v1-valyria-world-space-pbr',
	renderOnly: true,
	deterministic: true,
	canonicalHeightUnchanged: true,
	canonicalHydrologyUnchanged: true,
	canonicalColliderUnchanged: true,
	canonicalCoastlineUnchanged: true,
	newGeographyIntroduced: false,
	valyriaAuthorityPolicyId: VALYRIA_GEOLOGY_POLICY.id,
	valyriaMaterials: Object.freeze(['basalt', 'obsidian', 'ash', 'pumice', 'oxidation', 'sulfuric-weathering']),
	worldSpaceAlbedoVariation: true,
	worldSpaceNormalVariation: true,
	worldSpaceRoughnessVariation: true,
	lowlandHighPassMosaic: true,
	ridgeFacetRecovery: true,
	patchyIntertidalTransition: true,
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
	vec2 warped = worldXZ + (vec2(naturalSurfaceFbm(worldXZ / 420.0), naturalSurfaceFbm(worldXZ / 370.0 + 19.4)) - 0.5) * 92.0;
	float jointA = 1.0 - smoothstep(0.025, 0.115, abs(naturalSurfaceFbm(warped / 58.0 + vec2(7.3, -11.8)) - 0.5));
	float jointB = 1.0 - smoothstep(0.018, 0.085, abs(naturalSurfaceFbm(mat2(0.58, -0.81, 0.81, 0.58) * warped / 24.0) - 0.5));
	return clamp(jointA * 0.72 + jointB * 0.46, 0.0, 1.0);
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
float naturalSurfaceHighPass = (naturalSurfaceMeso - naturalSurfacePatch) * 0.115 + (naturalSurfaceFine - 0.5) * 0.055;
diffuseColor.rgb *= 1.0 + naturalSurfaceHighPass * naturalSurfaceLowland;

float naturalSurfaceDomainA = naturalSurfaceLowland * smoothstep(0.55, 0.70, naturalSurfacePatch + (naturalSurfaceMeso - 0.5) * 0.22);
float naturalSurfaceDomainB = naturalSurfaceLowland * smoothstep(0.58, 0.76, 1.0 - naturalSurfacePatch + (naturalSurfaceFine - 0.5) * 0.18);
vec3 naturalSurfaceLowlandStone = vec3(0.205, 0.199, 0.176);
vec3 naturalSurfaceLowlandEarth = vec3(0.248, 0.214, 0.164);
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfaceLowlandStone, naturalSurfaceDomainA * 0.075);
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfaceLowlandEarth, naturalSurfaceDomainB * 0.065);

float naturalSurfaceFacet = naturalSurfaceRidge(naturalSurfaceXZ / 145.0 + vec2(naturalSurfaceMacro * 2.4, naturalSurfacePatch * -1.8));
float naturalSurfaceRidgeMask = smoothstep(0.18, 0.62, naturalSurfaceSlope) * (1.0 - naturalSurfaceSnow * 0.72);
float naturalSurfaceDarkRecovery = naturalSurfaceRidgeMask * smoothstep(0.18, 0.055, naturalSurfaceLuma);
vec3 naturalSurfaceFacetStone = mix(vec3(0.205, 0.216, 0.216), vec3(0.310, 0.292, 0.263), naturalSurfaceFacet);
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfaceFacetStone, naturalSurfaceDarkRecovery * 0.34);
diffuseColor.rgb *= 1.0 + naturalSurfaceRidgeMask * (naturalSurfaceFacet - 0.5) * 0.095;

float naturalSurfaceCoastHeight = naturalSurfacePosition.y - ${GLSL.water};
float naturalSurfaceIntertidalEnvelope = (1.0 - smoothstep(0.15, 6.5, naturalSurfaceCoastHeight)) * (1.0 - naturalSurfaceSnow);
float naturalSurfaceSprayEnvelope = (1.0 - smoothstep(1.0, 15.0, naturalSurfaceCoastHeight)) * (1.0 - naturalSurfaceIntertidalEnvelope);
float naturalSurfaceTidePatch = smoothstep(0.50, 0.77, naturalSurfaceFbm(naturalSurfaceXZ / 86.0 + vec2(18.2, -3.4)));
float naturalSurfaceMineralPatch = smoothstep(0.64, 0.86, naturalSurfaceFbm(naturalSurfaceXZ / 47.0 + vec2(-9.1, 27.5)));
float naturalSurfaceWetTide = naturalSurfaceIntertidalEnvelope * naturalSurfaceTidePatch;
float naturalSurfaceSaltEdge = naturalSurfaceSprayEnvelope * naturalSurfaceMineralPatch;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.092, 0.103, 0.098), naturalSurfaceWetTide * 0.31);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.286, 0.282, 0.254), naturalSurfaceSaltEdge * 0.11);

float naturalSurfaceValyria = naturalSurfaceValyriaInfluence(naturalSurfacePosition);
float naturalSurfaceFracture = naturalSurfaceCoolingFracture(naturalSurfaceXZ);
float naturalSurfaceVolcanicMacro = naturalSurfaceFbm(naturalSurfaceXZ / 760.0 + vec2(-7.6, 12.3));
float naturalSurfaceVolcanicMeso = naturalSurfaceFbm(naturalSurfaceXZ / 190.0 + vec2(16.7, -4.5));
float naturalSurfaceFlow = naturalSurfaceFbm(vec2(naturalSurfaceXZ.x / 94.0 + naturalSurfaceXZ.y / 510.0, naturalSurfaceXZ.y / 230.0 - naturalSurfaceXZ.x / 690.0));
float naturalSurfaceAsh = smoothstep(0.43, 0.72, naturalSurfaceVolcanicMacro) * (1.0 - naturalSurfaceSlope * 0.52);
float naturalSurfacePumice = smoothstep(0.67, 0.88, naturalSurfaceVolcanicMeso) * smoothstep(0.35, 0.74, naturalSurfaceFlow);
float naturalSurfaceObsidian = smoothstep(0.58, 0.83, naturalSurfaceFlow) * (1.0 - naturalSurfaceAsh) * (0.44 + naturalSurfaceSlope * 0.56);
float naturalSurfaceOxidation = smoothstep(0.55, 0.81, naturalSurfaceFbm(naturalSurfaceXZ / 116.0 + vec2(31.2, 5.7))) * smoothstep(0.12, 0.55, naturalSurfaceSlope);
float naturalSurfaceSulfur = smoothstep(0.69, 0.89, naturalSurfaceFbm(naturalSurfaceXZ / 72.0 + vec2(-13.7, 24.9))) * (1.0 - naturalSurfaceSlope * 0.70);
vec3 naturalSurfaceBasaltColor = vec3(0.105, 0.103, 0.105);
vec3 naturalSurfaceVolcanicColor = naturalSurfaceBasaltColor;
naturalSurfaceVolcanicColor = mix(naturalSurfaceVolcanicColor, vec3(0.055, 0.062, 0.071), naturalSurfaceObsidian * 0.74);
naturalSurfaceVolcanicColor = mix(naturalSurfaceVolcanicColor, vec3(0.305, 0.292, 0.275), naturalSurfaceAsh * 0.62);
naturalSurfaceVolcanicColor = mix(naturalSurfaceVolcanicColor, vec3(0.455, 0.430, 0.385), naturalSurfacePumice * 0.46);
naturalSurfaceVolcanicColor = mix(naturalSurfaceVolcanicColor, vec3(0.305, 0.132, 0.074), naturalSurfaceOxidation * 0.34);
naturalSurfaceVolcanicColor = mix(naturalSurfaceVolcanicColor, vec3(0.405, 0.348, 0.142), naturalSurfaceSulfur * 0.23);
naturalSurfaceVolcanicColor = mix(naturalSurfaceVolcanicColor, vec3(0.025, 0.027, 0.031), naturalSurfaceFracture * 0.76);
diffuseColor.rgb = mix(diffuseColor.rgb, naturalSurfaceVolcanicColor, naturalSurfaceValyria * 0.88);
diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.012), vec3(0.86));
`;

const NATURAL_SURFACE_ROUGHNESS = `
float naturalSurfaceRoughValyria = naturalSurfaceValyriaInfluence(vNaturalSurfaceWorldPosition);
float naturalSurfaceRoughFracture = naturalSurfaceCoolingFracture(vNaturalSurfaceWorldPosition.xz);
float naturalSurfaceRoughAsh = naturalSurfaceFbm(vNaturalSurfaceWorldPosition.xz / 190.0 + vec2(16.7, -4.5));
float naturalSurfaceRoughObsidian = smoothstep(0.58, 0.83, naturalSurfaceFbm(vec2(vNaturalSurfaceWorldPosition.x / 94.0 + vNaturalSurfaceWorldPosition.z / 510.0, vNaturalSurfaceWorldPosition.z / 230.0 - vNaturalSurfaceWorldPosition.x / 690.0)));
float naturalSurfaceRoughTarget = 0.91 + naturalSurfaceRoughAsh * 0.075 - naturalSurfaceRoughObsidian * 0.22 - naturalSurfaceRoughFracture * 0.05;
roughnessFactor = mix(roughnessFactor, clamp(naturalSurfaceRoughTarget, 0.52, 0.99), naturalSurfaceRoughValyria * 0.84);
`;

const NATURAL_SURFACE_NORMAL = `
float naturalSurfaceNormalValyria = naturalSurfaceValyriaInfluence(vNaturalSurfaceWorldPosition);
if (naturalSurfaceNormalValyria > 0.001) {
	float naturalSurfaceNormalStep = 3.0;
	float naturalSurfaceCenter = naturalSurfaceCoolingFracture(vNaturalSurfaceWorldPosition.xz);
	float naturalSurfaceGradientX = naturalSurfaceCoolingFracture(vNaturalSurfaceWorldPosition.xz + vec2(naturalSurfaceNormalStep, 0.0)) - naturalSurfaceCenter;
	float naturalSurfaceGradientZ = naturalSurfaceCoolingFracture(vNaturalSurfaceWorldPosition.xz + vec2(0.0, naturalSurfaceNormalStep)) - naturalSurfaceCenter;
	vec3 naturalSurfacePerturbedWorldNormal = normalize(vNaturalSurfaceWorldNormal + vec3(-naturalSurfaceGradientX * 0.72, 0.0, -naturalSurfaceGradientZ * 0.72));
	normal = normalize(mix(normal, normalize(mat3(viewMatrix) * naturalSurfacePerturbedWorldNormal), naturalSurfaceNormalValyria * 0.48));
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

