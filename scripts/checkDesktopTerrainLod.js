#!/usr/bin/env node
/**
 * checkDesktopTerrainLod.js — regression guard for run 356 / ADR-0303's desktop terrain distance LOD,
 * the mirror of `scripts/checkMobileTerrainLod.js`.
 *
 * Asserts four things the implementation must keep true:
 *   1. **The bands are real.** A live-world desktop manager builds 128 subdivisions inside Chebyshev
 *      radius 2, 64 out to radius 5, and 32 beyond — 3.9 m vertices where the player stands.
 *   2. **Moving the streaming center regrades.** Chunks that change band are rebuilt and the old
 *      geometry disposed, so walking does not leave the player standing on far-band terrain.
 *   3. **Test and generic managers are untouched.** Only `sceneManager.js` supplies the full
 *      settlement flatten-pad set, and only that manager gets LOD — the same live-world discriminator
 *      run 140 established. A manager without pads keeps uniform `segments`, which is what every
 *      pre-existing desktop contract asserts.
 *   4. **Every chunk carries a crack skirt.** Differing resolutions at a shared edge are exactly what
 *      run 355 / ADR-0301's skirts exist to close; LOD without them is a T-junction crack generator.
 *
 * Usage: `node scripts/checkDesktopTerrainLod.js`
 * Exit codes: 0 = PASS. 1 = FAIL. 2 = Playwright unavailable.
 * @module scripts/checkDesktopTerrainLod
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** Stand-in for the 14 kingdom-seat pads `sceneManager.js` passes, enough to trip the live-world
 * discriminator without needing the real settlement placement pass. */
const LIVE_WORLD_PAD_COUNT = 14;

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const server = await startStaticServer();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
		const page = await context.newPage();
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		const result = await page.evaluate(async ({ padCount }) => {
			const [{ ChunkManager }, THREE] = await Promise.all([
				import('/src/3d/world/chunkManager.js'),
				import('/src/3d/vendor/three/three.module.js'),
			]);
			const flattenPads = Array.from({ length: padCount }, (_, index) => ({
				x: 40_000 + index * 1000, z: 40_000, innerRadiusMeters: 1, outerRadiusMeters: 2, anchorHeightMeters: 10,
			}));

			const scene = new THREE.Scene();
			const manager = new ChunkManager({ scene, chunkSizeMeters: 500, seed: 1337, flattenPads });
			manager.streamTowards(0, 0, 6);
			const sample = (x, z) => {
				const mesh = manager.getLoadedChunkMesh(x, z);
				return {
					segments: mesh?.userData.desktopTerrainLodSegmentsRun356 ?? null,
					vertices: mesh?.geometry.attributes.position.count ?? 0,
					skirts: (mesh?.children ?? []).filter((child) => child.userData?.terrainChunkSkirt).length,
				};
			};
			const initial = { near: sample(0, 0), mid: sample(4, 0), far: sample(6, 0) };
			// Step the centre one chunk at a time, which is how `camera.js`/`game3d.js` actually drive
			// streaming — a chunk only ever leaves the near band by one ring per crossing, so it is always
			// well inside the regrade radius when it does. A multi-chunk teleport is not a movement the
			// game produces, and asserting against one would bake in a union-of-squares artefact.
			for (let step = 1; step <= 6; step += 1) manager.streamTowards(step, 0, 6);
			const moved = { newNear: sample(6, 0), oldCenterNowFar: sample(0, 0) };

			const histogram = {};
			let chunksWithoutSkirt = 0;
			let misgradedInRange = 0;
			for (const [key, mesh] of manager.loaded.entries()) {
				const [chunkX, chunkZ] = key.split(',').map(Number);
				const segments = mesh.userData.desktopTerrainLodSegmentsRun356;
				histogram[segments] = (histogram[segments] ?? 0) + 1;
				if (!mesh.children.some((child) => child.userData?.terrainChunkSkirt)) chunksWithoutSkirt += 1;
				// The real invariant: every chunk within the regrade radius of the current centre carries
				// exactly the band its own distance implies, whatever path the centre took to get here.
				const distance = Math.max(Math.abs(chunkX - 6), Math.abs(chunkZ));
				if (distance > 6) continue;
				const expected = distance <= 2 ? 128 : distance <= 5 ? 64 : 32;
				if (segments !== expected) misgradedInRange += 1;
			}
			manager.disposeAll();
			const remaining = manager.loadedCount;

			// A manager with no flatten pads is a test/generic manager and must keep uniform resolution.
			const genericScene = new THREE.Scene();
			const generic = new ChunkManager({ scene: genericScene, chunkSizeMeters: 500, seed: 1337 });
			generic.streamTowards(0, 0, 1);
			const genericCenter = generic.getLoadedChunkMesh(0, 0);
			const genericEdge = generic.getLoadedChunkMesh(1, 0);
			const genericUniform = genericCenter?.geometry.attributes.position.count === 4225 &&
				genericEdge?.geometry.attributes.position.count === 4225 &&
				genericCenter?.userData.desktopTerrainLodSegmentsRun356 === undefined;
			generic.disposeAll();

			return {
				coarse: window.matchMedia('(pointer: coarse)').matches,
				initial, moved, histogram, remaining, chunksWithoutSkirt, misgradedInRange, genericUniform,
			};
		}, { padCount: LIVE_WORLD_PAD_COUNT });
		await context.close();

		const ok = !result.coarse &&
			result.initial.near.segments === 128 && result.initial.near.vertices === 16641 &&
			result.initial.mid.segments === 64 && result.initial.mid.vertices === 4225 &&
			result.initial.far.segments === 32 && result.initial.far.vertices === 1089 &&
			result.moved.newNear.segments === 128 && result.moved.newNear.vertices === 16641 &&
			result.moved.oldCenterNowFar.segments === 32 &&
			result.misgradedInRange === 0 &&
			result.chunksWithoutSkirt === 0 && result.remaining === 0 && result.genericUniform;

		if (!ok) {
			console.error('[desktop-terrain-lod] FAIL', JSON.stringify(result));
			process.exit(1);
		}
		console.log(
			'[desktop-terrain-lod] PASS: bands near@128 (16641 verts, 3.9m spacing) / mid@64 / far@32; ' +
				`every chunk within the regrade radius correctly banded after 6 incremental crossings ` +
				`(histogram ${JSON.stringify(result.histogram)}); every chunk skirted; ` +
				'generic managers stay uniform; dispose=0.',
		);
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[desktop-terrain-lod] FAIL: unexpected error:', error);
	process.exit(1);
});
