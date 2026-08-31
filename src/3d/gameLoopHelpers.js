/**
 * Pure per-frame helpers for camera-relative movement, Player target lock, camera collision,
 * streaming and resize wiring. Lock-on reads NPC positions but never mutates NPC AI.
 * @module gameLoopHelpers
 */

import * as THREE from 'three';
import { CHUNK_CONFIG } from './config.js';
import { worldToChunkCoord } from './sceneManager.js';

export const PLAYER_LOCK_ON_CONFIG = Object.freeze({ ACQUIRE_DISTANCE_METERS: 30, BREAK_DISTANCE_METERS: 38, ACQUIRE_HALF_ANGLE_DEGREES: 68, TRACK_HALF_ANGLE_DEGREES: 125, DISTANCE_SCORE_WEIGHT: 0.38, TURN_RATE_RADIANS_PER_SECOND: 11 });
const LOCK_ON_EVENT = 'aapw:player-lock-on';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const entityObject = (entity) => entity?.object3D ?? entity?.model ?? entity?.group ?? null;
const entityStableId = (entity, index) => String(entity?.id ?? entity?.displayName ?? entityObject(entity)?.userData?.npcId ?? entityObject(entity)?.name ?? `npc-${index}`);
const entityLockAvailable = (entity) => { const object = entityObject(entity); return Boolean(object && object.visible !== false && object.userData?.lockOnDisabled !== true); };
function planarPosition(value) { const position = value?.position ?? value; return position && Number.isFinite(position.x) && Number.isFinite(position.z) ? { x: position.x, y: Number.isFinite(position.y) ? position.y : 0, z: position.z } : null; }
function normalizedForward(forward) { const x = Number.isFinite(forward?.x) ? forward.x : 0, z = Number.isFinite(forward?.z) ? forward.z : 1, length = Math.hypot(x, z); return length > 1e-6 ? { x: x / length, z: z / length } : { x: 0, z: 1 }; }

export function computePlayerLockViewForward(cameraPosition, cameraTarget) {
	const camera = planarPosition(cameraPosition), target = planarPosition(cameraTarget);
	return camera && target ? normalizedForward({ x: target.x - camera.x, z: target.z - camera.z }) : { x: 0, z: 1 };
}
export function applyPlayerLockFacing(playerObject, targetPosition, delta, turnRate = PLAYER_LOCK_ON_CONFIG.TURN_RATE_RADIANS_PER_SECOND) {
	const player = planarPosition(playerObject), target = planarPosition(targetPosition);
	if (!player || !target || !playerObject?.rotation || !(delta > 0) || !(turnRate > 0)) return false;
	const dx = target.x - player.x, dz = target.z - player.z; if (Math.hypot(dx, dz) <= 0.05) return false;
	const current = Number.isFinite(playerObject.rotation.y) ? playerObject.rotation.y : 0, targetYaw = Math.atan2(dx, dz), shortest = Math.atan2(Math.sin(targetYaw - current), Math.cos(targetYaw - current));
	playerObject.rotation.y = current + clamp(shortest, -turnRate * Math.min(delta, 0.1), turnRate * Math.min(delta, 0.1)); return true;
}
export function evaluatePlayerLockTarget({ playerPosition, forward, entity, index = 0, maxDistanceMeters = PLAYER_LOCK_ON_CONFIG.ACQUIRE_DISTANCE_METERS, halfAngleDegrees = PLAYER_LOCK_ON_CONFIG.ACQUIRE_HALF_ANGLE_DEGREES } = {}) {
	const object = entityObject(entity), player = planarPosition(playerPosition), target = planarPosition(object), id = entityStableId(entity, index);
	if (!entityLockAvailable(entity)) return { eligible: false, reason: 'unavailable', score: Infinity, distanceMeters: Infinity, angleDegrees: 180, id, position: target };
	if (!player || !target || !(maxDistanceMeters > 0)) return { eligible: false, reason: 'invalid', score: Infinity, distanceMeters: Infinity, angleDegrees: 180, id };
	const dx = target.x - player.x, dz = target.z - player.z, distanceMeters = Math.hypot(dx, dz);
	if (!(distanceMeters > 0.05) || distanceMeters > maxDistanceMeters) return { eligible: false, reason: 'range', score: Infinity, distanceMeters, angleDegrees: 180, id, position: target };
	const view = normalizedForward(forward), dot = clamp((view.x * dx + view.z * dz) / distanceMeters, -1, 1), angleDegrees = Math.acos(dot) * 180 / Math.PI;
	if (angleDegrees > halfAngleDegrees) return { eligible: false, reason: 'angle', score: Infinity, distanceMeters, angleDegrees, id, position: target };
	const score = (angleDegrees / Math.max(1, halfAngleDegrees)) * (1 - PLAYER_LOCK_ON_CONFIG.DISTANCE_SCORE_WEIGHT) + (distanceMeters / maxDistanceMeters) * PLAYER_LOCK_ON_CONFIG.DISTANCE_SCORE_WEIGHT;
	return { eligible: true, reason: 'candidate', score, distanceMeters, angleDegrees, id, position: target };
}
export function selectPlayerLockTarget({ playerPosition, forward, candidates = [], maxDistanceMeters, halfAngleDegrees } = {}) {
	let best = null;
	for (let index = 0; index < candidates.length; index += 1) { const evaluation = evaluatePlayerLockTarget({ playerPosition, forward, entity: candidates[index], index, maxDistanceMeters, halfAngleDegrees }); if (!evaluation.eligible) continue; const candidate = { entity: candidates[index], index, ...evaluation }; if (!best || candidate.score < best.score - 1e-9 || (Math.abs(candidate.score - best.score) <= 1e-9 && candidate.id.localeCompare(best.id) < 0)) best = candidate; }
	return best;
}
export function findNearestPlayerLockCandidate({ playerPosition, forward, candidates = [] } = {}) {
	const player = planarPosition(playerPosition), view = normalizedForward(forward); if (!player) return null; let best = null;
	for (let index = 0; index < candidates.length; index += 1) { const entity = candidates[index], target = planarPosition(entityObject(entity)); if (!entityLockAvailable(entity) || !target) continue; const dx = target.x - player.x, dz = target.z - player.z, distanceMeters = Math.hypot(dx, dz); if (!(distanceMeters > 0.05)) continue; const dot = clamp((view.x * dx + view.z * dz) / distanceMeters, -1, 1), angleDegrees = Math.acos(dot) * 180 / Math.PI, id = entityStableId(entity, index); const candidate = { id, position: target, distanceMeters, angleDegrees }; if (!best || distanceMeters < best.distanceMeters - 1e-9 || (Math.abs(distanceMeters - best.distanceMeters) <= 1e-9 && id.localeCompare(best.id) < 0)) best = candidate; }
	return best;
}
function dispatchLockOn(detail) { if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') globalThis.dispatchEvent(new globalThis.CustomEvent(LOCK_ON_EVENT, { detail: Object.freeze(detail) })); }
export function createPlayerLockOnController(config = {}) {
	const acquireDistanceMeters = config.acquireDistanceMeters ?? PLAYER_LOCK_ON_CONFIG.ACQUIRE_DISTANCE_METERS, breakDistanceMeters = Math.max(acquireDistanceMeters, config.breakDistanceMeters ?? PLAYER_LOCK_ON_CONFIG.BREAK_DISTANCE_METERS), halfAngleDegrees = config.halfAngleDegrees ?? PLAYER_LOCK_ON_CONFIG.ACQUIRE_HALF_ANGLE_DEGREES, trackHalfAngleDegrees = Math.max(halfAngleDegrees, config.trackHalfAngleDegrees ?? PLAYER_LOCK_ON_CONFIG.TRACK_HALF_ANGLE_DEGREES);
	let lockedEntity = null, lockedId = null, lastDistanceMeters = Infinity;
	const snapshot = () => { const position = planarPosition(entityObject(lockedEntity)); return Object.freeze({ locked: Boolean(lockedEntity && position), targetId: lockedId, targetPosition: position ? Object.freeze({ ...position }) : null, distanceMeters: Number.isFinite(lastDistanceMeters) ? Number(lastDistanceMeters.toFixed(3)) : null }); };
	function clear(reason = 'released') { if (!lockedEntity) return false; const previousId = lockedId; lockedEntity = null; lockedId = null; lastDistanceMeters = Infinity; dispatchLockOn({ locked: false, targetId: previousId, reason }); return true; }
	return { update({ playerPosition, forward, candidates = [], toggleRequested = false } = {}) { const player = planarPosition(playerPosition); if (!player) { clear('invalid-player'); return snapshot(); } if (toggleRequested && lockedEntity) { clear('toggle-release'); return snapshot(); } if (lockedEntity) { if (!candidates.includes(lockedEntity)) { clear('target-removed'); return snapshot(); } if (!entityLockAvailable(lockedEntity)) { clear('target-unavailable'); return snapshot(); } const target = planarPosition(entityObject(lockedEntity)); lastDistanceMeters = target ? Math.hypot(target.x - player.x, target.z - player.z) : Infinity; if (!target || lastDistanceMeters > breakDistanceMeters) { clear('range-break'); return snapshot(); } const tracking = evaluatePlayerLockTarget({ playerPosition: player, forward, entity: lockedEntity, maxDistanceMeters: breakDistanceMeters, halfAngleDegrees: trackHalfAngleDegrees }); if (!tracking.eligible && tracking.reason === 'angle') { clear('view-break'); return snapshot(); } return snapshot(); } if (!toggleRequested) return snapshot(); const selected = selectPlayerLockTarget({ playerPosition: player, forward, candidates, maxDistanceMeters: acquireDistanceMeters, halfAngleDegrees }); if (!selected) { const nearest = findNearestPlayerLockCandidate({ playerPosition: player, forward, candidates }); dispatchLockOn({ locked: false, targetId: null, reason: 'no-target', nearestTargetId: nearest?.id ?? null, nearestTargetPosition: nearest?.position ? Object.freeze({ ...nearest.position }) : null, nearestDistanceMeters: nearest ? Number(nearest.distanceMeters.toFixed(3)) : null, nearestAngleDegrees: nearest ? Number(nearest.angleDegrees.toFixed(2)) : null }); return snapshot(); } lockedEntity = selected.entity; lockedId = selected.id; lastDistanceMeters = selected.distanceMeters; dispatchLockOn({ locked: true, targetId: lockedId, reason: 'acquired', distanceMeters: Number(lastDistanceMeters.toFixed(3)), angleDegrees: Number(selected.angleDegrees.toFixed(2)), targetPosition: Object.freeze({ ...selected.position }) }); return snapshot(); }, clear, getSnapshot: snapshot };
}

const _forward = new THREE.Vector3(), _right = new THREE.Vector3(), _move = new THREE.Vector3(), _worldUp = new THREE.Vector3(0, 1, 0), _cameraOffset = new THREE.Vector3(), _cameraSpherical = new THREE.Spherical();
const GAMEPAD_CAMERA_YAW_RADIANS_PER_SECOND = 2.5, GAMEPAD_CAMERA_PITCH_RADIANS_PER_SECOND = 1.9, GAMEPAD_CAMERA_ZOOM_METERS_PER_SECOND = 12, GAMEPAD_CAMERA_MAX_FRAME_SECONDS = 0.3, CAMERA_POLAR_EPSILON = 0.08;

export function applyGamepadCameraLook(camera, controls, axes) {
	const lookX = Number.isFinite(axes?.lookX) ? axes.lookX : 0, lookY = Number.isFinite(axes?.lookY) ? axes.lookY : 0, cameraZoom = Number.isFinite(axes?.cameraZoom) ? THREE.MathUtils.clamp(axes.cameraZoom, -1, 1) : 0, dt = Math.max(0, Math.min(GAMEPAD_CAMERA_MAX_FRAME_SECONDS, Number.isFinite(axes?.lookDeltaSeconds) ? axes.lookDeltaSeconds : 0));
	if (dt === 0 || (lookX === 0 && lookY === 0 && cameraZoom === 0)) return false; _cameraOffset.subVectors(camera.position, controls.target); if (_cameraOffset.lengthSq() < 1e-6) return false; _cameraSpherical.setFromVector3(_cameraOffset); _cameraSpherical.theta -= lookX * GAMEPAD_CAMERA_YAW_RADIANS_PER_SECOND * dt;
	const minPolar = Math.max(CAMERA_POLAR_EPSILON, Number.isFinite(controls.minPolarAngle) ? controls.minPolarAngle : CAMERA_POLAR_EPSILON), maxPolar = Math.min(Math.PI - CAMERA_POLAR_EPSILON, Number.isFinite(controls.maxPolarAngle) ? controls.maxPolarAngle : Math.PI - CAMERA_POLAR_EPSILON); _cameraSpherical.phi = THREE.MathUtils.clamp(_cameraSpherical.phi + lookY * GAMEPAD_CAMERA_PITCH_RADIANS_PER_SECOND * dt, minPolar, Math.max(minPolar, maxPolar));
	const minDistance = Math.max(0.1, Number.isFinite(controls.minDistance) ? controls.minDistance : 0.1), maxDistance = Math.max(minDistance, Number.isFinite(controls.maxDistance) ? controls.maxDistance : Infinity); _cameraSpherical.radius = THREE.MathUtils.clamp(_cameraSpherical.radius - cameraZoom * GAMEPAD_CAMERA_ZOOM_METERS_PER_SECOND * dt, minDistance, maxDistance); camera.position.copy(_cameraOffset.setFromSpherical(_cameraSpherical).add(controls.target)); return true;
}
export function computeCameraRelativeMove(camera, controls, axes) {
	applyGamepadCameraLook(camera, controls, axes);
	const guarding = Boolean(axes.guarding);
	const inputMagnitude = Math.min(1, Math.hypot(axes.forward, axes.strafe));
	if (inputMagnitude === 0) return { x: 0, z: 0, guarding };
	_forward.subVectors(controls.target, camera.position); _forward.y = 0; if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, -1); else _forward.normalize();
	_right.crossVectors(_forward, _worldUp).normalize(); _move.set(0, 0, 0).addScaledVector(_forward, axes.forward).addScaledVector(_right, axes.strafe);
	if (_move.lengthSq() < 1e-6) return { x: 0, z: 0, guarding };
	_move.normalize().multiplyScalar(inputMagnitude); return { x: _move.x, z: _move.z, guarding };
}
export function combineAxes(keyboardAxes, joystickAxes) {
	if (!joystickAxes) return keyboardAxes; return { forward: Math.max(-1, Math.min(1, keyboardAxes.forward + joystickAxes.forward)), strafe: Math.max(-1, Math.min(1, keyboardAxes.strafe + joystickAxes.strafe)), running: keyboardAxes.running || joystickAxes.running, guarding: Boolean(keyboardAxes.guarding || joystickAxes.guarding), lockOnRequested: Boolean(keyboardAxes.lockOnRequested), lookX: keyboardAxes.lookX ?? 0, lookY: keyboardAxes.lookY ?? 0, cameraZoom: keyboardAxes.cameraZoom ?? 0, lookDeltaSeconds: keyboardAxes.lookDeltaSeconds ?? 0 };
}
export function updatePlayerLockOn(state) {
	if (!state?.player?.object3D || !state?.camera || !state?.controls || !state?.keyboardInput) return null; state.playerLockOn ??= createPlayerLockOnController(); const nowSeconds = (globalThis.performance?.now?.() ?? Date.now()) / 1000, previousSeconds = Number.isFinite(state.playerLockOnLastSeconds) ? state.playerLockOnLastSeconds : nowSeconds; state.playerLockOnLastSeconds = nowSeconds; const delta = state.paused ? 0 : Math.max(0, Math.min(0.1, nowSeconds - previousSeconds));
	const keyboardToggle = Boolean(state.keyboardInput.consumeLockOnRequested?.()), touchToggle = Boolean(state.touchJoystick?.consumeLockOnRequested?.()); const snapshot = state.playerLockOn.update({ playerPosition: state.player.object3D.position, forward: computePlayerLockViewForward(state.camera.position, state.controls.target), candidates: state.npcs ?? [], toggleRequested: !state.paused && (keyboardToggle || touchToggle) }); if (snapshot?.targetPosition && delta > 0) applyPlayerLockFacing(state.player.object3D, snapshot.targetPosition, delta); state.touchJoystick?.setLockOnActive?.(Boolean(snapshot?.locked)); state.player.object3D.userData.playerLockOn = snapshot; return snapshot;
}

const _cameraCollidables = [];
export function collectCameraCollidables(state, worldX, worldZ) { _cameraCollidables.length = 0; const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS, centerChunkX = worldToChunkCoord(worldX, chunkSize), centerChunkZ = worldToChunkCoord(worldZ, chunkSize); for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const mesh = state.chunkManager.getLoadedChunkMesh(centerChunkX + dx, centerChunkZ + dz); if (mesh) _cameraCollidables.push(mesh); } for (const part of state.settlements.children) _cameraCollidables.push(part); for (const realCastle of state.realCastles.children) _cameraCollidables.push(realCastle); for (const icePart of state.iceLandmarks?.children ?? []) _cameraCollidables.push(icePart); return _cameraCollidables; }
export function streamAroundOrbitTarget(state) { updatePlayerLockOn(state); const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS, targetChunkX = worldToChunkCoord(state.controls.target.x, chunkSize), targetChunkZ = worldToChunkCoord(state.controls.target.z, chunkSize); if (state.lastStreamChunk && state.lastStreamChunk.x === targetChunkX && state.lastStreamChunk.z === targetChunkZ) return; state.lastStreamChunk = { x: targetChunkX, z: targetChunkZ }; const beforeCount = state.chunkManager.everGeneratedCount; state.chunkManager.streamTowards(targetChunkX, targetChunkZ, CHUNK_CONFIG.STREAM_RADIUS_CHUNKS); const newlyGenerated = state.chunkManager.everGeneratedCount - beforeCount; if (newlyGenerated > 0) console.info(`[game3d] Streamed in ${newlyGenerated} new chunk(s) near (${targetChunkX}, ${targetChunkZ}) — cumulative World Coverage now ${state.chunkManager.getCumulativeCoveredAreaKm2().toFixed(2)} km².`); }
export function bindResize(state) { const onResize = () => { const { innerWidth, innerHeight } = window; state.camera.aspect = innerWidth / innerHeight; state.camera.updateProjectionMatrix(); state.renderer.setSize(innerWidth, innerHeight); }; window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize); }
