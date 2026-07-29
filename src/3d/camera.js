/**
 * Camera controls for the 3D Westeros world.
 *
 * Phase 1 scope: a configured `OrbitControls` wrapper (vendored three.js addon) so the world can
 * be inspected interactively — orbit/pan/zoom around a target point — during development. A
 * third-person player-follow camera (spring-arm + wall-avoidance raycast) is a separate Phase 4
 * concern and will likely replace this entirely rather than extend it; see 3D_GAME_PROGRESS.md.
 * @module camera
 */

import { OrbitControls } from './vendor/three/addons/controls/OrbitControls.js';

/**
 * Creates damped `OrbitControls` for `camera`/`domElement`, targeting the world origin with
 * distance/angle limits sane for a ground-level terrain preview (can't zoom through the ground,
 * can't dolly out to an absurd distance).
 * @param {import('three').PerspectiveCamera} camera
 * @param {HTMLElement} domElement
 * @returns {OrbitControls} Call `.update()` once per frame (required for damping) and
 *   `.dispose()` on teardown to remove its pointer/wheel event listeners.
 */
export function createOrbitCamera(camera, domElement) {
	const controls = new OrbitControls(camera, domElement);
	controls.target.set(0, 0, 0);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.minDistance = 20;
	// Must stay under `WORLD_DEFAULTS.FAR_PLANE` (config.js, 2000m) with margin — previously 4000,
	// which let the camera dolly out past the far clip plane and made the entire scene vanish
	// (found this run while building sky.js's own far-plane-relative sphere radius).
	controls.maxDistance = 1800;
	// Stop just short of the target's height so orbiting can't dip the camera below/into the ground.
	controls.maxPolarAngle = Math.PI / 2 - 0.05;
	controls.update();
	return controls;
}
