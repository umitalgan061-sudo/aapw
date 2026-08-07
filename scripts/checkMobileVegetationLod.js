#!/usr/bin/env node
/** Runtime regression gate for Run 136 mobile vegetation geometry LOD. */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkMobileVegetationLod] FAIL: Playwright is unavailable.');
		process.exit(2);
	}
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 430, height: 932 },
		isMobile: true,
		hasTouch: true,
		userAgent: 'WesterosPWA-MobileVegetationLodGate/1.0',
	});
	const page = await context.newPage();
	const consoleErrors = [];
	const pageErrors = [];
	page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
	page.on('pageerror', (error) => pageErrors.push(String(error)));

	try {
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await page.waitForFunction(
			() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'),
			{ timeout: 60000, polling: 250 },
		);
		const result = await page.evaluate(async () => {
			const vegetation = await import('./src/3d/world/vegetation.js');
			const created = vegetation.createVegetation({
				sampleHeightMeters: () => 20,
				seaLevelMeters: 6,
				seed: 1337,
				seats: [],
				roadEdges: [],
				radiusMeters: 1000,
				densityPerKm2: 30,
			});
			const stats = vegetation.getMobileVegetationLodStatsRun136(created.group);
			const counts = created.group.children.map((mesh) => mesh.count);
			vegetation.disposeVegetation(created.group);
			return { stats, counts, coarse: matchMedia('(pointer: coarse)').matches };
		});

		if (!result.coarse) throw new Error('coarse-pointer mobile path was not active');
		if (!result.stats?.active) throw new Error(`mobile vegetation LOD metadata missing: ${JSON.stringify(result)}`);
		if (!(result.stats.mobileTriangles < result.stats.desktopTriangles)) {
			throw new Error(`triangle reduction missing: ${JSON.stringify(result.stats)}`);
		}
		if (result.stats.reductionRatio < 0.25) {
			throw new Error(`vegetation triangle reduction too small: ${JSON.stringify(result.stats)}`);
		}
		if (!result.counts.length || result.counts.some((count) => count < 0)) {
			throw new Error(`invalid instance counts: ${JSON.stringify(result.counts)}`);
		}
		if (consoleErrors.length || pageErrors.length) {
			throw new Error(`console/page errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
		}
		console.log(`[checkMobileVegetationLod] sample ${JSON.stringify(result)}`);
		console.log('[checkMobileVegetationLod] PASS: coarse-pointer vegetation keeps instances but lowers geometry triangles.');
	} finally {
		await context.close();
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[checkMobileVegetationLod] FAIL:', error.message || error);
	process.exit(1);
});
