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
			const coarse = window.matchMedia('(pointer: coarse)').matches;
			manager.streamTowards(0, 0, 2);
			const initial = { loaded: manager.loadedCount, ever: manager.everGeneratedCount, area: manager.getCoveredAreaKm2() };
			manager.streamTowards(7, 0, 2);
			const moved = { loaded: manager.loadedCount, ever: manager.everGeneratedCount, area: manager.getCoveredAreaKm2(), oldCenterResident: Boolean(manager.getLoadedChunkMesh(0, 0)), newCenterResident: Boolean(manager.getLoadedChunkMesh(7, 0)) };
			manager.disposeAll();
			return { coarse, initial, moved, remaining: manager.loadedCount };
		});
		await context.close();
		const ok = result.coarse && result.initial.loaded === 49 && result.initial.ever === 49 && result.initial.area === 12.25 && result.moved.loaded === 49 && result.moved.ever > 49 && result.moved.area === 12.25 && !result.moved.oldCenterResident && result.moved.newCenterResident && result.remaining === 0;
		if (!ok) { console.error('[mobile-streaming] FAIL', JSON.stringify(result)); process.exit(1); }
		console.log(`[mobile-streaming] PASS: resident ${result.initial.loaded} chunks / ${result.initial.area.toFixed(2)} km²; cumulative=${result.moved.ever}; bounded resident=${result.moved.loaded}; dispose=0.`);
	} finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error('[mobile-streaming] FAIL:', error); process.exit(1); });
