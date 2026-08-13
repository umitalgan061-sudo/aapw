#!/usr/bin/env node
/**
 * checkRun329CreatureBrain.js — evidence for `gameplay/creatureBrain.js`/`gameplay/creatureSpawner.js`
 * (run 329, ADR-0274): run 326/327's dormant procedural rigs finally move under a real per-frame tick,
 * and their deterministic world placement.
 *
 * Asserted:
 *   - `scatterCreatures` respects `isPlaceablePosition` for every placed spawn (no water/seat/road
 *     violations), is deterministic (same seed -> byte-identical spawn list, called twice), and never
 *     silently drops a placeable request (a synthetic all-placeable field places every requested count).
 *   - `createCreatureBeing` throws on an unknown species (loud failure, matches `findBodyPlan`'s own
 *     convention) and produces a live being for every `CREATURE_BEHAVIOR_PROFILES` entry.
 *   - Wander motion is deterministic (two independent beings, same spawn id/position, same `update()`
 *     call sequence -> identical resulting position) and every position stays finite.
 *   - `isFleeing`/reactive movement actually triggers when the player is inside
 *     `reactiveTriggerRadiusMeters` and moves the being away from (or, for `kopek`, toward) the player.
 *   - `game3d.html` boots with the new imports wired in and produces zero uncaught page errors.
 *   - Rendered before/after proof (GPU pixel read-back, same technique run327 used): a wandering being
 *     visibly moves across a short time span, for one representative species.
 *
 * Usage: `node scripts/checkRun329CreatureBrain.js`
 * Exit codes: 0 = pass, 1 = fail, 2 = Playwright unavailable.
 * @module scripts/checkRun329CreatureBrain
 */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts', 'run329-creature-brain');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkRun329CreatureBrain] SKIP: Playwright is not available in this environment.');
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
		// Navigate first — module specifiers below resolve relative to the loaded document, and
		// `game3d.html` is what carries the import map `three` (a bare specifier) needs, same
		// prerequisite `checkRun327CreatureGait.js` relies on for its own dynamic imports.
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await page.waitForTimeout(9000); // let the live scene finish booting before it's judged error-free below

		// --- pure-logic assertions (no live scene needed) -------------------------------------------
		const logic = await page.evaluate(async () => {
			const { scatterCreatures, DESKTOP_SPECIES_COUNTS } = await import('/src/3d/gameplay/creatureSpawner.js');
			const { isPlaceablePosition } = await import('/src/3d/world/vegetation.js');
			const { mulberry32 } = await import('/src/3d/world/terrain.js');
			const { createCreatureBeing, CREATURE_BEHAVIOR_PROFILES } = await import('/src/3d/gameplay/creatureBrain.js');
			const failures = [];

			// Synthetic world: flat ground well above sea level, no seats/roads — isolates the placement
			// logic itself from any real terrain data, same isolation `checkRun327` used for gait.
			const flatSampler = () => 50;
			const seaLevelMeters = 0;
			const commonArgs = {
				sampleHeightMeters: flatSampler,
				seaLevelMeters,
				seats: [],
				roadEdges: [],
				seed: 12345,
				seedTag: 0x43524554,
				mulberry32,
				centerX: 0,
				centerZ: 0,
				radiusMeters: 500,
				speciesCounts: DESKTOP_SPECIES_COUNTS,
			};
			const spawnsA = scatterCreatures(commonArgs);
			const spawnsB = scatterCreatures({ ...commonArgs });
			const expectedTotal = Object.values(DESKTOP_SPECIES_COUNTS).reduce((a, b) => a + b, 0);
			if (spawnsA.length !== expectedTotal) {
				failures.push(`scatterCreatures: expected ${expectedTotal} placed on an all-placeable field, got ${spawnsA.length}`);
			}
			if (spawnsA.length !== spawnsB.length) {
				failures.push(`scatterCreatures: non-deterministic count (${spawnsA.length} vs ${spawnsB.length}) for the same seed`);
			} else {
				for (let i = 0; i < spawnsA.length; i++) {
					const a = spawnsA[i];
					const b = spawnsB[i];
					if (a.speciesId !== b.speciesId || a.x !== b.x || a.z !== b.z || a.rotationYRadians !== b.rotationYRadians) {
						failures.push(`scatterCreatures: non-deterministic spawn #${i} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`);
						break;
					}
				}
			}
			for (const spawn of spawnsA) {
				if (!isPlaceablePosition(spawn.x, spawn.z, { sampleHeightMeters: flatSampler, seaLevelMeters, seats: [], roadEdges: [] })) {
					failures.push(`scatterCreatures: spawn "${spawn.id}" at (${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)}) is not actually placeable`);
				}
				if (!Number.isFinite(spawn.x) || !Number.isFinite(spawn.z)) failures.push(`scatterCreatures: spawn "${spawn.id}" has a non-finite coordinate`);
			}
			// A field with zero valid area (sea level everywhere) must place nothing and must not hang.
			const droughtSpawns = scatterCreatures({ ...commonArgs, sampleHeightMeters: () => -100, seedTag: 0x44525931 });
			if (droughtSpawns.length !== 0) failures.push(`scatterCreatures: placed ${droughtSpawns.length} on an all-underwater field, expected 0`);

			try {
				createCreatureBeing({
					speciesId: 'not-a-real-species',
					spawnId: 'x',
					worldX: 0,
					worldZ: 0,
					groundY: 0,
					groundCollider: { getGroundHeight: () => 0 },
					mulberry32,
				});
				failures.push('createCreatureBeing: expected a throw for an unknown species id, none thrown');
			} catch (error) {
				if (!/no CREATURE_BEHAVIOR_PROFILES entry/.test(error.message)) {
					failures.push(`createCreatureBeing: threw for unknown species, but with an unexpected message: ${error.message}`);
				}
			}

			const groundCollider = { getGroundHeight: () => 50 };
			const speciesIds = Object.keys(CREATURE_BEHAVIOR_PROFILES);
			const positionsAfterOneUpdate = {};
			for (const speciesId of speciesIds) {
				const beingA = createCreatureBeing({ speciesId, spawnId: `probe-${speciesId}`, worldX: 0, worldZ: 0, groundY: 50, groundCollider, mulberry32 });
				const beingB = createCreatureBeing({ speciesId, spawnId: `probe-${speciesId}`, worldX: 0, worldZ: 0, groundY: 50, groundCollider, mulberry32 });
				for (let step = 0; step < 20; step++) {
					beingA.update(0.5, undefined, []);
					beingB.update(0.5, undefined, []);
				}
				const a = beingA.object3D.position;
				const b = beingB.object3D.position;
				if (a.x !== b.x || a.y !== b.y || a.z !== b.z) {
					failures.push(`createCreatureBeing: "${speciesId}" wander is non-deterministic (two independent beings, same spawn id, diverged)`);
				}
				if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.z)) {
					failures.push(`createCreatureBeing: "${speciesId}" position went non-finite after 20 update()s`);
				}
				positionsAfterOneUpdate[speciesId] = { x: a.x, z: a.z };

				// Reactive-movement direction: a player close enough to trigger should move the being away
				// (default) or toward (kopek's approach-friendly) over the next update. `kopek` alone needs
				// a farther player — inside its trigger radius (10) but past its own stop distance (2.5),
				// or it correctly reads as "already arrived, stop approaching" instead of "reacting".
				const beingC = createCreatureBeing({ speciesId, spawnId: `reactive-${speciesId}`, worldX: 0, worldZ: 0, groundY: 50, groundCollider, mulberry32 });
				const before = { x: beingC.object3D.position.x, z: beingC.object3D.position.z };
				const player = speciesId === 'kopek' ? { x: 6, z: 0 } : { x: 1, z: 0 }; // inside every profile's own reactiveTriggerRadiusMeters (all >= 4)
				beingC.update(0.2, player, []);
				const after = { x: beingC.object3D.position.x, z: beingC.object3D.position.z };
				const distBefore = Math.hypot(before.x - player.x, before.z - player.z);
				const distAfter = Math.hypot(after.x - player.x, after.z - player.z);
				const isKopek = speciesId === 'kopek';
				if (!beingC.isFleeing) failures.push(`createCreatureBeing: "${speciesId}" did not react to a player inside its own trigger radius`);
				if (isKopek && distAfter >= distBefore) failures.push(`createCreatureBeing: "kopek" (approach-friendly) moved away from a close player instead of toward`);
				if (!isKopek && distAfter <= distBefore) failures.push(`createCreatureBeing: "${speciesId}" moved toward a close player instead of away`);
				beingA.dispose();
				beingB.dispose();
				beingC.dispose();
			}

			return { failures, speciesCount: speciesIds.length, totalDesktopSpawns: spawnsA.length };
		});

		if (logic.failures.length > 0) {
			console.error(`[checkRun329CreatureBrain] FAIL:\n  ${logic.failures.join('\n  ')}`);
			process.exitCode = 1;
			return;
		}

		// --- live game3d.html boot: zero uncaught errors with the new spawn wiring in place ----------
		if (pageErrors.length > 0) {
			console.error(`[checkRun329CreatureBrain] FAIL: game3d.html threw during boot with the creature spawn wired in: ${JSON.stringify(pageErrors)}`);
			process.exitCode = 1;
			return;
		}

		// --- rendered before/after proof: a wandering being visibly moves ---------------------------
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

			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setSize(1280, 720, false);
			const camera = new THREE.PerspectiveCamera(50, 1280 / 720, 0.1, 200);
			// Close, broadside framing scaled to the species (same formula `checkRun327CreatureGait.js`
			// uses for its own per-species shot) — at a "whole scene" distance a deer-scale body's own
			// leg swing covers too few pixels to clear a real diff-ratio threshold.
			const eyeY = 1.15 * 0.6 + 0.15;
			const dist = Math.max(1.6, 1.7 * 1.7, 1.15 * 1.7);
			camera.position.set(0, eyeY, dist);
			camera.lookAt(0, eyeY, 0);
			const gl = renderer.getContext();

			function readPixels() {
				const buf = new Uint8Array(1280 * 720 * 4);
				gl.readPixels(0, 0, 1280, 720, gl.RGBA, gl.UNSIGNED_BYTE, buf);
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

			const groundCollider = { getGroundHeight: () => 0 };
			const being = createCreatureBeing({ speciesId: 'geyik', spawnId: 'proof-geyik', worldX: 0, worldZ: 0, groundY: 0, groundCollider, mulberry32 });
			scene.add(being.object3D);

			renderer.render(scene, camera);
			const shot0 = renderer.domElement.toDataURL('image/png');
			const before = readPixels();

			// `geyik`'s own wanderPauseSeconds is 4s (bind pose, no motion by design) before the first
			// wander leg picks; 60 steps at 0.15s covers that pause plus ~5s of real walking/gait.
			for (let i = 0; i < 60; i++) being.update(0.15, undefined, []);

			renderer.render(scene, camera);
			const shot1 = renderer.domElement.toDataURL('image/png');
			const after = readPixels();

			const diffRatio = pixelDiffRatio(before, after);
			being.dispose();
			renderer.dispose();
			return { shot0, shot1, diffRatio };
		});

		fs.writeFileSync(path.join(ARTIFACT_DIR, 'geyik-before.png'), Buffer.from(pixelProof.shot0.split(',')[1], 'base64'));
		fs.writeFileSync(path.join(ARTIFACT_DIR, 'geyik-after.png'), Buffer.from(pixelProof.shot1.split(',')[1], 'base64'));
		if (pixelProof.diffRatio < 0.0005) {
			console.error(`[checkRun329CreatureBrain] FAIL: wandering "geyik" produced almost no visible pixel change (${(pixelProof.diffRatio * 100).toFixed(4)}%) over 6s`);
			process.exitCode = 1;
			return;
		}

		console.log(
			`[checkRun329CreatureBrain] PASS: ${logic.speciesCount} species behavior profiles verified (deterministic wander, ` +
				`correct reactive direction, unknown-species throws); scatterCreatures placed ${logic.totalDesktopSpawns}/` +
				`${logic.totalDesktopSpawns} on an all-placeable field, 0 on an all-underwater field, deterministic and ` +
				`exclusion-respecting; game3d.html booted with the new spawn wiring and 0 page errors; rendered proof: ` +
				`${(pixelProof.diffRatio * 100).toFixed(2)}% of pixels changed over 6s of wander. 2 screenshots in ` +
				`artifacts/run329-creature-brain/.`,
		);
	} catch (error) {
		console.error(`[checkRun329CreatureBrain] FAIL: ${error.message}\n${error.stack}`);
		process.exitCode = 1;
	} finally {
		await browser.close();
		server.close();
	}
}

main();
