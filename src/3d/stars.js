/**
 * Procedural night starfield: a fixed cloud of points scattered across the upper sky dome,
 * re-centered on the camera every frame (same technique as `sky.js`'s aurora sphere), fading in
 * only at night via `lighting.js`'s `nightFactor` — mirrors how `sky.js` already gates its aurora.
 *
 * Self-contained (no shared PRNG import from `world/terrain.js`): stars are a pure visual/
 * atmosphere concern, not world geography, so this module owns its own tiny seeded PRNG rather
 * than reaching across into `world/`. The position/twinkle stream and appearance stream are tagged
 * separately so visual refinements cannot silently reshuffle canonical same-seed star positions.
 *
 * Each star carries deterministic twinkle phase/frequency plus a restrained apparent-magnitude,
 * luminance and stellar-temperature treatment. Most stars stay small/faint/near-neutral, with a
 * small population of brighter or subtly warm/cool points. The fragment shader turns the hardware
 * point sprite into a circular point-spread core and soft halo using `gl_PointCoord`; square point
 * grains are discarded rather than rendered as obvious GPU quads.
 * @module stars
 */

import * as THREE from 'three';

/** Deterministic 32-bit PRNG (mulberry32). Never `Math.random()` — the project's determinism rule
 * applies to every generator, including purely visual atmosphere. */
function mulberry32(seed) {
	let a = seed >>> 0;
	return function random() {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const STAR_COUNT = 1200;
/** Must stay under `sky.js`'s `SKY_RADIUS_METERS` (1900) so stars render just inside the aurora
 * skybox sphere rather than at/past its surface. */
const STARFIELD_RADIUS_METERS = 1850;
/** Small margin above the horizon so stars never appear to poke through near the ground. */
const MIN_HEIGHT_FACTOR = 0.05;

/** Apparent sprite range. A strongly skewed magnitude distribution below keeps the majority near
 * this minimum and reserves the upper end for uncommon bright stars. */
const STAR_SIZE_MIN_PIXELS = 1.25;
const STAR_SIZE_MAX_PIXELS = 3.25;
const STAR_BRIGHTNESS_MIN = 0.42;
const STAR_BRIGHTNESS_MAX = 1.0;

/** Twinkle angular-frequency range (radians/sec), intentionally slow/gentle. */
const TWINKLE_FREQ_MIN = 0.4;
const TWINKLE_FREQ_MAX = 1.3;
/** No star fully disappears; twinkle modulates the deterministic apparent brightness instead of
 * replacing it. */
const TWINKLE_BASE = 0.65;
const TWINKLE_AMPLITUDE = 0.35;

const STAR_VERTEX_SHADER = /* glsl */ `
	attribute float aPhase;
	attribute float aFreq;
	attribute float aSize;
	attribute float aBrightness;
	attribute vec3 aColor;
	uniform float uTime;
	uniform float uNightFactor;
	varying float vAlpha;
	varying vec3 vColor;

	void main() {
		float twinkle = ${TWINKLE_BASE.toFixed(2)} + ${TWINKLE_AMPLITUDE.toFixed(2)} * sin(uTime * aFreq + aPhase);
		vAlpha = uNightFactor * twinkle * aBrightness;
		vColor = aColor;
		vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
		gl_Position = projectionMatrix * mvPosition;
		// Stars sit on a camera-follow dome: apparent pixel size should follow seeded magnitude, not
		// scene distance to an arbitrary 1850m shell.
		gl_PointSize = aSize;
	}
`;

const STAR_FRAGMENT_SHADER = /* glsl */ `
	varying float vAlpha;
	varying vec3 vColor;

	void main() {
		vec2 point = gl_PointCoord - vec2(0.5);
		float radius = length(point);
		if (radius > 0.5) discard;

		float core = 1.0 - smoothstep(0.02, 0.22, radius);
		float halo = 1.0 - smoothstep(0.16, 0.50, radius);
		float alpha = (core * 0.72 + halo * 0.34) * vAlpha;
		vec3 color = vColor * (0.82 + core * 0.24);
		gl_FragColor = vec4(color, alpha);
	}
`;

function writeStellarColor(colors, index, random) {
	const temperatureClass = random();
	const variation = random();
	let r;
	let g;
	let b;

	if (temperatureClass < 0.12) {
		// Warm stars: restrained cream/amber, never saturated orange.
		r = 1.0;
		g = 0.88 + variation * 0.06;
		b = 0.76 + variation * 0.08;
	} else if (temperatureClass < 0.80) {
		// Near-white stars dominate the field.
		r = 0.93 + variation * 0.06;
		g = 0.95 + variation * 0.05;
		b = 0.98 + variation * 0.02;
	} else {
		// Cool stars retain a subtle blue-white cast rather than becoming cyan points.
		r = 0.80 + variation * 0.09;
		g = 0.89 + variation * 0.07;
		b = 1.0;
	}

	colors[index * 3] = r;
	colors[index * 3 + 1] = g;
	colors[index * 3 + 2] = b;
}

/**
 * Builds a deterministic starfield across the upper hemisphere.
 * @param {number} [seed=1337] Seeded positions/twinkle plus independently tagged appearance data.
 * @returns {THREE.Points}
 */
export function createStarfield(seed = 1337) {
	const random = mulberry32(seed ^ 0x53544152); // "STAR"-ish: canonical position/twinkle stream.
	const positions = new Float32Array(STAR_COUNT * 3);
	const phases = new Float32Array(STAR_COUNT);
	const freqs = new Float32Array(STAR_COUNT);

	// Keep this loop's draw order unchanged: same seed => bit-identical legacy position/twinkle data.
	for (let i = 0; i < STAR_COUNT; i++) {
		const theta = random() * Math.PI * 2;
		const heightFactor = MIN_HEIGHT_FACTOR + random() * (1 - MIN_HEIGHT_FACTOR);
		const radiusXZ = Math.sqrt(Math.max(0, 1 - heightFactor * heightFactor));
		positions[i * 3] = Math.cos(theta) * radiusXZ * STARFIELD_RADIUS_METERS;
		positions[i * 3 + 1] = heightFactor * STARFIELD_RADIUS_METERS;
		positions[i * 3 + 2] = Math.sin(theta) * radiusXZ * STARFIELD_RADIUS_METERS;
		phases[i] = random() * Math.PI * 2;
		freqs[i] = TWINKLE_FREQ_MIN + random() * (TWINKLE_FREQ_MAX - TWINKLE_FREQ_MIN);
	}

	// Independent tagged stream: changing magnitude/color policy must never reshuffle sky geometry.
	const appearanceRandom = mulberry32(seed ^ 0x4d41474e); // "MAGN"-ish.
	const sizes = new Float32Array(STAR_COUNT);
	const brightnesses = new Float32Array(STAR_COUNT);
	const colors = new Float32Array(STAR_COUNT * 3);
	for (let i = 0; i < STAR_COUNT; i++) {
		// Cubic skew: many faint/small stars, few bright/larger apparent-magnitude anchors.
		const magnitude = Math.pow(appearanceRandom(), 3.2);
		sizes[i] = STAR_SIZE_MIN_PIXELS + magnitude * (STAR_SIZE_MAX_PIXELS - STAR_SIZE_MIN_PIXELS);
		brightnesses[i] = STAR_BRIGHTNESS_MIN + magnitude * (STAR_BRIGHTNESS_MAX - STAR_BRIGHTNESS_MIN);
		writeStellarColor(colors, i, appearanceRandom);
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
	geometry.setAttribute('aFreq', new THREE.BufferAttribute(freqs, 1));
	geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
	geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightnesses, 1));
	geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

	const material = new THREE.ShaderMaterial({
		vertexShader: STAR_VERTEX_SHADER,
		fragmentShader: STAR_FRAGMENT_SHADER,
		uniforms: {
			uTime: { value: 0 },
			uNightFactor: { value: 0 },
		},
		transparent: true,
		depthWrite: false,
		fog: false,
	});

	material.userData.starfieldRealism = 'magnitude-temperature-circular-psf-v1';
	const points = new THREE.Points(geometry, material);
	points.frustumCulled = false;
	points.renderOrder = -0.5;
	return points;
}

/** Re-centers the starfield, advances deterministic twinkle time, and applies canonical nightFactor. */
export function updateStarfield(starfield, cameraPosition, elapsedSeconds, nightFactor) {
	starfield.position.copy(cameraPosition);
	starfield.material.uniforms.uTime.value = elapsedSeconds;
	starfield.material.uniforms.uNightFactor.value = nightFactor;
}

/** Disposes starfield geometry/material. */
export function disposeStarfield(starfield) {
	starfield.geometry.dispose();
	starfield.material.dispose();
}
