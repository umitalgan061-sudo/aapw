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
 * Blends `object3D` off its already-applied on-circle pose toward the dive target. In addition to
 * moving the dragon, the heading now eases from the circle tangent toward the actual horizontal
 * swoop vector. Previously position left the circle while yaw remained tangent to it, so a committed
 * dive/attack could visibly travel sideways. The shortest-angle blend is tied to `diveBlend`: blend
 * 0 preserves the exact patrol heading; blend 1 faces the committed swoop; intermediate values turn
 * progressively without introducing a second controller/state machine.
 */
export function applyDiveOffset(object3D, { playerX, playerZ, centerY, diveDropMeters, lateralPullFraction, diveBlend }) {
	const circleX = object3D.position.x;
	const circleZ = object3D.position.z;
	const circleYaw = object3D.rotation.y;
	const diveTargetX = circleX + (playerX - circleX) * lateralPullFraction;
	const diveTargetZ = circleZ + (playerZ - circleZ) * lateralPullFraction;
	const diveTargetY = centerY - diveDropMeters;
	const blendedX = circleX + (diveTargetX - circleX) * diveBlend;
	const blendedZ = circleZ + (diveTargetZ - circleZ) * diveBlend;
	const blendedY = centerY + (diveTargetY - centerY) * diveBlend;
	object3D.position.set(blendedX, blendedY, blendedZ);

	const motionX = blendedX - circleX;
	const motionZ = blendedZ - circleZ;
	if (diveBlend > 0 && Math.hypot(motionX, motionZ) > 1e-8) {
		const targetYaw = Math.atan2(motionX, motionZ);
		const shortestDelta = Math.atan2(Math.sin(targetYaw - circleYaw), Math.cos(targetYaw - circleYaw));
		object3D.rotation.y = circleYaw + shortestDelta * Math.min(1, Math.max(0, diveBlend));
	}
}

export function clampAltitudeAboveGround(object3D, sampleGroundY, minAltitudeAboveGroundMeters) {
	const groundY = sampleGroundY(object3D.position.x, object3D.position.z);
	const minY = groundY + minAltitudeAboveGroundMeters;
	if (object3D.position.y < minY) object3D.position.y = minY;
}
