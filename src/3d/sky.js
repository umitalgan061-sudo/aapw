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

const SKY_VERTEX_SHADER = /* glsl */ `
	varying vec3 vWorldPosition;
	void main() {
		vec4 worldPosition = modelMatrix * vec4(position, 1.0);
		vWorldPosition = worldPosition.xyz;
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

	void main() {
		vec3 dir = normalize(vWorldPosition);
		float heightFactor = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
		vec3 skyColor = mix(uHorizonColor, uZenithColor, pow(heightFactor, 0.55));

		// Aurora only above the horizon, fading out before it reaches the ground line.
		float auroraMask = smoothstep(0.05, 0.55, dir.y) * (1.0 - smoothstep(0.75, 1.0, dir.y));
		vec2 sampleCoord = vec2(dir.x * 2.5 + uTime * 0.04, dir.z * 2.5 - uTime * 0.025);
		float bands = valueNoise(sampleCoord * 2.0) * 0.6 + valueNoise(sampleCoord * 4.0 + 10.0) * 0.4;
		bands = pow(clamp(bands, 0.0, 1.0), 2.0);
		vec3 auroraColor = mix(uAuroraColorA, uAuroraColorB, valueNoise(sampleCoord + 5.0));

		vec3 finalColor = skyColor + auroraColor * bands * auroraMask * uNightFactor * 0.55;
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
		},
		side: THREE.BackSide,
		depthWrite: false,
		fog: false,
	});
	applyRealisticAuroraMaterial(material);
	const mesh = new THREE.Mesh(geometry, material);
	mesh.frustumCulled = false; // it must never disappear — it always surrounds the camera by construction.
	mesh.renderOrder = -1; // draw first so opaque terrain/props overdraw it normally, not the other way around.
	return mesh;
}

/**
 * Re-centers the skybox on the camera, advances its animated aurora bands, and applies the
 * current day/night sky gradient + aurora visibility from `lighting.js`. Call once per frame.
 * @param {THREE.Mesh} skyMesh
 * @param {THREE.Vector3} cameraPosition
 * @param {number} elapsedSeconds
 * @param {{horizonColor: THREE.Color, zenithColor: THREE.Color, nightFactor: number}} dayNight - the
 *   object returned by `lighting.js`'s `updateDayNightLighting`.
 */
export function updateAuroraSky(skyMesh, cameraPosition, elapsedSeconds, dayNight) {
	skyMesh.position.copy(cameraPosition);
	const uniforms = skyMesh.material.uniforms;
	uniforms.uTime.value = elapsedSeconds;
	uniforms.uHorizonColor.value.copy(dayNight.horizonColor);
	uniforms.uZenithColor.value.copy(dayNight.zenithColor);
	uniforms.uNightFactor.value = dayNight.nightFactor;
}

/**
 * Disposes the skybox's geometry/material. Call on teardown — see the project's memory-leak
 * checklist.
 * @param {THREE.Mesh} skyMesh
 */
export function disposeAuroraSky(skyMesh) {
	skyMesh.geometry.dispose();
	skyMesh.material.dispose();
}

// Run222 additive-only aurora realism override. Kept in this existing cached module so offline/PWA
// installs need no new module entry and the established sky public API remains unchanged.
const REALISTIC_AURORA_FRAGMENT_SHADER = /* glsl */ `
	uniform vec3 uHorizonColor;
	uniform vec3 uZenithColor;
	uniform vec3 uAuroraColorA;
	uniform vec3 uAuroraColorB;
	uniform float uTime;
	uniform float uNightFactor;
	varying vec3 vWorldPosition;

	float auroraHash21(vec2 p) {
		p = fract(p * vec2(123.34, 456.21));
		p += dot(p, p + 45.32);
		return fract(p.x * p.y);
	}

	float auroraNoise(vec2 p) {
		vec2 i = floor(p);
		vec2 f = fract(p);
		float a = auroraHash21(i);
		float b = auroraHash21(i + vec2(1.0, 0.0));
		float c = auroraHash21(i + vec2(0.0, 1.0));
		float d = auroraHash21(i + vec2(1.0, 1.0));
		vec2 u = f * f * (3.0 - 2.0 * f);
		return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
	}

	float auroraFbm(vec2 p) {
		float value = 0.0;
		float amplitude = 0.56;
		mat2 rot = mat2(0.82, -0.57, 0.57, 0.82);
		for (int octave = 0; octave < 3; octave++) {
			value += auroraNoise(p) * amplitude;
			p = rot * p * 2.03 + vec2(13.7, 8.3);
			amplitude *= 0.5;
		}
		return value;
	}

	float curtainBand(vec2 p, float phase, float width, float drift) {
		float slowTime = uTime * drift;
		float broadWarp = auroraFbm(vec2(p.x * 0.48 + phase, slowTime * 0.08 + p.y * 0.18));
		float fineWarp = auroraFbm(vec2(p.x * 1.35 - phase * 0.7, p.y * 0.48 - slowTime * 0.13));
		float center = 0.48 + sin(p.x * 2.35 + phase + slowTime) * 0.105;
		center += (broadWarp - 0.5) * 0.22 + (fineWarp - 0.5) * 0.075;
		float ribbon = 1.0 - smoothstep(width, width + 0.12, abs(p.y - center));
		float verticalStriation = pow(0.5 + 0.5 * sin(p.x * 28.0 + fineWarp * 12.0 + slowTime * 2.1), 4.0);
		float brokenEdge = smoothstep(0.25, 0.78, auroraNoise(vec2(p.x * 5.4 + phase * 2.0, p.y * 2.4 - slowTime * 0.18)));
		return ribbon * mix(0.42, 1.0, verticalStriation) * mix(0.58, 1.0, brokenEdge);
	}

	void main() {
		vec3 dir = normalize(vWorldPosition);
		float heightFactor = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
		vec3 skyColor = mix(uHorizonColor, uZenithColor, pow(heightFactor, 0.55));
		float azimuth = atan(dir.z, dir.x) / 6.28318530718 + 0.5;
		float elevation = clamp(dir.y, -0.05, 1.0);
		vec2 curtainUv = vec2(azimuth * 3.0, elevation);
		float auroraMask = smoothstep(0.055, 0.24, elevation) * (1.0 - smoothstep(0.86, 1.0, elevation));

		float curtainA = curtainBand(curtainUv, 0.3, 0.115, 0.055);
		float curtainB = curtainBand(curtainUv + vec2(0.42, 0.055), 2.1, 0.09, -0.042);
		float curtainC = curtainBand(curtainUv + vec2(-0.31, 0.12), 4.2, 0.07, 0.031);
		float layeredCurtain = curtainA * 0.72 + curtainB * 0.48 + curtainC * 0.34;
		float slowPulse = 0.86 + 0.14 * sin(uTime * 0.23 + auroraNoise(curtainUv * 1.1) * 6.28318530718);
		float phosphorCore = pow(clamp(layeredCurtain, 0.0, 1.6), 1.32) * slowPulse;
		float softGlow = pow(clamp(curtainA * 0.55 + curtainB * 0.4 + curtainC * 0.3, 0.0, 1.0), 0.62);

		float colorNoise = auroraNoise(vec2(curtainUv.x * 1.6 + uTime * 0.009, curtainUv.y * 0.9 + 5.0));
		vec3 greenCyan = mix(uAuroraColorA, vec3(0.14, 1.0, 0.82), 0.48);
		vec3 violetEdge = mix(uAuroraColorB, vec3(0.62, 0.30, 1.0), 0.38);
		vec3 auroraColor = mix(greenCyan, violetEdge, smoothstep(0.58, 0.94, colorNoise));
		float luminance = (phosphorCore * 0.92 + softGlow * 0.32) * auroraMask * uNightFactor;
		vec3 atmosphericLift = greenCyan * softGlow * auroraMask * uNightFactor * 0.07;
		gl_FragColor = vec4(skyColor + atmosphericLift + auroraColor * luminance, 1.0);
	}
`;

function applyRealisticAuroraMaterial(material) {
	material.fragmentShader = REALISTIC_AURORA_FRAGMENT_SHADER;
	material.needsUpdate = true;
	material.userData.realisticAurora = true;
}
