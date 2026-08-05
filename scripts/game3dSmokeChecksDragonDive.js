/**
 * game3dSmokeChecksDragonDive.js — regression guard for `gameplay/dragons.js`'s dive/swoop reaction
 * (run 64, DECISIONS.md ADR-0082).
 *
 * Split into its own file rather than added to `game3dSmokeChecksMovement.js` (already 614/600
 * lines going into this run — see that file's own header for the original split precedent this
 * follows) so this run doesn't grow an already-over-budget file further. `smokeTestGame3D.js` calls
 * this file's export alongside every other check module's.
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
 * `game3dSmokeChecksMovement.js` already use) and asserts:
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

module.exports = { checkDragonDive };
