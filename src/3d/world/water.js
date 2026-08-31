/**
 * Sea-level water: terrain-authoritative coverage/depth with depth-safe geometric swell and
 * render-only optical realism. The water plane never owns coastline, lake membership, bathymetry
 * or collision; those stay with the canonical terrain/hydrology pipeline.
 *
 * Long swell is geometric and bounded by the baked physical-depth red channel. Fine chop, surf,
 * shelf optics, deep-marine colour/roughness breakup and celestial glints are fragment-only. The
 * green coverage channel remains the sole wet/dry render authority. The separate offshore texture
 * is boundary-connected to open sea, so marine optics never leak into enclosed lakes.
 * @module world/water
 */

import * as THREE from 'three';
import { getCelestialLightState } from '../celestialLightState.js';
import { GEOGRAPHIC_REFERENCE_PALETTE, GEOGRAPHIC_REFERENCE_PALETTE_POLICY } from './geographicReferencePalette.js';

const REFERENCE_WATER_COLORS = Object.freeze({
	shoreClear: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.shoreClear),
	lakeClear: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.lakeClear),
	deepSea: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.deepSea),
	abyss: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.abyss),
	foam: new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.water.foam),
});

export const SWELL_COMPONENTS = Object.freeze([
	Object.freeze([200, 1.05, 1.0, 0.28]),
	Object.freeze([115, 0.7, -0.42, 1.0]),
	Object.freeze([75, 0.4, 0.8, -0.6]),
]);

export const WAVE_TOTAL_AMPLITUDE_METERS = SWELL_COMPONENTS.reduce((sum, [, amplitude]) => sum + amplitude, 0);
export const WATER_OFFSHORE_OPTICAL_GAIN = 0.82;

export const WATER_SURFACE_VARIATION_POLICY = Object.freeze({
	id: 'water-world-surface-variation-2026-08-31-v7-aerial-backdrop-response',
	renderOnly: true,
	canonicalDepthUnchanged: true,
	canonicalCoverageUnchanged: true,
	macroScaleMeters: 3300,
	mesoScaleMeters: 1180,
	fineScaleMeters: 390,
	currentShearScaleMeters: 680,
	capillaryScaleMeters: 72,
	deepColorVariationMax: 0.22,
	roughnessMin: 0.20,
	roughnessMax: 0.72,
	backdropMacroScaleMeters: 6200,
	backdropMesoScaleMeters: 2300,
	backdropFineScaleMeters: 740,
	backdropRoughnessMin: 0.24,
	backdropRoughnessMax: 0.76,
	shoreBreakerRevision: 'v1-bathymetry-directed-irregular-lace',
	shoreGradientStepMeters: 68,
	directionalBreakers: true,
	nonPeriodicFoamBreakup: true,
	worldSpaceDeepBackdrop: true,
});

const WATER_VERTEX_SHADER = /* glsl */ `
	uniform float uTime;
	uniform sampler2D uDepthMap;
	uniform float uDepthFieldExtentMeters;
	uniform float uSwellStrength;
	varying vec3 vWorldPosition;
	varying float vDepthFactor;
	varying vec2 vSwellSlope;
	#include <fog_pars_vertex>

	float sampleDepthFactor(vec2 worldXZ) {
		vec2 uv = worldXZ / uDepthFieldExtentMeters + 0.5;
		if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
		return texture2D(uDepthMap, uv).r;
	}

	const float GRAVITY = 9.81;
	const float TAU = 6.28318530718;

	void addSwell(vec2 direction, float wavelength, float amplitude, vec2 worldXZ, float time, inout float height, inout vec2 slope) {
		vec2 dir = normalize(direction);
		float k = TAU / wavelength;
		float omega = sqrt(GRAVITY * k);
		float phase = k * dot(dir, worldXZ) - omega * time;
		height += amplitude * sin(phase);
		slope += dir * (amplitude * k * cos(phase));
	}

	void main() {
		vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
		float depthFactor = sampleDepthFactor(worldPos.xz);
		float swellHeight = 0.0;
		vec2 swellSlope = vec2(0.0);
		addSwell(vec2(${SWELL_COMPONENTS[0][2]}, ${SWELL_COMPONENTS[0][3]}), ${SWELL_COMPONENTS[0][0]}.0, ${SWELL_COMPONENTS[0][1]}, worldPos.xz, uTime, swellHeight, swellSlope);
		addSwell(vec2(${SWELL_COMPONENTS[1][2]}, ${SWELL_COMPONENTS[1][3]}), ${SWELL_COMPONENTS[1][0]}.0, ${SWELL_COMPONENTS[1][1]}, worldPos.xz, uTime, swellHeight, swellSlope);
		addSwell(vec2(${SWELL_COMPONENTS[2][2]}, ${SWELL_COMPONENTS[2][3]}), ${SWELL_COMPONENTS[2][0]}.0, ${SWELL_COMPONENTS[2][1]}, worldPos.xz, uTime, swellHeight, swellSlope);

		float localEdgeDistance = max(abs(position.x), abs(position.z));
		float nearCoverageFade = 1.0 - smoothstep(1500.0, 1950.0, localEdgeDistance);
		float amplitudeScale = depthFactor * uSwellStrength * nearCoverageFade;
		worldPos.y += swellHeight * amplitudeScale;
		vWorldPosition = worldPos;
		vDepthFactor = depthFactor;
		vSwellSlope = swellSlope * amplitudeScale;
		vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
		gl_Position = projectionMatrix * mvPosition;
		#include <fog_vertex>
	}
`;

const WATER_FRAGMENT_SHADER = /* glsl */ `
	uniform float uTime;
	uniform vec3 uShallowColor;
	uniform vec3 uDeepColor;
	uniform vec3 uSunDirection;
	uniform vec3 uSunColor;
	uniform float uSunIntensity;
	uniform float uNightFactor;
	uniform vec3 uCameraPosition;
	uniform sampler2D uDepthMap;
	uniform sampler2D uOffshoreMap;
	uniform float uDepthFieldExtentMeters;
	uniform float uFarLayerMask;
	varying vec3 vWorldPosition;
	varying float vDepthFactor;
	varying vec2 vSwellSlope;
	#include <fog_pars_fragment>

	vec2 sampleWaterField(vec2 worldXZ) {
		vec2 uv = worldXZ / uDepthFieldExtentMeters + 0.5;
		if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec2(1.0, 1.0);
		vec4 field = texture2D(uDepthMap, uv);
		return field.rg;
	}

	float sampleOffshoreOptical(vec2 worldXZ) {
		vec2 uv = worldXZ / uDepthFieldExtentMeters + 0.5;
		if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
		return texture2D(uOffshoreMap, uv).r;
	}

	float sampleFragmentDepth(vec2 worldXZ) {
		return sampleWaterField(worldXZ).x;
	}

	vec2 shorelineDepthGradient(vec2 worldXZ) {
		const float STEP_METERS = 68.0;
		return vec2(
			sampleFragmentDepth(worldXZ + vec2(STEP_METERS, 0.0)) - sampleFragmentDepth(worldXZ - vec2(STEP_METERS, 0.0)),
			sampleFragmentDepth(worldXZ + vec2(0.0, STEP_METERS)) - sampleFragmentDepth(worldXZ - vec2(0.0, STEP_METERS))
		);
	}

	float shorelineGradientMask(vec2 worldXZ) {
		const float STEP_METERS = 68.0;
		float eastWest = abs(sampleFragmentDepth(worldXZ + vec2(STEP_METERS, 0.0)) - sampleFragmentDepth(worldXZ - vec2(STEP_METERS, 0.0)));
		float northSouth = abs(sampleFragmentDepth(worldXZ + vec2(0.0, STEP_METERS)) - sampleFragmentDepth(worldXZ - vec2(0.0, STEP_METERS)));
		return smoothstep(0.018, 0.11, max(eastWest, northSouth));
	}

	float shelfOpticalMottle(vec2 worldXZ, float fragmentDepth) {
		float broadWarp = sin(dot(worldXZ, vec2(0.00131, -0.00107)) + sin(dot(worldXZ, vec2(-0.00047, 0.00083))) * 1.35);
		float broad = sin(dot(worldXZ, vec2(0.00203, 0.00117)) + broadWarp * 1.15);
		float mediumWarp = sin(dot(worldXZ, vec2(-0.0049, 0.0037)) + broad * 0.72);
		float medium = sin(dot(worldXZ, vec2(0.0061, -0.0043)) + mediumWarp * 0.88);
		float shelfMask = 1.0 - smoothstep(0.18, 0.62, fragmentDepth);
		return clamp((broad * 0.64 + medium * 0.36) * shelfMask, -1.0, 1.0);
	}

	float waterSurfaceHash(vec2 p) {
		p = fract(p * vec2(0.1031, 0.1030));
		p += dot(p, p.yx + 33.33);
		return fract((p.x + p.y) * p.x);
	}

	float waterSurfaceNoise(vec2 p) {
		vec2 i = floor(p);
		vec2 f = fract(p);
		f = f * f * (3.0 - 2.0 * f);
		float a = waterSurfaceHash(i);
		float b = waterSurfaceHash(i + vec2(1.0, 0.0));
		float c = waterSurfaceHash(i + vec2(0.0, 1.0));
		float d = waterSurfaceHash(i + vec2(1.0, 1.0));
		return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
	}

	float openOceanSurfaceFabric(vec2 worldXZ) {
		float warpA = waterSurfaceNoise(worldXZ / 1850.0 + vec2(8.2, -5.4));
		float warpB = waterSurfaceNoise(worldXZ / 2460.0 + vec2(-3.7, 11.6));
		vec2 warp = vec2(warpA - 0.5, warpB - 0.5) * 540.0;
		float macro = waterSurfaceNoise((worldXZ + warp) / ${WATER_SURFACE_VARIATION_POLICY.macroScaleMeters.toFixed(1)});
		float meso = waterSurfaceNoise((worldXZ * mat2(0.86, -0.51, 0.51, 0.86) - warp * 0.27) / ${WATER_SURFACE_VARIATION_POLICY.mesoScaleMeters.toFixed(1)} + vec2(17.3, -9.1));
		float fine = waterSurfaceNoise((worldXZ * mat2(0.61, 0.79, -0.79, 0.61) + warp * 0.11) / ${WATER_SURFACE_VARIATION_POLICY.fineScaleMeters.toFixed(1)} + vec2(-21.7, 4.9));
		float currentBand = 1.0 - abs(waterSurfaceNoise(vec2((worldXZ.x * 0.83 + worldXZ.y * 0.56) / 2100.0, (worldXZ.y * 0.83 - worldXZ.x * 0.56) / 760.0) + vec2(warpA, warpB)) * 2.0 - 1.0);
		return clamp((macro - 0.5) * 0.88 + (meso - 0.5) * 0.56 + (fine - 0.5) * 0.24 + (currentBand - 0.5) * 0.20, -1.0, 1.0);
	}

	float openOceanCurrentShear(vec2 worldXZ, float time) {
		vec2 primary = worldXZ * mat2(0.91, -0.41, 0.41, 0.91);
		vec2 secondary = worldXZ * mat2(0.58, 0.82, -0.82, 0.58);
		float broad = waterSurfaceNoise(primary / ${WATER_SURFACE_VARIATION_POLICY.currentShearScaleMeters.toFixed(1)} + vec2(time * 0.0018, -time * 0.0011));
		float cross = waterSurfaceNoise(secondary / 1040.0 + vec2(-13.7, 6.3) + vec2(-time * 0.0008, time * 0.0014));
		float streak = 1.0 - abs(waterSurfaceNoise(vec2(primary.x / 430.0, primary.y / 112.0) + vec2(broad * 0.61, cross * 0.33)) * 2.0 - 1.0);
		float shear = (broad - 0.5) * 0.72 + (cross - 0.5) * 0.38 + (streak - 0.5) * 0.54;
		return clamp(shear, -1.0, 1.0);
	}

	vec2 openOceanMicroSlope(vec2 worldXZ, float time, float shear) {
		float warp = sin(dot(worldXZ, vec2(0.0067, -0.0051)) + shear * 1.35 + time * 0.075);
		float c1 = sin(dot(worldXZ, vec2(0.041, 0.018)) + warp * 0.62 + time * 0.46);
		float c2 = sin(dot(worldXZ, vec2(-0.024, 0.049)) - warp * 0.47 - time * 0.38);
		float c3 = sin(dot(worldXZ, vec2(0.017, -0.031)) + shear * 0.92 + time * 0.27);
		float c4 = sin(dot(worldXZ, vec2(0.071, -0.056)) + warp * 0.24 - time * 0.62);
		return vec2(c1 + c2 * 0.58 + c4 * 0.21, c3 + c2 * 0.39 - c4 * 0.17) * 0.021;
	}

	vec2 rippleSlope(vec2 worldXZ, float time) {
		float warp = sin(dot(worldXZ, vec2(0.014, -0.011)) + time * 0.07);
		float r1 = sin(dot(worldXZ, vec2(0.095, 0.061)) + warp * 0.75 + time * 0.55);
		float r2 = sin(dot(worldXZ, vec2(-0.052, 0.083)) - warp * 0.42 - time * 0.41);
		float r3 = sin(dot(worldXZ, vec2(0.031, -0.044)) + warp * 0.58 + time * 0.29);
		return vec2(r1 + r2 * 0.55, r3 + r2 * 0.36) * 0.035;
	}

	void main() {
		if (uFarLayerMask > 0.5) {
			float nearLayerDistance = max(abs(vWorldPosition.x - uCameraPosition.x), abs(vWorldPosition.z - uCameraPosition.z));
			if (nearLayerDistance < 1999.5) discard;
		}

		vec2 waterField = sampleWaterField(vWorldPosition.xz);
		float fragmentDepth = waterField.x;
		float waterCoverage = smoothstep(0.08, 0.72, waterField.y);
		if (waterCoverage <= 0.01) discard;

		float offshoreOptical = smoothstep(0.08, 0.92, sampleOffshoreOptical(vWorldPosition.xz));
		float enclosedLakeMask = (1.0 - offshoreOptical) * (1.0 - uFarLayerMask);
		float clearShallowBand = 1.0 - smoothstep(0.10, 0.52, fragmentDepth);
		float clearCoastMask = clearShallowBand * smoothstep(0.08, 0.74, offshoreOptical);
		float offshoreGain = offshoreOptical * (1.0 - fragmentDepth) * ${WATER_OFFSHORE_OPTICAL_GAIN.toFixed(2)};
		float deepMarineMask = smoothstep(0.54, 0.96, fragmentDepth) * smoothstep(0.42, 0.94, offshoreOptical);
		float offshoreSurfaceMask = smoothstep(0.30, 0.90, offshoreOptical) * smoothstep(0.24, 0.78, fragmentDepth);
		float oceanFabric = openOceanSurfaceFabric(vWorldPosition.xz);
		float oceanShear = openOceanCurrentShear(vWorldPosition.xz, uTime);

		float cameraDistance = distance(uCameraPosition, vWorldPosition);
		float rippleFade = 1.0 - smoothstep(90.0, 360.0, cameraDistance);
		float swellShadingFade = 1.0 - smoothstep(700.0, 1800.0, cameraDistance);
		float microSlopeFade = mix(0.28, 1.0, 1.0 - smoothstep(420.0, 2200.0, cameraDistance));
		vec2 slope = vSwellSlope * swellShadingFade + rippleSlope(vWorldPosition.xz, uTime) * rippleFade;
		slope += openOceanMicroSlope(vWorldPosition.xz, uTime, oceanShear) * microSlopeFade * deepMarineMask;
		vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
		vec3 viewDir = normalize(uCameraPosition - vWorldPosition);

		vec3 bodyColor = mix(uShallowColor, uDeepColor, smoothstep(0.04, 0.82, fragmentDepth));
		bodyColor = mix(bodyColor, uDeepColor, offshoreGain * 0.88);
		float shelfMottle = shelfOpticalMottle(vWorldPosition.xz, fragmentDepth);
		float shelfVisibility = 1.0 - offshoreOptical * 0.72;
		vec3 sedimentTint = mix(uDeepColor, vec3(0.37, 0.50, 0.48), 0.78);
		bodyColor = mix(bodyColor, sedimentTint, max(shelfMottle, 0.0) * 0.34 * shelfVisibility);
		bodyColor = mix(bodyColor, uDeepColor, max(-shelfMottle, 0.0) * 0.20 * shelfVisibility);
		vec3 referenceLakeClear = vec3(${REFERENCE_WATER_COLORS.lakeClear.r.toFixed(4)}, ${REFERENCE_WATER_COLORS.lakeClear.g.toFixed(4)}, ${REFERENCE_WATER_COLORS.lakeClear.b.toFixed(4)});
		vec3 referenceShoreClear = vec3(${REFERENCE_WATER_COLORS.shoreClear.r.toFixed(4)}, ${REFERENCE_WATER_COLORS.shoreClear.g.toFixed(4)}, ${REFERENCE_WATER_COLORS.shoreClear.b.toFixed(4)});
		bodyColor = mix(bodyColor, referenceLakeClear, enclosedLakeMask * clearShallowBand * 0.34);
		bodyColor = mix(bodyColor, referenceShoreClear, clearCoastMask * 0.24);

		// Boundary-connected offshore water gets bounded kilometre- and hectometre-scale variation
		// without changing the canonical coverage or depth fields. The wider optical mask exposes
		// natural aerial fabric before the deepest bathymetric band, while enclosed lakes stay out.
		float deepLumaVariation = (oceanFabric * 0.140 + oceanShear * 0.100) * offshoreSurfaceMask;
		deepLumaVariation = clamp(deepLumaVariation, -${WATER_SURFACE_VARIATION_POLICY.deepColorVariationMax.toFixed(3)}, ${WATER_SURFACE_VARIATION_POLICY.deepColorVariationMax.toFixed(3)});
		bodyColor *= 1.0 + deepLumaVariation;
		float currentMix = clamp(0.5 + oceanFabric * 0.26 + oceanShear * 0.34, 0.0, 1.0);
		vec3 currentTint = mix(vec3(0.014, 0.041, 0.064), vec3(0.072, 0.150, 0.180), currentMix);
		float currentTintStrength = (0.060 + abs(oceanFabric) * 0.080 + abs(oceanShear) * 0.090) * offshoreSurfaceMask;
		bodyColor = mix(bodyColor, currentTint, currentTintStrength);
		vec3 nightAbsorption = vec3(0.010, 0.030, 0.052);
		bodyColor = mix(bodyColor, bodyColor * 0.62 + nightAbsorption, clamp(uNightFactor, 0.0, 1.0) * 0.34);

		float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 3.0);
		vec3 baseColor = mix(bodyColor, uShallowColor, fresnel * 0.48);

		vec3 halfVector = normalize(uSunDirection + viewDir);
		float localSlopeEnergy = clamp(length(slope) * 13.0, 0.0, 1.0);
		float roughnessDriver = clamp(0.50 + oceanFabric * 0.30 + oceanShear * 0.34 + (localSlopeEnergy - 0.5) * 0.22, 0.0, 1.0);
		float waterRoughness = mix(${WATER_SURFACE_VARIATION_POLICY.roughnessMin.toFixed(2)}, ${WATER_SURFACE_VARIATION_POLICY.roughnessMax.toFixed(2)}, roughnessDriver);
		waterRoughness = mix(0.36, waterRoughness, offshoreSurfaceMask);
		float specularPower = mix(132.0, 28.0, waterRoughness);
		float specular = pow(clamp(dot(normal, halfVector), 0.0, 1.0), specularPower);
		float specularFresnel = 0.02 + 0.98 * pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 5.0);
		float broadGlint = pow(clamp(dot(normal, halfVector), 0.0, 1.0), mix(48.0, 10.0, waterRoughness));
		float glintField = clamp(0.5 + oceanFabric * 0.31 + oceanShear * 0.42, 0.0, 1.0);
		float glintBreakup = smoothstep(0.18, 0.82, glintField) * offshoreSurfaceMask;
		vec3 celestialSpecular = uSunColor * (specular + broadGlint * glintBreakup * 0.16) * specularFresnel * (0.12 + clamp(uSunIntensity, 0.0, 1.6) * 0.34);

		float surfA = sin(dot(vWorldPosition.xz, vec2(0.018, -0.013)) + uTime * 0.55);
		float surfB = sin(dot(vWorldPosition.xz, vec2(-0.009, 0.021)) - uTime * 0.37);
		float surge = clamp(0.62 + 0.22 * surfA + 0.16 * surfB, 0.18, 1.0);
		float shallowMask = 1.0 - smoothstep(0.0, 0.22, fragmentDepth);
		shallowMask *= shorelineGradientMask(vWorldPosition.xz) * waterCoverage;
		float foam = clamp(shallowMask * surge, 0.0, 1.0);
		vec2 shoreDepthGradient = shorelineDepthGradient(vWorldPosition.xz);
		vec2 shoreNormal = shoreDepthGradient / max(length(shoreDepthGradient), 0.00001);
		vec2 shoreTangent = vec2(-shoreNormal.y, shoreNormal.x);
		float shoreMacroWarp = waterSurfaceNoise(vWorldPosition.xz / 310.0 + vec2(8.7, -4.1));
		vec2 shoreCoordinates = vec2(dot(vWorldPosition.xz, shoreTangent) / 145.0, dot(vWorldPosition.xz, shoreNormal) / 430.0);
		float alongShoreBreakup = waterSurfaceNoise(shoreCoordinates + vec2(shoreMacroWarp * 0.73, uTime * 0.018));
		float breakerPhase = sin(dot(vWorldPosition.xz, shoreNormal) * 0.042 - uTime * 0.62 + (shoreMacroWarp - 0.5) * 3.4);
		float breakerCrest = smoothstep(0.38, 0.92, breakerPhase * 0.5 + 0.5);
		float foamCell = waterSurfaceNoise(vWorldPosition.xz / 34.0 + shoreTangent * (uTime * 0.035) + vec2(19.3, -7.6));
		float foamLace = smoothstep(0.43, 0.78, foamCell * 0.58 + alongShoreBreakup * 0.42);
		float retreatGap = smoothstep(0.24, 0.70, waterSurfaceNoise(shoreCoordinates * vec2(2.7, 0.84) + vec2(-uTime * 0.011, 12.4)));
		float irregularBreaker = breakerCrest * mix(0.28, 1.0, foamLace) * mix(0.38, 1.0, alongShoreBreakup) * mix(0.56, 1.0, retreatGap);
		foam = clamp(foam * mix(0.32, 1.18, foamLace * 0.62 + alongShoreBreakup * 0.38) + shallowMask * irregularBreaker * 0.24, 0.0, 1.0);

		vec3 referenceFoam = vec3(${REFERENCE_WATER_COLORS.foam.r.toFixed(4)}, ${REFERENCE_WATER_COLORS.foam.g.toFixed(4)}, ${REFERENCE_WATER_COLORS.foam.b.toFixed(4)});
		vec3 color = mix(baseColor + celestialSpecular, referenceFoam, foam * 0.76);
		float opticalDepth = 1.0 - exp(-fragmentDepth * 3.2);
		float offshoreAbsorption = 1.0 - exp(-offshoreGain * 3.4);
		opticalDepth = 1.0 - (1.0 - opticalDepth) * (1.0 - offshoreAbsorption);
		float alpha = mix(0.14, 0.90, opticalDepth);
		alpha *= 1.0 + shelfMottle * 0.22;
		float bedReadability = max(enclosedLakeMask * clearShallowBand * 0.30, clearCoastMask * 0.18);
		alpha *= 1.0 - bedReadability;
		alpha *= waterCoverage;

		gl_FragColor = vec4(color, max(alpha, foam * 0.78));
		#include <fog_fragment>
	}
`;

const DEEP_OCEAN_BACKDROP_VERTEX_SHADER = /* glsl */ `
	varying vec3 vBackdropWorldPosition;
	#include <fog_pars_vertex>
	void main() {
		vec4 worldPosition = modelMatrix * vec4(position, 1.0);
		vBackdropWorldPosition = worldPosition.xyz;
		vec4 mvPosition = viewMatrix * worldPosition;
		gl_Position = projectionMatrix * mvPosition;
		#include <fog_vertex>
	}
`;

const DEEP_OCEAN_BACKDROP_FRAGMENT_SHADER = /* glsl */ `
	uniform vec3 uBackdropColor;
	uniform vec3 uSunDirection;
	uniform vec3 uSunColor;
	uniform float uSunIntensity;
	uniform float uNightFactor;
	uniform vec3 uCameraPosition;
	varying vec3 vBackdropWorldPosition;
	#include <fog_pars_fragment>
	float backdropHash(vec2 p) {
		p = fract(p * vec2(0.1031, 0.1030));
		p += dot(p, p.yx + 33.33);
		return fract((p.x + p.y) * p.x);
	}
	float backdropNoise(vec2 p) {
		vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
		float a = backdropHash(i); float b = backdropHash(i + vec2(1.0, 0.0));
		float c = backdropHash(i + vec2(0.0, 1.0)); float d = backdropHash(i + vec2(1.0, 1.0));
		return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
	}
	void main() {
		vec2 worldXZ = vBackdropWorldPosition.xz;
		float warpA = backdropNoise(worldXZ / 7200.0 + vec2(3.7, -8.1));
		float warpB = backdropNoise(worldXZ / 5100.0 + vec2(-9.4, 2.6));
		vec2 warp = vec2(warpA - 0.5, warpB - 0.5) * 980.0;
		float macro = backdropNoise((worldXZ + warp) / ${WATER_SURFACE_VARIATION_POLICY.backdropMacroScaleMeters.toFixed(1)});
		float meso = backdropNoise((worldXZ * mat2(0.82, -0.57, 0.57, 0.82) - warp * 0.22) / ${WATER_SURFACE_VARIATION_POLICY.backdropMesoScaleMeters.toFixed(1)} + vec2(11.8, -6.2));
		float fine = backdropNoise((worldXZ * mat2(0.53, 0.85, -0.85, 0.53) + warp * 0.09) / ${WATER_SURFACE_VARIATION_POLICY.backdropFineScaleMeters.toFixed(1)} + vec2(-4.7, 14.3));
		float streak = backdropNoise(vec2((worldXZ.x * 0.74 + worldXZ.y * 0.67) / 1450.0, (worldXZ.y * 0.74 - worldXZ.x * 0.67) / 430.0) + vec2(warpA, warpB));
		float fabric = clamp((macro - 0.5) * 0.92 + (meso - 0.5) * 0.66 + (fine - 0.5) * 0.34 + (streak - 0.5) * 0.24, -1.0, 1.0);
		float tone = clamp(0.5 + fabric * 0.66, 0.0, 1.0);
		vec3 bodyColor = mix(uBackdropColor * vec3(0.74, 0.84, 0.94), uBackdropColor * vec3(1.30, 1.22, 1.11) + vec3(0.005, 0.014, 0.019), tone);
		float slopeWarp = sin(dot(worldXZ, vec2(0.0017, -0.0012)) + fabric * 1.6);
		vec2 slope = vec2(
			sin(dot(worldXZ, vec2(0.0069, 0.0031)) + slopeWarp * 0.72) + sin(dot(worldXZ, vec2(-0.0038, 0.0081)) - slopeWarp * 0.42) * 0.55,
			sin(dot(worldXZ, vec2(0.0027, -0.0062)) - slopeWarp * 0.61) + sin(dot(worldXZ, vec2(0.0088, -0.0045)) + slopeWarp * 0.31) * 0.44
		) * 0.018;
		vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
		vec3 viewDir = normalize(uCameraPosition - vBackdropWorldPosition);
		vec3 halfVector = normalize(uSunDirection + viewDir);
		float roughnessDriver = clamp(0.50 + (macro - 0.5) * 0.18 + (meso - 0.5) * 0.62 + (fine - 0.5) * 0.74 + (streak - 0.5) * 0.38, 0.0, 1.0);
		float roughness = mix(${WATER_SURFACE_VARIATION_POLICY.backdropRoughnessMin.toFixed(2)}, ${WATER_SURFACE_VARIATION_POLICY.backdropRoughnessMax.toFixed(2)}, roughnessDriver);
		float specular = pow(clamp(dot(normal, halfVector), 0.0, 1.0), mix(92.0, 16.0, roughness));
		float broadSpecular = pow(clamp(dot(normal, halfVector), 0.0, 1.0), mix(28.0, 6.0, roughness));
		float fresnel = 0.02 + 0.98 * pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 5.0);
		float glintBreakup = smoothstep(0.26, 0.78, clamp(0.5 + fabric * 0.36 + (streak - 0.5) * 0.52, 0.0, 1.0));
		bodyColor += uSunColor * (specular + broadSpecular * glintBreakup * 0.22) * fresnel * (0.045 + clamp(uSunIntensity, 0.0, 1.6) * 0.080);
		bodyColor *= 1.0 + (roughnessDriver - 0.5) * -0.055;
		bodyColor = mix(bodyColor, bodyColor * 0.58 + vec3(0.004, 0.014, 0.026), clamp(uNightFactor, 0.0, 1.0) * 0.38);
		gl_FragColor = vec4(bodyColor, 1.0);
		#include <fog_fragment>
	}
`;

const WATER_PLANE_EXTENT_METERS = 4000;
export const WATER_FULL_WORLD_EXTENT_METERS = 17000;
export const WATER_DEEP_OCEAN_BACKDROP_EXTENT_METERS = 28000;
const WATER_DEEP_OCEAN_BACKDROP_LOCAL_Y_METERS = -32;
const WATER_PLANE_SEGMENTS = 128;
export const WATER_PLANE_SEGMENTS_DESKTOP = 320;
export const WATER_PLANE_SEGMENTS_MOBILE = 192;

const DEFAULT_SHALLOW_COLOR = new THREE.Color(0x53899a);
const DEFAULT_DEEP_COLOR = new THREE.Color(0x0c2c4a);
const DEFAULT_DEEP_OCEAN_BACKDROP_COLOR = new THREE.Color(0x071827);
DEFAULT_SHALLOW_COLOR.copy(REFERENCE_WATER_COLORS.shoreClear);
DEFAULT_DEEP_COLOR.copy(REFERENCE_WATER_COLORS.deepSea);
DEFAULT_DEEP_OCEAN_BACKDROP_COLOR.copy(REFERENCE_WATER_COLORS.abyss);
const DEFAULT_SUN_DIRECTION = new THREE.Vector3(300, 400, 200).normalize();
const DEFAULT_SUN_COLOR = new THREE.Color(0xffe2a1);

const PLACEHOLDER_DEPTH_TEXTURE = new THREE.DataTexture(
	new Uint8Array([255, 255, 255, 255]),
	1,
	1,
	THREE.RGBAFormat,
	THREE.UnsignedByteType,
);
PLACEHOLDER_DEPTH_TEXTURE.needsUpdate = true;
const PLACEHOLDER_OFFSHORE_TEXTURE = new THREE.DataTexture(
	new Uint8Array([255]),
	1,
	1,
	THREE.RedFormat,
	THREE.UnsignedByteType,
);
PLACEHOLDER_OFFSHORE_TEXTURE.needsUpdate = true;

export function createWater(waterLevelMeters, segments = WATER_PLANE_SEGMENTS) {
	const geometry = new THREE.PlaneGeometry(
		WATER_PLANE_EXTENT_METERS,
		WATER_PLANE_EXTENT_METERS,
		segments,
		segments,
	);
	geometry.rotateX(-Math.PI / 2);

	const material = new THREE.ShaderMaterial({
		vertexShader: WATER_VERTEX_SHADER,
		fragmentShader: WATER_FRAGMENT_SHADER,
		uniforms: THREE.UniformsUtils.merge([
			THREE.UniformsLib.fog,
			{
				uTime: { value: 0 },
				uShallowColor: { value: DEFAULT_SHALLOW_COLOR },
				uDeepColor: { value: DEFAULT_DEEP_COLOR },
				uSunDirection: { value: DEFAULT_SUN_DIRECTION },
				uSunColor: { value: DEFAULT_SUN_COLOR },
				uSunIntensity: { value: 1 },
				uNightFactor: { value: 0 },
				uCameraPosition: { value: new THREE.Vector3() },
				uDepthMap: { value: PLACEHOLDER_DEPTH_TEXTURE },
				uOffshoreMap: { value: PLACEHOLDER_OFFSHORE_TEXTURE },
				uDepthFieldExtentMeters: { value: 1 },
				uSwellStrength: { value: 0 },
				uFarLayerMask: { value: 0 },
			},
		]),
		transparent: true,
		depthWrite: true,
		fog: true,
	});

	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.y = waterLevelMeters;
	mesh.frustumCulled = false;
	mesh.userData.opticalProfile = Object.freeze({
		shallowAlpha: 0.14,
		deepAlpha: 0.90,
		attenuation: 3.2,
		offshoreDistanceField: true,
		offshoreOpticalGain: WATER_OFFSHORE_OPTICAL_GAIN,
		celestialSpecular: true,
		deepMarineSurfaceVariation: WATER_SURFACE_VARIATION_POLICY.id,
		deepOceanBackdropVariation: WATER_SURFACE_VARIATION_POLICY.id,
		variableRoughness: true,
		referencePalettePolicyId: GEOGRAPHIC_REFERENCE_PALETTE_POLICY.id,
		enclosedLakeBedReadable: true,
		clearCoastalDepthBand: true,
		bathymetryDirectedIrregularBreakers: true,
		nonPeriodicFoamLace: true,
		nightAbsorptionFromCelestialState: true,
	});

	const farGeometry = new THREE.PlaneGeometry(WATER_FULL_WORLD_EXTENT_METERS, WATER_FULL_WORLD_EXTENT_METERS, 1, 1);
	farGeometry.rotateX(-Math.PI / 2);
	const farMaterial = material.clone();
	farMaterial.depthWrite = false;
	farMaterial.uniforms.uFarLayerMask.value = 1;
	const farWater = new THREE.Mesh(farGeometry, farMaterial);
	farWater.position.y = -0.06;
	farWater.renderOrder = -1;
	farWater.frustumCulled = false;
	mesh.add(farWater);

	const deepOceanGeometry = new THREE.PlaneGeometry(
		WATER_DEEP_OCEAN_BACKDROP_EXTENT_METERS,
		WATER_DEEP_OCEAN_BACKDROP_EXTENT_METERS,
		1,
		1,
	);
	deepOceanGeometry.rotateX(-Math.PI / 2);
	const deepOceanMaterial = new THREE.ShaderMaterial({
		vertexShader: DEEP_OCEAN_BACKDROP_VERTEX_SHADER,
		fragmentShader: DEEP_OCEAN_BACKDROP_FRAGMENT_SHADER,
		uniforms: THREE.UniformsUtils.merge([
			THREE.UniformsLib.fog,
			{
				uBackdropColor: { value: DEFAULT_DEEP_OCEAN_BACKDROP_COLOR },
				uSunDirection: { value: DEFAULT_SUN_DIRECTION },
				uSunColor: { value: DEFAULT_SUN_COLOR },
				uSunIntensity: { value: 1 },
				uNightFactor: { value: 0 },
				uCameraPosition: { value: new THREE.Vector3() },
			},
		]),
		fog: true,
		depthTest: true,
		depthWrite: true,
	});
	const deepOceanBackdrop = new THREE.Mesh(deepOceanGeometry, deepOceanMaterial);
	deepOceanBackdrop.position.y = WATER_DEEP_OCEAN_BACKDROP_LOCAL_Y_METERS;
	deepOceanBackdrop.renderOrder = -2;
	deepOceanBackdrop.frustumCulled = false;
	mesh.add(deepOceanBackdrop);

	mesh.userData.farWater = farWater;
	mesh.userData.deepOceanBackdrop = deepOceanBackdrop;
	mesh.userData.waterCoverage = Object.freeze({
		nearExtentMeters: WATER_PLANE_EXTENT_METERS,
		fullWorldExtentMeters: WATER_FULL_WORLD_EXTENT_METERS,
		deepOceanBackdropExtentMeters: WATER_DEEP_OCEAN_BACKDROP_EXTENT_METERS,
		fullWorld: true,
	});
	return mesh;
}

export function setWaterDepthField(waterMesh, depthField, swellStrength = 1) {
	for (const material of [waterMesh.material, waterMesh.userData.farWater?.material].filter(Boolean)) {
		const { uniforms } = material;
		uniforms.uDepthMap.value = depthField.texture;
		uniforms.uOffshoreMap.value = depthField.offshoreTexture ?? PLACEHOLDER_OFFSHORE_TEXTURE;
		uniforms.uDepthFieldExtentMeters.value = depthField.extentMeters;
		uniforms.uSwellStrength.value = swellStrength;
	}
	waterMesh.userData.depthField = depthField;
}

export function updateWater(waterMesh, cameraPosition, elapsedSeconds) {
	waterMesh.position.x = cameraPosition.x;
	waterMesh.position.z = cameraPosition.z;
	const celestial = getCelestialLightState();
	for (const material of [waterMesh.material, waterMesh.userData.farWater?.material].filter(Boolean)) {
		const { uniforms } = material;
		uniforms.uTime.value = elapsedSeconds;
		uniforms.uCameraPosition.value.copy(cameraPosition);
		uniforms.uSunDirection.value.set(celestial.direction.x, celestial.direction.y, celestial.direction.z);
		uniforms.uSunColor.value.setRGB(celestial.color.r, celestial.color.g, celestial.color.b);
		uniforms.uSunIntensity.value = celestial.intensity;
		uniforms.uNightFactor.value = celestial.nightFactor;
	}
	const backdropUniforms = waterMesh.userData.deepOceanBackdrop?.material?.uniforms;
	if (backdropUniforms) {
		backdropUniforms.uCameraPosition.value.copy(cameraPosition);
		backdropUniforms.uSunDirection.value.set(celestial.direction.x, celestial.direction.y, celestial.direction.z);
		backdropUniforms.uSunColor.value.setRGB(celestial.color.r, celestial.color.g, celestial.color.b);
		backdropUniforms.uSunIntensity.value = celestial.intensity;
		backdropUniforms.uNightFactor.value = celestial.nightFactor;
	}
}

export function disposeWater(waterMesh) {
	const deepOceanBackdrop = waterMesh.userData.deepOceanBackdrop;
	if (deepOceanBackdrop) {
		deepOceanBackdrop.geometry.dispose();
		deepOceanBackdrop.material.dispose();
		waterMesh.remove(deepOceanBackdrop);
		waterMesh.userData.deepOceanBackdrop = null;
	}
	const farWater = waterMesh.userData.farWater;
	if (farWater) {
		farWater.geometry.dispose();
		farWater.material.dispose();
		waterMesh.remove(farWater);
		waterMesh.userData.farWater = null;
	}
	waterMesh.geometry.dispose();
	waterMesh.material.dispose();
	const depthField = waterMesh.userData.depthField;
	if (depthField && depthField.texture !== PLACEHOLDER_DEPTH_TEXTURE) {
		depthField.texture.dispose();
		if (depthField.offshoreTexture && depthField.offshoreTexture !== PLACEHOLDER_OFFSHORE_TEXTURE) {
			depthField.offshoreTexture.dispose();
		}
		waterMesh.userData.depthField = null;
	}
}