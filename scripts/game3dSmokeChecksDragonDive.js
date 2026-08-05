/**
 * game3dSmokeChecksDragonDive.js — regression guard for `gameplay/dragons.js`'s dive/swoop reaction
 * (run 64, DECISIONS.md ADR-0082).
 *
 * Split into its own file rather than added to `game3dSmokeChecksMovement.js` (already 614/600
 * lines going into run 64 — see that file's own header for the original split precedent this
 * follows) so that run didn't grow an already-over-budget file further. Run 68 (DECISIONS.md
 * ADR-0087) then cleared that violation properly, moving the three baseline dragon flight/awareness
 * checks into `game3dSmokeChecksDragonFlight.js`; this file's scope is unchanged and is now the
 * *path-deviation* half of dragon coverage (dive/swoop ADR-0082, continuous chase ADR-0085, and run
 * 71's give-up cue ADR-0091 — layered directly on the same `pursuitExhausted` state this file's own
 * `checkDragonPursuit` already exercises) against that sibling's nominal-flight half.
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
 * Regression guard for `gameplay/dragons.js`'s continuous chase (run 66, DECISIONS.md ADR-0085) —
 * the tier that finally lets the dragon leave its home seat, by traveling the whole circle rather
 * than pulling a bounded fraction off a fixed one.
 *
 * Every sub-scene parks the dragon's angle with `speedMps: 0` (same trick the dive check above and
 * `game3dSmokeChecksDragonFlight.js`'s dragon checks already use) and `startAngleRadians: 0`, which puts
 * the dragon at exactly `(centerX, centerY, centerZ + radius)`. That makes the two otherwise-internal
 * values directly readable off `object3D.position` without exposing them: with the radius held
 * constant, `centerZ === position.z - radius` reads the traveling center; with the center held still
 * (`pursuitCenterSpeedMps: 0`), `radius === position.z - centerZ` reads the easing radius. Asserts:
 * - the center travels toward the player at exactly `pursuitCenterSpeedMps` — a real speed limit,
 *   not a lerp that would teleport the circle when the player is far;
 * - the circle radius eases toward `pursuitCircleRadiusMeters` while engaged;
 * - the engagement is time-boxed: past `pursuitMaxSeconds` the dragon disengages and travels back,
 *   landing *exactly* on its home center (the snap-when-closer-than-one-step branch, so "home" is a
 *   real equality rather than an asymptote), and does not re-engage while the player stays put;
 * - leaving `pursuitRadiusMeters` re-arms it, and re-entering starts a fresh engagement;
 * - the terrain-safety clamp now applies to ordinary circling too, not just diving (run 66 hoisted
 *   it out of the dive branch) — a dragon with no dive configured at all still gets pushed up above
 *   a too-high `sampleGroundY`;
 * - pursuit is fully opt-in: with no `pursuitRadiusMeters` the center never moves, however close the
 *   player stands.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkDragonPursuit(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createDragon } = await import('/src/3d/gameplay/dragons.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { DRAGON_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');

			const assetLoader = new AssetLoader();
			const centerX = 0;
			const centerZ = 0;
			const centerY = 100;
			const circleRadiusMeters = 100;
			const delta = 0.1;
			// Flat ground at 0 with a cruise altitude equal to centerY, so terrain-following is a
			// no-op here and these assertions isolate the *horizontal* travel/radius behavior.
			const flatGround = () => 0;
			const base = {
				assetLoader,
				modelUrl: DRAGON_CONFIG.MODEL_URL,
				texturesResourcePath: DRAGON_CONFIG.TEXTURES_RESOURCE_PATH,
				scale: DRAGON_CONFIG.SCALE,
				flyClipName: DRAGON_CONFIG.FLY_CLIP_NAME,
				centerX, centerZ, centerY, circleRadiusMeters,
				speedMps: 0,
				startAngleRadians: 0,
				minAltitudeAboveGroundMeters: 10,
				cruiseAltitudeAboveGroundMeters: centerY,
			};
			// Directly under the dragon's parked position (0, 100, 100): 3D distance 100, inside the
			// 150m pursuit radius below.
			const playerNear = { x: 0, y: 0, z: circleRadiusMeters };
			const playerFar = { x: 5000, y: 0, z: 5000 };
			const approxEqual = (a, b, tolerance = 1e-6) => Math.abs(a - b) < tolerance;

			// --- Center travel at a bounded speed (radius held constant so position.z reads it). ---
			const travelDragon = await createDragon({
				...base,
				sampleGroundY: flatGround,
				pursuitRadiusMeters: 150,
				pursuitCenterSpeedMps: 10,
				pursuitCircleRadiusMeters: circleRadiusMeters, // no tightening — isolates travel
				pursuitMaxSeconds: 1000,
			});
			for (let i = 0; i < 10; i++) travelDragon.update(delta, playerNear); // 1.0s engaged
			// Center should have advanced exactly 10 m/s * 1.0s = 10m toward the player's z=100.
			const centerTraveledAtBoundedSpeed = approxEqual(travelDragon.object3D.position.z, circleRadiusMeters + 10);
			for (let i = 0; i < 10; i++) travelDragon.update(delta, playerNear); // 1.0s more
			const centerKeepsClosing = approxEqual(travelDragon.object3D.position.z, circleRadiusMeters + 20);
			travelDragon.dispose();

			// --- Radius tightening (center pinned still so position.z reads the radius). ---
			const tightenDragon = await createDragon({
				...base,
				sampleGroundY: flatGround,
				pursuitRadiusMeters: 150,
				pursuitCenterSpeedMps: 0, // center never moves — isolates the radius blend
				pursuitCircleRadiusMeters: 50,
				pursuitTransitionSeconds: 1,
				pursuitMaxSeconds: 1000,
			});
			for (let i = 0; i < 5; i++) tightenDragon.update(delta, playerNear); // 0.5s -> blend 0.5
			const radiusHalfwayTightened = approxEqual(tightenDragon.object3D.position.z, 75);
			for (let i = 0; i < 20; i++) tightenDragon.update(delta, playerNear); // fully engaged
			const radiusFullyTightened = approxEqual(tightenDragon.object3D.position.z, 50);
			tightenDragon.dispose();

			// --- Time-box, exact return home, no re-engage while the player stays put, re-arm. ---
			const timeboxDragon = await createDragon({
				...base,
				sampleGroundY: flatGround,
				pursuitRadiusMeters: 150,
				pursuitCenterSpeedMps: 10,
				pursuitCircleRadiusMeters: circleRadiusMeters,
				pursuitMaxSeconds: 1,
			});
			for (let i = 0; i < 10; i++) timeboxDragon.update(delta, playerNear); // 1.0s -> exhausts
			const engagedBeforeTimeout = timeboxDragon.object3D.position.z > circleRadiusMeters;
			// Player never leaves, so the dragon must stay disengaged and travel all the way home.
			for (let i = 0; i < 100; i++) timeboxDragon.update(delta, playerNear);
			const returnedExactlyHome = timeboxDragon.object3D.position.z === circleRadiusMeters;
			// Still exhausted (player never left the radius) — must not have started over.
			for (let i = 0; i < 20; i++) timeboxDragon.update(delta, playerNear);
			const noReEngageWhilePlayerStays = timeboxDragon.object3D.position.z === circleRadiusMeters;
			// Leaving the radius re-arms it; coming back starts a fresh engagement.
			timeboxDragon.update(delta, playerFar);
			for (let i = 0; i < 5; i++) timeboxDragon.update(delta, playerNear);
			const reArmsAfterPlayerLeaves = timeboxDragon.object3D.position.z > circleRadiusMeters;
			timeboxDragon.dispose();

			// --- Terrain clamp applies to ordinary circling, not just diving (run 66 hoist). ---
			const highGroundDragon = await createDragon({
				...base,
				sampleGroundY: () => 500, // far above the dragon's own 100m cruise altitude
				// No alarmRadiusMeters/pursuitRadiusMeters at all — pure circling.
			});
			highGroundDragon.update(delta, playerNear);
			const circlingClampedAboveTerrain = approxEqual(highGroundDragon.object3D.position.y, 510);
			highGroundDragon.dispose();

			// --- Pursuit fully opt-in. ---
			const noPursuitDragon = await createDragon({ ...base, sampleGroundY: flatGround });
			for (let i = 0; i < 200; i++) noPursuitDragon.update(delta, playerNear);
			const pursuitDisabledByDefault = noPursuitDragon.object3D.position.x === centerX &&
				noPursuitDragon.object3D.position.z === centerZ + circleRadiusMeters;
			noPursuitDragon.dispose();

			return {
				centerTraveledAtBoundedSpeed, centerKeepsClosing, radiusHalfwayTightened,
				radiusFullyTightened, engagedBeforeTimeout, returnedExactlyHome,
				noReEngageWhilePlayerStays, reArmsAfterPlayerLeaves, circlingClampedAboveTerrain,
				pursuitDisabledByDefault,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'circle center travels toward the player at exactly pursuitCenterSpeedMps (speed-limited, ' +
			'not a teleporting lerp); radius eases to pursuitCircleRadiusMeters; engagement is ' +
			'time-boxed and returns exactly to the home center; no re-engage while the player stays ' +
			'inside, re-arms once they leave; terrain clamp now guards ordinary circling too (not ' +
			'just diving); pursuit fully disabled by default'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'dragon continuous chase (gameplay/dragons.js, ADR-0085)', ok, details };
}

/**
 * Regression guard for `gameplay/dragons.js`'s give-up cue (run 71, DECISIONS.md ADR-0091) — the
 * distinct bank-angle telegraph layered on top of run 66's continuous chase (ADR-0085) when a
 * pursuit engagement times out (`pursuitExhausted`) rather than ending because the player simply
 * left `pursuitRadiusMeters` before the timer ran out. Placed alongside `checkDragonPursuit` (not
 * in `game3dSmokeChecksDragonFlight.js`) since it exercises the same `pursuitExhausted` state that
 * check already owns — this file's own header documents it as the "path-deviation"/chase half of
 * dragon coverage.
 *
 * Every scenario parks the dragon (`speedMps: 0`, `startAngleRadians: 0`) and pins
 * `pursuitCenterSpeedMps: 0`/`pursuitCircleRadiusMeters` equal to the calm radius — the same
 * isolation trick `checkDragonPursuit`'s own radius/center sub-scenes use — so position never
 * moves and only the bank-angle math under test changes `object3D.rotation.z`. `noticeRadiusMeters`
 * is deliberately omitted throughout (no `eventsBus`/`eventName`/`noticeToast` either), so
 * `reactiveBlend` stays exactly 0 the whole time and `reactiveBankAngleRadians` keeps its own
 * "defaults to `bankAngleRadians`" no-op value — isolating the give-up bank layer from the
 * already-covered reactive-flight bank (`checkDragonReactiveFlight`) instead of compounding them.
 * Four independent scenarios:
 * - **Give-up (explicit multiplier):** the player never leaves `pursuitRadiusMeters` — the
 *   engagement times out (`pursuitExhausted` becomes true) and `giveUpBlend` eases up to exactly 1,
 *   steepening the bank to exactly `bankAngleRadians * giveUpBankAngleMultiplier` (an explicit,
 *   non-default `2.0` here, to keep the assertion visibly distinct from both the calm bank and the
 *   `1.6` default) — and *stays* there while the player keeps lingering (proving the cue latches for
 *   the whole "still nearby, already given up" window, not just a one-frame blip).
 * - **Give-up (default multiplier omitted):** same shape, but `giveUpBankAngleMultiplier` itself is
 *   left unset — proves the `1.6` default actually applies rather than silently no-op'ing, same
 *   precedent `checkDragonWingFlapAgitation`'s own dive-only scenario already established for
 *   `agitatedWingFlapMultiplier`.
 * - **Ordinary disengage (no give-up):** the player leaves `pursuitRadiusMeters` *before*
 *   `pursuitMaxSeconds` elapses — `pursuitExhausted` never becomes true, so `giveUpBlend` (and the
 *   bank angle) never leaves its calm baseline at any point, proving the cue is specific to a
 *   timeout, not every disengage.
 * - **Re-arm eases the cue back off:** continuing scenario 1's already-given-up dragon, the player
 *   finally leaves `pursuitRadiusMeters` — `pursuitExhausted` resets to false (re-arming a future
 *   engagement, the same edge-trigger `checkDragonPursuit` already proves for the chase itself) and
 *   `giveUpBlend` eases back down to exactly 0, restoring the plain calm bank angle.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkDragonGiveUpCue(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createDragon } = await import('/src/3d/gameplay/dragons.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { DRAGON_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');

			const assetLoader = new AssetLoader();
			const delta = 0.1;
			const centerX = 0;
			const centerZ = 0;
			const centerY = 50;
			const circleRadiusMeters = 100;
			const bankAngleRadians = 0.3;
			const flatGround = () => 0;
			const approxEqual = (a, b, tolerance = 1e-9) => Math.abs(a - b) < tolerance;
			// Directly under the dragon's parked position (0, 50, 100): 3D distance 100, inside a
			// 150m pursuit radius; far outside it once moved to z=5000.
			const playerNear = { x: 0, y: 0, z: circleRadiusMeters };
			const playerFar = { x: 5000, y: 0, z: 5000 };
			const baseSpawn = {
				assetLoader,
				modelUrl: DRAGON_CONFIG.MODEL_URL,
				texturesResourcePath: DRAGON_CONFIG.TEXTURES_RESOURCE_PATH,
				scale: DRAGON_CONFIG.SCALE,
				flyClipName: DRAGON_CONFIG.FLY_CLIP_NAME,
				centerX, centerZ, centerY, circleRadiusMeters,
				speedMps: 0,
				startAngleRadians: 0,
				bankAngleRadians,
				sampleGroundY: flatGround,
				pursuitRadiusMeters: 150,
				pursuitCenterSpeedMps: 0, // pinned — isolates bank angle from center/radius travel
				pursuitCircleRadiusMeters: circleRadiusMeters, // no tightening, same isolation reason
				pursuitTransitionSeconds: 1,
				pursuitMaxSeconds: 1,
				giveUpTransitionSeconds: 0.5,
			};

			// --- Scenario 1: give-up with an explicit, non-default multiplier. ---
			const explicitDragon = await createDragon({ ...baseSpawn, giveUpBankAngleMultiplier: 2.0 });
			const expectedGiveUpBankExplicit = bankAngleRadians * 2.0;
			for (let i = 0; i < 10; i++) explicitDragon.update(delta, playerNear); // 1.0s -> exhausts
			const stillCalmRightAtExhaustion =
				approxEqual(explicitDragon.object3D.userData.giveUpBlend, 0, 1e-6);
			for (let i = 0; i < 5; i++) explicitDragon.update(delta, playerNear); // 0.5s more -> giveUpBlend -> 1
			const giveUpReachesExplicitMultiplier =
				approxEqual(explicitDragon.object3D.userData.giveUpBlend, 1) &&
				approxEqual(explicitDragon.object3D.rotation.z, expectedGiveUpBankExplicit);
			// Player keeps lingering — the cue must latch, not fall back to calm on its own.
			for (let i = 0; i < 20; i++) explicitDragon.update(delta, playerNear);
			const giveUpLatchesWhilePlayerLingers =
				approxEqual(explicitDragon.object3D.userData.giveUpBlend, 1) &&
				approxEqual(explicitDragon.object3D.rotation.z, expectedGiveUpBankExplicit);
			// Player finally leaves — re-arms, and the cue eases back off.
			for (let i = 0; i < 5; i++) explicitDragon.update(delta, playerFar); // 0.5s -> giveUpBlend -> 0
			const giveUpEasesBackOffOnReArm =
				approxEqual(explicitDragon.object3D.userData.giveUpBlend, 0) &&
				approxEqual(explicitDragon.object3D.rotation.z, bankAngleRadians);
			explicitDragon.dispose();

			// --- Scenario 2: give-up with giveUpBankAngleMultiplier omitted (proves the 1.6 default). ---
			const defaultDragon = await createDragon({ ...baseSpawn });
			const expectedGiveUpBankDefault = bankAngleRadians * 1.6;
			for (let i = 0; i < 15; i++) defaultDragon.update(delta, playerNear); // 1.0s exhaust + 0.5s ease
			const giveUpReachesDefaultMultiplier =
				approxEqual(defaultDragon.object3D.userData.giveUpBlend, 1) &&
				approxEqual(defaultDragon.object3D.rotation.z, expectedGiveUpBankDefault);
			defaultDragon.dispose();

			// --- Scenario 3: ordinary disengage — player leaves before the timer ever exhausts. ---
			const ordinaryDragon = await createDragon({ ...baseSpawn, giveUpBankAngleMultiplier: 2.0 });
			for (let i = 0; i < 3; i++) ordinaryDragon.update(delta, playerNear); // 0.3s — well under 1.0s
			const engagedButNotExhaustedYet =
				approxEqual(ordinaryDragon.object3D.userData.giveUpBlend, 0);
			ordinaryDragon.update(delta, playerFar); // leaves before exhausting — must never trigger
			for (let i = 0; i < 20; i++) ordinaryDragon.update(delta, playerFar);
			const noGiveUpOnOrdinaryDisengage =
				approxEqual(ordinaryDragon.object3D.userData.giveUpBlend, 0) &&
				approxEqual(ordinaryDragon.object3D.rotation.z, bankAngleRadians);
			ordinaryDragon.dispose();

			return {
				stillCalmRightAtExhaustion, giveUpReachesExplicitMultiplier, giveUpLatchesWhilePlayerLingers,
				giveUpEasesBackOffOnReArm, giveUpReachesDefaultMultiplier, engagedButNotExhaustedYet,
				noGiveUpOnOrdinaryDisengage,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'a timeout-driven give-up eases the bank angle to exactly bankAngleRadians * ' +
			'giveUpBankAngleMultiplier (explicit and un-passed-default cases both proven) and latches ' +
			'while the player keeps lingering; leaving the radius re-arms it and eases the cue back to ' +
			'the calm bank; an ordinary disengage (player leaves before the timer exhausts) never ' +
			'triggers the cue at all'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'dragon pursuit give-up cue (gameplay/dragons.js, ADR-0091)', ok, details };
}

module.exports = { checkDragonDive, checkDragonPursuit, checkDragonGiveUpCue };
