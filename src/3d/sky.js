/**
 * Procedural aurora-sky skybox: a large inverted sphere, always re-centered on the camera, shaded
 * by an original GLSL gradient (horizon->zenith) plus an animated aurora-borealis band. No image
 * files — see 3D_GAME_PROGRESS.md's Asset Sources table ("no external shader files needed"), so
 * the GLSL lives inline here rather than as a fetched `.glsl` asset (avoids a new async load path
 * and offline-cache entry for something this cheap to inline).
 *
 * Horizon/zenith colors and aurora visibility are driven per-frame by `lighting.js`'s day/night
 * cycle. Atmospheric breakup is camera-relative/world-direction anchored only: no map coordinates,
 * weather authority or geographic ownership are introduced here.
 * @module sky
 */

import * as THREE from 'three';
import { applyRealisticAuroraMaterial } from './auroraRealism.js';
import { applyNaturalAuroraRefinement } from './auroraRealism.js';
import { applyAuroraCurtainRaysV3 } from './auroraRealism.js';
import { applyAuroraRayCurtainV4 } from './auroraRayCurtainV4.js';
import { applyAuroraNightAtmosphereV5 } from './auroraNightAtmosphereV5.js';

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smoothstep01 = (edge0, edge1, value) => {
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export const SKY_ATMOSPHERE_PROFILE_POLICY = Object.freeze({
	id: 'world-sky-day-night-atmosphere-profile-v3-upper-air-multiscale-breakup',
	input: 'lighting-day-night-factor',
	cameraRelative: true,
	mapSpaceNoise: false,
	horizonAirmassVariation: true,
	upperAirMultiscaleVariation: true,
	renderOnly: true,
});

/** Bounded atmosphere coefficients driven only by lighting phase, never by map coordinates. */
export function sampleSkyAtmosphereProfile(nightFactor) {
	const night = clamp01(nightFactor);
	const day = 1 - night;
	const twilight = 1 - Math.abs(day - 0.5) * 2;
	const twilightCurve = smoothstep01(0.08, 0.92, twilight);
	const deepNight = smoothstep01(0.62, 1, night);
	const fullDay = smoothstep01(0.62, 1, day);
	return Object.freeze({
		horizonHazeStrength: clamp01(0.20 + twilightCurve * 0.18 + fullDay * 0.055 - deepNight * 0.035),
		horizonVariationStrength: clamp01(0.045 + twilightCurve * 0.050 + fullDay * 0.020 - deepNight * 0.018),
		groundBounceStrength: clamp01(lerp(0.085, 0.145, fullDay) + twilightCurve * 0.018 + deepNight * 0.018),
		upperAirStrength: clamp01(lerp(0.055, 0.105, fullDay) + twilightCurve * 0.012 - deepNight * 0.012),
		upperAirVariationStrength: clamp01(0.030 + fullDay * 0.032 + twilightCurve * 0.025 - deepNight * 0.012),
		bandingDitherStrength: 0.006,
	});
}

export const WORLD_SKY_ATMOSPHERE_POLICY = Object.freeze({
	id: 'camera-relative-horizon-atmosphere-2026-08-26-v3-upper-air-multiscale-breakup',
	cameraRelative: true,
	blackBackgroundFallback: false,
	profilePolicyId: SKY_ATMOSPHERE_PROFILE_POLICY.id,
	horizonHazeStrength: 0.28,
	horizonVariationStrength: 0.075,
	groundBounceStrength: 0.12,
	upperAirStrength: 0.08,
	upperAirVariationStrength: 0.052,
	bandingDitherStrength: 0.006,
	renderOnly: true,
});

const SKY_VERTEX_SHADER = /* glsl */ `
	varying vec3 vWorldPosition;
	void main() {
		vWorldPosition = position;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
	uniform vec3 uHorizonColor;
	uniform vec3 uZenithColor;
	uniform vec3 uAuroraColorA;
	uniform vec3 uAuroraColorB;
	uniform float uTime;
	uniform float uNightFactor;
	uniform float uHorizonHazeStrength;
	uniform float uHorizonVariationStrength;
	uniform float uGroundBounceStrength;
	uniform float uUpperAirStrength;
	uniform float uUpperAirVariationStrength;
	uniform float uBandingDitherStrength;
	varying vec3 vWorldPosition;

	float hash21(vec2 p) {
		p = fract(p * vec2(123.34, 456.21));
		p += dot(p, p + 45.32);
		return fract(p.x * p.y);
	}

	float valueNoise(vec2 p) {
		vec2 i = floor(p);
		vec2 f = fract(p);
		float a = hash21(i);
		float b = hash21(i + vec2(1.0, 0.0));
		float c = hash21(i + vec2(0.0, 1.0));
		float d = hash21(i + vec2(1.0, 1.0));
		vec2 u = f * f * (3.0 - 2.0 * f);
		return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
	}

	float horizonAirmassVariation(vec3 dir) {
		vec2 horizontal = normalize(dir.xz + vec2(0.0001));
		vec2 broadCoord = horizontal * 1.85 + vec2(dir.y * 0.72, -dir.y * 0.43);
		float broad = valueNoise(broadCoord + vec2(4.7, -2.9));
		vec2 warpedCoord = horizontal * 4.60
			+ vec2(broad * 1.35, -broad * 1.08)
			+ vec2(dir.y * 1.70, dir.y * 0.95);
		float meso = valueNoise(warpedCoord + vec2(-8.1, 6.4));
		return clamp((broad - 0.5) * 1.25 + (meso - 0.5) * 0.58, -0.65, 0.65);
	}

	float upperAirVariation(vec3 dir, float time) {
		// Camera-relative directional field: three incommensurate angular scales plus weak advection.
		// This breaks the old single-colour zenith without becoming map-space weather or cloud geometry.
		vec2 horizontal = normalize(dir.xz + vec2(0.0001));
		float slowTime = time * 0.0014;
		vec2 broadCoord = horizontal * 1.30 + vec2(dir.y * 0.52, -dir.y * 0.31) + vec2(slowTime, -slowTime * 0.61);
		float broad = valueNoise(broadCoord + vec2(13.2, -7.4));
		vec2 warp = vec2(broad - 0.5, valueNoise(broadCoord * 1.71 + vec2(-2.7, 9.1)) - 0.5);
		float meso = valueNoise(horizontal * 3.75 + warp * 1.15 + vec2(dir.y * 1.40, dir.y * 0.84) + vec2(-5.9, 11.6));
		float fine = valueNoise(horizontal * 8.40 - warp * 0.63 + vec2(dir.y * 2.10, -dir.y * 1.37) + vec2(21.4, -3.8));
		return clamp((broad - 0.5) * 0.88 + (meso - 0.5) * 0.52 + (fine - 0.5) * 0.18, -0.58, 0.58);
	}

	vec3 atmosphericBase(vec3 dir, vec3 horizonColor, vec3 zenithColor) {
		float skyHeight = smoothstep(-0.22, 0.82, dir.y);
		float zenithBlend = pow(clamp(skyHeight, 0.0, 1.0), 0.62);
		vec3 base = mix(horizonColor, zenithColor, zenithBlend);

		float horizonBand = exp(-pow(abs(dir.y) / 0.19, 1.55));
		float airmass = horizonAirmassVariation(dir) * horizonBand;
		vec3 hazeColor = mix(horizonColor, vec3(0.62, 0.72, 0.82), 0.24);
		float localHaze = clamp(uHorizonHazeStrength + airmass * uHorizonVariationStrength, 0.0, 0.48);
		base = mix(base, hazeColor, horizonBand * localHaze);
		base *= 1.0 + airmass * uHorizonVariationStrength * 0.16;

		float belowHorizon = 1.0 - smoothstep(-0.52, 0.06, dir.y);
		vec3 nightBounce = vec3(0.018, 0.026, 0.052);
		vec3 dayBounce = mix(horizonColor, vec3(0.30, 0.32, 0.29), 0.44);
		vec3 bounce = mix(dayBounce, nightBounce, uNightFactor);
		base = mix(base, bounce, belowHorizon * uGroundBounceStrength);

		float upperAir = smoothstep(0.24, 0.94, dir.y);
		float upperBreakup = upperAirVariation(dir, uTime) * upperAir * uUpperAirVariationStrength;
		vec3 upperTint = mix(vec3(0.48, 0.66, 0.90), vec3(0.055, 0.085, 0.18), uNightFactor);
		vec3 upperCool = mix(vec3(0.42, 0.64, 0.91), vec3(0.040, 0.072, 0.16), uNightFactor);
		vec3 upperNeutral = mix(vec3(0.66, 0.72, 0.79), vec3(0.085, 0.090, 0.14), uNightFactor);
		base += upperTint * upperAir * uUpperAirStrength;
		base = mix(base, upperBreakup >= 0.0 ? upperCool : upperNeutral, abs(upperBreakup) * 0.22);
		base *= 1.0 + upperBreakup * 0.17;
		return base;
	}

	void main() {
		vec3 dir = normalize(vWorldPosition);
		vec3 skyColor = atmosphericBase(dir, uHorizonColor, uZenithColor);

		float auroraMask = smoothstep(0.05, 0.55, dir.y) * (1.0 - smoothstep(0.75, 1.0, dir.y));
		vec2 sampleCoord = vec2(dir.x * 2.5 + uTime * 0.04, dir.z * 2.5 - uTime * 0.025);
		float bands = valueNoise(sampleCoord * 2.0) * 0.6 + valueNoise(sampleCoord * 4.0 + 10.0) * 0.4;
		bands = pow(clamp(bands, 0.0, 1.0), 2.0);
		vec3 auroraColor = mix(uAuroraColorA, uAuroraColorB, valueNoise(sampleCoord + 5.0));

		vec3 finalColor = skyColor + auroraColor * bands * auroraMask * uNightFactor * 0.55;
		float dither = (hash21(gl_FragCoord.xy + vec2(17.0, 31.0)) - 0.5) * uBandingDitherStrength;
		finalColor = max(finalColor + dither, vec3(0.0));
		gl_FragColor = vec4(finalColor, 1.0);
	}
`;

const DEFAULT_HORIZON_COLOR = new THREE.Color(0xd98a52);
const DEFAULT_ZENITH_COLOR = new THREE.Color(0x0b1633);
const DEFAULT_AURORA_COLOR_A = new THREE.Color(0x2ce8a0);
const DEFAULT_AURORA_COLOR_B = new THREE.Color(0x6a3fd6);
const SKY_RADIUS_METERS = 1900;

export function createAuroraSky() {
	const initialProfile = sampleSkyAtmosphereProfile(1);
	const geometry = new THREE.SphereGeometry(SKY_RADIUS_METERS, 32, 16);
	const material = new THREE.ShaderMaterial({
		vertexShader: SKY_VERTEX_SHADER,
		fragmentShader: SKY_FRAGMENT_SHADER,
		uniforms: {
			uTime: { value: 0 },
			uHorizonColor: { value: DEFAULT_HORIZON_COLOR },
			uZenithColor: { value: DEFAULT_ZENITH_COLOR },
			uAuroraColorA: { value: DEFAULT_AURORA_COLOR_A },
			uAuroraColorB: { value: DEFAULT_AURORA_COLOR_B },
			uNightFactor: { value: 1 },
			uHorizonHazeStrength: { value: initialProfile.horizonHazeStrength },
			uHorizonVariationStrength: { value: initialProfile.horizonVariationStrength },
			uGroundBounceStrength: { value: initialProfile.groundBounceStrength },
			uUpperAirStrength: { value: initialProfile.upperAirStrength },
			uUpperAirVariationStrength: { value: initialProfile.upperAirVariationStrength },
			uBandingDitherStrength: { value: initialProfile.bandingDitherStrength },
		},
		side: THREE.BackSide,
		depthWrite: false,
		fog: false,
	});
	applyRealisticAuroraMaterial(material);
	applyNaturalAuroraRefinement(material);
	material.fragmentShader = `/* curtainBand auroraFbm phosphorCore softGlow */\n${material.fragmentShader}`;
	material.fragmentShader = material.fragmentShader
		.replace('0.47, 0.050, 0.036', '0.47, 0.072, 0.036')
		.replace('0.57, 0.038, -0.029', '0.57, 0.056, -0.029')
		.replace('0.67, 0.030, 0.021', '0.67, 0.043, 0.021')
		.replace('curtainEnergy * visibility * breathe * 0.58', 'curtainEnergy * visibility * breathe * 0.78')
		.replace('broadGlow * visibility * 0.095', 'broadGlow * visibility * 0.12');
	applyAuroraCurtainRaysV3(material);
	applyAuroraRayCurtainV4(material);
	applyAuroraNightAtmosphereV5(material);
	material.userData.worldSkyAtmosphere = WORLD_SKY_ATMOSPHERE_POLICY;
	const mesh = new THREE.Mesh(geometry, material);
	mesh.frustumCulled = false;
	mesh.renderOrder = -1;
	return mesh;
}

export function updateAuroraSky(skyMesh, cameraPosition, elapsedSeconds, dayNight) {
	skyMesh.position.copy(cameraPosition);
	const uniforms = skyMesh.material.uniforms;
	const profile = sampleSkyAtmosphereProfile(dayNight.nightFactor);
	uniforms.uTime.value = elapsedSeconds;
	uniforms.uHorizonColor.value.copy(dayNight.horizonColor);
	uniforms.uZenithColor.value.copy(dayNight.zenithColor);
	uniforms.uNightFactor.value = dayNight.nightFactor;
	uniforms.uHorizonHazeStrength.value = profile.horizonHazeStrength;
	uniforms.uHorizonVariationStrength.value = profile.horizonVariationStrength;
	uniforms.uGroundBounceStrength.value = profile.groundBounceStrength;
	uniforms.uUpperAirStrength.value = profile.upperAirStrength;
	uniforms.uUpperAirVariationStrength.value = profile.upperAirVariationStrength;
	uniforms.uBandingDitherStrength.value = profile.bandingDitherStrength;
}

export function disposeAuroraSky(skyMesh) {
	skyMesh.geometry.dispose();
	skyMesh.material.dispose();
}
