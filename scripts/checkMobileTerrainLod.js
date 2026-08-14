#!/usr/bin/env node
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const server = await startStaticServer();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
		const page = await context.newPage();
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		const result = await page.evaluate(async () => {
			const [{ ChunkManager }, THREE] = await Promise.all([
				import('/src/3d/world/chunkManager.js'),
				import('/src/3d/vendor/three/three.module.js'),
			]);
			const scene = new THREE.Scene();
			const manager = new ChunkManager({ scene, chunkSizeMeters: 500, seed: 1337 });
			manager.streamTowards(0, 0, 2);
			const sample = (x, z) => {
				const mesh = manager.getLoadedChunkMesh(x, z);
				return {
					segments: mesh?.userData.mobileTerrainLodSegmentsRun134 ?? null,
					vertices: mesh?.geometry.attributes.position.count ?? 0,
				};
			};
			const initial = { loaded: manager.loadedCount, near: sample(0, 0), mid: sample(2, 0), far: sample(3, 0) };
			manager.streamTowards(3, 0, 2);
			const moved = { loaded: manager.loadedCount, newNear: sample(3, 0), oldCenterNowFar: sample(0, 0) };
			const segmentHistogram = {};
			for (const mesh of manager.loaded.values()) {
				const segments = mesh.userData.mobileTerrainLodSegmentsRun134;
				segmentHistogram[segments] = (segmentHistogram[segments] ?? 0) + 1;
			}
			manager.disposeAll();
			return { coarse: window.matchMedia('(pointer: coarse)').matches, initial, moved, segmentHistogram, remaining: manager.loadedCount };
		});
		await context.close();
		const ok = result.coarse &&
			result.initial.loaded === 49 && result.moved.loaded === 49 &&
			result.initial.near.segments === 64 && result.initial.near.vertices === 4225 &&
			result.initial.mid.segments === 32 && result.initial.mid.vertices === 1089 &&
			result.initial.far.segments === 16 && result.initial.far.vertices === 289 &&
			result.moved.newNear.segments === 64 && result.moved.newNear.vertices === 4225 &&
			result.moved.oldCenterNowFar.segments === 16 && result.moved.oldCenterNowFar.vertices === 289 &&
			result.segmentHistogram['64'] === 9 && result.segmentHistogram['32'] === 16 && result.segmentHistogram['16'] === 24 &&
			result.remaining === 0;
		if (!ok) {
			console.error('[mobile-terrain-lod] FAIL', JSON.stringify(result));
			process.exit(1);
		}
		console.log(`[mobile-terrain-lod] PASS: 49 resident chunks = 9 near@64 + 16 mid@32 + 24 far@16; center-crossing regrades LOD; dispose=0.`);
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[mobile-terrain-lod] FAIL:', error);
	process.exit(1);
});
