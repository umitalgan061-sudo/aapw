/**
 * game3dSmokeChecksMovement.js — ground-movement AI check functions run by `smokeTestGame3D.js`:
 * waypoint patrol and flee/pack-alert for the entities that walk on the terrain (wolves, NPCs).
 *
 * Originally split out of `game3dSmokeChecks.js` (run 40, was 596/600 lines) — same "extract into a
 * focused module, moved verbatim" pattern `game3dSmokeChecksScene.js` used, see DECISIONS.md ADR-0028
 * for the original precedent. Three dragon flight checks later accreted here and pushed this file to
 * 614 lines, over the 600-line cap (GOVERNANCE.md Altın Kural 7); run 68 (DECISIONS.md ADR-0087) moved
 * them out verbatim into `game3dSmokeChecksDragonFlight.js`, which both cleared the violation and
 * restored this file to the ground-movement scope its header always described. Flying entities are
 * now covered entirely by the two `...DragonFlight`/`...DragonDive` modules.
 *
 * Sibling check modules: `game3dSmokeChecksScene.js` (page/scene boot), `game3dSmokeChecks.js`
 * (non-movement per-entity gameplay: settlement collider, jump arc, interaction),
 * `game3dSmokeChecksDragonFlight.js` (dragon circling/notice/reactive flight),
 * `game3dSmokeChecksDragonDive.js` (dragon dive + continuous chase). `smokeTestGame3D.js` calls every
 * module's exports — see its own comment for the combined check list.
 *
 * Every function here takes `(browser, baseUrl)` and returns `Promise<{name, ok, details}>`. See
 * each function's own comment for what it guards against.
 * @module scripts/game3dSmokeChecksMovement
 */

/** Timeout for a page navigation (`domcontentloaded`) — asset fetches happen after this. Same
 * value/convention as `game3dSmokeChecks.js`'s/`game3dSmokeChecksScene.js`'s own copies; duplicated
 * rather than shared/imported across the sibling check files since it's a single primitive with no
 * other state. */
const NAV_TIMEOUT_MS = 15000;

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
			const { ANIMAL_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');

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
			const { NPC_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');

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
			const { ANIMAL_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');

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
	checkWolfPackAlert,
	checkNpcPatrol,
	checkWolfPatrol,
};
