/**
 * Procedural night starfield: a fixed cloud of small points scattered across the upper sky dome,
 * re-centered on the camera every frame (same technique as `sky.js`'s aurora sphere), fading in
 * only at night via `lighting.js`'s `nightFactor` — mirrors how `sky.js` already gates its aurora.
 *
 * Self-contained (no shared PRNG import from `world/terrain.js`): stars are a pure visual/
 * atmosphere concern, not world geography, so this module owns its own tiny seeded PRNG rather
 * than reaching across into `world/` — consistent with `sky.js`'s own self-contained noise
 * functions, and with the project's folder-ownership convention (`world/` owns terrain/water/
 * rivers/settlements; sky/lighting/fog/stars are atmosphere, kept at the top `src/3d/` level).
 *
 * **Twinkle (this run):** each star now gently varies in brightness over real time, driven by a
 * per-star seeded phase + frequency baked into the geometry at creation (deterministic — the same
 * seed always produces the same twinkle pattern, not `Math.random()`-per-frame flicker). Was flagged
 * as a known limitation ("fixed, non-twinkling pattern") in `3D_GAME_PROGRESS.md`'s Known Issues
 * since FAZ 2. Replaces the previous `PointsMaterial` (one uniform opacity for every star) with a
 * `ShaderMaterial` (per-vertex alpha) — same pattern `world/water.js` already established for its own
 * fragment-only animation (ADR-0048), just vertex-stage here since the twinkle is a per-point, not
 * per-fragment, property. See DECISIONS.md for this run's ADR.
 * @module stars
 */

import * as THREE from 'three';

/** Deterministic 32-bit PRNG (mulberry32) — same algorithm `world/terrain.js` uses, but an
 * intentionally separate copy (see this module's own doc comment for why). Never `Math.random()` —
 * the project's determinism rule applies to every generator, not just `world/`'s. */
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
/** Small margin above the horizon line (`y` component of the unit direction before scaling by
 * radius) so stars never appear to poke through near the ground — mirrors `sky.js`'s own aurora
 * mask, which starts fading in at `dir.y = 0.05` for the same reason. */
const MIN_HEIGHT_FACTOR = 0.05;
const STAR_COLOR = new THREE.Color(0xf5f8ff);
const STAR_SIZE_PIXELS = 2.2; // matches the previous PointsMaterial's fixed `size`.
/** Twinkle angular-frequency range (radians/sec). Kept slow/gentle on purpose — this is meant to
 * read as a subtle shimmer, not a strobe; ~0.4-1.3 rad/s means one full brighten/dim cycle every
 * ~5-16 seconds per star, and 1200 independently-phased stars means the field as a whole never
 * looks like it's pulsing in unison. */
const TWINKLE_FREQ_MIN = 0.4;
const TWINKLE_FREQ_MAX = 1.3;
/** Twinkle amplitude: alpha oscillates between `TWINKLE_BASE - TWINKLE_AMPLITUDE` and
 * `TWINKLE_BASE + TWINKLE_AMPLITUDE` (kept as named constants here for a single source of truth
 * with the vertex shader's `${TWINKLE_BASE}... + ${TWINKLE_AMPLITUDE}... * sin(...)` below, since a
 * GLSL string literal can't reference a JS `const` any other way than string interpolation at
 * module load). No star should ever fully vanish (would read as a graphical glitch, not
 * "twinkling") — this run's own engineering judgment, not calibrated against a real playtest. Same
 * "tuning value nobody can calibrate without watching a real person react to it" pattern as
 * ADR-0089/ADR-0096/ADR-0111 — logged to `QUESTIONS_FOR_OWNER.md` for consistency with those.
 */
const TWINKLE_BASE = 0.65;
const TWINKLE_AMPLITUDE = 0.35;

const STAR_VERTEX_SHADER = /* glsl */ `
	attribute float aPhase;
	attribute float aFreq;
	uniform float uTime;
	uniform float uNightFactor;
	uniform float uSize;
	varying float vAlpha;

	void main() {
		float twinkle = ${TWINKLE_BASE.toFixed(2)} + ${TWINKLE_AMPLITUDE.toFixed(2)} * sin(uTime * aFreq + aPhase);
		vAlpha = uNightFactor * twinkle;
		vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
		gl_Position = projectionMatrix * mvPosition;
		// Fixed pixel size regardless of distance (no /-mvPosition.z divide) — same "real stars don't
		// get closer" intent the old PointsMaterial's sizeAttenuation:false expressed.
		gl_PointSize = uSize;
	}
`;

const STAR_FRAGMENT_SHADER = /* glsl */ `
	uniform vec3 uColor;
	varying float vAlpha;

	void main() {
		gl_FragColor = vec4(uColor, vAlpha);
	}
`;

/**
 * Builds a starfield point cloud scattered across the upper hemisphere. Caller must reposition it
 * onto the camera every frame and drive its opacity/twinkle from the current time + night factor via
 * `updateStarfield`.
 * @param {number} [seed=1337] Seeded so the same seed always produces the same star positions AND
 *   the same per-star twinkle phase/frequency (determinism rule — see module doc).
 * @returns {THREE.Points}
 */
export function createStarfield(seed = 1337) {
	const random = mulberry32(seed ^ 0x53544152); // XOR tag ("STAR"-ish) — independent stream from terrain/river's own seeded sequences.
	const positions = new Float32Array(STAR_COUNT * 3);
	const phases = new Float32Array(STAR_COUNT);
	const freqs = new Float32Array(STAR_COUNT);
	for (let i = 0; i < STAR_COUNT; i++) {
		const theta = random() * Math.PI * 2;
		const heightFactor = MIN_HEIGHT_FACTOR + random() * (1 - MIN_HEIGHT_FACTOR);
		const radiusXZ = Math.sqrt(Math.max(0, 1 - heightFactor * heightFactor));
		positions[i * 3] = Math.cos(theta) * radiusXZ * STARFIELD_RADIUS_METERS;
		positions[i * 3 + 1] = heightFactor * STARFIELD_RADIUS_METERS;
		positions[i * 3 + 2] = Math.sin(theta) * radiusXZ * STARFIELD_RADIUS_METERS;
		// Drawn from the same continued deterministic stream as position above — same seed always
		// reproduces the exact same twinkle pattern, star-for-star.
		phases[i] = random() * Math.PI * 2;
		freqs[i] = TWINKLE_FREQ_MIN + random() * (TWINKLE_FREQ_MAX - TWINKLE_FREQ_MIN);
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
	geometry.setAttribute('aFreq', new THREE.BufferAttribute(freqs, 1));

	const material = new THREE.ShaderMaterial({
		vertexShader: STAR_VERTEX_SHADER,
		fragmentShader: STAR_FRAGMENT_SHADER,
		uniforms: {
			uTime: { value: 0 },
			uNightFactor: { value: 0 }, // starts invisible; updateStarfield sets this from the day/night state every frame.
			uSize: { value: STAR_SIZE_PIXELS },
			uColor: { value: STAR_COLOR },
		},
		transparent: true,
		depthWrite: false,
		fog: false, // stars sit "at infinity" — scene fog dimming them at ~1850m would look wrong (same choice sky.js already made for the aurora sphere).
	});

	const points = new THREE.Points(geometry, material);
	points.frustumCulled = false; // always surrounds the camera by construction, same as sky.js's sphere.
	points.renderOrder = -0.5; // after the aurora sky (-1), before ordinary opaque scene geometry (0, the default).
	return points;
}

/**
 * Re-centers the starfield on the camera, advances its twinkle animation time, and fades the whole
 * field in/out with the current night factor. Call once per frame.
 * @param {THREE.Points} starfield
 * @param {THREE.Vector3} cameraPosition
 * @param {number} elapsedSeconds Real elapsed time driving the per-star twinkle oscillation (same
 *   clock `world/water.js`'s `uTime` and `sky.js`'s aurora already use).
 * @param {number} nightFactor `lighting.js`'s `updateDayNightLighting` output (0 = full day, 1 = full night).
 */
export function updateStarfield(starfield, cameraPosition, elapsedSeconds, nightFactor) {
	starfield.position.copy(cameraPosition);
	starfield.material.uniforms.uTime.value = elapsedSeconds;
	starfield.material.uniforms.uNightFactor.value = nightFactor;
}

/**
 * Disposes the starfield's geometry/material. Call on teardown — see the project's memory-leak
 * checklist.
 * @param {THREE.Points} starfield
 */
export function disposeStarfield(starfield) {
	starfield.geometry.dispose();
	starfield.material.dispose();
}
