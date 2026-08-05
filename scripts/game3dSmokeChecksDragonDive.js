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
const NAV_TIMEOUT_MS = 15000;

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

module.exports = { checkDragonDive, checkDragonDiveTelegraph };
