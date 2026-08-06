/**
 * Per-frame reaction-state stepping for `dragonController.js`'s `createDragon` — the notice/
 * reactive/pursuit/give-up/dive/telegraph/attack blend bookkeeping that used to live entirely
 * inline in `update()`. Split out in run 109 when `dragonController.js` approached the project's
 * 600-line file cap (GOVERNANCE.md golden rule 7) — the same "extract by concern" pattern
 * `dragonFlightMath.js` (pure position/blend arithmetic) and `dragonSpawns.js` (config-driven
 * spawn wiring) already established when `gameplay/dragons.js` itself was first split in run 71
 * (DECISIONS.md ADR-0092). No behavior change: every blend/threshold/ease call below is moved
 * verbatim from `dragonController.js`'s previous inline `update()`, not rewritten — see
 * DECISIONS.md ADR-0136 for the reasoning and the regression evidence that nothing numeric moved.
 *
 * This module owns only the bookkeeping (blend values, elapsed-time counters, the circle center's
 * bounded-speed travel) — it never touches a `THREE.Object3D` or emits an event. Applying the
 * result to the actual dragon model (`applyCirclePose`/`applyDiveOffset`/
 * `clampAltitudeAboveGround`) and firing `eventsBus.emit(...)` stays `dragonController.js`'s job,
 * same pure-math/side-effect split `dragonFlightMath.js` already draws.
 *
 * @module gameplay/dragonReactionState
 */

import { easeBlendToward, blendScalar, stepCenterTowardTarget } from './dragonFlightMath.js';

/**
 * Creates the mutable per-dragon reaction state `stepDragonReactionState` advances every frame —
 * the same fields `createDragon` previously held as loose closure `let`s, now bundled as one
 * record so this module can pass/mutate them without a dozen individual arguments.
 * @param {number} startAngleRadians Initial position on the circle (radians).
 * @param {number} centerX Home circle-center X (immutable — pursuit travels `center`, not this).
 * @param {number} centerY Home circle-center Y (altitude).
 * @param {number} centerZ Home circle-center Z.
 * @returns {object} Mutable reaction state.
 */
export function createDragonReactionState(startAngleRadians, centerX, centerY, centerZ) {
	return {
		angle: startAngleRadians,
		// Run 66 (ADR-0085) pursuit: the circle's center is no longer fixed at the spawn seat. This
		// tracks where it actually is right now; the caller's own `centerX`/`centerZ`/`centerY` stay
		// the immutable "home" values the center travels back to on disengage.
		center: { x: centerX, y: centerY, z: centerZ },
		reactiveBlend: 0,
		diveBlend: 0,
		diveAlarmElapsedSeconds: 0,
		diveTelegraphBlend: 0,
		pursuitBlend: 0,
		pursuitElapsedSeconds: 0,
		pursuitExhausted: false,
		giveUpBlend: 0,
		attackBlend: 0,
		biteCooldownRemainingSeconds: 0,
		playerWasInNoticeRadius: false,
	};
}

/**
 * Advances one frame of reaction bookkeeping — notice edge-trigger, reactive/pursuit/give-up
 * blends, circle-center travel, the run-64 dive plus its run-72 telegraph, and the run-90 attack
 * escalation. Mutates `state` in place and returns this frame's derived values for the caller to
 * apply to the real `THREE.Object3D`.
 * @param {object} state From `createDragonReactionState`.
 * @param {number} delta Seconds since the last frame.
 * @param {number|null} distanceToPlayer Real 3D distance dragon-to-player this frame, or `null`
 *   when nothing needs it this frame (see `dragonController.js`'s own `canNotice || canDive ||
 *   canPursue` gate for when this is computed at all).
 * @param {object} config Every `createDragon` option this stepping logic reads, forwarded as one
 *   bundle (unchanged frame to frame) rather than individually destructured at each call site.
 * @returns {{isInRadius: boolean, justEnteredNotice: boolean, currentCircleRadiusMeters: number,
 *   currentBankAngleRadians: number, currentLateralPullFraction: number, currentDropMeters: number,
 *   agitationBlend: number}}
 */
export function stepDragonReactionState(state, delta, distanceToPlayer, config) {
	const {
		canNotice, canDive, canPursue, canBite,
		noticeRadiusMeters,
		reactiveSpeedMultiplier, reactiveBankAngleRadians, reactiveTransitionSeconds,
		bankAngleRadians, speedMps, circleRadiusMeters,
		alarmRadiusMeters, diveTelegraphSeconds, diveTelegraphTransitionSeconds, diveTransitionSeconds,
		attackTriggerSeconds, attackTransitionSeconds,
		clampedDiveLateralPullFraction, diveDropMeters,
		clampedAttackLateralPullFraction, attackDropMeters,
		pursuitRadiusMeters, pursuitCenterSpeedMps, centerX, centerZ, centerY,
		pursuitCircleRadiusMeters, pursuitTransitionSeconds, pursuitMaxSeconds,
		cruiseAltitudeAboveGroundMeters, sampleGroundY,
		giveUpBankAngleMultiplier, giveUpTransitionSeconds,
		playerPosition,
	} = config;

	// Notice edge-trigger (run 54, ADR-0072): the emit itself is the caller's job (this module
	// never touches `eventsBus`) — `justEnteredNotice` just tells it whether to.
	let isInRadius = false;
	let justEnteredNotice = false;
	if (canNotice && distanceToPlayer != null) {
		isInRadius = distanceToPlayer < noticeRadiusMeters;
		justEnteredNotice = isInRadius && !state.playerWasInNoticeRadius;
		state.playerWasInNoticeRadius = isInRadius;
	}

	// Run 58 (ADR-0077): ease `reactiveBlend` linearly toward 1 (in radius) or 0 (not) over
	// `reactiveTransitionSeconds`, then use it below to blend both angular speed and bank angle.
	state.reactiveBlend = easeBlendToward(state.reactiveBlend, isInRadius ? 1 : 0, delta, reactiveTransitionSeconds);

	// Run 66 (ADR-0085) pursuit engagement. Exhaustion re-arms only once the player actually
	// leaves the radius, so a stationary player can't be chased forever.
	let isEngaged = false;
	if (canPursue && distanceToPlayer != null) {
		const isInPursuitRadius = distanceToPlayer < pursuitRadiusMeters;
		if (!isInPursuitRadius) {
			state.pursuitExhausted = false;
			state.pursuitElapsedSeconds = 0;
		} else if (!state.pursuitExhausted) {
			state.pursuitElapsedSeconds += delta;
			if (state.pursuitElapsedSeconds >= pursuitMaxSeconds) state.pursuitExhausted = true;
			else isEngaged = true;
		}
	}

	// Run 71 (ADR-0091) give-up cue: eases toward 1 only while `pursuitExhausted` is true — an
	// ordinary disengage (player leaves before the timer exhausts) never sets that flag, so this
	// blend stays exactly 0 for that case.
	state.giveUpBlend = easeBlendToward(state.giveUpBlend, state.pursuitExhausted ? 1 : 0, delta, giveUpTransitionSeconds);

	// The circle center travels at a bounded speed toward the player while engaged, and back
	// toward its immutable home center otherwise (see `dragonFlightMath.js`'s
	// `stepCenterTowardTarget` for why this is speed-limited rather than blended).
	if (canPursue) {
		const targetCenterX = isEngaged && playerPosition ? playerPosition.x : centerX;
		const targetCenterZ = isEngaged && playerPosition ? playerPosition.z : centerZ;
		stepCenterTowardTarget(state.center, targetCenterX, targetCenterZ, pursuitCenterSpeedMps * delta);
	}

	// Radius/altitude ease into and out of the engaged shape.
	state.pursuitBlend = easeBlendToward(state.pursuitBlend, isEngaged ? 1 : 0, delta, pursuitTransitionSeconds);
	const currentCircleRadiusMeters = blendScalar(circleRadiusMeters, pursuitCircleRadiusMeters, state.pursuitBlend);
	if (canPursue && cruiseAltitudeAboveGroundMeters != null) {
		const terrainFollowingCenterY = sampleGroundY(state.center.x, state.center.z) + cruiseAltitudeAboveGroundMeters;
		state.center.y = blendScalar(centerY, terrainFollowingCenterY, state.pursuitBlend);
	}

	// Tangential speed is the tuned constant; angular speed is derived from it against the
	// circle's *current* radius each frame — holding tangential (not angular) speed constant is
	// what stops a closing dragon from appearing to slow down as pursuit tightens its ring.
	const calmAngular = speedMps / currentCircleRadiusMeters;
	const reactiveAngular = (speedMps * reactiveSpeedMultiplier) / currentCircleRadiusMeters;
	const angularSpeedRadiansPerSecond = blendScalar(calmAngular, reactiveAngular, state.reactiveBlend);
	const reactiveBankAngleThisFrame = blendScalar(bankAngleRadians, reactiveBankAngleRadians, state.reactiveBlend);
	// Run 71 (ADR-0091) give-up cue: layered on top of the ordinary reactive-blend bank above.
	const giveUpBankAngleRadians = reactiveBankAngleRadians * giveUpBankAngleMultiplier;
	const currentBankAngleRadians = blendScalar(reactiveBankAngleThisFrame, giveUpBankAngleRadians, state.giveUpBlend);

	state.angle += angularSpeedRadiansPerSecond * delta;

	// Run 64 (ADR-0082) dive + run 72's telegraph: `diveAlarmElapsedSeconds` is a plain elapsed-
	// time counter (not eased), reset the instant the player leaves `alarmRadiusMeters`. It gates
	// both the telegraph cue (fires immediately) and the dive's own position blend (only allowed
	// to start moving once the telegraph window has fully elapsed).
	const isAlarmed = canDive && distanceToPlayer != null && distanceToPlayer < alarmRadiusMeters;
	state.diveAlarmElapsedSeconds = isAlarmed ? state.diveAlarmElapsedSeconds + delta : 0;
	const diveTelegraphActive = isAlarmed && state.diveAlarmElapsedSeconds < diveTelegraphSeconds;
	state.diveTelegraphBlend = easeBlendToward(state.diveTelegraphBlend, diveTelegraphActive ? 1 : 0, delta, diveTelegraphTransitionSeconds);
	const diveMotionAllowed = isAlarmed && state.diveAlarmElapsedSeconds >= diveTelegraphSeconds;
	state.diveBlend = easeBlendToward(state.diveBlend, diveMotionAllowed ? 1 : 0, delta, diveTransitionSeconds);

	// Run 90 (ADR-0116) attack lunge: only ever computed for a biting dragon (`canBite`) — a
	// non-biting dragon's pull/drop stay exactly the plain dive values, provably identical to the
	// pre-run-88 dive math. Requires sustained proximity *on top of* the dive's own telegraph+
	// transition — the player kept provoking it, not merely triggered one swoop.
	let currentLateralPullFraction = clampedDiveLateralPullFraction;
	let currentDropMeters = diveDropMeters;
	if (canBite) {
		const attackTriggered = isAlarmed && state.diveAlarmElapsedSeconds >= diveTelegraphSeconds + attackTriggerSeconds;
		state.attackBlend = easeBlendToward(state.attackBlend, attackTriggered ? 1 : 0, delta, attackTransitionSeconds);
		currentLateralPullFraction = blendScalar(clampedDiveLateralPullFraction, clampedAttackLateralPullFraction, state.attackBlend);
		currentDropMeters = blendScalar(diveDropMeters, attackDropMeters, state.attackBlend);
	}

	// Run 70 (ADR-0089) wing-flap telegraph: whichever reaction is currently strongest sets how
	// hard the wings flap — a dragon that is both diving and pursuing flaps at the single fastest
	// rate either implies, not a compounded one.
	const agitationBlend = Math.max(state.reactiveBlend, state.diveBlend, state.pursuitBlend, state.diveTelegraphBlend, state.attackBlend);

	return {
		isInRadius,
		justEnteredNotice,
		currentCircleRadiusMeters,
		currentBankAngleRadians,
		currentLateralPullFraction,
		currentDropMeters,
		agitationBlend,
	};
}
