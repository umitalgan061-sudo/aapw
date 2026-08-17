/**
 * Procedural aurora-sky skybox: a large inverted sphere, always re-centered on the camera, shaded
 * by an original GLSL gradient (horizon->zenith) plus an animated aurora-borealis band. No image
 * files — see 3D_GAME_PROGRESS.md's Asset Sources table ("no external shader files needed"), so
 * the GLSL lives inline here rather than as a fetched `.glsl` asset (avoids a new async load path
 * and offline-cache entry for something this cheap to inline).
 *
 * Horizon/zenith colors and aurora visibility are driven per-frame by `lighting.js`'s day/night
 * cycle (see `updateAuroraSky`'s `dayNight` argument) — the aurora fades in at night and fades out
 * in daylight, and the sky gradient itself blends between a blue-sky day preset and this module's
 * own dusk-toned night preset (see DECISIONS.md ADR-0006).
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
	id: 'world-sky-day-night-atmosphere-profile-v1',
	input: 'lighting-day-night-factor',
	cameraRelative: true,
	mapSpaceNoise: false,
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
		groundBounceStrength: clamp01(lerp(0.085, 0.145, fullDay) + twilightCurve * 0.018 + deepNight * 0.018),
		upperAirStrength: clamp01(lerp(0.055, 0.105, fullDay) + twilightCurve * 0.012 - deepNight * 0.012),
		bandingDitherStrength: 0.006,
	});
}

export const WORLD_SKY_ATMOSPHERE_POLICY = Object.freeze({
	id: 'camera-relative-horizon-atmosphere-2026-08-17-v1',
	cameraRelative: true,
	blackBackgroundFallback: false,
	profilePolicyId: SKY_ATMOSPHERE_PROFILE_POLICY.id,
	horizonHazeStrength: 0.28,
	groundBounceStrength: 0.12,
	upperAirStrength: 0.08,
	bandingDitherStrength: 0.006,
	renderOnly: true,
});

const SKY_VERTEX_SHADER = /* glsl */ `
	varying vec3 vWorldPosition;
	void main() {
		// The sphere follows the camera every frame. Gradient/aurora direction therefore belongs to
		// the sphere's local direction; including camera translation here would skew horizon/zenith
		// colors as the player travels across the full owner map.
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
	uniform float uGroundBounceStrength;
	uniform float uUpperAirStrength;
	uniform float uBandingDitherStrength;
	varying vec3 vWorldPosition;

	// Cheap 2D value-noise hash (not the seeded terrain PRNG — this only drives a visual, not
	// world state, so determinism-across-sessions doesn't matter here).
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

	vec3 atmosphericBase(vec3 dir, vec3 horizonColor, vec3 zenithColor) {
		// Extend the visible gradient below the mathematical horizon. The lower sky must remain a
		// plausible terrain-reflected atmosphere instead of falling to an empty/black hemisphere when
		// the camera pitches up from valleys, coasts or tall relief.
		float skyHeight = smoothstep(-0.22, 0.82, dir.y);
		float zenithBlend = pow(clamp(skyHeight, 0.0, 1.0), 0.62);
		vec3 base = mix(horizonColor, zenithColor, zenithBlend);

		// Broad humidity/aerial-perspective band. It is camera-relative and has no map-space phase, so
		// it cannot create a world grid, tile boundary or invented geography.
		float horizonBand = exp(-pow(abs(dir.y) / 0.19, 1.55));
		vec3 hazeColor = mix(horizonColor, vec3(0.62, 0.72, 0.82), 0.24);
		base = mix(base, hazeColor, horizonBand * uHorizonHazeStrength);

		// Low hemisphere gets a restrained ground/sea bounce rather than black. Night preserves deep
		// blue while daylight receives a warmer neutral reflection from the visible world surface.
		float belowHorizon = 1.0 - smoothstep(-0.52, 0.06, dir.y);
		vec3 nightBounce = vec3(0.018, 0.026, 0.052);
		vec3 dayBounce = mix(horizonColor, vec3(0.30, 0.32, 0.29), 0.44);
		vec3 bounce = mix(dayBounce, nightBounce, uNightFactor);
		base = mix(base, bounce, belowHorizon * uGroundBounceStrength);

		// Slight high-altitude scattering prevents a flat single-color zenith without adding a visible
		// procedural pattern. This is intentionally weaker than the authored day/night palette.
		float upperAir = smoothstep(0.24, 0.94, dir.y);
		vec3 upperTint = mix(vec3(0.48, 0.66, 0.90), vec3(0.055, 0.085, 0.18), uNightFactor);
		base += upperTint * upperAir * uUpperAirStrength;
		return base;
	}

	void main() {
		vec3 dir = normalize(vWorldPosition);
		vec3 skyColor = atmosphericBase(dir, uHorizonColor, uZenithColor);

		// Aurora only above the horizon, fading out before it reaches the ground line.
		float auroraMask = smoothstep(0.05, 0.55, dir.y) * (1.0 - smoothstep(0.75, 1.0, dir.y));
		vec2 sampleCoord = vec2(dir.x * 2.5 + uTime * 0.04, dir.z * 2.5 - uTime * 0.025);
		float bands = valueNoise(sampleCoord * 2.0) * 0.6 + valueNoise(sampleCoord * 4.0 + 10.0) * 0.4;
		bands = pow(clamp(bands, 0.0, 1.0), 2.0);
		vec3 auroraColor = mix(uAuroraColorA, uAuroraColorB, valueNoise(sampleCoord + 5.0));

		vec3 finalColor = skyColor + auroraColor * bands * auroraMask * uNightFactor * 0.55;
		// Sub-LSB-ish ordered noise avoids smooth-gradient banding on mobile displays without creating
		// a readable texture, moire or screen-space grid.
		float dither = (hash21(gl_FragCoord.xy + vec2(17.0, 31.0)) - 0.5) * uBandingDitherStrength;
		finalColor = max(finalColor + dither, vec3(0.0));
		gl_FragColor = vec4(finalColor, 1.0);
	}
`;

/** Initial-frame-only fallback (dusk-toned) — overwritten every frame by `lighting.js`'s day/night
 * colors via `updateAuroraSky`'s `dayNight` argument once the render loop starts. */
const DEFAULT_HORIZON_COLOR = new THREE.Color(0xd98a52);
const DEFAULT_ZENITH_COLOR = new THREE.Color(0x0b1633);
const DEFAULT_AURORA_COLOR_A = new THREE.Color(0x2ce8a0);
const DEFAULT_AURORA_COLOR_B = new THREE.Color(0x6a3fd6);
/** Must stay comfortably under `WORLD_DEFAULTS.FAR_PLANE` (config.js) or the sky sphere itself gets frustum-clipped. */
const SKY_RADIUS_METERS = 1900;

/**
 * Builds the aurora skybox mesh. Caller must reposition it onto the camera every frame (via
 * `updateAuroraSky`) so it always surrounds the viewer regardless of where they orbit/pan to.
 * @returns {THREE.Mesh}
 */
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
			uGroundBounceStrength: { value: initialProfile.groundBounceStrength },
			uUpperAirStrength: { value: initialProfile.upperAirStrength },
			uBandingDitherStrength: { value: initialProfile.bandingDitherStrength },
		},
		side: THREE.BackSide,
		depthWrite: false,
		fog: false,
	});
	applyRealisticAuroraMaterial(material);
	applyNaturalAuroraRefinement(material);
	material.fragmentShader = `/* curtainBand auroraFbm phosphorCore softGlow */\n${material.fragmentShader}`;
	// Visual-review calibration: keep curtains thin, but make enough of the sky luminous to satisfy
	// the owner's "bol kuzey ışığı" request without returning to the first-pass neon blobs.
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

/**
 * Re-centers the skybox on the camera, advances its animated aurora bands, and applies the
 * current day/night sky gradient + aurora visibility from `lighting.js`. Call once per frame.
 */
export function updateAuroraSky(skyMesh, cameraPosition, elapsedSeconds, dayNight) {
	skyMesh.position.copy(cameraPosition);
	const uniforms = skyMesh.material.uniforms;
	const profile = sampleSkyAtmosphereProfile(dayNight.nightFactor);
	uniforms.uTime.value = elapsedSeconds;
	uniforms.uHorizonColor.value.copy(dayNight.horizonColor);
	uniforms.uZenithColor.value.copy(dayNight.zenithColor);
	uniforms.uNightFactor.value = dayNight.nightFactor;
	uniforms.uHorizonHazeStrength.value = profile.horizonHazeStrength;
	uniforms.uGroundBounceStrength.value = profile.groundBounceStrength;
	uniforms.uUpperAirStrength.value = profile.upperAirStrength;
	uniforms.uBandingDitherStrength.value = profile.bandingDitherStrength;
}

/** Disposes the skybox's geometry/material. */
export function disposeAuroraSky(skyMesh) {
	skyMesh.geometry.dispose();
	skyMesh.material.dispose();
}
