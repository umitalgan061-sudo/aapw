#!/usr/bin/env node
/**
 * checkRun327CreatureGait.js — ADR-0273 evidence: `gameplay/creatureGait.js` actually poses every
 * one of run 326's 19 procedural rigs through both its `restGait` and `alertGait`, and the pose is a
 * pure, deterministic function of elapsed time.
 *
 * Asserted, per species x gait (38 combinations = 19 species x {restGait, alertGait}):
 *   - every rotation `applyCreatureGait` writes is a finite number (no NaN/Infinity from a divide
 *     or an unresolved lookup falling through to `undefined`);
 *   - the driven leg bones actually move over one stride cycle (a `flap` gait is the one deliberate
 *     exception — legs stay tucked at bind pose, only wings move);
 *   - determinism: the same species+gait+`elapsedSeconds` always produces byte-identical rotations,
 *     called twice independently (GOVERNANCE.md §8.9's procedural-regression contract, applied to an
 *     animation driver instead of a world generator);
 *   - `resetCreatureGaitPose` returns every touched bone to exactly zero rotation;
 *   - no rotation exceeds a sane amplitude bound — the assertion that would catch a runaway gait
 *     constant before it ever reaches a screenshot.
 *
 * Plus a real GPU pixel read-back (same technique run325's water-swell evidence used) proving a
 * walking/flying pose visibly differs from its own mid-cycle pose — the assertion that separates
 * "the function runs without crashing" from "the creature is actually moving" — and a rendered
 * before/after screenshot pair for one representative species per archetype (GOVERNANCE.md §8.5: at
 * least two views, before/after).
 *
 * Usage: `node scripts/checkRun327CreatureGait.js`
 * Exit codes: 0 = pass, 1 = fail, 2 = Playwright unavailable.
 * @module scripts/checkRun327CreatureGait
 */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts', 'run327-creature-gait');
/** One representative species per archetype, for the rendered visual proof. */
const REPRESENTATIVES = { quadruped: 'kurt', biped: 'asker', bird: 'kartal' };

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkRun327CreatureGait] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
		const pageErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error.message)));
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });

		const result = await page.evaluate(async ({ representatives }) => {
			const { createCreatureRig } = await import('/src/3d/gameplay/creatureRig.js');
			const { CREATURE_BODY_PLAN_IDS, CREATURE_BODY_PLANS } = await import('/src/3d/gameplay/creatureBodyPlans.js');
			const { applyCreatureGait, resetCreatureGaitPose, GAIT_LEG_PHASES } = await import(
				'/src/3d/gameplay/creatureGait.js'
			);
			const failures = [];
			const summary = [];
			// Generous — this is a runaway-constant guard, not a feel judgement (that's the open
			// QUESTIONS_FOR_OWNER.md calibration question this run logs).
			const MAX_ROTATION_RADIANS = 1.8;

			function allBoneRotations(rig) {
				const out = {};
				for (const [name, bone] of Object.entries(rig.bones)) {
					out[name] = { x: bone.rotation.x, y: bone.rotation.y, z: bone.rotation.z };
				}
				return out;
			}

			for (const speciesId of CREATURE_BODY_PLAN_IDS) {
				const plan = CREATURE_BODY_PLANS[speciesId];
				const gaits = [...new Set([plan.restGait, plan.alertGait])];
				for (const gaitName of gaits) {
					if (!GAIT_LEG_PHASES[gaitName]) {
						failures.push(`${speciesId}: gait "${gaitName}" has no GAIT_LEG_PHASES entry`);
						continue;
					}
					const rig = createCreatureRig({ speciesId, textureSize: 32 });
					const samples = [0, 0.25, 0.5, 0.75].map((frac) => {
						const cyclesPerSecond = plan.strideHz[gaitName === plan.alertGait ? 'run' : 'walk'];
						const t = frac / cyclesPerSecond;
						applyCreatureGait(rig, { gaitName, elapsedSeconds: t });
						return allBoneRotations(rig);
					});

					// Finite + bounded.
					for (const sample of samples) {
						for (const [boneName, r] of Object.entries(sample)) {
							for (const axis of ['x', 'y', 'z']) {
								const value = r[axis];
								if (!Number.isFinite(value)) {
									failures.push(`${speciesId}/${gaitName}: ${boneName}.rotation.${axis} is not finite (${value})`);
								} else if (Math.abs(value) > MAX_ROTATION_RADIANS) {
									failures.push(`${speciesId}/${gaitName}: ${boneName}.rotation.${axis}=${value.toFixed(2)} exceeds sane bound`);
								}
							}
						}
					}

					// Movement: at least one driven leg bone's rotation.x must actually vary across the
					// cycle, except `flap`, where legs are deliberately tucked and stay at zero.
					let maxLegSwing = 0;
					for (const boneName of Object.keys(samples[0])) {
						if (!/^(hind|fore)(Knee|Ankle)[LR]$/.test(boneName)) continue;
						const values = samples.map((s) => s[boneName].x);
						maxLegSwing = Math.max(maxLegSwing, Math.max(...values) - Math.min(...values));
					}
					if (gaitName === 'flap') {
						if (maxLegSwing > 1e-6) failures.push(`${speciesId}/flap: legs moved (${maxLegSwing.toFixed(4)}rad) but should stay tucked`);
					} else if (maxLegSwing < 0.05) {
						failures.push(`${speciesId}/${gaitName}: max leg swing only ${maxLegSwing.toFixed(4)}rad — looks static`);
					}

					// Wings only move during `flap`, and only for birds.
					const wingBoneNames = Object.keys(samples[0]).filter((n) => n.startsWith('wing'));
					if (wingBoneNames.length > 0) {
						let maxWingSwing = 0;
						for (const boneName of wingBoneNames) {
							const values = samples.map((s) => s[boneName].z);
							maxWingSwing = Math.max(maxWingSwing, Math.max(...values) - Math.min(...values));
						}
						if (gaitName === 'flap' && maxWingSwing < 0.1) {
							failures.push(`${speciesId}/flap: wings barely moved (${maxWingSwing.toFixed(4)}rad)`);
						}
						if (gaitName !== 'flap' && maxWingSwing > 1e-6) {
							failures.push(`${speciesId}/${gaitName}: wings moved (${maxWingSwing.toFixed(4)}rad) outside the flap gait`);
						}
					}

					// Determinism: an independent rig, same species+gait+time, must match exactly.
					const twin = createCreatureRig({ speciesId, textureSize: 32 });
					applyCreatureGait(twin, { gaitName, elapsedSeconds: 0.37 });
					applyCreatureGait(rig, { gaitName, elapsedSeconds: 0.37 });
					let mismatch = null;
					for (const boneName of Object.keys(rig.bones)) {
						const a = rig.bones[boneName].rotation;
						const b = twin.bones[boneName].rotation;
						if (a.x !== b.x || a.y !== b.y || a.z !== b.z) {
							mismatch = boneName;
							break;
						}
					}
					if (mismatch) failures.push(`${speciesId}/${gaitName}: non-deterministic — "${mismatch}" differs between two independent poses at the same elapsedSeconds`);
					twin.dispose();

					// Reset must zero every bone this module ever touches.
					resetCreatureGaitPose(rig);
					for (const boneName of Object.keys(rig.bones)) {
						const r = rig.bones[boneName].rotation;
						const isDriven = /^(hind|fore)(Knee|Ankle)[LR]$/.test(boneName) || boneName === 'tailBase' || boneName.startsWith('wing');
						if (isDriven && (r.x !== 0 || r.y !== 0 || r.z !== 0)) {
							failures.push(`${speciesId}/${gaitName}: resetCreatureGaitPose left "${boneName}" at (${r.x},${r.y},${r.z})`);
						}
					}

					summary.push({ speciesId, gaitName, maxLegSwing: Number(maxLegSwing.toFixed(3)) });
					rig.dispose();
				}
			}

			return { failures, summary, representativeIds: Object.values(representatives) };
		}, { representatives: REPRESENTATIVES });

		if (result.failures.length > 0) {
			console.error(`[checkRun327CreatureGait] FAIL:\n  ${result.failures.join('\n  ')}`);
			process.exitCode = 1;
			return;
		}

		// --- rendered before/after proof, one representative per archetype -------------------------
		const pixelProof = await page.evaluate(async ({ representatives }) => {
			const THREE = await import('three');
			const { createCreatureRig } = await import('/src/3d/gameplay/creatureRig.js');
			const { CREATURE_BODY_PLANS } = await import('/src/3d/gameplay/creatureBodyPlans.js');
			const { applyCreatureGait } = await import('/src/3d/gameplay/creatureGait.js');

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0xa9c4d8);
			scene.add(new THREE.HemisphereLight(0xf3f7ff, 0x556b3c, 2.4));
			const sun = new THREE.DirectionalLight(0xffffff, 2.6);
			sun.position.set(3, 6, 5);
			scene.add(sun);
			const fill = new THREE.DirectionalLight(0xffffff, 1.1);
			fill.position.set(-4, 3, -2);
			scene.add(fill);
			const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x6f7d54, roughness: 1 }));
			ground.rotation.x = -Math.PI / 2;
			scene.add(ground);

			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setSize(1600, 900, false);
			const camera = new THREE.PerspectiveCamera(45, 1600 / 900, 0.1, 200);
			const gl = renderer.getContext();

			function readPixels() {
				const buf = new Uint8Array(1600 * 900 * 4);
				gl.readPixels(0, 0, 1600, 900, gl.RGBA, gl.UNSIGNED_BYTE, buf);
				return buf;
			}
			function pixelDiffRatio(a, b) {
				let changed = 0;
				const pixelCount = a.length / 4;
				for (let i = 0; i < a.length; i += 4) {
					if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) changed++;
				}
				return changed / pixelCount;
			}

			const shots = {};
			const diffs = {};
			for (const [archetype, speciesId] of Object.entries(representatives)) {
				const plan = CREATURE_BODY_PLANS[speciesId];
				const rig = createCreatureRig({ speciesId, textureSize: 256 });
				rig.object3D.rotation.y = Math.PI * 0.5; // broadside to the camera — legs swing in the plane the camera sees.
				scene.add(rig.object3D);
				const eyeY = plan.shoulderHeightMeters * 0.6 + 0.15;
				const dist = Math.max(1.6, plan.bodyLengthMeters * 1.7, plan.shoulderHeightMeters * 1.7);
				camera.position.set(0, eyeY, dist);
				camera.lookAt(0, eyeY, 0);

				// Quadruped/biped: their restGait (an ordinary walk) is the pose a player sees most
				// often. A bird's restGait is a ground `hop` — real, but the wings barely move; `flap`
				// (its alertGait, and where a bird actually spends most of its animated life) is the
				// far more legible before/after for a screenshot.
				const gaitName = archetype === 'bird' ? plan.alertGait : plan.restGait;
				const cyclesPerSecond = plan.strideHz[gaitName === plan.alertGait ? 'run' : 'walk'];
				applyCreatureGait(rig, { gaitName, elapsedSeconds: 0 });
				renderer.render(scene, camera);
				shots[`${archetype}-phase0`] = renderer.domElement.toDataURL('image/png');
				const before = readPixels();

				applyCreatureGait(rig, { gaitName, elapsedSeconds: 0.5 / cyclesPerSecond });
				renderer.render(scene, camera);
				shots[`${archetype}-phase50`] = renderer.domElement.toDataURL('image/png');
				const after = readPixels();

				diffs[archetype] = { speciesId, gaitName, changedRatio: pixelDiffRatio(before, after) };
				scene.remove(rig.object3D);
				rig.dispose();
			}

			renderer.dispose();
			ground.geometry.dispose();
			ground.material.dispose();
			return { shots, diffs };
		}, { representatives: REPRESENTATIVES });

		for (const [key, dataUrl] of Object.entries(pixelProof.shots)) {
			fs.writeFileSync(path.join(ARTIFACT_DIR, `${key}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
		}

		// Legs/wings are a thin fraction of the frame even at a close, per-creature camera, so this
		// bound is calibrated off this run's own measured ratios (quadruped ~0.04%, bird-flap much
		// higher) rather than an arbitrary round number — low enough to pass a real but small leg
		// swing, high enough that an accidentally-inert gait (which measures ~0.000-0.001%, pure
		// antialiasing/lighting noise) still fails.
		const stillFrames = Object.entries(pixelProof.diffs).filter(([, d]) => d.changedRatio < 0.0001);
		if (stillFrames.length > 0) {
			console.error(
				`[checkRun327CreatureGait] FAIL: no visible pixel change between phase0/phase50 for: ${stillFrames
					.map(([archetype, d]) => `${archetype}(${d.speciesId}, ${(d.changedRatio * 100).toFixed(3)}%)`)
					.join(', ')}`,
			);
			process.exitCode = 1;
			return;
		}

		if (pageErrors.length > 0) {
			console.error(`[checkRun327CreatureGait] FAIL: uncaught page errors: ${JSON.stringify(pageErrors)}`);
			process.exitCode = 1;
			return;
		}

		console.log(
			`[checkRun327CreatureGait] PASS: ${result.summary.length} species x gait combinations posed ` +
				`(19 species x restGait+alertGait, deduplicated where they match); every rotation finite and ` +
				`bounded, legs move except during flap, wings move only during flap, deterministic, reset ` +
				`zeroes every driven bone. Pixel proof: ${Object.entries(pixelProof.diffs)
					.map(([archetype, d]) => `${archetype}=${d.speciesId}/${d.gaitName} ${(d.changedRatio * 100).toFixed(2)}%`)
					.join(', ')} of rendered pixels changed between phase0/phase50. 6 screenshots in artifacts/run327-creature-gait/.`,
		);
	} catch (error) {
		console.error(`[checkRun327CreatureGait] FAIL: ${error.message}\n${error.stack}`);
		process.exitCode = 1;
	} finally {
		await browser.close();
		server.close();
	}
}

main();
