/**
 * Pure per-frame helper functions for `game3d.js`'s tick loop and bootstrap: camera-relative
 * movement, keyboard/touch axis merging, chase-camera occluder collection, chunk streaming, and
 * window-resize wiring. Extracted from `game3d.js` (run 105) purely to stay under the project's
 * 600-line-per-file cap — `game3d.js` was at 590/600 with no behavior change in this split, only
 * a relocation. None of these functions close over `initGame3D`'s local state; each receives
 * everything it needs as a parameter, so this module has no dependency on `game3d.js` itself and
 * could be reused by a future second render-loop entry point without change.
 * @module gameLoopHelpers
 */

import * as THREE from 'three';
import { CHUNK_CONFIG } from './config.js';
import { worldToChunkCoord } from './sceneManager.js';

/**
 * Computes a normalized (or zero) world-space `(x, z)` movement direction from raw input axes and
 * the camera's current facing — kept here (not in `gameplay/player.js`) so gameplay code stays
 * camera-agnostic (see `gameplay/README.md`'s Conventions).
 * @param {THREE.PerspectiveCamera} camera
 * @param {import('./camera.js').OrbitControls} controls
 * @param {{forward: number, strafe: number}} axes
 * @returns {{x: number, z: number}}
 */
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
export function computeCameraRelativeMove(camera, controls, axes) {
	if (axes.forward === 0 && axes.strafe === 0) return { x: 0, z: 0 };

	_forward.subVectors(controls.target, camera.position);
	_forward.y = 0;
	if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, -1);
	else _forward.normalize();
	_right.crossVectors(_forward, _worldUp).normalize();

	_move.set(0, 0, 0).addScaledVector(_forward, axes.forward).addScaledVector(_right, axes.strafe);
	if (_move.lengthSq() < 1e-6) return { x: 0, z: 0 };
	_move.normalize();
	return { x: _move.x, z: _move.z };
}

/**
 * Combines keyboard and (optional) touch-joystick axes into one `{forward, strafe, running}`,
 * summing the continuous forward/strafe components (clamped back to [-1, 1]) and OR-ing `running`
 * — lets a touch-capable device with a plugged-in keyboard use either without one silently
 * overriding the other, and costs nothing extra on devices with no joystick (`joystickAxes` is
 * `null` there, so this just returns `keyboardAxes` unchanged).
 * @param {{forward: number, strafe: number, running: boolean}} keyboardAxes
 * @param {{forward: number, strafe: number, running: boolean} | null} joystickAxes
 * @returns {{forward: number, strafe: number, running: boolean}}
 */
export function combineAxes(keyboardAxes, joystickAxes) {
	if (!joystickAxes) return keyboardAxes;
	return {
		forward: Math.max(-1, Math.min(1, keyboardAxes.forward + joystickAxes.forward)),
		strafe: Math.max(-1, Math.min(1, keyboardAxes.strafe + joystickAxes.strafe)),
		running: keyboardAxes.running || joystickAxes.running,
	};
}

/** Reused across frames by `collectCameraCollidables` — cleared and refilled each call rather than
 * allocated fresh, since it only needs to live for the duration of that frame's raycast. */
const _cameraCollidables = [];

/**
 * Gathers the small set of meshes `camera.js`'s `resolveCameraCollision` should test the chase
 * camera's line of sight against: the terrain chunk the player currently stands in (plus its 8
 * immediate neighbors, so a ray started near a chunk boundary can't miss the chunk it should hit)
 * and every settlement part (`state.settlements`' 3 `InstancedMesh` children — cheap regardless of
 * distance, only 14 castles total). Deliberately excludes water/river meshes (not "walls" in the
 * FAZ 4 Known Issues sense this exists to fix) and the wider unloaded world (the chase camera's
 * `CAMERA_MAX_DISTANCE_METERS` is 40m, far short of even one 500m chunk, so anything farther out
 * can never be the actual occluder).
 * @param {{chunkManager: import('./world/chunkManager.js').ChunkManager, settlements: THREE.Group, realCastles: THREE.Group}} state
 * @param {number} worldX Player's current world-space X.
 * @param {number} worldZ Player's current world-space Z.
 * @returns {THREE.Object3D[]} A reused array — valid only until the next call.
 */
export function collectCameraCollidables(state, worldX, worldZ) {
	_cameraCollidables.length = 0;
	const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
	const centerChunkX = worldToChunkCoord(worldX, chunkSize);
	const centerChunkZ = worldToChunkCoord(worldZ, chunkSize);
	for (let dz = -1; dz <= 1; dz++) {
		for (let dx = -1; dx <= 1; dx++) {
			const mesh = state.chunkManager.getLoadedChunkMesh(centerChunkX + dx, centerChunkZ + dz);
			if (mesh) _cameraCollidables.push(mesh);
		}
	}
	for (const part of state.settlements.children) _cameraCollidables.push(part);
	for (const realCastle of state.realCastles.children) _cameraCollidables.push(realCastle);
	return _cameraCollidables;
}

/**
 * Streams in new chunks around the orbit target, but only when it has actually crossed into a
 * different chunk since the last check — cheap to call every frame since the common case (camera
 * orbiting, target not panned) is a no-op integer comparison.
 * @param {{controls: import('./camera.js').OrbitControls, chunkManager: import('./world/chunkManager.js').ChunkManager, lastStreamChunk: {x: number, z: number} | null}} state
 */
export function streamAroundOrbitTarget(state) {
	const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
	const targetChunkX = worldToChunkCoord(state.controls.target.x, chunkSize);
	const targetChunkZ = worldToChunkCoord(state.controls.target.z, chunkSize);

	if (
		state.lastStreamChunk &&
		state.lastStreamChunk.x === targetChunkX &&
		state.lastStreamChunk.z === targetChunkZ
	) {
		return;
	}
	state.lastStreamChunk = { x: targetChunkX, z: targetChunkZ };

	const beforeCount = state.chunkManager.everGeneratedCount;
	state.chunkManager.streamTowards(targetChunkX, targetChunkZ, CHUNK_CONFIG.STREAM_RADIUS_CHUNKS);
	const newlyGenerated = state.chunkManager.everGeneratedCount - beforeCount;
	if (newlyGenerated > 0) {
		console.info(
			`[game3d] Streamed in ${newlyGenerated} new chunk(s) near (${targetChunkX}, ${targetChunkZ}) ` +
				`— cumulative World Coverage now ${state.chunkManager.getCumulativeCoveredAreaKm2().toFixed(2)} km².`,
		);
	}
}

/**
 * Wires window resize handling for a render state's camera/renderer.
 * @param {{renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera}} state
 * @returns {() => void} Call to remove the listener.
 */
export function bindResize(state) {
	const onResize = () => {
		const { innerWidth, innerHeight } = window;
		state.camera.aspect = innerWidth / innerHeight;
		state.camera.updateProjectionMatrix();
		state.renderer.setSize(innerWidth, innerHeight);
	};
	window.addEventListener('resize', onResize);
	return () => window.removeEventListener('resize', onResize);
}
