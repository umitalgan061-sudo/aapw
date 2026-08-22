/**
 * Pure flight-path / reaction-blend math for `gameplay/dragons.js` (run 71, DECISIONS.md ADR-0092).
 *
 * Every function here is stateless and side-effect-free apart from writing into the caller's own
 * objects (an `Object3D`'s `position`/`rotation`, or the small mutable circle-center record
 * `dragonController.js` owns) — nothing is cached between frames, nothing allocates per frame, and
 * no `Math.random()` is involved, so the whole module stays deterministic in exactly the way
 * GOVERNANCE.md §5 requires of world/gameplay code.
 *
 * These blocks were lifted out of `dragons.js`'s single 598-line file when it reached the 600-line
 * cap (GOVERNANCE.md Altın Kural 7). Each one is the *same arithmetic in the same order* as the
 * inline code it replaces — deliberately not "cleaned up" on the way out, because the expression
 * order is load-bearing: e.g. `stepCenterTowardTarget`'s `(to / distance) * maxStep` must stay in
 * that order (rewriting it as `to * (maxStep / distance)` is a different floating-point result), and
 * its snap-to-target branch must assign the target *exactly* rather than add a remaining delta, so
 * "fully returned home" stays an exact equality instead of an asymptote. See ADR-0092.
 *
 * @module gameplay/dragonFlightMath
 */

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

/**
 * Points a dive pose along the dragon's actual rendered path from its on-circle origin. This is
 * intentionally callable both before and after terrain clamping: `applyDiveOffset()` gives immediate
 * orientation for pure math callers, while `dragonController.js` calls it again after the canonical
 * terrain floor so the final pitch matches the position the player really sees. A vertical dive is
 * valid — `atan2(verticalDrop, 0)` gives π/2 — so pitch must not be gated on horizontal travel.
 */
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

/**
 * Blends `object3D` off its already-applied on-circle pose toward the dive target. In addition to
 * moving the dragon, yaw eases from the circle tangent toward the actual horizontal swoop vector and
 * pitch eases toward the real downward path angle. Previously a committed dive could descend with a
 * level body even after yaw had been corrected, making the dragon look like it was sliding down an
 * invisible ramp. Both orientation corrections are tied to `diveBlend`: blend 0 preserves the exact
 * authored patrol pose, blend 1 faces the committed 3D swoop, and intermediate values progress
 * smoothly without introducing a second controller/state machine. Authored bank/roll is untouched.
 */
export function applyDiveOffset(object3D, { playerX, playerZ, centerY, diveDropMeters, lateralPullFraction, diveBlend }) {
	const circleX = object3D.position.x;
	const circleZ = object3D.position.z;
	const circlePitch = object3D.rotation.x;
	const circleYaw = object3D.rotation.y;
	const diveTargetX = circleX + (playerX - circleX) * lateralPullFraction;
	const diveTargetZ = circleZ + (playerZ - circleZ) * lateralPullFraction;
	const diveTargetY = centerY - diveDropMeters;
	const blendedX = circleX + (diveTargetX - circleX) * diveBlend;
	const blendedZ = circleZ + (diveTargetZ - circleZ) * diveBlend;
	const blendedY = centerY + (diveTargetY - centerY) * diveBlend;
	object3D.position.set(blendedX, blendedY, blendedZ);
	alignDiveOrientation(object3D, circleX, centerY, circleZ, circlePitch, circleYaw, diveBlend);
}

export function clampAltitudeAboveGround(object3D, sampleGroundY, minAltitudeAboveGroundMeters) {
	const groundY = sampleGroundY(object3D.position.x, object3D.position.z);
	const minY = groundY + minAltitudeAboveGroundMeters;
	if (object3D.position.y < minY) object3D.position.y = minY;
}
