/**
 * game3dSmokeChecksDragonPursuit.js — regression guard for `gameplay/dragons.js`'s continuous chase
 * (run 66, DECISIONS.md ADR-0085) and its give-up cue (run 71, DECISIONS.md ADR-0091).
 *
 * Split out of `game3dSmokeChecksDragonDive.js` (run 72, DECISIONS.md ADR-0093) when adding
 * `checkDragonDiveTelegraph` there pushed that file to 598/600 lines — the exact same forcing signal
 * (and by-theme split shape) `gameplay/dragons.js`'s own run-71 split (ADR-0092) already established:
 * split by cohesive responsibility, not by raw line count. This file holds the *pursuit* half of
 * dragon path-deviation coverage — everything triggered by `pursuitRadiusMeters` — leaving the
 * *dive/swoop* half (`alarmRadiusMeters`-triggered) in the sibling file. Both checks here exercise the
 * same `pursuitExhausted` state, which is why they were kept together rather than split further.
 * `smokeTestGame3D.js` calls this file's exports alongside every other check module's.
 * @module scripts/game3dSmokeChecksDragonPursuit
 */

/** Timeout for a page navigation (`domcontentloaded`) — asset fetches happen after this. Same
 * value/convention as the sibling check files' own copies; duplicated rather than shared/imported
 * across files since it's a single primitive with no other state. */
const NAV_TIMEOUT_MS = 15000;

/**
 * Regression guard for `gameplay/dragons.js`'s continuous chase (run 66, DECISIONS.md ADR-0085) —
 * the tier that finally lets the dragon leave its home seat, by traveling the whole circle rather
 * than pulling a bounded fraction off a fixed one.
 *
 * Every sub-scene parks the dragon's angle with `speedMps: 0` (same trick the dive check in the
 * sibling file and `game3dSmokeChecksDragonFlight.js`'s dragon checks already use) and
 * `startAngleRadians: 0`, which puts the dragon at exactly `(centerX, centerY, centerZ + radius)`.
 * That makes the two otherwise-internal values directly readable off `object3D.position` without
 * exposing them: with the radius held constant, `centerZ === position.z - radius` reads the
 * traveling center; with the center held still (`pursuitCenterSpeedMps: 0`), `radius === position.z
 * - centerZ` reads the easing radius. Asserts:
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
 * left `pursuitRadiusMeters` before the timer ran out. Placed alongside `checkDragonPursuit` since
 * it exercises the same `pursuitExhausted` state that check already owns.
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

module.exports = { checkDragonPursuit, checkDragonGiveUpCue };
