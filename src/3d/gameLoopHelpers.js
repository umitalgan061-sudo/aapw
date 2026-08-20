/**
 * Pure per-frame helpers for camera-relative movement, input-axis merging, camera collision,
 * streaming and resize wiring.
 * @module gameLoopHelpers
 */

import * as THREE from 'three';
import { CHUNK_CONFIG } from './config.js';
import { worldToChunkCoord } from './sceneManager.js';
import { applyPlayerLockFacing, computePlayerLockViewForward, createPlayerLockOnController } from './gameplay/playerLockOn.js';

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _cameraOffset = new THREE.Vector3();
const _cameraSpherical = new THREE.Spherical();
const GAMEPAD_CAMERA_YAW_RADIANS_PER_SECOND = 2.5;
const GAMEPAD_CAMERA_PITCH_RADIANS_PER_SECOND = 1.9;
const GAMEPAD_CAMERA_ZOOM_METERS_PER_SECOND = 12;
const GAMEPAD_CAMERA_MAX_FRAME_SECONDS = 0.3;
const CAMERA_POLAR_EPSILON = 0.08;

export function applyGamepadCameraLook(camera, controls, axes) {
	const lookX = Number.isFinite(axes?.lookX) ? axes.lookX : 0, lookY = Number.isFinite(axes?.lookY) ? axes.lookY : 0;
	const cameraZoom = Number.isFinite(axes?.cameraZoom) ? THREE.MathUtils.clamp(axes.cameraZoom, -1, 1) : 0;
	const dt = Math.max(0, Math.min(GAMEPAD_CAMERA_MAX_FRAME_SECONDS, Number.isFinite(axes?.lookDeltaSeconds) ? axes.lookDeltaSeconds : 0));
	if (dt === 0 || (lookX === 0 && lookY === 0 && cameraZoom === 0)) return false;
	_cameraOffset.subVectors(camera.position, controls.target);
	if (_cameraOffset.lengthSq() < 1e-6) return false;
	_cameraSpherical.setFromVector3(_cameraOffset);
	_cameraSpherical.theta -= lookX * GAMEPAD_CAMERA_YAW_RADIANS_PER_SECOND * dt;
	const minPolar = Math.max(CAMERA_POLAR_EPSILON, Number.isFinite(controls.minPolarAngle) ? controls.minPolarAngle : CAMERA_POLAR_EPSILON);
	const maxPolar = Math.min(Math.PI - CAMERA_POLAR_EPSILON, Number.isFinite(controls.maxPolarAngle) ? controls.maxPolarAngle : Math.PI - CAMERA_POLAR_EPSILON);
	_cameraSpherical.phi = THREE.MathUtils.clamp(_cameraSpherical.phi + lookY * GAMEPAD_CAMERA_PITCH_RADIANS_PER_SECOND * dt, minPolar, Math.max(minPolar, maxPolar));
	const minDistance = Math.max(0.1, Number.isFinite(controls.minDistance) ? controls.minDistance : 0.1), maxDistance = Math.max(minDistance, Number.isFinite(controls.maxDistance) ? controls.maxDistance : Infinity);
	_cameraSpherical.radius = THREE.MathUtils.clamp(_cameraSpherical.radius - cameraZoom * GAMEPAD_CAMERA_ZOOM_METERS_PER_SECOND * dt, minDistance, maxDistance);
	camera.position.copy(_cameraOffset.setFromSpherical(_cameraSpherical).add(controls.target));
	return true;
}

export function computeCameraRelativeMove(camera, controls, axes) {
	applyGamepadCameraLook(camera, controls, axes);
	const guarding = Boolean(axes.guarding), inputMagnitude = Math.min(1, Math.hypot(axes.forward, axes.strafe));
	if (inputMagnitude === 0) return { x: 0, z: 0, guarding };
	_forward.subVectors(controls.target, camera.position); _forward.y = 0;
	if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, -1); else _forward.normalize();
	_right.crossVectors(_forward, _worldUp).normalize();
	_move.set(0, 0, 0).addScaledVector(_forward, axes.forward).addScaledVector(_right, axes.strafe);
	if (_move.lengthSq() < 1e-6) return { x: 0, z: 0, guarding };
	_move.normalize().multiplyScalar(inputMagnitude);
	return { x: _move.x, z: _move.z, guarding };
}

export function combineAxes(keyboardAxes, joystickAxes) {
	if (!joystickAxes) return keyboardAxes;
	return {
		forward: Math.max(-1, Math.min(1, keyboardAxes.forward + joystickAxes.forward)),
		strafe: Math.max(-1, Math.min(1, keyboardAxes.strafe + joystickAxes.strafe)),
		running: keyboardAxes.running || joystickAxes.running,
		guarding: Boolean(keyboardAxes.guarding || joystickAxes.guarding),
		lockOnRequested: Boolean(keyboardAxes.lockOnRequested),
		lookX: keyboardAxes.lookX ?? 0, lookY: keyboardAxes.lookY ?? 0,
		cameraZoom: keyboardAxes.cameraZoom ?? 0, lookDeltaSeconds: keyboardAxes.lookDeltaSeconds ?? 0,
	};
}

export function updatePlayerLockOn(state) {
	if (!state?.player?.object3D || !state?.camera || !state?.controls || !state?.keyboardInput) return null;
	state.playerLockOn ??= createPlayerLockOnController();
	const nowSeconds = (globalThis.performance?.now?.() ?? Date.now()) / 1000;
	const previousSeconds = Number.isFinite(state.playerLockOnLastSeconds) ? state.playerLockOnLastSeconds : nowSeconds;
	state.playerLockOnLastSeconds = nowSeconds;
	const delta = state.paused ? 0 : Math.max(0, Math.min(0.1, nowSeconds - previousSeconds));
	// Consume both one-shot sources even while paused so a menu-time tap cannot unexpectedly acquire
	// a target after resume. Only the OR-result is gated by pause; neither source remains queued.
	const keyboardToggle = Boolean(state.keyboardInput.consumeLockOnRequested?.());
	const touchToggle = Boolean(state.touchJoystick?.consumeLockOnRequested?.());
	const snapshot = state.playerLockOn.update({
		playerPosition: state.player.object3D.position,
		forward: computePlayerLockViewForward(state.camera.position, state.controls.target),
		candidates: state.npcs ?? [],
		toggleRequested: !state.paused && (keyboardToggle || touchToggle),
	});
	if (snapshot?.targetPosition && delta > 0) applyPlayerLockFacing(state.player.object3D, snapshot.targetPosition, delta);
	state.touchJoystick?.setLockOnActive?.(Boolean(snapshot?.locked));
	state.player.object3D.userData.playerLockOn = snapshot;
	return snapshot;
}

const _cameraCollidables = [];
export function collectCameraCollidables(state, worldX, worldZ) {
	_cameraCollidables.length = 0;
	const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
	const centerChunkX = worldToChunkCoord(worldX, chunkSize), centerChunkZ = worldToChunkCoord(worldZ, chunkSize);
	for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const mesh = state.chunkManager.getLoadedChunkMesh(centerChunkX + dx, centerChunkZ + dz); if (mesh) _cameraCollidables.push(mesh); }
	for (const part of state.settlements.children) _cameraCollidables.push(part);
	for (const realCastle of state.realCastles.children) _cameraCollidables.push(realCastle);
	return _cameraCollidables;
}

export function streamAroundOrbitTarget(state) {
	// `game3d.js` deliberately stays under its 600-line cap; this already-called post-entity helper
	// is the small Player-only adapter point. NPC state is read but never mutated.
	updatePlayerLockOn(state);
	const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
	const targetChunkX = worldToChunkCoord(state.controls.target.x, chunkSize), targetChunkZ = worldToChunkCoord(state.controls.target.z, chunkSize);
	if (state.lastStreamChunk && state.lastStreamChunk.x === targetChunkX && state.lastStreamChunk.z === targetChunkZ) return;
	state.lastStreamChunk = { x: targetChunkX, z: targetChunkZ };
	const beforeCount = state.chunkManager.everGeneratedCount;
	state.chunkManager.streamTowards(targetChunkX, targetChunkZ, CHUNK_CONFIG.STREAM_RADIUS_CHUNKS);
	const newlyGenerated = state.chunkManager.everGeneratedCount - beforeCount;
	if (newlyGenerated > 0) console.info(`[game3d] Streamed in ${newlyGenerated} new chunk(s) near (${targetChunkX}, ${targetChunkZ}) — cumulative World Coverage now ${state.chunkManager.getCumulativeCoveredAreaKm2().toFixed(2)} km².`);
}

export function bindResize(state) {
	const onResize = () => { const { innerWidth, innerHeight } = window; state.camera.aspect = innerWidth / innerHeight; state.camera.updateProjectionMatrix(); state.renderer.setSize(innerWidth, innerHeight); };
	window.addEventListener('resize', onResize);
	return () => window.removeEventListener('resize', onResize);
}
