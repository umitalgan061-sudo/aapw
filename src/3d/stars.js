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

/**
 * Builds a starfield point cloud scattered across the upper hemisphere. Caller must reposition it
 * onto the camera every frame and drive its opacity from the current night factor via
 * `updateStarfield`.
 * @param {number} [seed=1337] Seeded so the same seed always produces the same star pattern.
 * @returns {THREE.Points}
 */
export function createStarfield(seed = 1337) {
	const random = mulberry32(seed ^ 0x53544152); // XOR tag ("STAR"-ish) — independent stream from terrain/river's own seeded sequences.
	const positions = new Float32Array(STAR_COUNT * 3);
	for (let i = 0; i < STAR_COUNT; i++) {
		const theta = random() * Math.PI * 2;
		const heightFactor = MIN_HEIGHT_FACTOR + random() * (1 - MIN_HEIGHT_FACTOR);
		const radiusXZ = Math.sqrt(Math.max(0, 1 - heightFactor * heightFactor));
		positions[i * 3] = Math.cos(theta) * radiusXZ * STARFIELD_RADIUS_METERS;
		positions[i * 3 + 1] = heightFactor * STARFIELD_RADIUS_METERS;
		positions[i * 3 + 2] = Math.sin(theta) * radiusXZ * STARFIELD_RADIUS_METERS;
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

	const material = new THREE.PointsMaterial({
		color: STAR_COLOR,
		size: 2.2,
		sizeAttenuation: false, // fixed pixel size regardless of distance — real stars don't get "closer".
		transparent: true,
		opacity: 0, // starts invisible; updateStarfield sets this from the day/night state every frame.
		depthWrite: false,
		fog: false, // stars sit "at infinity" — scene fog dimming them at ~1850m would look wrong (same choice sky.js already made for the aurora sphere).
	});

	const points = new THREE.Points(geometry, material);
	points.frustumCulled = false; // always surrounds the camera by construction, same as sky.js's sphere.
	points.renderOrder = -0.5; // after the aurora sky (-1), before ordinary opaque scene geometry (0, the default).
	return points;
}

/**
 * Re-centers the starfield on the camera and fades it in/out with the current night factor. Call
 * once per frame.
 * @param {THREE.Points} starfield
 * @param {THREE.Vector3} cameraPosition
 * @param {number} nightFactor `lighting.js`'s `updateDayNightLighting` output (0 = full day, 1 = full night).
 */
export function updateStarfield(starfield, cameraPosition, nightFactor) {
	starfield.position.copy(cameraPosition);
	starfield.material.opacity = nightFactor;
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
