/**
 * Pure flight-path / reaction-blend math for `gameplay/dragons.js` (run 71, DECISIONS.md ADR-0092).
 * Stateless, deterministic helpers only; no module-level retained state or randomness.
 * @module gameplay/dragonFlightMath
 */

export const DRAGON_TERRAIN_LOOKAHEAD_METERS = 12;
export const DRAGON_TERRAIN_PROBE_SPACING_METERS = 1;
export const DRAGON_TERRAIN_MAX_TRAVERSED_SWEEP_METERS = 48;

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
	object3D.userData ??= {};
	if (Number.isFinite(object3D.position?.x) && Number.isFinite(object3D.position?.z)) {
		object3D.userData.dragonPreviousRenderedX = object3D.position.x;
		object3D.userData.dragonPreviousRenderedZ = object3D.position.z;
	}
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

function sampleSegmentGround(sampleGroundY, startX, startZ, unitX, unitZ, distanceMeters, spacingMeters, includeStart, includeEndpoint, onSample) {
	if (distanceMeters <= 1e-8) return;
	const segmentCount = Math.max(1, Math.ceil(distanceMeters / spacingMeters));
	const firstSegment = includeStart ? 0 : 1;
	const lastSegment = includeEndpoint ? segmentCount : segmentCount - 1;
	for (let segment = firstSegment; segment <= lastSegment; segment += 1) {
		const distance = distanceMeters * (segment / segmentCount);
		onSample(sampleGroundY(startX + unitX * distance, startZ + unitZ * distance));
	}
}

/**
 * Deterministically samples the actual traversed XZ segment and then a bounded strip ahead of the
 * rendered dragon. Normal frame travel is swept at the conservative probe spacing before the
 * forward strip is projected. Retained positions that are farther apart than
 * `maxTraversedSweepMeters` are treated as a discontinuity (teleport, resume-from-background or
 * external reposition): the destination and normal forward lookahead remain terrain-safe, but the
 * unrendered gap is deliberately not sampled metre-by-metre. This caps one dragon's terrain work
 * under pathological frame gaps while preserving the qualified long-frame anti-tunnelling path for
 * ordinary movement. Facing yaw remains only a compatibility fallback when no retained motion
 * exists. Non-finite terrain samples are counted and ignored individually so one transient bad
 * sample cannot disable valid ridge probes; if every sample is invalid the existing altitude is
 * preserved rather than manufacturing a ground height. `lookAheadMeters=0` preserves historical
 * point-only behavior.
 */
export function clampAltitudeAboveGround(
	object3D,
	sampleGroundY,
	minAltitudeAboveGroundMeters,
	lookAheadMeters = DRAGON_TERRAIN_LOOKAHEAD_METERS,
	probeSpacingMeters = DRAGON_TERRAIN_PROBE_SPACING_METERS,
	motionX,
	motionZ,
	maxTraversedSweepMeters = DRAGON_TERRAIN_MAX_TRAVERSED_SWEEP_METERS,
) {
	object3D.userData ??= {};
	let terrainSampleCount = 0;
	let invalidTerrainSampleCount = 0;
	let highestGroundY = Number.NEGATIVE_INFINITY;
	const keepHighest = (groundY) => {
		terrainSampleCount += 1;
		if (!Number.isFinite(groundY)) {
			invalidTerrainSampleCount += 1;
			return;
		}
		if (groundY > highestGroundY) highestGroundY = groundY;
	};
	keepHighest(sampleGroundY(object3D.position.x, object3D.position.z));
	let traversedDistance = 0;
	let skippedDiscontinuity = false;
	if (lookAheadMeters > 0) {
		const spacing = Number.isFinite(probeSpacingMeters) && probeSpacingMeters > 0
			? Math.min(probeSpacingMeters, lookAheadMeters)
			: lookAheadMeters;
		const previousX = object3D.userData?.dragonPreviousRenderedX;
		const previousZ = object3D.userData?.dragonPreviousRenderedZ;
		const hasRetainedPosition = Number.isFinite(previousX) && Number.isFinite(previousZ);
		let forwardX = Number.isFinite(motionX) ? motionX : Number.NaN;
		let forwardZ = Number.isFinite(motionZ) ? motionZ : Number.NaN;
		if (!Number.isFinite(forwardX) || !Number.isFinite(forwardZ)) {
			if (hasRetainedPosition) {
				forwardX = object3D.position.x - previousX;
				forwardZ = object3D.position.z - previousZ;
			} else {
				forwardX = 0;
				forwardZ = 0;
			}
		}
		let motionLength = Math.hypot(forwardX, forwardZ);
		if (motionLength <= 1e-8 && Number.isFinite(object3D.rotation?.y)) {
			forwardX = Math.sin(object3D.rotation.y);
			forwardZ = Math.cos(object3D.rotation.y);
			motionLength = 1;
		}
		if (motionLength > 1e-8) {
			forwardX /= motionLength;
			forwardZ /= motionLength;
			if (hasRetainedPosition) {
				const traversedX = object3D.position.x - previousX;
				const traversedZ = object3D.position.z - previousZ;
				traversedDistance = Math.hypot(traversedX, traversedZ);
				const boundedMaxTraversed = Number.isFinite(maxTraversedSweepMeters) && maxTraversedSweepMeters > 0
					? maxTraversedSweepMeters
					: DRAGON_TERRAIN_MAX_TRAVERSED_SWEEP_METERS;
				if (traversedDistance > 1e-8 && traversedDistance <= boundedMaxTraversed) {
					sampleSegmentGround(
						sampleGroundY,
						previousX,
						previousZ,
						traversedX / traversedDistance,
						traversedZ / traversedDistance,
						traversedDistance,
						spacing,
						true,
						false,
						keepHighest,
					);
				} else if (traversedDistance > boundedMaxTraversed) {
					skippedDiscontinuity = true;
				}
			}
			sampleSegmentGround(
				sampleGroundY,
				object3D.position.x,
				object3D.position.z,
				forwardX,
				forwardZ,
				lookAheadMeters,
				spacing,
				false,
				true,
				keepHighest,
			);
		}
	}
	object3D.userData.dragonTerrainTraversedMeters = traversedDistance;
	object3D.userData.dragonTerrainSweepDiscontinuity = skippedDiscontinuity;
	object3D.userData.dragonTerrainSampleCount = terrainSampleCount;
	object3D.userData.dragonTerrainInvalidSampleCount = invalidTerrainSampleCount;
	if (!Number.isFinite(highestGroundY)) return;
	const minY = highestGroundY + minAltitudeAboveGroundMeters;
	if (object3D.position.y < minY) object3D.position.y = minY;
}