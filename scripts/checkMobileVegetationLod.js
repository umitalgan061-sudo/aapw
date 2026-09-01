#!/usr/bin/env node
/**
 * Mobile vegetation geometry LOD regression gate.
 * Runs the production createVegetation() path inside a coarse-pointer browser without booting the
 * full game, so unrelated Git-LFS model placeholders and scene shaders cannot contaminate this test.
 */
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
		userAgent: 'WesterosPWA-MobileVegetationLodGate/2.0',
	});
	const page = await context.newPage();
	const pageErrors = [];
	page.on('pageerror', (error) => pageErrors.push(String(error)));

	try {
		await page.goto(`http://127.0.0.1:${port}/scripts/vegetationSilhouetteHarness.html`, {
			waitUntil: 'domcontentloaded',
			timeout: 30000,
		});
		const result = await page.evaluate(async () => {
			const vegetation = await import('/src/3d/world/vegetation.js');
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
			const meshes = created.group.children.map((mesh) => ({
				name: mesh.name,
				count: mesh.count,
				type: mesh.geometry.type,
				triangles: mesh.geometry.index
					? mesh.geometry.index.count / 3
					: mesh.geometry.getAttribute('position').count / 3,
			}));
			const coarse = matchMedia('(pointer: coarse)').matches;
			const placedCount = created.placedCount;
			vegetation.disposeVegetation(created.group);
			return { stats, meshes, placedCount, coarse };
		});

		if (!result.coarse) throw new Error('coarse-pointer mobile path was not active');
		if (!result.stats?.active) throw new Error(`mobile vegetation LOD metadata missing: ${JSON.stringify(result)}`);
		if (!(result.stats.desktopTriangles > result.stats.mobileTriangles)) {
			throw new Error(`triangle reduction missing: ${JSON.stringify(result.stats)}`);
		}
		if (result.stats.reductionRatio < 0.25) {
			throw new Error(`vegetation triangle reduction too small: ${JSON.stringify(result.stats)}`);
		}
		if (result.stats.placedCount !== result.placedCount) {
			throw new Error(`LOD metadata placement drift: ${JSON.stringify(result)}`);
		}
		if (result.meshes.length !== 6 || result.meshes.some((mesh) => mesh.count < 0 || mesh.triangles <= 0)) {
			throw new Error(`invalid mobile mesh inventory: ${JSON.stringify(result.meshes)}`);
		}
		const mobileTypes = result.meshes.map((mesh) => mesh.type);
		const expectedTypes = [
			'CylinderGeometry', 'ConeGeometry',
			'CylinderGeometry', 'SphereGeometry',
			'CylinderGeometry', 'ConeGeometry',
		];
		if (mobileTypes.some((type, index) => type !== expectedTypes[index])) {
			throw new Error(`mobile primitive LOD type drift: ${JSON.stringify(mobileTypes)}`);
		}
		if (pageErrors.length) throw new Error(`page errors: ${JSON.stringify(pageErrors)}`);
		console.log('[checkMobileVegetationLod] PASS', JSON.stringify(result));
	} finally {
		await context.close();
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error('[checkMobileVegetationLod] FAIL:', error.message || error);
	process.exit(1);
});
