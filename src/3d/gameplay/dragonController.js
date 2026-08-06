/**
 * A single flying dragon's controller (FAZ 7) — model/rig loading, the per-frame flight + reaction
 * update loop (notice/reactive/dive/pursuit/give-up), and disposal. Split out of
 * `gameplay/dragons.js` in run 71 when that single file hit the 600-line cap (DECISIONS.md
 * ADR-0092); `dragons.js` re-exports `createDragon` from here, so every existing importer and doc
 * reference to `gameplay/dragons.js` keeps working unchanged. The pure position/blend arithmetic
 * this loop drives lives in `gameplay/dragonFlightMath.js`; the config-driven spawn wiring lives in
 * `gameplay/dragonSpawns.js`. The run-by-run history of *why* the behavior below is shaped the way
 * it is (runs 53/54/58/64/66/70/71 and their ADRs) is kept in `gameplay/dragons.js`'s own header,
 * the entry point every other module and doc already points at.
 *
 * @module gameplay/dragonController
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import {
	easeBlendToward,
	blendScalar,
	applyCirclePose,
	stepCenterTowardTarget,
	applyDiveOffset,
	clampAltitudeAboveGround,
} from './dragonFlightMath.js';

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

	// Tangential speed is the tuned constant (see DRAGON_CONFIG's own speed/radius comment for the
	// resulting ~0.08 rad/s at the default spawn's 150m radius); angular speed is derived from it
	// against the circle's *current* radius each frame. With no pursuit configured the radius never
	// changes, so this is arithmetically identical to the fixed `speedMps / circleRadiusMeters`
	// run 53 used — it only starts to matter once run 66's pursuit tightens the circle, where
	// holding tangential (not angular) speed constant is what stops a closing dragon from appearing
	// to slow down as its ring shrinks.
	const calmAngularSpeedFor = (radiusMeters) => speedMps / radiusMeters;
	const reactiveAngularSpeedFor = (radiusMeters) => (speedMps * reactiveSpeedMultiplier) / radiusMeters;
	let angle = startAngleRadians;

	// Run 66 (ADR-0085) pursuit: the circle's center is no longer fixed at the spawn seat. This
	// tracks where it actually is right now; `centerX`/`centerZ`/`centerY` stay the immutable "home"
	// values the center travels back to on disengage. Held as one mutable record (rather than three
	// `let`s) so `dragonFlightMath.js`'s `stepCenterTowardTarget` can advance it in place without
	// allocating a result object every frame.
	const center = { x: centerX, y: centerY, z: centerZ };

	// Run 58 (ADR-0077) reactive flight: 0 = calm baseline, 1 = fully reactive (faster + harder
	// bank). Eased linearly toward its target each frame rather than snapped, so the reaction reads
	// as the dragon actually responding, not teleporting between two fixed states. Starts at 0 (calm)
	// — same "never assumed" convention `playerWasInNoticeRadius` below already follows.
	let reactiveBlend = 0;
	// Run 64 (ADR-0082) dive: 0 = on-circle, 1 = fully at the (terrain-clamped) dive target. Same
	// starts-at-0, eased-not-snapped shape as `reactiveBlend` above.
	let diveBlend = 0;
	// Run 72 dive telegraph: seconds the player has been continuously inside `alarmRadiusMeters` —
	// reset to 0 the instant they leave it (not eased; this is a plain elapsed-time counter, not a
	// blend). Gates when `diveBlend`'s target is allowed to become 1 (see `update()` below).
	let diveAlarmElapsedSeconds = 0;
	// Run 72 dive telegraph: 0 = no telegraph cue, 1 = fully flared. Rises immediately once alarmed
	// (independent of `diveBlend`, which stays pinned at 0 until `diveTelegraphSeconds` elapses) and
	// falls back to 0 either once the player leaves `alarmRadiusMeters` or once the telegraph window
	// itself elapses and the real dive takes over driving the agitation cue. Same starts-at-0,
	// eased-not-snapped shape as `reactiveBlend`/`diveBlend` above.
	let diveTelegraphBlend = 0;
	// Run 66 (ADR-0085) pursuit: 0 = home-shaped circle (calm radius/altitude), 1 = fully engaged
	// (tightened radius, terrain-following cruise altitude). Same starts-at-0, eased-not-snapped
	// shape as the two blends above. The circle *center*'s travel is deliberately not driven by this
	// — it moves at a bounded speed instead, see `pursuitCenterSpeedMps`'s doc comment.
	let pursuitBlend = 0;
	let pursuitElapsedSeconds = 0;
	// Set once an engagement burns through `pursuitMaxSeconds`; blocks re-engaging until the player
	// leaves `pursuitRadiusMeters`, the same edge-trigger/re-arm shape `playerWasInNoticeRadius`
	// below already uses for the notice event.
	let pursuitExhausted = false;
	// Run 71 (ADR-0091) give-up cue: 0 = no give-up cue, 1 = fully at the steepened give-up bank
	// angle. Eased toward 1 only while `pursuitExhausted` is true and back to 0 once the player
	// leaves `pursuitRadiusMeters` (the same event that resets `pursuitExhausted` itself) — an
	// ordinary disengage, where the player leaves before the timer ever exhausts, never sets
	// `pursuitExhausted` true at all, so this blend never leaves 0 for that case. Same starts-at-0,
	// eased-not-snapped shape as `reactiveBlend`/`diveBlend`/`pursuitBlend` above.
	let giveUpBlend = 0;
	// Run 90 (ADR-0116) attack lunge: 0 = ordinary dive pull/drop, 1 = fully escalated to
	// `attackLateralPullFraction`/`attackDropMeters`. Same starts-at-0, eased-not-snapped shape as
	// every other blend above. Only ever computed when `canBite` (below) is true — see `update()`.
	let attackBlend = 0;
	// Run 90 (ADR-0116): seconds remaining before this dragon may land another bite, ticked down
	// every frame regardless of `attackBlend` (recovers even while not currently attacking). Starts
	// at 0 (no cooldown yet) rather than `biteCooldownSeconds` — a freshly spawned dragon can land
	// its first hit as soon as it genuinely reaches the player, not on an artificial delay.
	let biteCooldownRemainingSeconds = 0;

	applyCirclePose(model, center, circleRadiusMeters, angle, bankAngleRadians);

	const canNotice = Boolean(noticeRadiusMeters != null && eventsBus && eventName && noticeToast);
	const canDive = Boolean(alarmRadiusMeters != null && typeof sampleGroundY === 'function');
	const canPursue = Boolean(pursuitRadiusMeters != null && typeof sampleGroundY === 'function');
	// Run 90 (ADR-0116): biting is additive escalation on top of diving, never independent of it —
	// requires `canDive` alongside its own defining values (`biteEventName`/`biteDamage`), same
	// "the feature's own defining value has no generic default" reasoning `noticeToast` already
	// follows for the notice tier above.
	const canBite = Boolean(canDive && biteEventName && eventsBus && typeof biteDamage === 'number');
	// Starts false: the very first `update()` call (typically seconds after boot) does its own
	// real distance check before deciding whether the player already started inside the radius —
	// never assumed true/false up front.
	let playerWasInNoticeRadius = false;

	return {
		object3D: model,

		/**
		 * @param {number} delta Seconds since the last frame.
		 * @param {{x: number, y: number, z: number}} [playerPosition] Current player world position —
		 *   only read when this dragon has player-awareness configured (`noticeRadiusMeters`).
		 */
		update(delta, playerPosition) {
			// Distance check (and the notice edge-trigger it already drove) now runs first, against
			// the dragon's position as of the end of the previous frame — same real distance the
			// original run-54 check used, just also reused below to pick this frame's reactive blend
			// target (and, run 64, the dive-alarm target) instead of only firing the one-shot notice
			// event.
			let distanceToPlayer = null;
			if (playerPosition && (canNotice || canDive || canPursue)) {
				const dx = model.position.x - playerPosition.x;
				const dy = model.position.y - playerPosition.y;
				const dz = model.position.z - playerPosition.z;
				distanceToPlayer = Math.hypot(dx, dy, dz);
			}

			let isInRadius = false;
			if (canNotice && distanceToPlayer != null) {
				isInRadius = distanceToPlayer < noticeRadiusMeters;
				if (isInRadius && !playerWasInNoticeRadius) {
					eventsBus.emit(eventName, noticeToast);
				}
				playerWasInNoticeRadius = isInRadius;
			}

			// Run 58 (ADR-0077): ease `reactiveBlend` linearly toward 1 (in radius) or 0 (not) over
			// `reactiveTransitionSeconds`, then use it to blend both the angular speed and the bank
			// angle between their calm and reactive values for this frame's move.
			reactiveBlend = easeBlendToward(reactiveBlend, isInRadius ? 1 : 0, delta, reactiveTransitionSeconds);

			// Run 66 (ADR-0085) pursuit engagement. `isEngaged` gates both the center's travel target
			// and the radius/altitude blend below. Exhaustion re-arms only on the player actually
			// leaving the radius, so a stationary player can't be chased forever.
			let isEngaged = false;
			if (canPursue && distanceToPlayer != null) {
				const isInPursuitRadius = distanceToPlayer < pursuitRadiusMeters;
				if (!isInPursuitRadius) {
					pursuitExhausted = false; // left the radius — re-arm for a future engagement.
					pursuitElapsedSeconds = 0;
				} else if (!pursuitExhausted) {
					pursuitElapsedSeconds += delta;
					if (pursuitElapsedSeconds >= pursuitMaxSeconds) pursuitExhausted = true;
					else isEngaged = true;
				}
			}

			// Run 71 (ADR-0091) give-up cue: eases toward 1 while `pursuitExhausted` is true (the
			// dragon gave up mid-engagement, the timer ran out while the player was still inside
			// `pursuitRadiusMeters`) and back toward 0 once the player actually leaves the radius —
			// distinct from an *ordinary* disengage, where the player leaves before the timer ever
			// exhausts and `pursuitExhausted` never becomes true in the first place, so this blend
			// stays exactly 0 for that case.
			giveUpBlend = easeBlendToward(giveUpBlend, pursuitExhausted ? 1 : 0, delta, giveUpTransitionSeconds);

			// The circle center travels at a bounded speed toward the player while engaged, and back
			// toward its immutable home center otherwise (see `dragonFlightMath.js`'s
			// `stepCenterTowardTarget` for why this is speed-limited rather than blended).
			if (canPursue) {
				const targetCenterX = isEngaged && playerPosition ? playerPosition.x : centerX;
				const targetCenterZ = isEngaged && playerPosition ? playerPosition.z : centerZ;
				stepCenterTowardTarget(center, targetCenterX, targetCenterZ, pursuitCenterSpeedMps * delta);
			}

			// Radius/altitude ease into and out of the engaged shape.
			pursuitBlend = easeBlendToward(pursuitBlend, isEngaged ? 1 : 0, delta, pursuitTransitionSeconds);
			const currentCircleRadiusMeters = blendScalar(circleRadiusMeters, pursuitCircleRadiusMeters, pursuitBlend);
			// While pursuing, cruise altitude follows the terrain under the *moving* center rather
			// than staying pinned to the home seat's own ground height — otherwise a chase up a
			// mountainside would fly straight into the slope (the final safety clamp below would
			// still catch it, but as an emergency floor, not as flight that reads as deliberate).
			if (canPursue && cruiseAltitudeAboveGroundMeters != null) {
				const terrainFollowingCenterY = sampleGroundY(center.x, center.z) + cruiseAltitudeAboveGroundMeters;
				center.y = blendScalar(centerY, terrainFollowingCenterY, pursuitBlend);
			}

			const calmAngular = calmAngularSpeedFor(currentCircleRadiusMeters);
			const reactiveAngular = reactiveAngularSpeedFor(currentCircleRadiusMeters);
			const angularSpeedRadiansPerSecond = blendScalar(calmAngular, reactiveAngular, reactiveBlend);
			const reactiveBankAngleThisFrame = blendScalar(bankAngleRadians, reactiveBankAngleRadians, reactiveBlend);
			// Run 71 (ADR-0091) give-up cue: layered on top of the ordinary reactive-blend bank above,
			// via `giveUpBlend` — a plain distance-triggered disengage never moves this past 0, so it
			// keeps exactly the reactive bank it already had; only a timeout-driven give-up steepens it
			// further.
			const giveUpBankAngleRadians = reactiveBankAngleRadians * giveUpBankAngleMultiplier;
			const currentBankAngleRadians = blendScalar(reactiveBankAngleThisFrame, giveUpBankAngleRadians, giveUpBlend);

			angle += angularSpeedRadiansPerSecond * delta;
			// Pure on-circle pose — the dive below blends *away* from this, never replaces the
			// underlying path, so easing back to diveBlend 0 always lands exactly here again.
			applyCirclePose(model, center, currentCircleRadiusMeters, angle, currentBankAngleRadians);

			// Run 64 (ADR-0082): brief dive off the circle when the player is much closer than
			// `noticeRadiusMeters` (inside the smaller `alarmRadiusMeters`), easing back the same way
			// once they retreat — a linear ease-toward-a-target, same shape as `reactiveBlend` above,
			// just blending *position* instead of speed/bank.
			const isAlarmed = canDive && distanceToPlayer != null && distanceToPlayer < alarmRadiusMeters;
			// Run 72 dive telegraph: a plain elapsed-time counter (not eased), reset the instant the
			// player leaves `alarmRadiusMeters` — gates when the dive's own position blend is allowed
			// to start moving, below.
			diveAlarmElapsedSeconds = isAlarmed ? diveAlarmElapsedSeconds + delta : 0;
			const diveTelegraphActive = isAlarmed && diveAlarmElapsedSeconds < diveTelegraphSeconds;
			diveTelegraphBlend = easeBlendToward(diveTelegraphBlend, diveTelegraphActive ? 1 : 0, delta, diveTelegraphTransitionSeconds);
			// The dive's position blend only targets 1 once the telegraph window has fully elapsed —
			// while alarmed but still inside that window, it stays pinned at its current value (0 on
			// first entering `alarmRadiusMeters`), so the dragon visibly holds its circling pose while
			// only the telegraph cue (wing-flap agitation, below) fires. A player who retreats before
			// the window elapses never sees `diveBlend` leave 0 at all — the dive itself never started.
			const diveMotionAllowed = isAlarmed && diveAlarmElapsedSeconds >= diveTelegraphSeconds;
			diveBlend = easeBlendToward(diveBlend, diveMotionAllowed ? 1 : 0, delta, diveTransitionSeconds);

			// Run 90 (ADR-0116) attack lunge: only ever computed for a biting dragon (`canBite`) — a
			// non-biting dragon's `currentLateralPullFraction`/`currentDropMeters` stay exactly
			// `clampedDiveLateralPullFraction`/`diveDropMeters`, provably identical to the pre-run-88
			// dive math. Requires sustained proximity *on top of* the dive's own telegraph+transition —
			// the player kept provoking it, not merely triggered one swoop.
			let currentLateralPullFraction = clampedDiveLateralPullFraction;
			let currentDropMeters = diveDropMeters;
			if (canBite) {
				const attackTriggered = isAlarmed && diveAlarmElapsedSeconds >= diveTelegraphSeconds + attackTriggerSeconds;
				attackBlend = easeBlendToward(attackBlend, attackTriggered ? 1 : 0, delta, attackTransitionSeconds);
				currentLateralPullFraction = blendScalar(clampedDiveLateralPullFraction, clampedAttackLateralPullFraction, attackBlend);
				currentDropMeters = blendScalar(diveDropMeters, attackDropMeters, attackBlend);
			}
			if (diveBlend > 0 && playerPosition) {
				applyDiveOffset(model, {
					playerX: playerPosition.x,
					playerZ: playerPosition.z,
					centerY: center.y,
					diveDropMeters: currentDropMeters,
					lateralPullFraction: currentLateralPullFraction,
					diveBlend,
				});
			}

			// Terrain-collision safety floor, applied to the finished position — unchanged for any
			// dragon with no `sampleGroundY` (see `dragonFlightMath.js`'s own doc comment).
			if (typeof sampleGroundY === 'function') {
				clampAltitudeAboveGround(model, sampleGroundY, minAltitudeAboveGroundMeters);
			}

			// Run 90 (ADR-0116) bite: checked against the *final*, post-terrain-clamp position (the
			// real rendered position) — the actual on-screen distance, not the unclamped dive-offset
			// math. `attackBlend > 0.95` (not exactly `1`, which `easeBlendToward` only ever reaches
			// asymptotically-exactly at the very end of `attackTransitionSeconds`, same floating-point
			// caution `checkStarfieldTwinkle`'s own header already notes for a sine peak) restricts a
			// landed hit to a *fully*-committed lunge, never an incidental close pass during ordinary
			// circling/pursuit.
			biteCooldownRemainingSeconds = Math.max(0, biteCooldownRemainingSeconds - delta);
			let didBiteThisFrame = false;
			if (canBite && attackBlend > 0.95 && biteCooldownRemainingSeconds <= 0 && playerPosition) {
				const dx = model.position.x - playerPosition.x;
				const dy = model.position.y - playerPosition.y;
				const dz = model.position.z - playerPosition.z;
				if (Math.hypot(dx, dy, dz) < biteRadiusMeters) {
					eventsBus.emit(biteEventName, { amount: biteDamage, sourceId: name ?? 'dragon' });
					biteCooldownRemainingSeconds = biteCooldownSeconds;
					didBiteThisFrame = true;
				}
			}

			// Run 70 (ADR-0089) wing-flap telegraph: reuses the blends already computed above this
			// frame (reactive/dive/pursuit, and run 72's dive-telegraph) rather than adding a new
			// trigger — whichever reaction is currently strongest sets how hard the wings flap, so a
			// dragon that is merely reactive (sped-up circling, no dive/pursuit) still gets a visible
			// cue, one that is diving or pursuing doesn't flap faster than either alone implies, and —
			// run 72 — the telegraph window itself (before the dive's position blend is even allowed
			// to move) already reads as agitated rather than waiting for `diveBlend` to catch up. Run
			// 88's `attackBlend` folds in the same way — inert (0) for any non-biting dragon, so this
			// `Math.max` stays exactly as before for every dragon spawned prior to this run.
			const agitationBlend = Math.max(reactiveBlend, diveBlend, pursuitBlend, diveTelegraphBlend, attackBlend);
			const wingFlapTimeScale = 1 + (agitatedWingFlapMultiplier - 1) * agitationBlend;
			if (flyAction) flyAction.timeScale = wingFlapTimeScale;
			model.userData.wingFlapTimeScale = wingFlapTimeScale;
			// Run 71 (ADR-0091) give-up cue: exposed the same way `wingFlapTimeScale` already is, so
			// regression tests (and any future debug tooling) can read it without reaching into the
			// bank-angle math above.
			model.userData.giveUpBlend = giveUpBlend;
			// Run 72 dive telegraph: exposed the same way, so a regression test can directly assert
			// "the cue fired but the dive itself never moved" instead of inferring it only from
			// `wingFlapTimeScale` (which `diveBlend` also drives once the dive actually starts).
			model.userData.diveTelegraphBlend = diveTelegraphBlend;
			// Run 90 (ADR-0116): exposed the same way, so a regression test can assert the escalation
			// and the landed hit independently of each other and of `wingFlapTimeScale`.
			model.userData.attackBlend = attackBlend;
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
