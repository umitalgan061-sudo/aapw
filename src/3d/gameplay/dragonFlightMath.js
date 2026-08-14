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

/**
 * Eases a 0..1 reaction blend linearly toward `targetBlend`, one frame's worth — the shared shape
 * every reaction in `dragonController.js` uses (reactive flight, dive, pursuit, give-up), so a
 * reaction reads as the dragon actually responding rather than snapping between two fixed states.
 * A non-positive `transitionSeconds` means "no easing configured": the blend snaps to the target,
 * the same escape hatch each inline copy of this already had.
 * @param {number} currentBlend Blend value as of the previous frame (0..1).
 * @param {number} targetBlend Blend value this frame is easing toward (0 or 1 in practice).
 * @param {number} delta Seconds since the last frame.
 * @param {number} transitionSeconds Full 0->1 (or 1->0) ease duration.
 * @returns {number} The new blend value; never overshoots `targetBlend`.
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

/**
 * Linear interpolation written the one way this module's callers already wrote it inline
 * (`from + (to - from) * blend`) — used for circle radius, cruise altitude, angular speed and bank
 * angle. Kept as its own named function rather than open-coded so every blended quantity provably
 * shares one expression, which is what makes "blend 0 lands exactly back on the calm value" true
 * everywhere instead of per-call-site.
 * @param {number} fromValue Value at `blend === 0`.
 * @param {number} toValue Value at `blend === 1`.
 * @param {number} blend 0..1.
 * @returns {number}
 */
export function blendScalar(fromValue, toValue, blend) {
	return fromValue + (toValue - fromValue) * blend;
}

/**
 * Places `object3D` at `angle` on its circle and orients it along the direction of travel.
 * The tangent of a circle parameterized by (sin, cos) is (cos, -sin) — the same `atan2(dx, dz)` yaw
 * convention every other gameplay system here uses (see `gameplay/animals.js`'s `turnToward`), just
 * derived analytically instead of from a per-frame position delta, since the path itself is a
 * closed-form circle.
 * @param {import('three').Object3D} object3D
 * @param {{x: number, y: number, z: number}} center Current circle center (see `stepCenterTowardTarget`).
 * @param {number} radiusMeters Circle radius this frame.
 * @param {number} angle Position on the circle, in radians.
 * @param {number} bankAngleRadians Visual roll applied this frame.
 */
export function applyCirclePose(object3D, center, radiusMeters, angle, bankAngleRadians) {
	const x = center.x + radiusMeters * Math.sin(angle);
	const z = center.z + radiusMeters * Math.cos(angle);
	object3D.position.set(x, center.y, z);
	const tangentX = Math.cos(angle);
	const tangentZ = -Math.sin(angle);
	object3D.rotation.set(0, Math.atan2(tangentX, tangentZ), bankAngleRadians);
}

/**
 * Moves the circle center at most `maxStep` meters toward (`targetX`, `targetZ`), mutating `center`
 * in place (no per-frame allocation). Speed-limited rather than a fraction-of-remaining-distance
 * lerp, which is what makes a sprinting player genuinely open a gap the dragon has to close instead
 * of the whole circle teleporting after them — see `dragonController.js`'s `pursuitCenterSpeedMps`
 * doc comment. Within one step of the target it lands on it *exactly*, so "fully returned home"
 * stays an exact equality rather than an asymptote that never quite arrives.
 * @param {{x: number, y: number, z: number}} center Mutated: `x`/`z` only.
 * @param {number} targetX
 * @param {number} targetZ
 * @param {number} maxStep Maximum horizontal distance to travel this frame, in meters.
 */
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
 * Blends `object3D` off its already-applied on-circle pose toward the dive target (run 64,
 * ADR-0082): partway toward the player's horizontal position — a swoop toward them, not a teleport
 * onto them — and `diveDropMeters` below the circle's cruise altitude. Blends *away* from the pose
 * `applyCirclePose` just wrote rather than replacing it, so easing `diveBlend` back to 0 always
 * lands exactly on the ordinary circling pose again with no path-planning.
 * @param {import('three').Object3D} object3D Read for its current on-circle (x, z), then repositioned.
 * @param {object} options
 * @param {number} options.playerX
 * @param {number} options.playerZ
 * @param {number} options.centerY Circle cruise altitude this frame (`center.y`).
 * @param {number} options.diveDropMeters Raw altitude drop, before the caller's terrain-safety clamp.
 * @param {number} options.lateralPullFraction 0..1, already clamped by the caller.
 * @param {number} options.diveBlend 0..1.
 */
export function applyDiveOffset(object3D, { playerX, playerZ, centerY, diveDropMeters, lateralPullFraction, diveBlend }) {
	const circleX = object3D.position.x;
	const circleZ = object3D.position.z;
	// Pulled only partway toward the player's horizontal position, not all the way onto it.
	const diveTargetX = circleX + (playerX - circleX) * lateralPullFraction;
	const diveTargetZ = circleZ + (playerZ - circleZ) * lateralPullFraction;
	const diveTargetY = centerY - diveDropMeters;
	const blendedX = circleX + (diveTargetX - circleX) * diveBlend;
	const blendedZ = circleZ + (diveTargetZ - circleZ) * diveBlend;
	const blendedY = centerY + (diveTargetY - centerY) * diveBlend;
	object3D.position.set(blendedX, blendedY, blendedZ);
}

/**
 * Terrain-collision safety floor: never lets the dragon end a frame below the real ground under its
 * *final* (x, z), plus a clearance margin. Re-sampled every frame (the position moves every frame)
 * and applied to the finished position rather than inside the dive branch as run 64 originally had
 * it — since run 66 the ordinary circling pose flies over arbitrary terrain too (the center
 * travels), so clamping only the dive would leave the far more common case unguarded.
 * @param {import('three').Object3D} object3D Mutated in place when it is below the floor.
 * @param {(worldX: number, worldZ: number) => number} sampleGroundY
 * @param {number} minAltitudeAboveGroundMeters
 */
export function clampAltitudeAboveGround(object3D, sampleGroundY, minAltitudeAboveGroundMeters) {
	const groundY = sampleGroundY(object3D.position.x, object3D.position.z);
	const minY = groundY + minAltitudeAboveGroundMeters;
	if (object3D.position.y < minY) object3D.position.y = minY;
}
