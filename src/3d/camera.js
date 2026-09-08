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
 * once a player exists (a free-panned target would just get overwritten next frame).
 * `resolveCameraCollision` (below) adds wall-avoidance: `game3d.js` calls it every frame, after
 * `OrbitControls.update()` has computed the "desired" free-orbit position, to pull the camera in
 * front of any terrain/castle it would otherwise clip through — see that function's doc comment
 * and DECISIONS.md ADR-0018 for why this stays a per-frame, non-persistent adjustment rather than
 * writing the shortened distance back into `OrbitControls`' own spherical radius.
 * @module camera
 */

import * as THREE from 'three';
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

/** Reused scratch vector — `resolveCameraCollision` runs once per frame; a fresh `Vector3` every
 * call would be needless per-frame garbage. Safe because its value is only read synchronously
 * within the same call, never retained across frames. */
const _rayDirection = new THREE.Vector3();

/**
 * Pulls `desiredPosition` in along the target->camera ray if it's occluded by anything in
 * `collidables` (terrain chunks, castle parts — see `gameLoopHelpers.js`'s `collectCameraCollidables`),
 * so the chase camera lands just in front of a wall/hillside instead of clipping through it.
 *
 * Collision roots are intentionally raycast recursively. Repository castle/ice-landmark entries can
 * be imported FBX/GLB `Group`s whose renderable meshes sit one or more levels below the root; a
 * non-recursive ray against those roots silently sees no triangles and lets the third-person camera
 * pass straight through the real asset. Recursive traversal keeps the world-generation ownership
 * unchanged while making the player camera honor the actual shipped model hierarchy.
 *
 * Deliberately does not mutate `OrbitControls`' own spherical radius — `game3d.js` restores
 * `camera.position` to `desiredPosition` right after each frame's render, so a collision pull-in
 * is purely a one-frame visual adjustment: the user's actual zoom/orbit distance is preserved and
 * the camera smoothly returns to it the moment line of sight clears, rather than staying stuck at
 * whatever distance the last collision left it at. See DECISIONS.md ADR-0018.
 * @param {import('three').Raycaster} raycaster Reused across frames by the caller.
 * @param {import('three').Vector3} target Ray origin — `OrbitControls.target` (the player's chase
 *   point), not the player's feet, so the ray starts roughly at chest height.
 * @param {import('three').Vector3} desiredPosition The free-orbit camera position `OrbitControls.
 *   update()` computed this frame, before any collision adjustment.
 * @param {import('three').Object3D[]} collidables Candidate meshes or imported model roots to test
 *   against. Kept small by the caller (nearby terrain chunks + settlement/model roots only).
 * @param {number} marginMeters Distance to stop short of the hit surface (`PLAYER_CONFIG.
 *   CAMERA_COLLISION_MARGIN_METERS`).
 * @param {number} minDistanceMeters Preferred chase-camera comfort floor (`PLAYER_CONFIG.
 *   CAMERA_COLLISION_MIN_DISTANCE_METERS`). A nearer real surface is authoritative: when keeping
 *   this floor would place the camera through the surface, collision clearance wins and the camera
 *   is allowed to move closer to the target for that frame.
 * @returns {import('three').Vector3} Either `desiredPosition` unchanged (no occlusion) or a new
 *   `Vector3` pulled in along the ray — never mutates `desiredPosition` itself, since the caller
 *   needs the original value to restore `camera.position` after render.
 */
export function resolveCameraCollision(raycaster, target, desiredPosition, collidables, marginMeters, minDistanceMeters) {
	_rayDirection.subVectors(desiredPosition, target);
	const desiredDistance = _rayDirection.length();
	if (desiredDistance < 1e-6 || collidables.length === 0) return desiredPosition;
	_rayDirection.divideScalar(desiredDistance);

	raycaster.set(target, _rayDirection);
	raycaster.near = 0;
	raycaster.far = desiredDistance;
	const hits = raycaster.intersectObjects(collidables, true);
	if (hits.length === 0) return desiredPosition;

	const surfaceClearanceDistance = Math.max(0, hits[0].distance - marginMeters);
	const clampedDistance = hits[0].distance <= minDistanceMeters + marginMeters
		? surfaceClearanceDistance
		: Math.max(minDistanceMeters, surfaceClearanceDistance);
	return target.clone().addScaledVector(_rayDirection, clampedDistance);
}
