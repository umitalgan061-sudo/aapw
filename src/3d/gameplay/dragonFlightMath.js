/**
 * Pure flight-path / reaction-blend math for `gameplay/dragons.js` (run 71, DECISIONS.md ADR-0092).
 * Stateless, deterministic helpers only; no per-frame retained state or randomness.
 * @module gameplay/dragonFlightMath
 */

export const DRAGON_TERRAIN_LOOKAHEAD_METERS = 12;
export const DRAGON_TERRAIN_PROBE_SPACING_METERS = 1;

export function easeBlendToward(currentBlend, targetBlend, delta, transitionSeconds) {
	if (transitionSeconds > 0) {
		const step = delta / transitionSeconds;
		if (currentBlend < targetBlend) return Math.min(targetBlend, currentBlend + step);
		if (currentBlend > targetBlend) return Math.max(targetBlend, currentBlend - step);
		return currentBlend;
	}
	return targetBlend;
}

export function blendScalar(fromValue, toValue, blend) {
	return fromValue + (toValue - fromValue) * blend;
}

export function applyCirclePose(object3D, center, radiusMeters, angle, bankAngleRadians) {
	const x = center.x + radiusMeters * Math.sin(angle);
	const z = center.z + radiusMeters * Math.cos(angle);
	object3D.position.set(x, center.y, z);
	const tangentX = Math.cos(angle);
	const tangentZ = -Math.sin(angle);
	object3D.rotation.set(0, Math.atan2(tangentX, tangentZ), bankAngleRadians);
}

export function stepCenterTowardTarget(center, targetX, targetZ, maxStep) {
	const toTargetX = targetX - center.x;
	const toTargetZ = targetZ - center.z;
	const distanceToTarget = Math.hypot(toTargetX, toTargetZ);
	if (distanceToTarget > maxStep && distanceToTarget > 0) {
		center.x += (toTargetX / distanceToTarget) * maxStep;
		center.z += (toTargetZ / distanceToTarget) * maxStep;
	} else {
		center.x = targetX;
		center.z = targetZ;
	}
}

export function alignDiveOrientation(object3D, circleX, circleY, circleZ, circlePitch, circleYaw, diveBlend) {
	if (diveBlend <= 0) return;
	const boundedBlend = Math.min(1, Math.max(0, diveBlend));
	const motionX = object3D.position.x - circleX;
	const motionZ = object3D.position.z - circleZ;
	const horizontalDistance = Math.hypot(motionX, motionZ);
	if (horizontalDistance > 1e-8) {
		const targetYaw = Math.atan2(motionX, motionZ);
		const shortestYawDelta = Math.atan2(Math.sin(targetYaw - circleYaw), Math.cos(targetYaw - circleYaw));
		object3D.rotation.y = circleYaw + shortestYawDelta * boundedBlend;
	} else {
		object3D.rotation.y = circleYaw;
	}
	const verticalDrop = Math.max(0, circleY - object3D.position.y);
	const targetPitch = Math.atan2(verticalDrop, horizontalDistance);
	const shortestPitchDelta = Math.atan2(Math.sin(targetPitch - circlePitch), Math.cos(targetPitch - circlePitch));
	object3D.rotation.x = circlePitch + shortestPitchDelta * boundedBlend;
}

export function applyDiveOffset(object3D, { playerX, playerZ, centerY, diveDropMeters, lateralPullFraction, diveBlend }) {
	const circleX = object3D.position.x;
	const circleZ = object3D.position.z;
	const circlePitch = object3D.rotation.x;
	const circleYaw = object3D.rotation.y;
	const diveTargetX = circleX + (playerX - circleX) * lateralPullFraction;
	const diveTargetZ = circleZ + (playerZ - circleZ) * lateralPullFraction;
	const diveTargetY = centerY - diveDropMeters;
	object3D.position.set(
		circleX + (diveTargetX - circleX) * diveBlend,
		centerY + (diveTargetY - centerY) * diveBlend,
		circleZ + (diveTargetZ - circleZ) * diveBlend,
	);
	alignDiveOrientation(object3D, circleX, centerY, circleZ, circlePitch, circleYaw, diveBlend);
}

/**
 * Deterministically samples a bounded strip ahead of the rendered dragon. A three-point probe left
 * gaps large enough for narrow ridges to remain invisible between samples. The strip is now
 * subdivided at a conservative 1 m gameplay-terrain spacing, so a 12 m look-ahead performs at most
 * 13 samples (current point + 12 forward samples). This stays bounded and allocation-free while
 * materially reducing low-FPS terrain tunnelling. `lookAheadMeters=0` preserves point-only behavior.
 */
export function clampAltitudeAboveGround(
	object3D,
	sampleGroundY,
	minAltitudeAboveGroundMeters,
	lookAheadMeters = DRAGON_TERRAIN_LOOKAHEAD_METERS,
	probeSpacingMeters = DRAGON_TERRAIN_PROBE_SPACING_METERS,
) {
	let highestGroundY = sampleGroundY(object3D.position.x, object3D.position.z);
	if (lookAheadMeters > 0 && Number.isFinite(object3D.rotation?.y)) {
		const forwardX = Math.sin(object3D.rotation.y);
		const forwardZ = Math.cos(object3D.rotation.y);
		const spacing = Number.isFinite(probeSpacingMeters) && probeSpacingMeters > 0
			? Math.min(probeSpacingMeters, lookAheadMeters)
			: lookAheadMeters;
		const segmentCount = Math.max(1, Math.ceil(lookAheadMeters / spacing));
		for (let segment = 1; segment <= segmentCount; segment += 1) {
			const distance = lookAheadMeters * (segment / segmentCount);
			const groundY = sampleGroundY(
				object3D.position.x + forwardX * distance,
				object3D.position.z + forwardZ * distance,
			);
			if (groundY > highestGroundY) highestGroundY = groundY;
		}
	}
	const minY = highestGroundY + minAltitudeAboveGroundMeters;
	if (object3D.position.y < minY) object3D.position.y = minY;
}
