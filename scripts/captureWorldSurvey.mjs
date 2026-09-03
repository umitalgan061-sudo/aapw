#!/usr/bin/env node
/**
 * Surveys the real world the way a player sees it, and writes one PNG per viewpoint.
 *
 * Every other evidence script in here hand-assembles the subset of the world it needs. That is fast,
 * but it is also how run 416 came to record a road-ribbon float defect that existed only inside the
 * harness. This one asks `sceneManager.createScene()` for the game's own scene — terrain, vegetation,
 * villages, settlements, roads, rivers, water, sky — and photographs it at eye height.
 *
 * **The trap this script exists to close.** Desktop terrain LOD is keyed to the *streaming centre*,
 * which only `ChunkManager.streamTowards` moves, and the live game calls it every frame from the
 * player's position. A harness that merely teleports the camera leaves that centre at the world
 * origin, so every chunk under the lens stays in the FAR band. Measured, at the `ziya` seat:
 *
 *   without streamTowards   32 segments over a 500 m chunk = 15.625 m between vertices
 *   with    streamTowards  128 segments over a 500 m chunk =  3.906 m between vertices
 *
 * Four times coarser than anything a player stands on. Terrain conclusions drawn from renders taken
 * the first way are conclusions about geometry that never reaches the screen — a whole class of
 * phantom defects, and this script had already produced one before the cause was found. So `shoot`
 * streams before it renders, every time, and that is not an optimisation to be tidied away later.
 *
 * Renders are read back with `renderer.domElement.toDataURL`, not Playwright's `page.screenshot`:
 * screenshotting this page times out waiting for fonts that the WebGL canvas does not need.
 *
 * Usage: `node scripts/captureWorldSurvey.mjs [--out-dir=artifacts/world-survey]`
 * Exit codes: 0 wrote the renders, 2 Playwright is unavailable (skip), 1 something failed.
 * @module scripts/captureWorldSurvey
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.find((value) => value.startsWith('--out-dir='));
const OUT = path.resolve(ROOT, outArg ? outArg.slice('--out-dir='.length) : 'artifacts/world-survey');

/** Seats to photograph. Spread across climates so one run covers snow, farmland and coast. */
const SURVEY_SEATS = Object.freeze(['berk', 'berkalp', 'cersei', 'olena', 'umit', 'ziya']);
/** Chunk radius handed to `streamTowards` — enough to regrade the near band around the camera. */
const STREAM_RADIUS_CHUNKS = 2;
/**
 * Asset errors this container cannot avoid: without `git-lfs` the model and texture binaries are
 * pointer stubs, so the loaders log and fall back. Anything else is a real page error and is reported.
 */
const IGNORABLE_ERROR = /assets\/|version ht|not valid JSON|Couldn't load texture|placeholder box/;

async function main() {
	const playwright = devServerHelper.loadPlaywright();
	if (!playwright) {
		console.error('[captureWorldSurvey] SKIP: Playwright is not installed in this environment.');
		process.exit(2);
	}
	fs.mkdirSync(OUT, { recursive: true });
	const server = await devServerHelper.startStaticServer();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	const errors = [];
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		page.on('pageerror', (error) => { if (!IGNORABLE_ERROR.test(error.message)) errors.push(`page:${error.message}`); });
		page.on('console', (message) => {
			if (message.type() === 'error' && !IGNORABLE_ERROR.test(message.text())) errors.push(`console:${message.text()}`);
		});
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 120_000 });

		const shots = await page.evaluate(async ({ seatIds, streamRadius }) => {
			const { createScene, worldToChunkCoord } = await import('/src/3d/sceneManager.js');
			const { WORLD_DEFAULTS, CHUNK_CONFIG } = await import('/src/3d/config.js');
			const { updateDayNightLighting } = await import('/src/3d/lighting.js');
			const { updateAuroraSky } = await import('/src/3d/sky.js');
			const { updateSkyBodies } = await import('/src/3d/skyBodies.js');
			const { updateFog } = await import('/src/3d/fog.js');

			const canvas = document.createElement('canvas');
			canvas.width = 1280;
			canvas.height = 720;
			document.body.innerHTML = '';
			document.body.style.margin = '0';
			document.body.appendChild(canvas);
			const world = await createScene(canvas);
			world.renderer.setSize(1280, 720, false);
			world.camera.aspect = 1280 / 720;
			world.camera.updateProjectionMatrix();
			const { renderer, scene, camera } = world;
			const ground = world.groundCollider.getGroundHeight;
			// timeRatio = (elapsed / dayLength + START_TIME_OF_DAY_RATIO) % 1, and the start ratio is 0.3,
			// so 0.2 of a day past it is midday — real daylight rather than a hand-placed light.
			const noon = WORLD_DEFAULTS.DAY_LENGTH_SECONDS * 0.2;
			const done = [];

			const shoot = (name, from, to) => {
				camera.position.set(from.x, from.y, from.z);
				camera.lookAt(to.x, to.y, to.z);
				camera.updateMatrixWorld(true);
				// The streaming centre, before anything is drawn. See the module doc for why.
				world.chunkManager.streamTowards(
					worldToChunkCoord(from.x, CHUNK_CONFIG.CHUNK_SIZE_METERS),
					worldToChunkCoord(from.z, CHUNK_CONFIG.CHUNK_SIZE_METERS),
					streamRadius,
				);
				scene.updateMatrixWorld(true);
				const dayNight = updateDayNightLighting(world.lights, noon, WORLD_DEFAULTS.DAY_LENGTH_SECONDS, WORLD_DEFAULTS.START_TIME_OF_DAY_RATIO);
				updateAuroraSky(world.sky, camera.position, noon, dayNight);
				updateSkyBodies(world.skyBodies, camera.position, world.lights.sun, dayNight.nightFactor);
				updateFog(scene.fog, dayNight);
				// Twice: the first render is what makes a freshly regraded chunk compile its program, and
				// a program that compiles mid-frame draws with whatever was bound before it.
				renderer.render(scene, camera);
				renderer.render(scene, camera);
				const chunkUnderfoot = [];
				scene.traverse((node) => {
					const segments = node.userData?.desktopTerrainLodSegmentsRun356;
					if (segments) chunkUnderfoot.push(segments);
				});
				done.push({
					name,
					url: renderer.domElement.toDataURL('image/png'),
					// Recorded so a reader can tell at a glance which LOD band the render actually shows.
					nearestSegments: chunkUnderfoot.length ? Math.max(...chunkUnderfoot) : null,
				});
			};

			const seats = seatIds
				.map((id) => world.settlementSeats.find((seat) => seat.id === id))
				.filter(Boolean);
			for (const seat of seats) {
				// Standing back and above, the way a rider would come over the last rise onto the seat.
				const fromX = seat.x + 120;
				const fromZ = seat.z + 120;
				shoot(`seat-${seat.id}`,
					{ x: fromX, y: ground(fromX, fromZ) + 14, z: fromZ },
					{ x: seat.x, y: seat.groundY + 6, z: seat.z });
			}
			return done;
		}, { seatIds: SURVEY_SEATS, streamRadius: STREAM_RADIUS_CHUNKS });

		for (const shot of shots) {
			fs.writeFileSync(path.join(OUT, `${shot.name}.png`), Buffer.from(shot.url.split(',')[1], 'base64'));
		}
		const bands = [...new Set(shots.map((shot) => shot.nearestSegments))].join('/');
		console.log(
			`[captureWorldSurvey] OK: ${shots.length} renders at ${path.relative(ROOT, OUT)}; ` +
			`finest terrain LOD present ${bands} segments; ${errors.length} unexpected page errors`,
		);
		for (const error of errors.slice(0, 5)) console.log(`  ${error}`);
		if (errors.length) process.exitCode = 1;
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[captureWorldSurvey] FAIL', error?.stack || error);
	process.exit(1);
});
