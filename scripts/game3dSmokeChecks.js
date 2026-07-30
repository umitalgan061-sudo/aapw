/**
 * game3dSmokeChecks.js — the individual check functions run by `smokeTestGame3D.js`.
 *
 * Split out of `smokeTestGame3D.js` this run (was 552 lines; adding this run's new
 * `checkNpcPatrol` regression check in-place would have pushed it past this project's 600-line
 * file cap). Mirrors the same "extract into a focused module, moved verbatim" pattern
 * DECISIONS.md ADR-0028 already established for `game3d.js` — the runner (`smokeTestGame3D.js`)
 * keeps only the static-file-server/Playwright-bootstrap infrastructure; every actual browser
 * assertion lives here.
 *
 * Every function here takes `(browser, baseUrl)` and returns `Promise<{name, ok, details}>`. See
 * each function's own comment for what it guards against.
 * @module scripts/game3dSmokeChecks
 */

/** Timeout for a page navigation (`load`/`domcontentloaded`) — asset fetches happen after this. */
const NAV_TIMEOUT_MS = 15000;
/** Timeout for the 3D mode's boot sequence (444 terrain chunks + ~76MB of character/animal
 *  models decoded under SwiftShader software rendering in a headless sandbox can be slow — see
 *  3D_GAME_PROGRESS.md's FPS caveat). Generous on purpose to avoid environment-flaky failures. */
const GAME3D_READY_TIMEOUT_MS = 60000;

/**
 * Navigates to `url` and collects uncaught exceptions / console errors seen during the load.
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @returns {Promise<{page: import('playwright').Page, errors: string[]}>}
 */
async function loadAndCollectErrors(browser, url) {
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
	});
	await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
	return { page, errors };
}

/**
 * Non-blocking: only a failed navigation (empty title) counts against `ok`. Console/page errors
 * are reported for visibility but never fail this check — they trace to this sandbox's
 * external-network restrictions and a pre-existing, unrelated 2D media-asset gap, not to anything
 * a 3D-mode regression could cause.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function check2DShell(browser, baseUrl) {
	const { page, errors } = await loadAndCollectErrors(browser, `${baseUrl}/index.html`);
	const title = await page.title();
	await page.close();
	const ok = title.length > 0;
	const errorNote = errors.length > 0
		? ` (${errors.length} console/page error(s) seen, non-blocking — see file header comment)`
		: '';
	return { name: '2D shell (index.html)', ok, details: `title="${title}"${errorNote}` };
}

/** @returns {Promise<{name: string, ok: boolean, details: string}>} */
async function check3DMode(browser, baseUrl) {
	const { page, errors } = await loadAndCollectErrors(browser, `${baseUrl}/game3d.html`);
	let outcome = 'timeout';
	try {
		const handle = await page.waitForFunction(
			() => {
				const el = document.getElementById('game3d-loading');
				if (!el) return 'missing-element';
				if (el.classList.contains('g3d-loading-hidden')) return 'ready';
				if (el.classList.contains('g3d-loading-error')) return 'error';
				return false;
			},
			{ timeout: GAME3D_READY_TIMEOUT_MS, polling: 250 },
		);
		outcome = await handle.jsonValue();
	} catch (error) {
		outcome = 'timeout';
	}
	await page.close();
	const ok = outcome === 'ready' && errors.length === 0;
	const details = ok
		? 'loading screen hid (GAME_READY phase1-scene), zero console/page errors'
		: `outcome=${outcome}${errors.length ? `, errors: ${errors.join('; ')}` : ''}`;
	return { name: '3D mode (game3d.html)', ok, details };
}

/**
 * Replays ADR-0037's manual collider verification as a persisted, always-run regression check.
 * Runs entirely in-page via dynamic `import()` against the real modules over HTTP (not a separate
 * unit-test harness) so it exercises the exact same module resolution the live game uses.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkSettlementCollider(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createSettlementCollider } = await import('/src/3d/physics.js');
			const { SETTLEMENT_CONFIG } = await import('/src/3d/config.js');

			const seats = [{ id: 'test-castle', x: 1000, z: 500, groundY: 10 }];
			const collider = createSettlementCollider(seats, SETTLEMENT_CONFIG);
			const expectedHalfExtent = SETTLEMENT_CONFIG.KEEP_WIDTH_METERS / 2 + 0.4;

			const center = collider.resolveXZ(1000, 500);
			const centerDist = Math.hypot(center.x - 1000, center.z - 500);
			const centerOk = Math.abs(centerDist - expectedHalfExtent) < 1e-6;

			const far = collider.resolveXZ(5000, 5000);
			const farOk = far.x === 5000 && far.z === 5000;

			let x = 1000;
			let z = 560;
			for (let i = 0; i < 3000; i++) {
				const resolved = collider.resolveXZ(x, z - 0.05);
				x = resolved.x;
				z = resolved.z;
			}
			const walkerDist = Math.hypot(x - 1000, z - 500);
			const walkerOk = Math.abs(walkerDist - expectedHalfExtent) < 1e-6;

			return { centerOk, centerDist, farOk, walkerOk, walkerDist, expectedHalfExtent };
		});
	} finally {
		await page.close();
	}
	const ok = result.centerOk && result.farOk && result.walkerOk;
	const details = ok
		? `castle-center push=${result.centerDist.toFixed(2)}m, far point unchanged, ` +
			`3000-step walker stopped at ${result.walkerDist.toFixed(2)}m (expected ${result.expectedHalfExtent}m)`
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'settlement collider (physics.js)', ok, details };
}

/**
 * Regression guard for `physics.js`'s `integrateJumpArc` (run 36, DECISIONS.md ADR-0039) — FAZ 4's
 * previously-open "no gravity/jump" gap. Runs the same in-page dynamic-`import()` pattern
 * `checkSettlementCollider` above established, stepping the pure function frame-by-frame the same
 * way `gameplay/player.js`'s `update()` does, and checking the resulting arc against the closed-form
 * ballistic-motion formula (peak height `v² / (2·|g|)`, flight time `2v / |g|`) rather than just
 * "it runs without throwing".
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkJumpArc(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { integrateJumpArc } = await import('/src/3d/physics.js');
			const { PLAYER_CONFIG } = await import('/src/3d/config.js');
			const gravity = PLAYER_CONFIG.GRAVITY_MPS2;
			const jumpSpeed = PLAYER_CONFIG.JUMP_SPEED_MPS;
			const delta = 1 / 60;

			// Standing still (never jumped): height/velocity 0 in, must stay grounded at height 0.
			const idle = integrateJumpArc(0, 0, delta, gravity);
			const idleOk = idle.isGrounded && idle.heightAboveGroundMeters === 0 && idle.velocityYMps === 0;

			// A full jump arc, stepped frame-by-frame exactly like `player.js`'s `update()` loop.
			let height = 0;
			let velocity = jumpSpeed;
			let peak = 0;
			let frames = 0;
			let wentNegative = false;
			let landedFrame = -1;
			for (let i = 0; i < 600 && landedFrame === -1; i++) {
				const step = integrateJumpArc(height, velocity, delta, gravity);
				height = step.heightAboveGroundMeters;
				velocity = step.velocityYMps;
				if (height < 0) wentNegative = true;
				if (height > peak) peak = height;
				frames++;
				if (step.isGrounded) landedFrame = frames;
			}

			const expectedPeak = (jumpSpeed * jumpSpeed) / (2 * -gravity);
			const expectedFlightSeconds = (2 * jumpSpeed) / -gravity;
			const expectedFrames = expectedFlightSeconds / delta;
			// Semi-implicit Euler integration (velocity updated before position each step, matching
			// `integrateJumpArc`'s own order) systematically undershoots the true continuous-time
			// peak by a small, delta-dependent amount — not a bug, just discretization error, so the
			// tolerance is wider than a floating-point epsilon on purpose.
			const peakOk = Math.abs(peak - expectedPeak) < 0.1;
			const landedOk = landedFrame > 0 && !wentNegative;
			const frameCountOk = Math.abs(frames - expectedFrames) <= 3;

			return {
				idleOk, peak, expectedPeak, peakOk, landedOk, landedFrame, frames, expectedFrames, frameCountOk,
			};
		});
	} finally {
		await page.close();
	}
	const ok = result.idleOk && result.peakOk && result.landedOk && result.frameCountOk;
	const details = ok
		? `idle stays grounded at 0, peak=${result.peak.toFixed(3)}m (expected ${result.expectedPeak.toFixed(3)}m), ` +
			`landed after ${result.frames} frames (expected ~${result.expectedFrames.toFixed(1)}), never negative`
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'jump/gravity arc (physics.js)', ok, details };
}

/**
 * Regression guard for `gameplay/interaction.js`'s `createInteractionController` (run 36, third
 * chained sub-task, DECISIONS.md ADR-0041). The module has no `THREE`/DOM dependency of its own
 * (its collaborators — `interactionPrompt`/`dialogueBox` — are injected), so this test uses plain
 * fake stubs instead of the real UI modules, same in-page dynamic-`import()` pattern as
 * `checkSettlementCollider`/`checkJumpArc` for real module resolution.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkInteractionController(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createInteractionController } = await import('/src/3d/gameplay/interaction.js');

			function makeFakes() {
				const prompt = { visible: null, setVisible(v) { this.visible = v; } };
				const dialogue = { shown: null, show(text) { this.shown = text; }, hide() { this.shown = null; } };
				const controller = createInteractionController({
					interactionPrompt: prompt,
					dialogueBox: dialogue,
					greetingTemplate: 'Selam, {name}!',
					radiusMeters: 6,
				});
				return { prompt, dialogue, controller };
			}
			const npc = { object3D: { position: { x: 10, z: 0 } }, displayName: 'Test NPC' };
			const near = { x: 10, z: 3 }; // distance 3 < radius 6
			const far = { x: 10, z: 100 }; // distance 100 > radius 6

			const t1 = makeFakes();
			t1.controller.update([npc], far);
			const farHidesPrompt = t1.prompt.visible === false && t1.dialogue.shown === null;

			const t2 = makeFakes();
			t2.controller.update([npc], near);
			const nearShowsPrompt = t2.prompt.visible === true && t2.dialogue.shown === null;

			const t3 = makeFakes();
			t3.controller.update([npc], near);
			t3.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			const eOpensDialogue = t3.dialogue.shown === 'Selam, Test NPC!' && t3.prompt.visible === false;

			const t4 = makeFakes();
			t4.controller.update([npc], near);
			t4.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			t4.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			const eAgainCloses = t4.dialogue.shown === null;

			const t5 = makeFakes();
			t5.controller.update([npc], near);
			t5.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			t5.controller.handleKeyDown({ code: 'Escape', repeat: false });
			const escapeCloses = t5.dialogue.shown === null;

			const t6 = makeFakes();
			t6.controller.update([npc], near);
			t6.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			t6.controller.update([npc], far); // player walked away while dialogue open
			const walkingAwayAutoCloses = t6.dialogue.shown === null;

			const t7 = makeFakes();
			t7.controller.update([npc], near);
			t7.controller.handleKeyDown({ code: 'KeyE', repeat: true }); // held-key repeat, must be ignored
			const repeatIgnored = t7.dialogue.shown === null;

			return {
				farHidesPrompt, nearShowsPrompt, eOpensDialogue, eAgainCloses, escapeCloses,
				walkingAwayAutoCloses, repeatIgnored,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'far hides prompt, near shows it, E opens/closes, Escape closes, walking away auto-closes, key-repeat ignored'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'interaction controller (gameplay/interaction.js)', ok, details };
}

/**
 * Regression guard for `gameplay/animals.js`'s `createWolf` flee/pack-alert logic (run 29/30,
 * DECISIONS.md ADR-0029/ADR-0030). Drives 3 real `createWolf` controllers (loading the actual
 * `Wolf-Blender-2.82a.glb` via a real `AssetLoader` against this script's own local static server —
 * the same file `check3DMode`'s full boot already loads 3 copies of, so this adds no new asset) with
 * a fake `groundCollider` and directly-controlled `packmateFleePositions` arguments, replaying
 * ADR-0030's exact chain scenario: wolf1 flees the player directly; wolf2 (out of the player's own
 * trigger radius, but within pack range of wolf1) pack-flees one frame later; wolf3 (out of pack
 * range of wolf1, but within pack range of wolf2) only pack-flees a further frame after that — plus
 * ADR-0030's negative control and ADR-0029's core design assertion that a pack-alerted wolf flees
 * *away from the player*, not away from the packmate that alerted it.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkWolfPackAlert(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createWolf } = await import('/src/3d/gameplay/animals.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { ANIMAL_CONFIG } = await import('/src/3d/config.js');

			const assetLoader = new AssetLoader();
			const groundCollider = { getGroundHeight: () => 10 };
			const delta = 1 / 60;

			/** @param {number} worldX @param {number} worldZ */
			function spawnWolf(worldX, worldZ, name) {
				return createWolf({
					assetLoader,
					modelUrl: ANIMAL_CONFIG.WOLF_MODEL_URL,
					idleClipName: ANIMAL_CONFIG.IDLE_CLIP_NAME,
					stripChildNames: ANIMAL_CONFIG.STRIP_CHILD_NAMES,
					worldX,
					worldZ,
					groundY: 10,
					name,
					groundCollider,
					fleeClipName: ANIMAL_CONFIG.FLEE_CLIP_NAME,
					fleeTriggerRadiusMeters: ANIMAL_CONFIG.FLEE_TRIGGER_RADIUS_METERS,
					fleeSpeedMps: ANIMAL_CONFIG.FLEE_SPEED_MPS,
					packAlertRadiusMeters: ANIMAL_CONFIG.PACK_ALERT_RADIUS_METERS,
				});
			}

			// wolf1-wolf2 = 18m (inside the 20m pack radius), wolf1-wolf3 = 34m (outside),
			// wolf2-wolf3 = 16m (inside) — the only path from the player to wolf3 is via wolf2.
			const wolf1 = await spawnWolf(10, 0, 'test-wolf-1');
			const wolf2 = await spawnWolf(10, 18, 'test-wolf-2');
			const wolf3 = await spawnWolf(10, 34, 'test-wolf-3');
			const player = { x: 0, z: 0 }; // 10m from wolf1 (<15m trigger), ~20.6m from wolf2, ~35.1m from wolf3.

			// Baseline: nobody has ever been near the player or a fleeing packmate.
			wolf1.update(delta, { x: 5000, z: 5000 }, []);
			wolf2.update(delta, { x: 5000, z: 5000 }, []);
			wolf3.update(delta, { x: 5000, z: 5000 }, []);
			const baselineCalm = !wolf1.isFleeing && !wolf2.isFleeing && !wolf3.isFleeing;

			// Frame 1: player approaches wolf1 only. wolf2/wolf3 get no packmate positions yet.
			const wolf2StartX = wolf2.object3D.position.x;
			wolf1.update(delta, player, []);
			wolf2.update(delta, player, []);
			wolf3.update(delta, player, []);
			const wolf1FleesDirect = wolf1.isFleeing;
			const wolf2CalmFrame1 = !wolf2.isFleeing;
			const wolf3CalmFrame1 = !wolf3.isFleeing;

			// Frame 2: wolf2 now told wolf1 is fleeing (within its 20m pack radius) -> should pack-flee.
			// wolf3 is only told about wolf1 (34m away, outside range) -> negative control, must stay calm.
			const wolf1Position = { x: wolf1.object3D.position.x, z: wolf1.object3D.position.z };
			wolf2.update(delta, player, [wolf1Position]);
			wolf3.update(delta, player, [wolf1Position]);
			const wolf2PackFlees = wolf2.isFleeing;
			const wolf2FleesAwayFromPlayer = wolf2.object3D.position.x > wolf2StartX; // away from player (0,0), not away from wolf1 (same x as wolf2 — that path wouldn't move x at all)
			const wolf3StaysCalmOnOutOfRangePackmate = !wolf3.isFleeing;

			// Frame 3: wolf3 now told wolf2 is fleeing (16m away, inside range) -> chain completes.
			const wolf2Position = { x: wolf2.object3D.position.x, z: wolf2.object3D.position.z };
			wolf3.update(delta, player, [wolf2Position]);
			const wolf3ChainFlees = wolf3.isFleeing;

			return {
				baselineCalm, wolf1FleesDirect, wolf2CalmFrame1, wolf3CalmFrame1, wolf2PackFlees,
				wolf2FleesAwayFromPlayer, wolf3StaysCalmOnOutOfRangePackmate, wolf3ChainFlees,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'baseline calm, direct flee, pack-flee chains wolf1->wolf2->wolf3 one hop/frame, ' +
			'flee direction stays player-relative, out-of-range packmate correctly ignored'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'wolf flee/pack-alert (gameplay/animals.js)', ok, details };
}

/**
 * Regression guard for `gameplay/npc.js`'s `createNPC` waypoint-patrol logic (run 22, DECISIONS.md
 * ADR-0021) — the movement/pause/ground-resample/turn behavior all 11+ patrolling NPCs (and, via
 * the copied-not-shared pattern ADR-0026 documents, `gameplay/animals.js`'s wolves) depend on had
 * zero persisted coverage until now — only ever eyeballed live in a running scene. Same in-page
 * dynamic-`import()` pattern as `checkWolfPackAlert`, driving one real `createNPC` controller
 * (loading an actual downloaded Mixamo FBX via a real `AssetLoader`) through the exact 2-waypoint
 * shape `gameplay/npc.js`'s own `spawnConfiguredNPCs` builds: `patrolWaypoints[0]` equal to the
 * spawn position itself, `patrolWaypoints[1]` the real far point.
 *
 * Originally surfaced (and, for one run, merely documented) a timing quirk: `update()`'s
 * `pauseTimer` used to start pre-loaded to `pauseSeconds` unconditionally, before the first
 * distance-to-waypoint check ever ran — so every patrolling NPC idled a full `pauseSeconds`,
 * "arrived" at waypoint 0 (its own spawn point — a no-op), idled a *second* full `pauseSeconds`,
 * and only then took its first real step. Fixed run 38 (DECISIONS.md ADR-0045) — `pauseTimer` now
 * starts at 0, so the zero-distance "arrival" at waypoint 0 resolves immediately on the first
 * `update()` call and the real `pauseSeconds` dwell only happens once, same as every later lap.
 * This check asserts the fixed (single-pause-cycle) timing directly.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkNpcPatrol(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createNPC } = await import('/src/3d/gameplay/npc.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { NPC_CONFIG } = await import('/src/3d/config.js');

			const assetLoader = new AssetLoader();
			// Height varies with z so ground-resampling during the walk (not just at spawn/waypoints)
			// is actually observable, not just coincidentally correct.
			const groundCollider = { getGroundHeight: (x, z) => 5 + z * 0.1 };
			const delta = 1 / 60;

			const npc = await createNPC({
				assetLoader,
				modelUrl: NPC_CONFIG.SPAWNS[0].modelUrl,
				idleAnimationUrl: NPC_CONFIG.IDLE_ANIMATION_URL,
				walkAnimationUrl: NPC_CONFIG.WALK_ANIMATION_URL,
				worldX: 0,
				worldZ: 0,
				groundY: groundCollider.getGroundHeight(0, 0),
				groundCollider,
				// Matches `spawnConfiguredNPCs`'s own shape: waypoint 0 is the spawn point itself.
				patrolWaypoints: [{ x: 0, z: 0 }, { x: 10, z: 10 }],
				speedMps: NPC_CONFIG.PATROL_SPEED_MPS,
				pauseSeconds: NPC_CONFIG.PATROL_PAUSE_SECONDS,
				turnRateRadiansPerSecond: NPC_CONFIG.PATROL_TURN_RATE_RADIANS_PER_SECOND,
			});

			// Advance frame-by-frame until the NPC actually leaves (0, 0). A generous cap (1 pause
			// cycle + 1 extra second) bounds the loop.
			const maxIdleFrames = Math.ceil((NPC_CONFIG.PATROL_PAUSE_SECONDS + 1) / delta);
			let idleFrames = 0;
			while (idleFrames < maxIdleFrames && npc.object3D.position.x === 0 && npc.object3D.position.z === 0) {
				npc.update(delta);
				idleFrames++;
			}
			const startedMoving = npc.object3D.position.x > 0 || npc.object3D.position.z > 0;
			const idleSecondsBeforeMove = idleFrames * delta;
			const expectedIdleSeconds = NPC_CONFIG.PATROL_PAUSE_SECONDS;
			// Loose tolerance (5 frames) — this asserts "roughly 1 pause cycle", not frame-perfect
			// timing, since the exact frame the float `pauseTimer` crosses 0 isn't the point being
			// guarded here.
			const idleDurationOk = Math.abs(idleSecondsBeforeMove - expectedIdleSeconds) <= delta * 5;

			// Mid-walk sample: ground height must track the NPC's real x/z, not stay frozen at spawn.
			const midWalkExpectedY = groundCollider.getGroundHeight(npc.object3D.position.x, npc.object3D.position.z);
			const midWalkYTracksGround = Math.abs(npc.object3D.position.y - midWalkExpectedY) < 1e-9;

			// Walk the rest of the way to (10, 10) — generous frame cap well above the ~606-frame
			// expected distance/speed/delta (14.14m / 1.4mps / (1/60)s).
			let arriveFrames = 0;
			while (
				arriveFrames < 5000 &&
				!(npc.object3D.position.x === 10 && npc.object3D.position.z === 10)
			) {
				npc.update(delta);
				arriveFrames++;
			}
			const arrivedExactly = npc.object3D.position.x === 10 && npc.object3D.position.z === 10;
			const finalYTracksGround = Math.abs(npc.object3D.position.y - groundCollider.getGroundHeight(10, 10)) < 1e-9;
			// Direction of travel was (10, 10) from (0, 0) -> targetYaw = atan2(10, 10) = PI/4. The
			// turn-rate-limited lerp should have converged close to it by the time it arrives.
			const expectedYaw = Math.PI / 4;
			const turnedTowardTravel = Math.abs(npc.object3D.rotation.y - expectedYaw) < 0.05;

			return {
				startedMoving, idleDurationOk, midWalkYTracksGround,
				arrivedExactly, finalYTracksGround, turnedTowardTravel,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'idles exactly 1 pause cycle before first lap, ground height resamples mid-walk, ' +
			'arrives exactly at target with correct final height and turned toward travel direction'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'NPC waypoint patrol (gameplay/npc.js)', ok, details };
}

/**
 * Regression guard for `gameplay/animals.js`'s `createWolf` waypoint-patrol movement (run 27,
 * DECISIONS.md ADR-0026) — as opposed to `checkWolfPackAlert` above, which already covers its
 * flee/pack-alert behavior. `patrolWaypoints` handling was copied (not shared) from
 * `gameplay/npc.js`'s `checkNpcPatrol`-covered logic, so this replays the same scenario shape on a
 * real `createWolf` controller with flee disabled (no `fleeClipName`/`fleeTriggerRadiusMeters`
 * passed, so `canFlee` is false and the patrol branch is the only one that can ever run) —
 * confirming the copy stayed behaviorally identical to its already-tested original, not just that
 * it compiles — including the run-38 `pauseTimer`-starts-at-0 fix (DECISIONS.md ADR-0045), applied
 * to this file identically to `gameplay/npc.js`'s.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkWolfPatrol(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createWolf } = await import('/src/3d/gameplay/animals.js');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { ANIMAL_CONFIG } = await import('/src/3d/config.js');

			const assetLoader = new AssetLoader();
			const groundCollider = { getGroundHeight: (x, z) => 5 + z * 0.1 };
			const delta = 1 / 60;

			const wolf = await createWolf({
				assetLoader,
				modelUrl: ANIMAL_CONFIG.WOLF_MODEL_URL,
				idleClipName: ANIMAL_CONFIG.IDLE_CLIP_NAME,
				stripChildNames: ANIMAL_CONFIG.STRIP_CHILD_NAMES,
				worldX: 0,
				worldZ: 0,
				groundY: groundCollider.getGroundHeight(0, 0),
				groundCollider,
				walkClipName: ANIMAL_CONFIG.WALK_CLIP_NAME,
				// Matches `spawnConfiguredAnimals`'s own shape: waypoint 0 is the spawn point itself.
				patrolWaypoints: [{ x: 0, z: 0 }, { x: 10, z: 10 }],
				speedMps: ANIMAL_CONFIG.PATROL_SPEED_MPS,
				pauseSeconds: ANIMAL_CONFIG.PATROL_PAUSE_SECONDS,
				turnRateRadiansPerSecond: ANIMAL_CONFIG.PATROL_TURN_RATE_RADIANS_PER_SECOND,
				// No fleeClipName/fleeTriggerRadiusMeters -> canFlee is false; update()'s flee branch
				// can never trigger even if a playerPosition were passed (it never is here).
			});

			// Single-pause-cycle timing, same fix as `checkNpcPatrol` — this is the copied (not shared)
			// code path, so it inherits the fix identically.
			const maxIdleFrames = Math.ceil((ANIMAL_CONFIG.PATROL_PAUSE_SECONDS + 1) / delta);
			let idleFrames = 0;
			while (idleFrames < maxIdleFrames && wolf.object3D.position.x === 0 && wolf.object3D.position.z === 0) {
				wolf.update(delta);
				idleFrames++;
			}
			const startedMoving = wolf.object3D.position.x > 0 || wolf.object3D.position.z > 0;
			const idleSecondsBeforeMove = idleFrames * delta;
			const expectedIdleSeconds = ANIMAL_CONFIG.PATROL_PAUSE_SECONDS;
			const idleDurationOk = Math.abs(idleSecondsBeforeMove - expectedIdleSeconds) <= delta * 5;

			const midWalkExpectedY = groundCollider.getGroundHeight(wolf.object3D.position.x, wolf.object3D.position.z);
			const midWalkYTracksGround = Math.abs(wolf.object3D.position.y - midWalkExpectedY) < 1e-9;
			const notFleeingDuringPatrol = !wolf.isFleeing;

			let arriveFrames = 0;
			while (
				arriveFrames < 5000 &&
				!(wolf.object3D.position.x === 10 && wolf.object3D.position.z === 10)
			) {
				wolf.update(delta);
				arriveFrames++;
			}
			const arrivedExactly = wolf.object3D.position.x === 10 && wolf.object3D.position.z === 10;
			const finalYTracksGround = Math.abs(wolf.object3D.position.y - groundCollider.getGroundHeight(10, 10)) < 1e-9;
			const expectedYaw = Math.PI / 4;
			const turnedTowardTravel = Math.abs(wolf.object3D.rotation.y - expectedYaw) < 0.05;

			return {
				startedMoving, idleDurationOk, midWalkYTracksGround, notFleeingDuringPatrol,
				arrivedExactly, finalYTracksGround, turnedTowardTravel,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'idles exactly 1 pause cycle before first lap (same fix as NPC patrol), never flees with no ' +
			'flee config, ground height resamples mid-walk, arrives exactly at target, turned toward travel'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'wolf waypoint patrol (gameplay/animals.js)', ok, details };
}

module.exports = {
	check2DShell,
	check3DMode,
	checkSettlementCollider,
	checkJumpArc,
	checkInteractionController,
	checkWolfPackAlert,
	checkNpcPatrol,
	checkWolfPatrol,
};
