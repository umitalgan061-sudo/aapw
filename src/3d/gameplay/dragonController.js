/**
 * A single flying dragon's controller (FAZ 7) — model/rig loading, the per-frame flight + reaction
 * update loop (notice/reactive/dive/pursuit/give-up), and disposal. Split out of
 * `gameplay/dragons.js` in run 71 when that single file hit the 600-line cap (DECISIONS.md
 * ADR-0092); `dragons.js` re-exports `createDragon` from here, so every existing importer and doc
 * reference to `gameplay/dragons.js` keeps working unchanged. The pure position/blend arithmetic
 * this loop drives lives in `gameplay/dragonFlightMath.js`; the config-driven spawn wiring lives in
 * `gameplay/dragonSpawns.js`; the per-frame notice/reactive/pursuit/give-up/dive/telegraph/attack
 * blend *bookkeeping* was itself split out to `gameplay/dragonReactionState.js` in run 109
 * (DECISIONS.md ADR-0136) when this file approached the same 600-line cap a second time — this
 * file now owns model/mixer loading, calling that stepping logic once per frame, applying its
 * result to the real `THREE.Object3D`, and firing events/exposing `userData`. The run-by-run
 * history of *why* the behavior below is shaped the way it is (runs 53/54/58/64/66/70/71/72/90 and
 * their ADRs) is kept in `gameplay/dragons.js`'s own header, the entry point every other module and
 * doc already points at.
 *
 * @module gameplay/dragonController
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import { alignDiveOrientation, applyCirclePose, applyDiveOffset, clampAltitudeAboveGround } from './dragonFlightMath.js';
import { createDragonReactionState, stepDragonReactionState } from './dragonReactionState.js';

/**
 * Loads the dragon model, places it on its circling flight path, and returns a small controller
 * object matching this project's usual `{object3D, update(delta), dispose()}` shape (see
 * `gameplay/animals.js`'s `createWolf`, `gameplay/npc.js`'s `createNPC`).
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {string} options.modelUrl
 * @param {string} [options.texturesResourcePath] See `AssetLoader.loadFBXModel`'s `resourcePath` option.
 * @param {number} options.scale Uniform scale applied to the loaded model — see `DRAGON_CONFIG.SCALE`'s doc comment for why this can't reuse `AssetLoader.correctMixamoFbxScale`.
 * @param {string} options.flyClipName Exact `THREE.AnimationClip` name to loop.
 * @param {number} options.centerX World-space circle-center X (a kingdom seat's own position).
 * @param {number} options.centerZ World-space circle-center Z.
 * @param {number} options.centerY World-space altitude the dragon flies at (already
 *   ground-height + `altitudeMeters` — resolved by the caller, same convention
 *   `spawnConfiguredAnimals` uses for `sampleGroundY`).
 * @param {number} options.circleRadiusMeters
 * @param {number} options.speedMps Tangential speed around the circle.
 * @param {number} [options.bankAngleRadians] Constant visual roll while circling.
 * @param {number} [options.startAngleRadians] Initial position on the circle (radians).
 * @param {string} [options.name] Assigned to the loaded `Object3D` (useful for debugging/tests).
 * @param {number} [options.noticeRadiusMeters] Player-awareness (run 54, ADR-0072): when the player
 *   comes within this many meters of the dragon's real, current 3D position, `eventsBus.emit(
 *   eventName, noticeToast)` fires once — edge-triggered, re-arms only after the player leaves the
 *   radius again. Omit (along with `eventsBus`/`eventName`/`noticeToast`) to disable entirely — the
 *   controller then never reads `update()`'s `playerPosition` argument at all.
 * @param {import('../eventBus.js').EventBus} [options.eventsBus]
 * @param {string} [options.eventName] `EVENTS.WORLD_EVENT_TRIGGERED`, passed in rather than imported
 *   — same options-over-import precedent `gameplay/worldEvents.js` itself uses.
 * @param {{icon: string, title: string, desc: string, color: string}} [options.noticeToast] Payload
 *   emitted as-is — matches `ui/worldEventToast.js`'s existing `_show(event)` shape, so no new UI
 *   widget is needed for this first player-awareness pass.
 * @param {number} [options.reactiveSpeedMultiplier] Run 58 (ADR-0077) reactive flight: while the
 *   player is inside `noticeRadiusMeters`, the circling angular speed eases toward
 *   `speedMps * reactiveSpeedMultiplier / circleRadiusMeters` instead of the calm baseline. Defaults
 *   to `1` (no reaction) — same "omit to disable" convention `noticeRadiusMeters` already uses, so a
 *   dragon can have awareness without reactive flight, but not the reverse (reacting requires
 *   knowing the player is near in the first place).
 * @param {number} [options.reactiveBankAngleRadians] Bank angle eased toward while the player is
 *   inside range, replacing the calm `bankAngleRadians`. Defaults to `bankAngleRadians` (no change).
 * @param {number} [options.reactiveTransitionSeconds] How long, in seconds, easing from calm to
 *   reactive (or back) takes — a linear blend, not an instant snap, so the speed-up/bank-in reads as
 *   a reaction rather than a teleport. Defaults to `1.5`. Ignored if reactive params are both at
 *   their no-op defaults.
 * @param {number} [options.alarmRadiusMeters] Run 64 (ADR-0082) dive: when the player comes within
 *   this many meters of the dragon's real position — meant to be well inside `noticeRadiusMeters`,
 *   a "right underneath it" distance rather than "somewhere on the horizon" — the dragon eases off
 *   its circle toward them and loses altitude (see `diveDropMeters`/`diveLateralPullFraction`
 *   below), easing back once they retreat past it. Omit (along with `sampleGroundY`) to disable
 *   entirely — same "omit to disable" convention `noticeRadiusMeters`/reactive-flight already use, so
 *   a dragon can react (speed up/bank) without diving, but diving requires `sampleGroundY` for its
 *   own terrain-safety clamp.
 * @param {(worldX: number, worldZ: number) => number} [options.sampleGroundY] Real ground height at
 *   an (x, z) — same convention `spawnConfiguredAnimals`/`spawnConfiguredDragons` already use for
 *   `centerY`. Required for diving to activate; re-sampled every frame the dive blend is above 0
 *   (the dive position moves every frame, so a single sample at the dive's start wouldn't stay
 *   correct) to clamp the dragon's altitude above the real terrain under its new position.
 * @param {number} [options.diveDropMeters] How far below `centerY` the dive's raw target altitude
 *   is, before the terrain-safety clamp. Defaults to `25`. The actual altitude reached may be higher
 *   than `centerY - diveDropMeters` if the real ground there is close enough that
 *   `minAltitudeAboveGroundMeters` would otherwise be violated.
 * @param {number} [options.diveLateralPullFraction] How far horizontally the dive target is pulled
 *   toward the player's current (x, z), as a fraction of the distance from the dragon's on-circle
 *   position to the player (`0` = stays over the circle point, `1` = directly over the player).
 *   Defaults to `0.35` — a swoop toward them, not a teleport to stand on top of them. Clamped to
 *   `[0, 1]` internally (a bad config value can't send the dragon past the player or behind it).
 * @param {number} [options.diveTransitionSeconds] How long, in seconds, easing into (or out of) the
 *   dive takes — same linear-blend shape `reactiveTransitionSeconds` uses, just for position instead
 *   of speed/bank. Defaults to `1`.
 * @param {number} [options.diveTelegraphSeconds] Run 72's dive telegraph: once the player enters
 *   `alarmRadiusMeters`, the dive's own position blend (`diveBlend` above) does not start moving for
 *   this many seconds — the dragon stays exactly on its circle, but `diveTelegraphBlend` (see below)
 *   still rises immediately, driving the wing-flap agitation cue on its own so the player sees "wings
 *   flaring, still circling" as a distinct warning beat *before* the swoop itself begins, rather than
 *   the dive starting to move the instant they cross the threshold. If the player retreats past
 *   `alarmRadiusMeters` before this elapses, the dive never starts at all — only the telegraph cue
 *   fired, which is the intended "warned, not committed" read. Defaults to `0.4`: long enough to read
 *   as a distinct beat, short enough that the dive itself (`diveTransitionSeconds`, `0.8`-`1` in
 *   practice) still feels like the dominant motion. A value of `0` degenerates to the pre-run-72
 *   behavior (dive starts moving the same frame the telegraph blend does).
 * @param {number} [options.diveTelegraphTransitionSeconds] How long, in seconds,
 *   `diveTelegraphBlend` takes to ease toward 1 (on entering `alarmRadiusMeters`) or back to 0 (once
 *   alarmed clears, or once the telegraph window itself elapses and the real dive blend takes over
 *   agitation instead). Defaults to `0.15` — deliberately much snappier than `diveTelegraphSeconds`
 *   itself, so the wing-flap cue reads as a sudden flare-up rather than a gradual ramp, the same
 *   "the cue itself is quick even though the window it lives in is longer" shape
 *   `giveUpTransitionSeconds` (`0.6`, snappier than its siblings) already established in run 71.
 * @param {number} [options.attackTriggerSeconds] Run 90 (ADR-0116) attack lunge — the owner-
 *   requested "if provoked, attack" behavior: a real, damage-dealing escalation on top of the
 *   run-64 dive's non-lethal menace. Gated behind `canBite` (see `biteEventName`/`biteDamage` below)
 *   — a dragon with no bite configured never computes any of this and behaves exactly as before.
 *   Once alarmed continuously for `diveTelegraphSeconds + attackTriggerSeconds` (i.e. the ordinary
 *   dive has already fully committed, *then* this much longer of sustained proximity on top of that
 *   — the player kept provoking it rather than the dragon merely swooping once), `attackBlend` (see
 *   `update()` below) starts easing toward 1, escalating the dive's own pull/drop from their calm
 *   values toward `attackLateralPullFraction`/`attackDropMeters`. The player retreating past
 *   `alarmRadiusMeters` at any point resets `diveAlarmElapsedSeconds` to 0 (pre-existing behavior)
 *   and eases `attackBlend` back down with it — an ordinary dive that never escalates never sees
 *   this fire at all. Defaults to `2.5`.
 * @param {number} [options.attackLateralPullFraction] Replaces `diveLateralPullFraction` once
 *   `attackBlend` reaches 1 (blended between the two by `attackBlend`, same `blendScalar` shape
 *   `pursuitCircleRadiusMeters`'s own blend already uses) — how far horizontally the escalated lunge
 *   pulls toward the player, same clamped `0`-`1` range as `diveLateralPullFraction`. Defaults to
 *   `diveLateralPullFraction` itself (no escalation unless a spawn explicitly configures a higher
 *   value) — kept provably inert when unconfigured (`blendScalar` between two equal values is that
 *   value regardless of blend) rather than defaulting to a plausible-sounding but arbitrary number.
 * @param {number} [options.attackDropMeters] Replaces `diveDropMeters` the same way, once escalated —
 *   how far below cruise altitude the lunge's *unclamped* target sits (the terrain-safety floor below
 *   still applies exactly as it does to the ordinary dive). Defaults to `diveDropMeters` itself, same
 *   "provably inert unless configured" reasoning as `attackLateralPullFraction` above — a real attack
 *   spawn should set this close to `centerY`'s own altitude-above-ground budget (e.g. `altitudeMeters
 *   - minAltitudeAboveGroundMeters`) so the terrain clamp is what actually stops the descent, reading
 *   as "dives all the way down to bite," not a fixed, altitude-agnostic magic number.
 * @param {number} [options.attackTransitionSeconds] How long, in seconds, `attackBlend` takes to ease
 *   toward 1 (escalating) or back to 0 (the player retreated, or the underlying dive itself eased
 *   back down with it). Defaults to `1.5` — deliberately slower than `diveTransitionSeconds` (`0.8`-
 *   `1` in practice): the *ordinary* swoop should read as quick, but committing to a real attack is a
 *   bigger, more deliberate escalation, not just a faster version of the same motion.
 * @param {number} [options.biteRadiusMeters] The 3D distance, in meters, to the player at which a
 *   fully-escalated lunge (`attackBlend > 0.95` — see `update()`'s own comment for why not exactly
 *   `1`) counts as landing a hit: emits `biteEventName` with `{amount: biteDamage, sourceId: name}`
 *   once `biteCooldownSeconds` has elapsed since the last hit. Checked against the *final*, post-
 *   terrain-clamp position (the real rendered position), not the unclamped dive-offset math, so this
 *   is the actual on-screen distance, not a theoretical one. Defaults to `15`: this run's own
 *   engineering judgment (this project's first combat range of any kind, nothing to calibrate
 *   against) — see `QUESTIONS_FOR_OWNER.md` for the open feel-calibration question, same pattern
 *   every other guessed dragon constant (ADR-0082/ADR-0085/ADR-0091) already logged there.
 * @param {number} [options.biteDamage] Health removed per landed hit (`gameplay/health.js`'s
 *   `onDamage` handler reads `payload.amount`). **Required for biting to activate at all** — `canBite`
 *   below is `false` without it, same "the feature's own defining value has no generic default"
 *   reasoning `noticeToast` already follows for the notice tier. No default: a dragon that should
 *   deal no damage (every dragon before this run, and any future non-combat spawn) simply omits this.
 * @param {number} [options.biteCooldownSeconds] Minimum seconds between two landed hits from this
 *   same dragon — prevents one sustained lunge from draining health every single frame it happens to
 *   stay inside `biteRadiusMeters`. Defaults to `4`. Ticks down every frame regardless of
 *   `attackBlend` (recovers even while not currently attacking), floored at `0`.
 * @param {string} [options.biteEventName] `EVENTS.PLAYER_DAMAGED`, passed in rather than imported —
 *   same options-over-import precedent `eventName`/`noticeToast` above already use. **Required for
 *   biting to activate at all**, alongside `biteDamage` and `alarmRadiusMeters`/`sampleGroundY` (dive
 *   must already be enabled — biting is additive escalation on top of diving, never independent of
 *   it) — see `canBite` in the function body.
 * @param {number} [options.minAltitudeAboveGroundMeters] Terrain-safety floor: the dragon's final
 *   altitude is never allowed to end up below `sampleGroundY(x, z) + minAltitudeAboveGroundMeters`
 *   for its *actual* (post-blend) (x, z) that frame. Defaults to `10`. Applied to every frame's
 *   final position whenever `sampleGroundY` is available (run 66) — not only while diving, as it
 *   was when run 64 first introduced it: once the circle center can travel (see
 *   `pursuitRadiusMeters` below) the ordinary circling pose flies over arbitrary terrain too, so
 *   clamping only the dive would leave the much more common case unguarded.
 * @param {number} [options.pursuitRadiusMeters] Run 66 (ADR-0085) continuous chase: while the
 *   player is within this many meters of the dragon's real position, the dragon *engages* — its
 *   circle center travels toward the player at `pursuitCenterSpeedMps`, the circle tightens toward
 *   `pursuitCircleRadiusMeters`, and its cruise altitude starts following the terrain under the
 *   moving center. Omit (along with `sampleGroundY`) to disable entirely, same "omit to disable"
 *   convention every earlier tier uses — a dragon can dive without pursuing, but pursuing requires
 *   `sampleGroundY` for the traveling circle's own terrain-following/safety math. Meant to sit
 *   between `alarmRadiusMeters` and `noticeRadiusMeters`: wide enough that a player who lingers
 *   gets chased, narrow enough that merely being seen from across the valley doesn't start one.
 * @param {number} [options.pursuitCenterSpeedMps] How fast the circle center itself travels, in
 *   m/s — toward the player while engaged, back toward the home center once disengaged. Bounded
 *   *speed*, deliberately not a blend fraction: a fraction-of-the-remaining-distance lerp would
 *   teleport the whole circle whenever the player moved a long way in one frame, whereas a speed
 *   limit means the dragon genuinely falls behind a sprinting player and has to close the gap.
 *   Defaults to `10` (vs. `PLAYER_CONFIG.RUN_SPEED_MPS`'s 6.5 — a dragon outruns a running player,
 *   but not instantly).
 * @param {number} [options.pursuitCircleRadiusMeters] Circle radius eased toward while engaged,
 *   replacing the calm `circleRadiusMeters` — a tighter ring directly over the player reads as
 *   stalking rather than patrolling. Defaults to `circleRadiusMeters` (no tightening). Tangential
 *   speed (`speedMps`) is held constant as this changes, so a tighter circle is flown *faster* in
 *   angular terms rather than the dragon appearing to slow down as it closes in.
 * @param {number} [options.pursuitTransitionSeconds] Ease time, in seconds, for the radius/altitude
 *   blend into and out of pursuit — same linear-blend shape `reactiveTransitionSeconds`/
 *   `diveTransitionSeconds` already use. Defaults to `2`. Note the *center's* travel is speed-
 *   limited rather than blended (see `pursuitCenterSpeedMps`), so this governs only the shape of
 *   the circle, not how fast the chase itself closes.
 * @param {number} [options.pursuitMaxSeconds] How long a single engagement may last before the
 *   dragon gives up and heads home. Defaults to `20`. Once exhausted it will not re-engage until
 *   the player has left `pursuitRadiusMeters` at least once — the same edge-trigger/re-arm shape
 *   `noticeRadiusMeters` already uses — so a player who stands their ground gets harried and then
 *   left alone, instead of being followed across the map indefinitely.
 * @param {number} [options.giveUpBankAngleMultiplier] Run 71 (ADR-0091) give-up cue: while
 *   `pursuitExhausted` is true (an engagement burned through `pursuitMaxSeconds` — as opposed to an
 *   *ordinary* disengage, where the player simply leaves `pursuitRadiusMeters` before the timer ever
 *   runs out, and `pursuitExhausted` never becomes true at all), the bank angle is steepened to
 *   `reactiveBankAngleRadians * giveUpBankAngleMultiplier` — layered on top of whatever the ordinary
 *   reactive-blend bank already is, via `giveUpBlend` (see below) — instead of the plain reactive
 *   bank a distance-triggered disengage keeps. Defaults to `1.6`: a visibly harder roll than
 *   ordinary reactive flight, reading as a decisive "breaking off" turn rather than a smooth glide
 *   away. A dragon with `bankAngleRadians`/`reactiveBankAngleRadians` both left at `0` (no banking
 *   configured at all) sees no visible cue from this either — same "derives from what's already
 *   configured, adds no bank of its own out of nothing" reasoning `agitatedWingFlapMultiplier`'s
 *   default already follows for its own base values.
 * @param {number} [options.giveUpTransitionSeconds] How long, in seconds, `giveUpBlend` takes to
 *   ease toward 1 (on giving up) or back to 0 (once the player leaves `pursuitRadiusMeters` and
 *   re-arms a future engagement) — same linear-ease shape every other blend in this module already
 *   uses. Defaults to `0.6`, deliberately snappier than `reactiveTransitionSeconds` (1.5),
 *   `diveTransitionSeconds` (1), and `pursuitTransitionSeconds` (2 by default here) — a "decisive
 *   break-off" reads faster than the smoother reactions those govern, not slower.
 * @param {number} [options.cruiseAltitudeAboveGroundMeters] The dragon's cruise height *above the
 *   terrain under its circle center*, used while pursuing so a chase up a mountainside climbs with
 *   it instead of flying into the slope. Omit to keep the fixed `centerY` at all times (exact
 *   pre-run-66 behavior). `spawnConfiguredDragons` passes each spawn's own `altitudeMeters` — the
 *   same number `centerY` was resolved from at spawn — so the two agree by construction at home.
 * @param {number} [options.agitatedWingFlapMultiplier] Run 70 (ADR-0089) wing-flap telegraph: the
 *   `Fly` clip's `AnimationAction.timeScale` is driven every frame by `agitationBlend` — the
 *   strongest of `reactiveBlend`/`diveBlend`/`pursuitBlend` this frame (a dragon that is both
 *   diving and pursuing flaps at the single fastest rate either implies, not a compounded one) —
 *   eased linearly from `1` (calm) up to this value (fully agitated), the same blend-driven-not
 *   -snapped shape every other reaction in this module already uses. Defaults to `1.5`: fast enough
 *   to read as a distinct "wings work harder" cue at a glance, not so fast the clip visibly
 *   stutters. Exposed on `object3D.userData.wingFlapTimeScale` each frame (no other public API
 *   change) so regression tests can assert it without reaching into the `AnimationMixer` internals.
 * @returns {Promise<{object3D: THREE.Object3D, update: (delta: number, playerPosition?: {x: number, y: number, z: number}) => void, dispose: () => void}>}
 */
export async function createDragon({
	assetLoader,
	modelUrl,
	texturesResourcePath,
	scale,
	flyClipName,
	centerX,
	centerZ,
	centerY,
	circleRadiusMeters,
	speedMps,
	bankAngleRadians = 0,
	startAngleRadians = 0,
	name,
	noticeRadiusMeters,
	eventsBus,
	eventName,
	noticeToast,
	reactiveSpeedMultiplier = 1,
	reactiveBankAngleRadians = bankAngleRadians,
	reactiveTransitionSeconds = 1.5,
	alarmRadiusMeters,
	sampleGroundY,
	diveDropMeters = 25,
	diveLateralPullFraction = 0.35,
	diveTransitionSeconds = 1,
	diveTelegraphSeconds = 0.4,
	diveTelegraphTransitionSeconds = 0.15,
	attackTriggerSeconds = 2.5,
	attackLateralPullFraction = diveLateralPullFraction,
	attackDropMeters = diveDropMeters,
	attackTransitionSeconds = 1.5,
	biteRadiusMeters = 15,
	biteDamage,
	biteCooldownSeconds = 4,
	biteEventName,
	minAltitudeAboveGroundMeters = 10,
	pursuitRadiusMeters,
	pursuitCenterSpeedMps = 10,
	pursuitCircleRadiusMeters = circleRadiusMeters,
	pursuitTransitionSeconds = 2,
	pursuitMaxSeconds = 20,
	giveUpBankAngleMultiplier = 1.6,
	giveUpTransitionSeconds = 0.6,
	cruiseAltitudeAboveGroundMeters,
	agitatedWingFlapMultiplier = 1.5,
}) {
	const clampedDiveLateralPullFraction = Math.min(1, Math.max(0, diveLateralPullFraction));
	const clampedAttackLateralPullFraction = Math.min(1, Math.max(0, attackLateralPullFraction));
	const model = await assetLoader.loadFBXModel(modelUrl, {
		fallbackColor: 0x2a2a2a,
		fallbackSize: 6,
		resourcePath: texturesResourcePath,
	});
	model.scale.setScalar(scale);
	if (name) model.name = name;

	const mixer = new THREE.AnimationMixer(model);
	const flyClip = THREE.AnimationClip.findByName(model.animations, flyClipName);
	const flyAction = flyClip ? mixer.clipAction(flyClip) : null;
	if (flyAction) flyAction.play();

	const canNotice = Boolean(noticeRadiusMeters != null && eventsBus && eventName && noticeToast);
	const canDive = Boolean(alarmRadiusMeters != null && typeof sampleGroundY === 'function');
	const canPursue = Boolean(pursuitRadiusMeters != null && typeof sampleGroundY === 'function');
	// Run 90 (ADR-0116): biting is additive escalation on top of diving, never independent of it —
	// requires `canDive` alongside its own defining values (`biteEventName`/`biteDamage`), same
	// "the feature's own defining value has no generic default" reasoning `noticeToast` already
	// follows for the notice tier above.
	const canBite = Boolean(canDive && biteEventName && eventsBus && typeof biteDamage === 'number');

	// All per-frame notice/reactive/pursuit/give-up/dive/telegraph/attack blend bookkeeping lives
	// in `gameplay/dragonReactionState.js` (run 109, DECISIONS.md ADR-0136) — this controller only
	// creates the mutable record, steps it once per frame, and applies the result to `model`.
	const state = createDragonReactionState(startAngleRadians, centerX, centerY, centerZ);
	applyCirclePose(model, state.center, circleRadiusMeters, state.angle, bankAngleRadians);

	return {
		object3D: model,

		/**
		 * @param {number} delta Seconds since the last frame.
		 * @param {{x: number, y: number, z: number}} [playerPosition] Current player world position —
		 *   only read when this dragon has player-awareness configured (`noticeRadiusMeters`).
		 */
		update(delta, playerPosition) {
			// Distance check runs first, against the dragon's position as of the end of the previous
			// frame — same real distance the original run-54 check used, reused by
			// `stepDragonReactionState` for the reactive/dive/pursuit blend targets, not only the
			// one-shot notice event.
			let distanceToPlayer = null;
			if (playerPosition && (canNotice || canDive || canPursue)) {
				const dx = model.position.x - playerPosition.x;
				const dy = model.position.y - playerPosition.y;
				const dz = model.position.z - playerPosition.z;
				distanceToPlayer = Math.hypot(dx, dy, dz);
			}

			const frame = stepDragonReactionState(state, delta, distanceToPlayer, {
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
			});

			if (frame.justEnteredNotice) {
				eventsBus.emit(eventName, noticeToast);
			}

			// Pure on-circle pose — the dive below blends *away* from this, never replaces the
			// underlying path, so easing back to diveBlend 0 always lands exactly here again.
			applyCirclePose(model, state.center, frame.currentCircleRadiusMeters, state.angle, frame.currentBankAngleRadians);

			let diveOriginX = null;
			let diveOriginY = 0;
			let diveOriginZ = 0;
			let diveOriginPitch = 0;
			let diveOriginYaw = 0;
			if (state.diveBlend > 0 && playerPosition) {
				diveOriginX = model.position.x;
				diveOriginY = model.position.y;
				diveOriginZ = model.position.z;
				diveOriginPitch = model.rotation.x;
				diveOriginYaw = model.rotation.y;
				applyDiveOffset(model, {
					playerX: playerPosition.x,
					playerZ: playerPosition.z,
					centerY: state.center.y,
					diveDropMeters: frame.currentDropMeters,
					lateralPullFraction: frame.currentLateralPullFraction,
					diveBlend: state.diveBlend,
				});
			}

			// Terrain-collision safety floor, applied to the finished position — unchanged for any
			// dragon with no `sampleGroundY` (see `dragonFlightMath.js`'s own doc comment).
			if (typeof sampleGroundY === 'function') {
				clampAltitudeAboveGround(model, sampleGroundY, minAltitudeAboveGroundMeters);
			}

			// The terrain floor may raise a requested dive substantially. Recompute orientation from
			// the real post-clamp path so the rendered body cannot point through the ground; this also
			// handles a purely vertical dive where horizontal displacement is exactly zero.
			if (diveOriginX != null) {
				alignDiveOrientation(model, diveOriginX, diveOriginY, diveOriginZ, diveOriginPitch, diveOriginYaw, state.diveBlend);
			}

			// Run 90 (ADR-0116) bite: checked against the *final*, post-terrain-clamp position (the
			// real rendered position), not the unclamped dive-offset math — the actual on-screen
			// distance, not a theoretical one. `attackBlend > 0.95` (not exactly `1`, which
			// `easeBlendToward` only ever reaches asymptotically-exactly at the very end of
			// `attackTransitionSeconds`, same floating-point caution `checkStarfieldTwinkle`'s own
			// header already notes for a sine peak) restricts a landed hit to a *fully*-committed
			// lunge, never an incidental close pass during ordinary circling/pursuit.
			state.biteCooldownRemainingSeconds = Math.max(0, state.biteCooldownRemainingSeconds - delta);
			let didBiteThisFrame = false;
			if (canBite && state.attackBlend > 0.95 && state.biteCooldownRemainingSeconds <= 0 && playerPosition) {
				const dx = model.position.x - playerPosition.x;
				const dy = model.position.y - playerPosition.y;
				const dz = model.position.z - playerPosition.z;
				if (Math.hypot(dx, dy, dz) < biteRadiusMeters) {
					eventsBus.emit(biteEventName, { amount: biteDamage, sourceId: name ?? 'dragon' });
					state.biteCooldownRemainingSeconds = biteCooldownSeconds;
					didBiteThisFrame = true;
				}
			}

			// Run 70 (ADR-0089) wing-flap telegraph: `frame.agitationBlend` is already the strongest
			// of reactive/dive/pursuit/telegraph/attack this frame (see `dragonReactionState.js`).
			const wingFlapTimeScale = 1 + (agitatedWingFlapMultiplier - 1) * frame.agitationBlend;
			if (flyAction) flyAction.timeScale = wingFlapTimeScale;
			model.userData.wingFlapTimeScale = wingFlapTimeScale;
			// Run 71 (ADR-0091) give-up cue: exposed the same way `wingFlapTimeScale` already is, so
			// regression tests (and any future debug tooling) can read it without reaching into the
			// reaction-state module directly.
			model.userData.giveUpBlend = state.giveUpBlend;
			// Run 72 dive telegraph: exposed the same way, so a regression test can directly assert
			// "the cue fired but the dive itself never moved" instead of inferring it only from
			// `wingFlapTimeScale` (which `diveBlend` also drives once the dive actually starts).
			model.userData.diveTelegraphBlend = state.diveTelegraphBlend;
			// Run 90 (ADR-0116): exposed the same way, so a regression test can assert the escalation
			// and the landed hit independently of each other and of `wingFlapTimeScale`.
			model.userData.attackBlend = state.attackBlend;
			model.userData.didBiteThisFrame = didBiteThisFrame;

			mixer.update(delta);
		},

		/** Stops all animation actions and releases the model's GPU resources. */
		dispose() {
			mixer.stopAllAction();
			AssetLoader.disposeObject3D(model);
		},
	};
}