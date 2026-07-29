/**
 * Procedural aurora-sky skybox: a large inverted sphere, always re-centered on the camera, shaded
 * by an original GLSL gradient (horizon->zenith) plus an animated aurora-borealis band. No image
 * files — see 3D_GAME_PROGRESS.md's Asset Sources table ("no external shader files needed"), so
 * the GLSL lives inline here rather than as a fetched `.glsl` asset (avoids a new async load path
 * and offline-cache entry for something this cheap to inline).
 *
 * This is a Phase 1 placeholder: always-on aurora, not gated by time-of-day (there is no day/night
 * system yet — that's Phase 2's `lighting.js`). Revisit then to fade the aurora in only at night.
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

		vec3 finalColor = skyColor + auroraColor * bands * auroraMask * 0.55;
		gl_FragColor = vec4(finalColor, 1.0);
	}
`;

/** Dusk-toned horizon/zenith gradient, chosen to read consistently with the existing warm sun/hemisphere lights in `game3d.js`. */
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
		},
		side: THREE.BackSide,
		depthWrite: false,
		fog: false,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.frustumCulled = false; // it must never disappear — it always surrounds the camera by construction.
	mesh.renderOrder = -1; // draw first so opaque terrain/props overdraw it normally, not the other way around.
	return mesh;
}

/**
 * Re-centers the skybox on the camera and advances its animated aurora bands. Call once per frame.
 * @param {THREE.Mesh} skyMesh
 * @param {THREE.Vector3} cameraPosition
 * @param {number} elapsedSeconds
 */
export function updateAuroraSky(skyMesh, cameraPosition, elapsedSeconds) {
	skyMesh.position.copy(cameraPosition);
	skyMesh.material.uniforms.uTime.value = elapsedSeconds;
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
