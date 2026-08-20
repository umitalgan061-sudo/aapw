/**
 * Read-only Player target-lock selection over existing living-world entities.
 * This module never mutates NPC AI; it only reads object3D positions and returns a target position
 * that the existing Player controller may face while locked.
 * @module gameplay/playerLockOn
 */

export const PLAYER_LOCK_ON_CONFIG = Object.freeze({
	ACQUIRE_DISTANCE_METERS: 22,
	BREAK_DISTANCE_METERS: 28,
	ACQUIRE_HALF_ANGLE_DEGREES: 68,
	DISTANCE_SCORE_WEIGHT: 0.38,
	TURN_RATE_RADIANS_PER_SECOND: 11,
});

const LOCK_ON_EVENT = 'aapw:player-lock-on';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function entityObject(entity) {
	return entity?.object3D ?? entity?.model ?? entity?.group ?? null;
}

function entityStableId(entity, index) {
	const object = entityObject(entity);
	return String(entity?.id ?? entity?.displayName ?? object?.userData?.npcId ?? object?.name ?? `npc-${index}`);
}

function planarPosition(value) {
	const position = value?.position ?? value;
	if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
	return { x: position.x, y: Number.isFinite(position.y) ? position.y : 0, z: position.z };
}

function normalizedForward(forward) {
	const x = Number.isFinite(forward?.x) ? forward.x : 0;
	const z = Number.isFinite(forward?.z) ? forward.z : 1;
	const length = Math.hypot(x, z);
	return length > 1e-6 ? { x: x / length, z: z / length } : { x: 0, z: 1 };
}

export function computePlayerLockViewForward(cameraPosition, cameraTarget) {
	const camera = planarPosition(cameraPosition), target = planarPosition(cameraTarget);
	if (!camera || !target) return { x: 0, z: 1 };
	return normalizedForward({ x: target.x - camera.x, z: target.z - camera.z });
}

export function applyPlayerLockFacing(playerObject, targetPosition, delta, turnRateRadiansPerSecond = PLAYER_LOCK_ON_CONFIG.TURN_RATE_RADIANS_PER_SECOND) {
	const player = planarPosition(playerObject), target = planarPosition(targetPosition);
	if (!player || !target || !playerObject?.rotation || !(delta > 0) || !(turnRateRadiansPerSecond > 0)) return false;
	const dx = target.x - player.x, dz = target.z - player.z;
	if (Math.hypot(dx, dz) <= 0.05) return false;
	const currentYaw = Number.isFinite(playerObject.rotation.y) ? playerObject.rotation.y : 0;
	const targetYaw = Math.atan2(dx, dz);
	const shortestDelta = Math.atan2(Math.sin(targetYaw - currentYaw), Math.cos(targetYaw - currentYaw));
	const maxStep = turnRateRadiansPerSecond * Math.min(delta, 0.1);
	playerObject.rotation.y = currentYaw + clamp(shortestDelta, -maxStep, maxStep);
	return true;
}

export function evaluatePlayerLockTarget({ playerPosition, forward, entity, index = 0, maxDistanceMeters = PLAYER_LOCK_ON_CONFIG.ACQUIRE_DISTANCE_METERS, halfAngleDegrees = PLAYER_LOCK_ON_CONFIG.ACQUIRE_HALF_ANGLE_DEGREES } = {}) {
	const player = planarPosition(playerPosition), target = planarPosition(entityObject(entity));
	if (!player || !target || !(maxDistanceMeters > 0)) return { eligible: false, reason: 'invalid', score: Infinity, distanceMeters: Infinity, angleDegrees: 180, id: entityStableId(entity, index) };
	const dx = target.x - player.x, dz = target.z - player.z, distanceMeters = Math.hypot(dx, dz);
	if (!(distanceMeters > 0.05) || distanceMeters > maxDistanceMeters) return { eligible: false, reason: 'range', score: Infinity, distanceMeters, angleDegrees: 180, id: entityStableId(entity, index), position: target };
	const view = normalizedForward(forward), dot = clamp((view.x * dx + view.z * dz) / distanceMeters, -1, 1), angleDegrees = Math.acos(dot) * 180 / Math.PI;
	if (angleDegrees > halfAngleDegrees) return { eligible: false, reason: 'angle', score: Infinity, distanceMeters, angleDegrees, id: entityStableId(entity, index), position: target };
	const angleScore = angleDegrees / Math.max(1, halfAngleDegrees);
	const distanceScore = distanceMeters / maxDistanceMeters;
	const score = angleScore * (1 - PLAYER_LOCK_ON_CONFIG.DISTANCE_SCORE_WEIGHT) + distanceScore * PLAYER_LOCK_ON_CONFIG.DISTANCE_SCORE_WEIGHT;
	return { eligible: true, reason: 'candidate', score, distanceMeters, angleDegrees, id: entityStableId(entity, index), position: target };
}

export function selectPlayerLockTarget({ playerPosition, forward, candidates = [], maxDistanceMeters, halfAngleDegrees } = {}) {
	let best = null;
	for (let index = 0; index < candidates.length; index += 1) {
		const entity = candidates[index];
		const evaluation = evaluatePlayerLockTarget({ playerPosition, forward, entity, index, maxDistanceMeters, halfAngleDegrees });
		if (!evaluation.eligible) continue;
		const candidate = { entity, index, ...evaluation };
		if (!best || candidate.score < best.score - 1e-9 || (Math.abs(candidate.score - best.score) <= 1e-9 && candidate.id.localeCompare(best.id) < 0)) best = candidate;
	}
	return best;
}

function dispatchLockOn(detail) {
	if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
	globalThis.dispatchEvent(new globalThis.CustomEvent(LOCK_ON_EVENT, { detail: Object.freeze(detail) }));
}

export function createPlayerLockOnController(config = {}) {
	const acquireDistanceMeters = config.acquireDistanceMeters ?? PLAYER_LOCK_ON_CONFIG.ACQUIRE_DISTANCE_METERS;
	const breakDistanceMeters = Math.max(acquireDistanceMeters, config.breakDistanceMeters ?? PLAYER_LOCK_ON_CONFIG.BREAK_DISTANCE_METERS);
	const halfAngleDegrees = config.halfAngleDegrees ?? PLAYER_LOCK_ON_CONFIG.ACQUIRE_HALF_ANGLE_DEGREES;
	let lockedEntity = null, lockedId = null, lastDistanceMeters = Infinity;

	function clear(reason = 'released') {
		if (!lockedEntity) return false;
		const previousId = lockedId;
		lockedEntity = null; lockedId = null; lastDistanceMeters = Infinity;
		dispatchLockOn({ locked: false, targetId: previousId, reason });
		return true;
	}

	function snapshot() {
		const position = planarPosition(entityObject(lockedEntity));
		return Object.freeze({ locked: Boolean(lockedEntity && position), targetId: lockedId, targetPosition: position ? Object.freeze({ ...position }) : null, distanceMeters: Number.isFinite(lastDistanceMeters) ? Number(lastDistanceMeters.toFixed(3)) : null });
	}

	return {
		update({ playerPosition, forward, candidates = [], toggleRequested = false } = {}) {
			const player = planarPosition(playerPosition);
			if (!player) { clear('invalid-player'); return snapshot(); }
			if (toggleRequested && lockedEntity) { clear('toggle-release'); return snapshot(); }
			if (lockedEntity) {
				if (!candidates.includes(lockedEntity)) { clear('target-removed'); return snapshot(); }
				const target = planarPosition(entityObject(lockedEntity));
				lastDistanceMeters = target ? Math.hypot(target.x - player.x, target.z - player.z) : Infinity;
				if (!target || lastDistanceMeters > breakDistanceMeters) { clear('range-break'); return snapshot(); }
				return snapshot();
			}
			if (!toggleRequested) return snapshot();
			const selected = selectPlayerLockTarget({ playerPosition: player, forward, candidates, maxDistanceMeters: acquireDistanceMeters, halfAngleDegrees });
			if (!selected) { dispatchLockOn({ locked: false, targetId: null, reason: 'no-target' }); return snapshot(); }
			lockedEntity = selected.entity; lockedId = selected.id; lastDistanceMeters = selected.distanceMeters;
			dispatchLockOn({ locked: true, targetId: lockedId, reason: 'acquired', distanceMeters: Number(lastDistanceMeters.toFixed(3)), angleDegrees: Number(selected.angleDegrees.toFixed(2)) });
			return snapshot();
		},
		clear,
		getSnapshot: snapshot,
	};
}
