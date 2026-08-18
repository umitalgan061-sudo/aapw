/**
 * Pure per-frame helpers for camera-relative movement, input-axis merging, camera collision,
 * streaming and resize wiring.
 * @module gameLoopHelpers
 */

import * as THREE from 'three';
import { CHUNK_CONFIG } from './config.js';
import { worldToChunkCoord } from './sceneManager.js';

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

export function computeCameraRelativeMove(camera, controls, axes) {
	const guarding = Boolean(axes.guarding);
	if (axes.forward === 0 && axes.strafe === 0) return { x: 0, z: 0, guarding };
	_forward.subVectors(controls.target, camera.position);
	_forward.y = 0;
	if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, -1);
	else _forward.normalize();
	_right.crossVectors(_forward, _worldUp).normalize();
	_move.set(0, 0, 0).addScaledVector(_forward, axes.forward).addScaledVector(_right, axes.strafe);
	if (_move.lengthSq() < 1e-6) return { x: 0, z: 0, guarding };
	_move.normalize();
	return { x: _move.x, z: _move.z, guarding };
}

export function combineAxes(keyboardAxes, joystickAxes) {
	if (!joystickAxes) return keyboardAxes;
	return {
		forward: Math.max(-1, Math.min(1, keyboardAxes.forward + joystickAxes.forward)),
		strafe: Math.max(-1, Math.min(1, keyboardAxes.strafe + joystickAxes.strafe)),
		running: keyboardAxes.running || joystickAxes.running,
		guarding: Boolean(keyboardAxes.guarding || joystickAxes.guarding),
	};
}

const _cameraCollidables = [];
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

export function streamAroundOrbitTarget(state) {
	const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
	const targetChunkX = worldToChunkCoord(state.controls.target.x, chunkSize);
	const targetChunkZ = worldToChunkCoord(state.controls.target.z, chunkSize);
	if (state.lastStreamChunk && state.lastStreamChunk.x === targetChunkX && state.lastStreamChunk.z === targetChunkZ) return;
	state.lastStreamChunk = { x: targetChunkX, z: targetChunkZ };
	const beforeCount = state.chunkManager.everGeneratedCount;
	state.chunkManager.streamTowards(targetChunkX, targetChunkZ, CHUNK_CONFIG.STREAM_RADIUS_CHUNKS);
	const newlyGenerated = state.chunkManager.everGeneratedCount - beforeCount;
	if (newlyGenerated > 0) console.info(`[game3d] Streamed in ${newlyGenerated} new chunk(s) near (${targetChunkX}, ${targetChunkZ}) — cumulative World Coverage now ${state.chunkManager.getCumulativeCoveredAreaKm2().toFixed(2)} km².`);
}

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
