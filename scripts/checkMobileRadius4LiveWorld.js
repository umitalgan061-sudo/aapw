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
			const flattenPads = Array.from({ length: 14 }, (_, index) => ({
				x: 100000 + index * 100,
				z: 100000 + index * 100,
				innerRadiusMeters: 10,
				outerRadiusMeters: 20,
				anchorHeightMeters: 10,
			}));
			const manager = new ChunkManager({ scene, chunkSizeMeters: 500, seed: 1337, flattenPads });
			const coarse = window.matchMedia('(pointer: coarse)').matches;
			manager.loadSquare(0, 0, 2);
			const initial = {
				loaded: manager.loadedCount,
				ever: manager.everGeneratedCount,
				area: manager.getCoveredAreaKm2(),
				liveFlag: manager.mobileLiveWorldRadius4Run140 === true,
			};
			manager.streamTowards(9, 0, 2);
			const moved = {
				loaded: manager.loadedCount,
				ever: manager.everGeneratedCount,
				area: manager.getCoveredAreaKm2(),
				oldCenterResident: Boolean(manager.getLoadedChunkMesh(0, 0)),
				newCenterResident: Boolean(manager.getLoadedChunkMesh(9, 0)),
			};
			manager.disposeAll();
			return { coarse, initial, moved, remaining: manager.loadedCount };
		});
		await context.close();
		const ok = result.coarse &&
			result.initial.liveFlag &&
			result.initial.loaded === 81 &&
			result.initial.ever === 81 &&
			result.initial.area === 20.25 &&
			result.moved.loaded === 81 &&
			result.moved.ever > 81 &&
			result.moved.area === 20.25 &&
			!result.moved.oldCenterResident &&
			result.moved.newCenterResident &&
			result.remaining === 0;
		if (!ok) {
			console.error('[mobile-radius4-live] FAIL', JSON.stringify(result));
			process.exit(1);
		}
		console.log(`[mobile-radius4-live] PASS: live resident ${result.initial.loaded} chunks / ${result.initial.area.toFixed(2)} km²; cumulative=${result.moved.ever}; bounded=${result.moved.loaded}; dispose=0.`);
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[mobile-radius4-live] FAIL:', error);
	process.exit(1);
});
