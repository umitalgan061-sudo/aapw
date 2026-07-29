/**
 * Camera controls for the 3D Westeros world.
 *
 * Phase 1 scope: a configured `OrbitControls` wrapper (vendored three.js addon) so the world can
 * be inspected interactively — orbit/pan/zoom around a target point — during development.
 *
 * FAZ 4 update: rather than replace this with a fully custom spring-arm rig, `game3d.js` reuses
 * this same `OrbitControls` instance as the player's chase camera — every frame it re-targets
 * `controls.target` at the player (see DECISIONS.md ADR-0016 for why: it's already tested,
 * damped, and distance/angle-limited, and reusing it means this run's FAZ 4 budget goes toward
 * real movement/animation work instead of a parallel camera rig). `game3d.js` disables panning
 * once a player exists (a free-panned target would just get overwritten next frame). True
 * wall-avoidance raycasting (so the camera can't clip through terrain/castles) is not implemented
 * yet — flagged in 3D_GAME_PROGRESS.md's Known Issues.
 * @module camera
 */

import { OrbitControls } from './vendor/three/addons/controls/OrbitControls.js';

/**
 * Creates damped `OrbitControls` for `camera`/`domElement`, targeting the world origin with
 * distance/angle limits sane for a ground-level terrain preview (can't zoom through the ground,
 * can't dolly out to an absurd distance).
 * @param {import('three').PerspectiveCamera} camera
 * @param {HTMLElement} domElement
 * @param {object} [options]
 * @param {number} [options.minDistance=20] Overridden by `game3d.js` to `PLAYER_CONFIG.
 *   CAMERA_MIN_DISTANCE_METERS` once a player exists (a third-person chase camera needs a much
 *   tighter range than this dev-preview default).
 * @param {number} [options.maxDistance=1800] Same as above — must stay under `WORLD_DEFAULTS.
 *   FAR_PLANE` (config.js, 2000m) with margin regardless of caller. The unconfigured default was
 *   previously a hardcoded 4000, which let the camera dolly out past the far clip plane and made
 *   the entire scene vanish (found while building sky.js's own far-plane-relative sphere radius).
 * @returns {OrbitControls} Call `.update()` once per frame (required for damping) and
 *   `.dispose()` on teardown to remove its pointer/wheel event listeners.
 */
export function createOrbitCamera(camera, domElement, { minDistance = 20, maxDistance = 1800 } = {}) {
	const controls = new OrbitControls(camera, domElement);
	controls.target.set(0, 0, 0);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.minDistance = minDistance;
	controls.maxDistance = maxDistance;
	// Stop just short of the target's height so orbiting can't dip the camera below/into the ground.
	controls.maxPolarAngle = Math.PI / 2 - 0.05;
	controls.update();
	return controls;
}
