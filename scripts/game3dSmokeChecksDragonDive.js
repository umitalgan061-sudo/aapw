/**
 * game3dSmokeChecksDragonDive.js — regression guard for `gameplay/dragons.js`'s dive/swoop reaction
 * (run 64, DECISIONS.md ADR-0082) and its dive telegraph (run 72, DECISIONS.md ADR-0093).
 *
 * Split into its own file rather than added to `game3dSmokeChecksMovement.js` (already 614/600
 * lines going into run 64 — see that file's own header for the original split precedent this
 * follows) so that run didn't grow an already-over-budget file further. Run 68 (DECISIONS.md
 * ADR-0087) then cleared that violation properly, moving the three baseline dragon flight/awareness
 * checks into `game3dSmokeChecksDragonFlight.js`. This file originally also held the *pursuit* half
 * of dragon path-deviation coverage (`checkDragonPursuit`, `checkDragonGiveUpCue`); run 72
 * (DECISIONS.md ADR-0093) split those out into `game3dSmokeChecksDragonPursuit.js` when adding
 * `checkDragonDiveTelegraph` pushed this file to 598/600 — the exact same forcing signal (and
 * by-theme split shape) ADR-0087/ADR-0092 already established, following this run's own "Next step"
 * note rather than deferring it. This file's scope is now specifically the *dive/swoop* half:
 * `alarmRadiusMeters`-triggered behavior only, not `pursuitRadiusMeters`-triggered behavior.
 * `smokeTestGame3D.js` calls this file's exports alongside every other check module's.
 * @module scripts/game3dSmokeChecksDragonDive
 */

/** Timeout for a page navigation (`domcontentloaded`) — asset fetches happen after this. Same
 * value/convention as the sibling check files' own copies; duplicated rather than shared/imported
 * across files since it's a single primitive with no other state. */
// Run 332 RCA (game3d.js line-cap extraction, ADR-0279): this project's own boot cost has grown
// past this constant's original assumption -- run-326/330/330b/331's procedural creatures, real
// castle models, and villages pushed a real game3d.html boot to ~9-13s (observed via direct
// domcontentloaded-timing instrumentation) in this project's software-WebGL sandboxed CI/dev
// environment, which sat right at or over the old 10s/15s ceiling -- a pre-existing flake
// (already recorded as an "environment quirk" by game3dSmokeChecksScene.js's own run-68 comment)
// that reproduced on unmodified `main` in this run's own RCA, not something the run's actual code
// change caused (confirmed: that change executes strictly after the domcontentloaded event this
// timeout gates on). 30s gives real margin above the observed range, including one measured 20s+
// outlier under sandbox contention.
const NAV_TIMEOUT_MS = 30_000;

/**
 * Regression guard for `gameplay/dragons.js`'s dive/swoop reaction (run 64, DECISIONS.md ADR-0082) —
 * the first real path deviation layered on top of run 58's speed/bank-only reaction (ADR-0077).
 * Drives a real `createDragon` controller with `speedMps: 0` (parks the dragon at a fixed, known
 * position — same trick `checkDragonNotice`/`checkDragonReactiveFlight` in
 * `game3dSmokeChecksDragonFlight.js` already use) and asserts:
 * - while the player is outside `alarmRadiusMeters`, the dragon stays exactly on its circle (no
 *   position blend at all, `diveBlend` never leaves 0);
 * - sustained proximity inside `alarmRadiusMeters` eases the dragon off the circle, pulled partway
 *   toward the player horizontally (by exactly `diveLateralPullFraction`) and down toward
 *   `centerY - diveDropMeters`;
 * - a `sampleGroundY` that would put the raw dive target below the terrain-safety floor is clamped
 *   to exactly `groundY + minAltitudeAboveGroundMeters`, never lower — the actual terrain-collision
 *   guarantee, not just the unclamped math;
 * - the player retreating past `alarmRadiusMeters` eases the dragon back to *exactly* its on-circle
 *   pose (position, not just blend value) — confirming "returning to the circle" really does need no
 *   separate path-planning, per `createDragon`'s own doc comment;
 * - a dragon spawned with no `alarmRadiusMeters`/`sampleGroundY` never leaves its circle regardless
 *   of how close `playerPosition` is (dive fully opt-in, same convention `noticeRadiusMeters` uses).
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkDragonDive(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createDragon } = await import('/src/3d/gameplay/dragons.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { DRAGON_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');

			const assetLoader = new AssetLoader();
			const centerX = 300;
			const centerZ = 400;
			const centerY = 90;
			const circleRadiusMeters = 150;
			const alarmRadiusMeters = 50;
			const diveDropMeters = 30;
			const diveLateralPullFraction = 0.4;
			const diveTransitionSeconds = 1;
			const minAltitudeAboveGroundMeters = 10;
			// Flat, generous ground well below anything the unclamped dive math would reach, so the
			// "stays clamped" assertions below are exercised against a *different*, deliberately too-
			// low ground plane instead.
			const generousGroundY = () => -1000;

			const dragon = await createDragon({
				assetLoader,
				modelUrl: DRAGON_CONFIG.MODEL_URL,
				texturesResourcePath: DRAGON_CONFIG.TEXTURES_RESOURCE_PATH,
				scale: DRAGON_CONFIG.SCALE,
				flyClipName: DRAGON_CONFIG.FLY_CLIP_NAME,
				centerX, centerZ, centerY, circleRadiusMeters,
				speedMps: 0, // parks the dragon at its start position (centerX, centerY, centerZ + circleRadiusMeters)
				alarmRadiusMeters,
				sampleGroundY: generousGroundY,
				diveDropMeters,
				diveLateralPullFraction,
				diveTransitionSeconds,
				minAltitudeAboveGroundMeters,
			});

			const delta = 1 / 60;
			const circleX = centerX; // dragon's parked position: (centerX, centerY, centerZ + radius)
			const circleZ = centerZ + circleRadiusMeters;
			const playerFar = { x: circleX, y: centerY, z: circleZ + 1000 }; // outside alarmRadiusMeters
			const playerNear = { x: circleX + 20, y: centerY, z: circleZ }; // ~20m away, inside alarmRadiusMeters

			dragon.update(delta, playerFar);
			const staysOnCircleWhileFar = dragon.object3D.position.x === circleX &&
				dragon.object3D.position.y === centerY && dragon.object3D.position.z === circleZ;

			for (let i = 0; i < 200; i++) dragon.update(delta, playerNear);
			const { x: divedX, y: divedY, z: divedZ } = dragon.object3D.position;
			const expectedDivedX = circleX + (playerNear.x - circleX) * diveLateralPullFraction;
			const expectedDivedZ = circleZ + (playerNear.z - circleZ) * diveLateralPullFraction;
			const expectedDivedY = centerY - diveDropMeters; // generousGroundY() is far below this, so unclamped here
			const divedToExpectedPosition = Math.abs(divedX - expectedDivedX) < 1e-6 &&
				Math.abs(divedZ - expectedDivedZ) < 1e-6 && Math.abs(divedY - expectedDivedY) < 1e-6;
			// Moved a real distance away from the pure on-circle pose — NOT necessarily *toward* the
			// circle's own center (pulling toward a player standing tangentially, as `playerNear` does
			// here, moves the blended position slightly outward, not inward — a real property of
			// pulling off an arbitrary point on a circle, not a bug), just genuinely off it.
			const divedOffCircle = Math.hypot(divedX - circleX, divedY - centerY, divedZ - circleZ) > 5;

			for (let i = 0; i < 200; i++) dragon.update(delta, playerFar);
			const returnsExactlyToCircle = dragon.object3D.position.x === circleX &&
				dragon.object3D.position.y === centerY && dragon.object3D.position.z === circleZ;

			// Second dragon, ground positioned so the clamp floor sits *above* this dive's own
			// unclamped target (centerY - diveDropMeters = 60) — the actual terrain-collision
			// guarantee: the clamp must win over the unclamped dive math. Deliberately a modest,
			// realistic diveDropMeters (not an extreme one): an extreme drop would itself balloon the
			// dragon's 3D distance-to-player past alarmRadiusMeters mid-dive (the alarm check reads
			// real 3D distance, including altitude) and un-alarm it before diveBlend ever reaches 1 —
			// a real property of this design, not a test bug, and worth keeping small/realistic here
			// so this check isolates the terrain clamp instead of that separate interaction.
			const clampGroundY = 65;
			const clampMinAltitude = 10; // floor = 75, above the unclamped target (60) -> clamp must apply
			const clampDragon = await createDragon({
				assetLoader,
				modelUrl: DRAGON_CONFIG.MODEL_URL,
				texturesResourcePath: DRAGON_CONFIG.TEXTURES_RESOURCE_PATH,
				scale: DRAGON_CONFIG.SCALE,
				flyClipName: DRAGON_CONFIG.FLY_CLIP_NAME,
				centerX, centerZ, centerY, circleRadiusMeters,
				speedMps: 0,
				alarmRadiusMeters,
				sampleGroundY: () => clampGroundY,
				diveDropMeters,
				diveLateralPullFraction,
				diveTransitionSeconds,
				minAltitudeAboveGroundMeters: clampMinAltitude,
			});
			for (let i = 0; i < 200; i++) clampDragon.update(delta, playerNear);
			const clampedToTerrainFloor = Math.abs(clampDragon.object3D.position.y - (clampGroundY + clampMinAltitude)) < 1e-6;

			// Third dragon: no alarmRadiusMeters/sampleGroundY configured — dive fully disabled.
			const noDiveDragon = await createDragon({
				assetLoader,
				modelUrl: DRAGON_CONFIG.MODEL_URL,
				texturesResourcePath: DRAGON_CONFIG.TEXTURES_RESOURCE_PATH,
				scale: DRAGON_CONFIG.SCALE,
				flyClipName: DRAGON_CONFIG.FLY_CLIP_NAME,
				centerX, centerZ, centerY, circleRadiusMeters,
				speedMps: 0,
			});
			for (let i = 0; i < 200; i++) noDiveDragon.update(delta, { x: circleX, y: centerY, z: circleZ }); // exactly on top of it
			const diveDisabledByDefault = noDiveDragon.object3D.position.x === circleX &&
				noDiveDragon.object3D.position.y === centerY && noDiveDragon.object3D.position.z === circleZ;

			return {
				staysOnCircleWhileFar, divedToExpectedPosition, divedOffCircle, returnsExactlyToCircle,
				clampedToTerrainFloor, diveDisabledByDefault,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'stays exactly on-circle while far; sustained close proximity eases the dragon off the ' +
			'circle to the exact expected lateral-pull + altitude-drop position; a too-low ' +
			'sampleGroundY clamps the dive to exactly groundY + minAltitudeAboveGroundMeters; player ' +
			'retreating eases it back to the exact on-circle pose; dive fully disabled by default ' +
			'(no alarmRadiusMeters/sampleGroundY configured)'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'dragon dive/swoop reaction (gameplay/dragons.js, ADR-0082)', ok, details };
}

/**
 * Regression guard for `gameplay/dragons.js`'s dive telegraph (run 72) — the warning beat layered on
 * top of run 64's dive (ADR-0082), giving its *start* the same distinct read run 71's give-up cue
 * (ADR-0091, now in `game3dSmokeChecksDragonPursuit.js`) already gave its end. Placed alongside
 * `checkDragonDive` since it exercises the exact same `alarmRadiusMeters`/dive machinery that check
 * already owns.
 *
 * Every scenario parks the dragon (`speedMps: 0`) — same trick every sibling dragon check already
 * uses — so position only moves once the dive's own blend actually starts. Three independent
 * scenarios:
 * - **Telegraph fires before the dive moves:** sustained proximity inside `alarmRadiusMeters`, for
 *   longer than `diveTelegraphTransitionSeconds` but still under `diveTelegraphSeconds`, drives
 *   `userData.diveTelegraphBlend` to exactly 1 (the wing-flap cue is fully flared) while the dragon's
 *   position stays *exactly* on its circle — `diveBlend` never left 0 — proving the cue and the dive
 *   motion are genuinely decoupled, not just an early sample of the same ramp.
 * - **The dive itself starts once the telegraph window elapses:** continuing the same dragon past
 *   `diveTelegraphSeconds`, the position eventually leaves the circle and reaches the exact expected
 *   dived position (same math `checkDragonDive` already proves) — the telegraph delays the dive, it
 *   doesn't replace it.
 * - **Retreating during the telegraph window cancels the dive entirely:** a fresh dragon gets a short
 *   burst of proximity — long enough for the telegraph cue to fire, but well under
 *   `diveTelegraphSeconds` — then the player retreats past `alarmRadiusMeters`. The dragon's position
 *   never once left its circle (`diveBlend` stayed exactly 0 throughout), even though the wing-flap
 *   cue did fire — the "warned, not committed" property the feature is meant to have.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkDragonDiveTelegraph(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createDragon } = await import('/src/3d/gameplay/dragons.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { DRAGON_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');

			const assetLoader = new AssetLoader();
			const centerX = 300;
			const centerZ = 400;
			const centerY = 90;
			const circleRadiusMeters = 150;
			const alarmRadiusMeters = 50;
			const diveDropMeters = 30;
			const diveLateralPullFraction = 0.4;
			const diveTransitionSeconds = 1;
			const diveTelegraphSeconds = 0.5; // deliberately non-default (createDragon's own is 0.4)
			const diveTelegraphTransitionSeconds = 0.1; // deliberately non-default (createDragon's own is 0.15)
			const minAltitudeAboveGroundMeters = 10;
			const generousGroundY = () => -1000; // well below anything the unclamped dive math reaches
			const approxEqual = (a, b, tolerance = 1e-6) => Math.abs(a - b) < tolerance;
			const delta = 1 / 60;

			const baseSpawn = {
				assetLoader,
				modelUrl: DRAGON_CONFIG.MODEL_URL,
				texturesResourcePath: DRAGON_CONFIG.TEXTURES_RESOURCE_PATH,
				scale: DRAGON_CONFIG.SCALE,
				flyClipName: DRAGON_CONFIG.FLY_CLIP_NAME,
				centerX, centerZ, centerY, circleRadiusMeters,
				speedMps: 0, // parks the dragon at its start position (centerX, centerY, centerZ + radius)
				alarmRadiusMeters,
				sampleGroundY: generousGroundY,
				diveDropMeters,
				diveLateralPullFraction,
				diveTransitionSeconds,
				diveTelegraphSeconds,
				diveTelegraphTransitionSeconds,
				minAltitudeAboveGroundMeters,
			};
			const circleX = centerX; // dragon's parked position: (centerX, centerY, centerZ + radius)
			const circleZ = centerZ + circleRadiusMeters;
			const playerNear = { x: circleX + 20, y: centerY, z: circleZ }; // ~20m away, inside alarmRadiusMeters
			const playerFar = { x: circleX, y: centerY, z: circleZ + 1000 }; // outside alarmRadiusMeters

			// --- Scenario 1+2: telegraph fires first, dive starts only once the window elapses. ---
			const dragon = await createDragon({ ...baseSpawn });
			// 15 frames = 0.25s: past diveTelegraphTransitionSeconds (0.1s, so the cue itself is fully
			// flared) but well under diveTelegraphSeconds (0.5s, so the dive must not have started).
			for (let i = 0; i < 15; i++) dragon.update(delta, playerNear);
			const telegraphFullyFlaredDuringWindow = approxEqual(dragon.object3D.userData.diveTelegraphBlend, 1);
			const positionStillExactlyOnCircleDuringTelegraph =
				dragon.object3D.position.x === circleX && dragon.object3D.position.y === centerY &&
				dragon.object3D.position.z === circleZ;
			// Continue well past diveTelegraphSeconds + diveTransitionSeconds (0.5 + 1 = 1.5s -> 90
			// frames from the start of this scenario; 75 more from here) so the dive itself finishes.
			for (let i = 0; i < 200; i++) dragon.update(delta, playerNear);
			const { x: divedX, y: divedY, z: divedZ } = dragon.object3D.position;
			const expectedDivedX = circleX + (playerNear.x - circleX) * diveLateralPullFraction;
			const expectedDivedZ = circleZ + (playerNear.z - circleZ) * diveLateralPullFraction;
			const expectedDivedY = centerY - diveDropMeters;
			const diveEventuallyReachesExpectedPosition =
				Math.abs(divedX - expectedDivedX) < 1e-6 && Math.abs(divedZ - expectedDivedZ) < 1e-6 &&
				Math.abs(divedY - expectedDivedY) < 1e-6;
			dragon.dispose();

			// --- Scenario 3: retreating during the telegraph window cancels the dive entirely. ---
			const cancelDragon = await createDragon({ ...baseSpawn });
			for (let i = 0; i < 15; i++) cancelDragon.update(delta, playerNear); // 0.25s, cue fires
			const cueFiredBeforeRetreat = approxEqual(cancelDragon.object3D.userData.diveTelegraphBlend, 1);
			for (let i = 0; i < 60; i++) cancelDragon.update(delta, playerFar); // retreats well before 0.5s window would elapse
			const dragonNeverLeftCircleDespiteCue =
				cancelDragon.object3D.position.x === circleX && cancelDragon.object3D.position.y === centerY &&
				cancelDragon.object3D.position.z === circleZ;
			const cueEasedBackOffAfterRetreat = approxEqual(cancelDragon.object3D.userData.diveTelegraphBlend, 0);
			cancelDragon.dispose();

			return {
				telegraphFullyFlaredDuringWindow, positionStillExactlyOnCircleDuringTelegraph,
				diveEventuallyReachesExpectedPosition, cueFiredBeforeRetreat,
				dragonNeverLeftCircleDespiteCue, cueEasedBackOffAfterRetreat,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'entering alarmRadiusMeters flares the wing-flap telegraph cue to exactly 1 while the ' +
			'dragon holds its exact on-circle pose (diveBlend never leaves 0) for diveTelegraphSeconds; ' +
			'the dive itself starts only once that window elapses and reaches the same expected ' +
			'position checkDragonDive proves; retreating during the telegraph window cancels the dive ' +
			'entirely -- the dragon never once leaves its circle despite the cue having fired'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'dragon dive telegraph (gameplay/dragons.js, run 72)', ok, details };
}

/**
 * Regression guard for `gameplay/dragons.js`'s attack lunge/bite (run 90, DECISIONS.md ADR-0116) —
 * the project owner's own live request: dragons should attack once provoked, not just menace and
 * withdraw. Every scenario parks the dragon (`speedMps: 0`) and uses a real `EventBus`, same
 * conventions `checkDragonDive`/`checkWorldEvents` already establish, so the actual emitted damage
 * event (not just an internal blend value) is what's asserted wherever possible.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkDragonBiteAttack(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createDragon } = await import('/src/3d/gameplay/dragons.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { DRAGON_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');
			const { EventBus } = await import('/src/3d/eventBus.js');

			const assetLoader = new AssetLoader();
			const approxEqual = (a, b, tolerance = 1e-6) => Math.abs(a - b) < tolerance;
			const delta = 1 / 60;
			// Deliberately low altitude/short transitions (vs. DRAGON_CONFIG.SPAWNS[0]'s real, much
			// larger numbers) purely so this test reaches every stage in a small, fast, exact frame
			// count — the *mechanism* under test is identical either way.
			const centerX = 300;
			const centerZ = 400;
			const centerY = 20;
			const circleRadiusMeters = 150;
			const alarmRadiusMeters = 50; // > centerY, same "must clear altitude to ever trigger" property real spawns need.
			const diveDropMeters = 10;
			const diveLateralPullFraction = 0.4;
			const diveTransitionSeconds = 0.3;
			const diveTelegraphSeconds = 0.2;
			const diveTelegraphTransitionSeconds = 0.1;
			const attackTriggerSeconds = 0.3; // additional sustained time *beyond* the telegraph+dive window above.
			const attackLateralPullFraction = 0.95;
			const attackDropMeters = 18; // deeper than diveDropMeters -- clamped by minAltitudeAboveGroundMeters below.
			const attackTransitionSeconds = 0.3;
			const minAltitudeAboveGroundMeters = 3;
			const biteRadiusMeters = 10;
			const biteDamage = 25;
			const biteCooldownSeconds = 1;
			const flatGroundY = () => 0;
			const circleX = centerX; // dragon's parked position: (centerX, centerY, centerZ + radius)
			const circleZ = centerZ + circleRadiusMeters;
			// A real player standing on the ground (y=0), not at the dragon's own cruise altitude —
			// matters here specifically because the bite check reads real 3D distance, unlike
			// `checkDragonDive`'s own `playerNear` (which reuses `centerY` purely to isolate the
			// lateral-pull math, never intended to double as a realistic bite-range scenario).
			const playerNear = { x: circleX + 15, y: 0, z: circleZ };
			const playerFar = { x: circleX, y: 0, z: circleZ + 1000 };

			const baseSpawn = {
				assetLoader,
				modelUrl: DRAGON_CONFIG.MODEL_URL,
				texturesResourcePath: DRAGON_CONFIG.TEXTURES_RESOURCE_PATH,
				scale: DRAGON_CONFIG.SCALE,
				flyClipName: DRAGON_CONFIG.FLY_CLIP_NAME,
				centerX, centerZ, centerY, circleRadiusMeters,
				speedMps: 0,
				alarmRadiusMeters,
				sampleGroundY: flatGroundY,
				diveDropMeters, diveLateralPullFraction, diveTransitionSeconds,
				diveTelegraphSeconds, diveTelegraphTransitionSeconds,
				attackTriggerSeconds, attackLateralPullFraction, attackDropMeters, attackTransitionSeconds,
				minAltitudeAboveGroundMeters,
				biteRadiusMeters, biteDamage, biteCooldownSeconds,
			};

			// --- Scenario 1: sustained provocation escalates and lands exactly one hit; cooldown then
			//     blocks a 2nd one until it elapses, after which a 2nd hit lands. ---
			const bus = new EventBus();
			const hits = [];
			bus.on('test:bite', (payload) => hits.push(payload));
			const dragon = await createDragon({ ...baseSpawn, eventsBus: bus, biteEventName: 'test:bite' });
			// 90 frames = 1.5s: well past telegraph (0.2s) + dive transition (0.3s) + attack trigger
			// (0.3s more) + attack transition (0.3s) = 1.1s total to full escalation. With these
			// exact numbers the 1st hit deterministically lands at frame 48 (0.8s: the first frame
			// `attackBlend` exceeds 0.95 -- 17/18 steps of the 1/18-per-frame ease is 0.944, 18/18 is
			// exactly 1) -- 90 frames leaves comfortable margin on both sides.
			for (let i = 0; i < 90; i++) dragon.update(delta, playerNear);
			const exactlyOneHitAfterEscalation = hits.length === 1;
			const firstHitAmountCorrect = hits[0]?.amount === biteDamage;
			const attackBlendFullyEscalated = approxEqual(dragon.object3D.userData.attackBlend, 1);
			// 10 more frames (cumulative 100, 1.667s): the cooldown from the frame-48 hit
			// (biteCooldownSeconds=1s -> expires at frame 108) has not elapsed yet -- must not add a
			// 2nd hit. (An earlier draft of this check used 30 more frames here -- cumulative 120,
			// past frame 108 -- and *correctly* caught the resulting 2nd hit as a real test-timing bug
			// in itself, not a bug in `dragonController.js`: re-verified by hand against the exact
			// frame-by-frame blend math above before narrowing this window, not just loosened until
			// it passed.)
			for (let i = 0; i < 10; i++) dragon.update(delta, playerNear);
			const stillExactlyOneHitDuringCooldown = hits.length === 1;
			// 40 more frames (cumulative 140, 2.333s): well past frame 108's cooldown expiry -- a 2nd
			// hit must land now that the dragon is still fully escalated and in range.
			for (let i = 0; i < 40; i++) dragon.update(delta, playerNear);
			const secondHitLandsAfterCooldown = hits.length === 2;
			dragon.dispose();

			// --- Scenario 2: proximity alone (dive, no sustained escalation yet) never bites. ---
			const shortHits = [];
			bus.on('test:biteShort', (payload) => shortHits.push(payload));
			const shortDragon = await createDragon({ ...baseSpawn, eventsBus: bus, biteEventName: 'test:biteShort' });
			// 20 frames = 0.33s: past the telegraph (0.2s, dive is moving) but well under the 0.5s
			// (telegraph + attackTriggerSeconds) needed for escalation to even begin.
			for (let i = 0; i < 20; i++) shortDragon.update(delta, playerNear);
			const diveStartedButNoBiteYet = shortDragon.object3D.userData.attackBlend === 0 && shortHits.length === 0;
			shortDragon.dispose();

			// --- Scenario 3: retreating mid-escalation cancels it and stops any further bite. ---
			const retreatHits = [];
			bus.on('test:biteRetreat', (payload) => retreatHits.push(payload));
			const retreatDragon = await createDragon({ ...baseSpawn, eventsBus: bus, biteEventName: 'test:biteRetreat' });
			for (let i = 0; i < 90; i++) retreatDragon.update(delta, playerNear); // escalates, lands 1 hit (same as scenario 1).
			const hitCountBeforeRetreat = retreatHits.length;
			for (let i = 0; i < 60; i++) retreatDragon.update(delta, playerFar); // 1s outside alarmRadiusMeters.
			const attackBlendErasedAfterRetreat = approxEqual(retreatDragon.object3D.userData.attackBlend, 0);
			const noFurtherHitsAfterRetreat = retreatHits.length === hitCountBeforeRetreat;
			retreatDragon.dispose();

			// --- Scenario 4: dive-only dragon (no biteEventName/biteDamage) never bites regardless of
			//     how long the player provokes it, and its position is untouched (exact pre-run-88
			//     dive math — the same formula checkDragonDive itself proves). ---
			const noBiteDragon = await createDragon({ ...baseSpawn, eventsBus: bus }); // no biteEventName/biteDamage.
			for (let i = 0; i < 200; i++) noBiteDragon.update(delta, playerNear); // far past every threshold above.
			const expectedCalmDivedX = circleX + (playerNear.x - circleX) * diveLateralPullFraction;
			const expectedCalmDivedY = centerY - diveDropMeters;
			const noBiteDragonUnaffected = approxEqual(noBiteDragon.object3D.position.x, expectedCalmDivedX)
				&& approxEqual(noBiteDragon.object3D.position.z, circleZ)
				&& approxEqual(noBiteDragon.object3D.position.y, expectedCalmDivedY)
				&& noBiteDragon.object3D.userData.attackBlend === 0;
			noBiteDragon.dispose();

			return {
				exactlyOneHitAfterEscalation, firstHitAmountCorrect, attackBlendFullyEscalated,
				stillExactlyOneHitDuringCooldown, secondHitLandsAfterCooldown,
				diveStartedButNoBiteYet,
				attackBlendErasedAfterRetreat, noFurtherHitsAfterRetreat,
				noBiteDragonUnaffected,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'sustained provocation past the dive+telegraph window escalates to a real, damage-dealing ' +
			'hit (exact configured amount) exactly once, blocked by its own cooldown, landing a 2nd ' +
			'hit once that cooldown elapses; a short proximity burst that never escalates lands no ' +
			'hit at all; retreating mid-escalation eases the escalation back to exactly 0 and stops ' +
			'any further hit; a dive-only dragon with no bite configured never bites regardless of ' +
			'duration and its position stays exactly the pre-existing dive-only math'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'dragon attack lunge/bite (gameplay/dragons.js, ADR-0116)', ok, details };
}

module.exports = { checkDragonDive, checkDragonDiveTelegraph, checkDragonBiteAttack };
