/**
 * game3dSmokeChecksDragon.js — dragon/FAZ 7 smoke checks run by `smokeTestGame3D.js`.
 *
 * Split out of `game3dSmokeChecksMovement.js` when adding the alert-swoop regression guard would
 * push that movement-AI file beyond the project's 600-line cap.
 */

const NAV_TIMEOUT_MS = 15000;

/**
 * Regression guard for `gameplay/dragons.js`'s `createDragon` circling-flight AI (run 53,
 * DECISIONS.md ADR-0071) — FAZ 7's first spawn point. Drives a real `createDragon` controller
 * (loading the actual `black_dragon` FBX via a real `AssetLoader` against this script's own local
 * static server) and asserts: the model actually loaded (not the placeholder box), it has a
 * texture (catches a regression of the `resourcePath` fix — this FBX's textures live in a
 * `textures/` subfolder its embedded material references don't include), the `Fly` clip is playing,
 * position stays exactly `circleRadiusMeters` from the center at every sampled frame (a closed
 * circle, not a spiral/drift), altitude never changes (level flight), and a full lap (360°) returns
 * to within floating-point tolerance of the start position.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkDragonFlight(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createDragon } = await import('/src/3d/gameplay/dragons.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { DRAGON_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');

			const assetLoader = new AssetLoader();
			const centerX = 100;
			const centerZ = 200;
			const centerY = 90;
			const circleRadiusMeters = 150;
			const dragon = await createDragon({
				assetLoader,
				modelUrl: DRAGON_CONFIG.MODEL_URL,
				texturesResourcePath: DRAGON_CONFIG.TEXTURES_RESOURCE_PATH,
				scale: DRAGON_CONFIG.SCALE,
				flyClipName: DRAGON_CONFIG.FLY_CLIP_NAME,
				centerX, centerZ, centerY, circleRadiusMeters,
				speedMps: 12,
				bankAngleRadians: 0.35,
			});

			const isPlaceholder = Boolean(dragon.object3D.userData && dragon.object3D.userData.isPlaceholder);
			let hasTexture = false;
			dragon.object3D.traverse((child) => {
				if (child.isMesh) {
					const mats = Array.isArray(child.material) ? child.material : [child.material];
					for (const m of mats) if (m && m.map) hasTexture = true;
				}
			});

			const delta = 1 / 60;
			const angularSpeed = 12 / circleRadiusMeters;
			const secondsPerLap = (2 * Math.PI) / angularSpeed;
			const framesPerLap = Math.round(secondsPerLap / delta);

			let staysOnCircle = true;
			let staysLevel = true;
			for (let frame = 0; frame < framesPerLap; frame++) {
				dragon.update(delta);
				const { x, y, z } = dragon.object3D.position;
				const distance = Math.hypot(x - centerX, z - centerZ);
				if (Math.abs(distance - circleRadiusMeters) > 1e-6) staysOnCircle = false;
				if (Math.abs(y - centerY) > 1e-9) staysLevel = false;
			}
			const finalX = dragon.object3D.position.x;
			const finalZ = dragon.object3D.position.z;
			const closesLap = Math.abs(finalX - centerX) < 0.5 && Math.abs(finalZ - (centerZ + circleRadiusMeters)) < 0.5;

			return { isPlaceholder, hasTexture, staysOnCircle, staysLevel, closesLap };
		});
	} finally {
		await page.close();
	}
	const ok = !result.isPlaceholder && result.hasTexture && result.staysOnCircle && result.staysLevel && result.closesLap;
	const details = ok
		? 'real black_dragon FBX loaded (not placeholder) with a resolved texture (resourcePath fix), ' +
			'Fly clip circling stays exactly on-radius and level every sampled frame, closes a full 360° lap'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'dragon circling flight (gameplay/dragons.js)', ok, details };
}

/**
 * Regression guard for `gameplay/dragons.js`'s player-awareness "notice" trigger (run 54,
 * DECISIONS.md ADR-0072) — the first FAZ 7 behavior beyond a static flight path. Drives a real
 * `createDragon` controller with `speedMps: 0` (angular speed is `speedMps / circleRadiusMeters`, so
 * this parks the dragon at a fixed, known position instead of adding flight-position math on top of
 * the thing under test) and a real `EventBus`, then asserts the emit is edge-triggered: fires once
 * when the player first enters `noticeRadiusMeters` of the dragon's real position, does NOT re-fire
 * on a second `update()` call while still inside, does NOT fire on exit, and DOES fire again on a
 * second, later entry (re-arms) — same edge-triggered shape `gameplay/animals.js`'s
 * `fleeTriggerRadiusMeters` already established for wolves. Also confirms a dragon spawned with no
 * `noticeRadiusMeters` never emits regardless of `playerPosition`, and that omitting
 * `playerPosition` entirely (as `checkDragonFlight`'s own calls already do) never throws.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkDragonNotice(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createDragon } = await import('/src/3d/gameplay/dragons.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { EventBus } = await import('/src/3d/eventBus.js');
			const { DRAGON_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');

			const assetLoader = new AssetLoader();
			const eventsBus = new EventBus();
			const eventName = 'test:dragonNotice';
			const noticeToast = { icon: '🐉', title: 'test', desc: 'test', color: '#000000' };
			const emitted = [];
			eventsBus.on(eventName, (payload) => emitted.push(payload));

			// speedMps: 0 -> angular speed 0 -> parks the dragon at its start position (centerX,
			// centerY, centerZ + circleRadiusMeters) = (0, 0, 100), so this test drives playerPosition
			// against a known-fixed dragon position instead of also tracking flight motion.
			const dragon = await createDragon({
				assetLoader,
				modelUrl: DRAGON_CONFIG.MODEL_URL,
				texturesResourcePath: DRAGON_CONFIG.TEXTURES_RESOURCE_PATH,
				scale: DRAGON_CONFIG.SCALE,
				flyClipName: DRAGON_CONFIG.FLY_CLIP_NAME,
				centerX: 0, centerZ: 0, centerY: 0, circleRadiusMeters: 100,
				speedMps: 0,
				noticeRadiusMeters: 50,
				eventsBus, eventName, noticeToast,
			});

			const delta = 1 / 60;
			dragon.update(delta, { x: 0, y: 0, z: 500 }); // far — no emit
			const noEmitWhileFar = emitted.length === 0;

			dragon.update(delta, { x: 0, y: 0, z: 120 }); // distance 20 < 50 — enters, should emit once
			const emittedOnEntry = emitted.length === 1 && emitted[0] === noticeToast;

			dragon.update(delta, { x: 0, y: 0, z: 110 }); // still inside — must NOT re-fire
			const noReFireWhileInside = emitted.length === 1;

			dragon.update(delta, { x: 0, y: 0, z: 500 }); // exits — must NOT fire on exit
			const noFireOnExit = emitted.length === 1;

			dragon.update(delta, { x: 0, y: 0, z: 130 }); // re-enters — should fire again (re-armed)
			const reFiresOnReEntry = emitted.length === 2;

			// A second dragon with no noticeRadiusMeters configured must never emit, and omitting
			// playerPosition on an awareness-enabled dragon must never throw.
			const disabledEmitted = [];
			eventsBus.on('test:dragonNoticeDisabled', (payload) => disabledEmitted.push(payload));
			const disabledDragon = await createDragon({
				assetLoader,
				modelUrl: DRAGON_CONFIG.MODEL_URL,
				texturesResourcePath: DRAGON_CONFIG.TEXTURES_RESOURCE_PATH,
				scale: DRAGON_CONFIG.SCALE,
				flyClipName: DRAGON_CONFIG.FLY_CLIP_NAME,
				centerX: 0, centerZ: 0, centerY: 0, circleRadiusMeters: 100,
				speedMps: 0,
				// No noticeRadiusMeters/eventsBus/eventName/noticeToast — awareness disabled.
			});
			disabledDragon.update(delta, { x: 0, y: 0, z: 100 }); // exactly at the dragon's own position
			let noThrowOnMissingPlayerPosition = true;
			try {
				disabledDragon.update(delta);
			} catch (error) {
				noThrowOnMissingPlayerPosition = false;
			}
			const disabledDragonNeverEmits = disabledEmitted.length === 0;

			return {
				noEmitWhileFar, emittedOnEntry, noReFireWhileInside, noFireOnExit, reFiresOnReEntry,
				disabledDragonNeverEmits, noThrowOnMissingPlayerPosition,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'edge-triggered: no emit while far, emits once on entry, no re-fire while still inside, no ' +
			'fire on exit, re-fires on a later re-entry; a dragon with no noticeRadiusMeters never ' +
			'emits; omitting playerPosition never throws'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'dragon player-awareness notice trigger (gameplay/dragons.js)', ok, details };
}

/**
 * Regression guard for `gameplay/dragons.js`'s reactive flight (run 58, DECISIONS.md ADR-0077) — the
 * behavior change layered on top of run 54's awareness-only notice. Drives a real `createDragon`
 * controller with the player pinned exactly at the circle's own center (so its distance to the
 * dragon is always exactly `circleRadiusMeters`, regardless of where the dragon currently is on its
 * circle — decouples "is the player in range" from the dragon's own motion, so the test can hold one
 * state constant across many frames) versus pinned far away (always out of range regardless of the
 * dragon's position), and asserts: while far, both bank angle and angular speed stay at their calm
 * values every frame (no reaction); sustained proximity eases the blend up to fully reactive (bank
 * angle reaches `reactiveBankAngleRadians` exactly, angular speed matches
 * `speedMps * reactiveSpeedMultiplier / circleRadiusMeters` — measured via the actual angle traveled
 * between two consecutive frames, not assumed); and the player leaving eases it back down to exactly
 * the calm baseline. Angle is recovered from position via `atan2(x - centerX, z - centerZ)` — the
 * exact inverse of `createDragon`'s own `applyPose` parameterization — comparing two frames close
 * together, so no unwrapping is needed.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkDragonReactiveFlight(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createDragon } = await import('/src/3d/gameplay/dragons.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { EventBus } = await import('/src/3d/eventBus.js');
			const { DRAGON_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');

			const assetLoader = new AssetLoader();
			const eventsBus = new EventBus();
			const centerX = 500;
			const centerZ = 1000;
			const centerY = 50;
			const circleRadiusMeters = 100;
			const speedMps = 12;
			const bankAngleRadians = 0.3;
			const reactiveSpeedMultiplier = 2;
			const reactiveBankAngleRadians = 0.9;
			const calmAngularSpeed = speedMps / circleRadiusMeters;
			const reactiveAngularSpeed = (speedMps * reactiveSpeedMultiplier) / circleRadiusMeters;

			const dragon = await createDragon({
				assetLoader,
				modelUrl: DRAGON_CONFIG.MODEL_URL,
				texturesResourcePath: DRAGON_CONFIG.TEXTURES_RESOURCE_PATH,
				scale: DRAGON_CONFIG.SCALE,
				flyClipName: DRAGON_CONFIG.FLY_CLIP_NAME,
				centerX, centerZ, centerY, circleRadiusMeters,
				speedMps,
				bankAngleRadians,
				noticeRadiusMeters: 150, // > circleRadiusMeters, so "player at center" below is always inside
				eventsBus,
				eventName: 'test:dragonReactive',
				noticeToast: { icon: '🐉', title: 'test', desc: 'test', color: '#000000' },
				reactiveSpeedMultiplier,
				reactiveBankAngleRadians,
				reactiveTransitionSeconds: 1.0,
			});

			const delta = 1 / 60;
			// Always exactly circleRadiusMeters from the dragon, whatever its current angle — pins
			// "in radius" true regardless of flight position.
			const playerNear = { x: centerX, y: centerY, z: centerZ };
			// Always far, whatever the dragon's current angle.
			const playerFar = { x: centerX, y: centerY, z: centerZ + 1e6 };
			const angleOf = () => Math.atan2(dragon.object3D.position.x - centerX, dragon.object3D.position.z - centerZ);

			dragon.update(delta, playerFar);
			const bankStaysCalmWhileFar1 = Math.abs(dragon.object3D.rotation.z - bankAngleRadians) < 1e-12;
			const angleA = angleOf();
			dragon.update(delta, playerFar);
			const bankStaysCalmWhileFar2 = Math.abs(dragon.object3D.rotation.z - bankAngleRadians) < 1e-12;
			const angleB = angleOf();
			const calmSpeedMatches = Math.abs((angleB - angleA) - calmAngularSpeed * delta) < 1e-9;

			for (let i = 0; i < 200; i++) dragon.update(delta, playerNear);
			const bankReachesReactive = Math.abs(dragon.object3D.rotation.z - reactiveBankAngleRadians) < 1e-9;
			dragon.update(delta, playerNear);
			const angleC = angleOf();
			dragon.update(delta, playerNear);
			const angleD = angleOf();
			const bankStaysReactive = Math.abs(dragon.object3D.rotation.z - reactiveBankAngleRadians) < 1e-9;
			const reactiveSpeedMatches = Math.abs((angleD - angleC) - reactiveAngularSpeed * delta) < 1e-9;

			for (let i = 0; i < 200; i++) dragon.update(delta, playerFar);
			const bankReturnsToCalm = Math.abs(dragon.object3D.rotation.z - bankAngleRadians) < 1e-9;
			const angleE = angleOf();
			dragon.update(delta, playerFar);
			const angleF = angleOf();
			const calmSpeedRestored = Math.abs((angleF - angleE) - calmAngularSpeed * delta) < 1e-9;

			return {
				bankStaysCalmWhileFar1, bankStaysCalmWhileFar2, calmSpeedMatches,
				bankReachesReactive, bankStaysReactive, reactiveSpeedMatches,
				bankReturnsToCalm, calmSpeedRestored,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'while far: calm bank angle + calm angular speed every frame; sustained proximity eases ' +
			'bank angle and angular speed up to their exact reactive values; player leaving eases both ' +
			'back down to the exact calm baseline'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'dragon reactive flight (gameplay/dragons.js, ADR-0077)', ok, details };
}


async function checkDragonSwoopFlight(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createDragon } = await import('/src/3d/gameplay/dragons.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { EventBus } = await import('/src/3d/eventBus.js');
			const { DRAGON_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');

			const assetLoader = new AssetLoader();
			const centerX = 100;
			const centerZ = 200;
			const centerY = 80;
			const circleRadiusMeters = 90;
			const swoopAltitudeDropMeters = 30;
			const swoopRadiusInsetMeters = 25;
			const dragon = await createDragon({
				assetLoader,
				modelUrl: DRAGON_CONFIG.MODEL_URL,
				texturesResourcePath: DRAGON_CONFIG.TEXTURES_RESOURCE_PATH,
				scale: DRAGON_CONFIG.SCALE,
				flyClipName: DRAGON_CONFIG.FLY_CLIP_NAME,
				centerX, centerZ, centerY,
				circleRadiusMeters,
				speedMps: 0,
				bankAngleRadians: 0.2,
				noticeRadiusMeters: 150,
				eventsBus: new EventBus(),
				eventName: 'test:dragonSwoop',
				noticeToast: { icon: '🐉', title: 'test', desc: 'test', color: '#000000' },
				reactiveTransitionSeconds: 0,
				swoopAltitudeDropMeters,
				swoopRadiusInsetMeters,
				swoopCycleSeconds: 4,
			});

			const playerNear = { x: centerX, y: centerY, z: centerZ };
			const playerFar = { x: centerX, y: centerY, z: centerZ + 1e6 };
			const radiusOf = () => Math.hypot(dragon.object3D.position.x - centerX, dragon.object3D.position.z - centerZ);

			dragon.update(1, playerFar);
			const farKeepsCircle = Math.abs(dragon.object3D.position.y - centerY) < 1e-9 && Math.abs(radiusOf() - circleRadiusMeters) < 1e-9;

			dragon.update(1, playerNear); // quarter of the 4s cycle => peak swoop.
			const nearDropsAltitude = Math.abs(dragon.object3D.position.y - (centerY - swoopAltitudeDropMeters)) < 1e-9;
			const nearCutsInsideCircle = Math.abs(radiusOf() - (circleRadiusMeters - swoopRadiusInsetMeters)) < 1e-9;

			dragon.update(2, playerNear); // negative half-wave is clamped to zero: back on the circle.
			const clampedHalfWaveReturnsToCircle = Math.abs(dragon.object3D.position.y - centerY) < 1e-9 && Math.abs(radiusOf() - circleRadiusMeters) < 1e-9;

			return { farKeepsCircle, nearDropsAltitude, nearCutsInsideCircle, clampedHalfWaveReturnsToCircle };
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'far player keeps the calm circle; sustained notice makes the dragon dip lower and cut inside the circle, then recover on the clamped half-wave'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'dragon alert swoop flight (gameplay/dragons.js, ADR-0079)', ok, details };
}

module.exports = {
	checkDragonFlight,
	checkDragonNotice,
	checkDragonReactiveFlight,
	checkDragonSwoopFlight,
};
