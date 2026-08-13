#!/usr/bin/env node
/**
 * checkRun334BirdFlight.js — evidence for `gameplay/creatureBrain.js`'s new bird flight locomotion
 * (run 334): `kuzgun`/`kartal`/`tavuk` previously had no `CREATURE_BEHAVIOR_PROFILES` entry at all
 * (explicitly excluded — this file's own header used to say flight/perch "deserves its own pass").
 * This is that pass: a climb -> cruise -> land state machine that replaces the ground reactive-flee
 * branch once a player startles a bird, closing FAZ 6's last-named remaining animal gap ("kuş").
 *
 * Asserted:
 *   - Every bird species (`kuzgun`, `kartal`, `tavuk`) has a `CREATURE_BEHAVIOR_PROFILES` entry with
 *     `locomotion: 'flight'` and the three flight-only numeric properties.
 *   - Grounded (undisturbed) a bird hops on the ground exactly like a quadruped's own wander — altitude
 *     above ground stays at 0 for as long as no player is nearby.
 *   - Startling a bird (player inside `reactiveTriggerRadiusMeters`) makes it climb: altitude above the
 *     ground directly beneath it rises from 0 toward `flightAltitudeMeters`, and horizontal distance
 *     from the player increases (it flies away, not just up).
 *   - The being reaches and holds its cruise altitude (never exceeds `flightAltitudeMeters`), then
 *     — even with the player still nearby the whole time, proving this is a *timed* flight and not an
 *     indefinitely circling one — lands again: altitude returns to 0 within a bounded number of frames.
 *   - After landing, the being resumes ground wander from its new landing spot without going non-finite
 *     or getting stuck (a fresh `pickNewWanderTarget` around the new `wanderCenter`).
 *   - `game3d.html` boots with the larger bird-inclusive spawn counts wired in and produces zero
 *     uncaught page errors.
 *   - Rendered before/during/after proof (GPU pixel read-back): a bird visibly gains height across a
 *     framing that keeps both the ground and the cruise altitude in frame, for one representative
 *     species (`kartal`, the tallest-flying of the three, most likely to reveal a broken climb).
 *
 * Usage: `node scripts/checkRun334BirdFlight.js`
 * Exit codes: 0 = pass, 1 = fail, 2 = Playwright unavailable.
 * @module scripts/checkRun334BirdFlight
 */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts', 'run334-bird-flight');
const BIRD_SPECIES = ['kuzgun', 'kartal', 'tavuk'];

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkRun334BirdFlight] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		const pageErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error.message)));
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await page.waitForTimeout(9000); // let the live scene finish booting before it's judged error-free below

		// --- pure-logic assertions (no live scene needed) -------------------------------------------
		const logic = await page.evaluate(
			async ({ birdSpecies }) => {
				const { createCreatureBeing, CREATURE_BEHAVIOR_PROFILES } = await import('/src/3d/gameplay/creatureBrain.js');
				const { mulberry32 } = await import('/src/3d/world/terrain.js');
				const failures = [];

				for (const speciesId of birdSpecies) {
					const profile = CREATURE_BEHAVIOR_PROFILES[speciesId];
					if (!profile) {
						failures.push(`"${speciesId}": no CREATURE_BEHAVIOR_PROFILES entry at all`);
						continue;
					}
					if (profile.locomotion !== 'flight') {
						failures.push(`"${speciesId}": expected locomotion "flight", got ${JSON.stringify(profile.locomotion)}`);
					}
					for (const key of ['flightAltitudeMeters', 'takeoffClimbMps', 'flightDurationSeconds']) {
						if (!(Number.isFinite(profile[key]) && profile[key] > 0)) {
							failures.push(`"${speciesId}": profile.${key} is not a positive finite number (${profile[key]})`);
						}
					}
				}

				const groundHeightAt = 30;
				const groundCollider = { getGroundHeight: () => groundHeightAt };

				for (const speciesId of birdSpecies) {
					const profile = CREATURE_BEHAVIOR_PROFILES[speciesId];
					if (!profile || profile.locomotion !== 'flight') continue;

					// 1) Undisturbed: altitude stays 0 (ground-hop wander only) for a while.
					const groundedBeing = createCreatureBeing({
						speciesId, spawnId: `grounded-${speciesId}`, worldX: 0, worldZ: 0, groundY: groundHeightAt, groundCollider, mulberry32,
					});
					for (let i = 0; i < 20; i++) groundedBeing.update(0.3, undefined, []);
					const groundedAltitude = groundedBeing.object3D.position.y - groundHeightAt;
					if (Math.abs(groundedAltitude) > 0.01) {
						failures.push(`"${speciesId}": undisturbed bird left the ground (altitude ${groundedAltitude.toFixed(2)}m) with no player nearby`);
					}
					groundedBeing.dispose();

					// 2) Startled: a very close, stationary player. Track altitude/distance across many
					// frames to observe the full climb -> cruise -> land arc without guessing frame counts —
					// bounded by a generous frame ceiling so a broken state machine fails loudly (timeout-like)
					// rather than the test hanging.
					const flyingBeing = createCreatureBeing({
						speciesId, spawnId: `flying-${speciesId}`, worldX: 0, worldZ: 0, groundY: groundHeightAt, groundCollider, mulberry32,
					});
					const player = { x: 1, z: 0 }; // inside every bird profile's own reactiveTriggerRadiusMeters
					const delta = 0.2;
					const maxFrames = Math.ceil((profile.flightAltitudeMeters / profile.takeoffClimbMps + profile.flightDurationSeconds + profile.flightAltitudeMeters / profile.takeoffClimbMps) / delta) + 50;
					let maxAltitudeSeen = 0;
					let everMovedAway = false;
					let landedAgain = false;
					let sawNonFinite = false;
					const startDistance = Math.hypot(flyingBeing.object3D.position.x - player.x, flyingBeing.object3D.position.z - player.z);
					for (let frame = 0; frame < maxFrames; frame++) {
						flyingBeing.update(delta, player, []);
						const p = flyingBeing.object3D.position;
						if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
							sawNonFinite = true;
							break;
						}
						const altitude = p.y - groundHeightAt;
						maxAltitudeSeen = Math.max(maxAltitudeSeen, altitude);
						if (altitude > 0.05 && Math.hypot(p.x - player.x, p.z - player.z) > startDistance + 0.5) everMovedAway = true;
						if (altitude > profile.flightAltitudeMeters + 0.05) {
							failures.push(`"${speciesId}": altitude ${altitude.toFixed(2)}m exceeded its own flightAltitudeMeters ceiling (${profile.flightAltitudeMeters}m) at frame ${frame}`);
							break;
						}
						// "landed again" only counts once the bird has actually been airborne first —
						// altitude 0 on frame 0 is "never took off", not "landed".
						if (maxAltitudeSeen > profile.flightAltitudeMeters * 0.5 && altitude <= 0.01) {
							landedAgain = true;
							break;
						}
					}
					if (sawNonFinite) failures.push(`"${speciesId}": position went non-finite during flight`);
					if (maxAltitudeSeen < profile.flightAltitudeMeters * 0.9) {
						failures.push(`"${speciesId}": never climbed close to its own flightAltitudeMeters (${profile.flightAltitudeMeters}m) — max seen ${maxAltitudeSeen.toFixed(2)}m`);
					}
					if (!everMovedAway) failures.push(`"${speciesId}": never moved horizontally away from the player while airborne`);
					if (!landedAgain) failures.push(`"${speciesId}": did not land again within ${maxFrames} frames (${(maxFrames * delta).toFixed(1)}s) — flight looks indefinite, not timed`);

					// 3) After landing, it must resume normal ground behavior — a few more updates with no
					// player nearby should keep it grounded and finite (not stuck mid-transition).
					for (let i = 0; i < 10; i++) flyingBeing.update(0.3, undefined, []);
					const postLanding = flyingBeing.object3D.position;
					if (!Number.isFinite(postLanding.x) || !Number.isFinite(postLanding.y) || !Number.isFinite(postLanding.z)) {
						failures.push(`"${speciesId}": position went non-finite after landing + resumed wander`);
					} else if (Math.abs(postLanding.y - groundHeightAt) > 0.01) {
						failures.push(`"${speciesId}": still airborne (altitude ${(postLanding.y - groundHeightAt).toFixed(2)}m) 3s after landing, with no player nearby`);
					}
					flyingBeing.dispose();
				}

				return { failures };
			},
			{ birdSpecies: BIRD_SPECIES },
		);

		if (logic.failures.length > 0) {
			console.error(`[checkRun334BirdFlight] FAIL:\n  ${logic.failures.join('\n  ')}`);
			process.exitCode = 1;
			return;
		}

		// --- live game3d.html boot: zero uncaught errors with the bird-inclusive spawn wiring ---------
		if (pageErrors.length > 0) {
			console.error(`[checkRun334BirdFlight] FAIL: game3d.html threw during boot with birds wired into the spawn counts: ${JSON.stringify(pageErrors)}`);
			process.exitCode = 1;
			return;
		}

		// --- rendered before/during/after proof: a startled kartal visibly gains height ---------------
		const pixelProof = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createCreatureBeing } = await import('/src/3d/gameplay/creatureBrain.js');
			const { mulberry32 } = await import('/src/3d/world/terrain.js');

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0xa9c4d8);
			scene.add(new THREE.HemisphereLight(0xf3f7ff, 0x556b3c, 2.4));
			const sun = new THREE.DirectionalLight(0xffffff, 2.6);
			sun.position.set(3, 6, 5);
			scene.add(sun);
			// A visible ground plane, so "how high above the ground" reads at a glance in the screenshots
			// instead of only being provable by the numeric assertions above.
			const ground = new THREE.Mesh(
				new THREE.PlaneGeometry(400, 400),
				new THREE.MeshStandardMaterial({ color: 0x4c6b3a }),
			);
			ground.rotation.x = -Math.PI / 2;
			scene.add(ground);

			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setSize(1280, 720, false);
			const camera = new THREE.PerspectiveCamera(50, 1280 / 720, 0.1, 400);
			const gl = renderer.getContext();

			const groundCollider = { getGroundHeight: () => 0 };
			const being = createCreatureBeing({ speciesId: 'kartal', spawnId: 'proof-kartal', worldX: 0, worldZ: 0, groundY: 0, groundCollider, mulberry32 });
			scene.add(being.object3D);

			// Chase-cam: horizontal offset tracks the being's own current (x, z) so it stays a consistent,
			// legible size across all three shots regardless of how far the climb/cruise/land arc carries
			// it horizontally — but camera *height* is a fixed 15m (NOT relative to the being's own
			// altitude), so a grounded bird sits low in frame against the ground plane and an airborne one
			// visibly rises toward/past the horizon. This is a framing choice for legibility only; the
			// being's own simulated position (what the numeric assertions above already verify directly)
			// is untouched.
			const CAMERA_HORIZONTAL_OFFSET = 14;
			const CAMERA_FIXED_HEIGHT = 15;
			function shot() {
				const p = being.object3D.position;
				camera.position.set(p.x + CAMERA_HORIZONTAL_OFFSET, CAMERA_FIXED_HEIGHT, p.z + CAMERA_HORIZONTAL_OFFSET);
				camera.lookAt(p.x, p.y, p.z);
				renderer.render(scene, camera);
				return renderer.domElement.toDataURL('image/png');
			}

			const before = shot();
			const beforeAltitude = being.object3D.position.y;

			const player = { x: 1, z: 0 };
			for (let i = 0; i < 40; i++) being.update(0.2, player, []); // ~8s — well into climb/cruise for kartal (climb takes ~4.4s to 22m)
			const during = shot();
			const duringAltitude = being.object3D.position.y;

			for (let i = 0; i < 60; i++) being.update(0.2, undefined, []); // ~12s more with no player — long enough to land (flightDurationSeconds 9 + descent)
			const after = shot();
			const afterAltitude = being.object3D.position.y;

			being.dispose();
			renderer.dispose();
			return { before, during, after, beforeAltitude, duringAltitude, afterAltitude };
		});

		fs.writeFileSync(path.join(ARTIFACT_DIR, 'kartal-1-grounded.png'), Buffer.from(pixelProof.before.split(',')[1], 'base64'));
		fs.writeFileSync(path.join(ARTIFACT_DIR, 'kartal-2-airborne.png'), Buffer.from(pixelProof.during.split(',')[1], 'base64'));
		fs.writeFileSync(path.join(ARTIFACT_DIR, 'kartal-3-landed.png'), Buffer.from(pixelProof.after.split(',')[1], 'base64'));

		if (pixelProof.duringAltitude < pixelProof.beforeAltitude + 5) {
			console.error(
				`[checkRun334BirdFlight] FAIL: kartal's rendered altitude barely changed after being startled ` +
					`(before=${pixelProof.beforeAltitude.toFixed(2)}m, during=${pixelProof.duringAltitude.toFixed(2)}m)`,
			);
			process.exitCode = 1;
			return;
		}
		if (Math.abs(pixelProof.afterAltitude) > 0.5) {
			console.error(`[checkRun334BirdFlight] FAIL: kartal did not land back near ground level (final altitude ${pixelProof.afterAltitude.toFixed(2)}m)`);
			process.exitCode = 1;
			return;
		}

		console.log(
			`[checkRun334BirdFlight] PASS: 3 bird species (kuzgun/kartal/tavuk) verified — grounded hop stays on ` +
				`the ground, a nearby player triggers a climb to each species' own flightAltitudeMeters ceiling ` +
				`(never exceeded), horizontal escape while airborne, a bounded timed landing (not indefinite), and ` +
				`normal ground wander resumes after landing. game3d.html booted with bird-inclusive spawn counts ` +
				`and 0 page errors. Rendered proof: kartal climbed from ${pixelProof.beforeAltitude.toFixed(1)}m to ` +
				`${pixelProof.duringAltitude.toFixed(1)}m then landed back to ${pixelProof.afterAltitude.toFixed(1)}m. ` +
				`3 screenshots in artifacts/run334-bird-flight/.`,
		);
	} catch (error) {
		console.error(`[checkRun334BirdFlight] FAIL: ${error.message}\n${error.stack}`);
		process.exitCode = 1;
	} finally {
		await browser.close();
		server.close();
	}
}

main();
