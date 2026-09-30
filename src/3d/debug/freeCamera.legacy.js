/**
 * F4 debug/editor free-fly camera. Entirely separate from FAZ 4's chase camera (`camera.js`,
 * `OrbitControls`) — toggling it never touches that camera, its controls, or the player; it just
 * swaps which camera `game3d.js` renders with for the frame. Built to answer a real project-owner
 * question `camera.js`'s chase camera can't: with `PLAYER_CONFIG.CAMERA_MAX_DISTANCE_METERS` (40m)
 * and `WORLD_DEFAULTS.FAR_PLANE` (2000m) both tuned for normal gameplay perf, most of the 14
 * kingdom seats (already all in the scene at boot — `world/settlements.js` — not a streaming gap)
 * sit beyond the far clip plane and are never visible together. This camera gets its own much
 * larger `far` instead of changing either of those normal-gameplay budgets. See DECISIONS.md
 * ADR-0049.
 *
 * Self-contained: owns its own F4 keydown listener, its own WASD reader (`input.js`'s
 * `KeyboardInput` — the same camera-agnostic input module the player uses), drag-to-look, and its
 * own window resize handling. `game3d.js` only needs to create it, call `.update(delta)` once per
 * frame, read `.active`/`.camera` to pick a render target, and `.dispose()` on teardown.
 * @module debug/freeCamera
 */

import * as THREE from 'three';
import { KeyboardInput } from '../input.js';

/** Far clip plane while flying — large enough that the whole ~137.5km² world fits in view from a
 * few thousand meters up, well past `WORLD_DEFAULTS.FAR_PLANE` (2000m) real gameplay uses. */
const FAR_PLANE_METERS = 20000;
/** Base fly speed. Tuned to cross a multi-km gap between kingdom seats in a few seconds, not
 * gameplay-realistic — this is an inspection tool, not the player's own movement. */
const FLY_SPEED_MPS = 150;
const RUN_SPEED_MULTIPLIER = 4;
const LOOK_SENSITIVITY = 0.0025;
/** Just short of straight up/down — avoids the gimbal flip a full ±PI/2 pitch would hit. */
const PITCH_LIMIT_RADIANS = Math.PI / 2 - 0.01;

/**
 * @param {object} options
 * @param {THREE.PerspectiveCamera} options.sourceCamera Normal chase camera — copies fov/aspect/
 *   near so the free camera frames the world the same way on the frame it activates, and starts at
 *   that camera's exact position/orientation (no visual jump on toggle).
 * @param {HTMLElement} options.domElement Canvas to drag-to-look on.
 * @returns {{camera: THREE.PerspectiveCamera, active: boolean, update: (delta: number) => void, dispose: () => void}}
 */
export function createFreeCameraController({ sourceCamera, domElement }) {
	const camera = new THREE.PerspectiveCamera(
		sourceCamera.fov,
		sourceCamera.aspect,
		sourceCamera.near,
		FAR_PLANE_METERS,
	);
	const keyboardInput = new KeyboardInput(window);

	const controller = { camera, active: false };
	let yaw = 0;
	let pitch = 0;
	let dragging = false;
	let lastX = 0;
	let lastY = 0;

	const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
	const _forward = new THREE.Vector3();
	const _right = new THREE.Vector3();

	function activate() {
		controller.active = true;
		camera.position.copy(sourceCamera.position);
		camera.quaternion.copy(sourceCamera.quaternion);
		_euler.setFromQuaternion(camera.quaternion, 'YXZ');
		yaw = _euler.y;
		pitch = Math.max(-PITCH_LIMIT_RADIANS, Math.min(PITCH_LIMIT_RADIANS, _euler.x));
	}

	function deactivate() {
		controller.active = false;
		dragging = false;
	}

	const onKeyDown = (event) => {
		if (event.code !== 'F4') return;
		if (controller.active) deactivate();
		else activate();
	};
	const onMouseDown = (event) => {
		if (!controller.active) return;
		dragging = true;
		lastX = event.clientX;
		lastY = event.clientY;
	};
	const onMouseUp = () => { dragging = false; };
	const onMouseMove = (event) => {
		if (!controller.active || !dragging) return;
		yaw -= (event.clientX - lastX) * LOOK_SENSITIVITY;
		pitch -= (event.clientY - lastY) * LOOK_SENSITIVITY;
		pitch = Math.max(-PITCH_LIMIT_RADIANS, Math.min(PITCH_LIMIT_RADIANS, pitch));
		lastX = event.clientX;
		lastY = event.clientY;
	};
	const onResize = () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
	};

	window.addEventListener('keydown', onKeyDown);
	domElement.addEventListener('mousedown', onMouseDown);
	window.addEventListener('mouseup', onMouseUp);
	window.addEventListener('mousemove', onMouseMove);
	window.addEventListener('resize', onResize);

	/** Call once per frame regardless of `.active` — a no-op while inactive. */
	controller.update = (delta) => {
		if (!controller.active) return;
		_euler.set(pitch, yaw, 0, 'YXZ');
		camera.quaternion.setFromEuler(_euler);
		const { forward, strafe, running } = keyboardInput.getAxes();
		if (forward === 0 && strafe === 0) return;
		_forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
		_right.set(1, 0, 0).applyQuaternion(camera.quaternion);
		const speed = FLY_SPEED_MPS * (running ? RUN_SPEED_MULTIPLIER : 1) * delta;
		camera.position.addScaledVector(_forward, forward * speed);
		camera.position.addScaledVector(_right, strafe * speed);
	};

	/** Removes every listener this controller registered — memory-leak checklist. */
	controller.dispose = () => {
		keyboardInput.dispose();
		window.removeEventListener('keydown', onKeyDown);
		domElement.removeEventListener('mousedown', onMouseDown);
		window.removeEventListener('mouseup', onMouseUp);
		window.removeEventListener('mousemove', onMouseMove);
		window.removeEventListener('resize', onResize);
	};

	return controller;
}
