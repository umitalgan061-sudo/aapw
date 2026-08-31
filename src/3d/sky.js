/**
 * Camera-follow procedural sky with final V4 aurora curtains and V5 night calibration.
 *
 * `lighting.js` remains the day/night authority. Atmosphere breakup is camera-relative directional
 * rendering only: no map coordinates, weather authority or geographic ownership are introduced.
 * The final V4 shader consumes the same profile uniforms `updateAuroraSky()` updates every frame.
 * @module sky
 */

import * as THREE from 'three';
import { applyAuroraRayCurtainV4 } from './auroraRayCurtainV4.js';
import { applyAuroraNightAtmosphereV5 } from './auroraNightAtmosphereV5.js';

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smoothstep01 = (edge0, edge1, value) => {
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export const SKY_ATMOSPHERE_PROFILE_POLICY = Object.freeze({
	id: 'world-sky-day-night-atmosphere-profile-v4-final-shader-wired',
	input: 'lighting-day-night-factor',
	cameraRelative: true,
	mapSpaceNoise: false,
	horizonAirmassVariation: true,
	upperAirMultiscaleVariation: true,
	finalShaderConsumesProfile: true,
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
	id: 'camera-relative-horizon-atmosphere-2026-08-31-v4-final-shader-wired',
	cameraRelative: true,
	blackBackgroundFallback: false,
	profilePolicyId: SKY_ATMOSPHERE_PROFILE_POLICY.id,
	horizonHazeStrength: 0.28,
	horizonVariationStrength: 0.075,
	groundBounceStrength: 0.12,
	upperAirStrength: 0.08,
	upperAirVariationStrength: 0.052,
	bandingDitherStrength: 0.006,
	finalShaderConsumesProfile: true,
	renderOnly: true,
});

const SKY_VERTEX_SHADER = /* glsl */ `
	varying vec3 vWorldPosition;
	void main() {
		vWorldPosition = position;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

// V4 replaces this before the first render. Keeping a tiny valid fallback makes ShaderMaterial
// construction explicit without retaining the superseded full pre-V4 aurora implementation.
const SKY_INITIAL_FRAGMENT_SHADER = /* glsl */ `
	uniform vec3 uHorizonColor;
	uniform vec3 uZenithColor;
	varying vec3 vWorldPosition;
	void main() {
		vec3 dir = normalize(vWorldPosition - cameraPosition);
		float heightFactor = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
		gl_FragColor = vec4(mix(uHorizonColor, uZenithColor, pow(heightFactor, 0.55)), 1.0);
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
		fragmentShader: SKY_INITIAL_FRAGMENT_SHADER,
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
