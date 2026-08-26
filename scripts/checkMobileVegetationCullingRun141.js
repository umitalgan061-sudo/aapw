#!/usr/bin/env node
/** Browser integration gate for run-141 live-radius-aware mobile vegetation culling. */

const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright is unavailable');
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 430, height: 932 },
		screen: { width: 430, height: 932 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
		userAgent: 'WesterosPWA-MobileVegetationCullingRun141/1.0',
	});
	const page = await context.newPage();
	const transitions = [];
	const errors = [];
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
		if (message.type() === 'info' && message.text().includes('[mobileVegetationCulling]')) transitions.push(message.text());
	});
	page.on('pageerror', (error) => errors.push(String(error)));
	try {
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await page.waitForFunction(
			() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'),
			undefined,
			{ timeout: 60000, polling: 250 },
		);
		await page.waitForTimeout(1200);
		if (errors.length) throw new Error(`console/page errors: ${JSON.stringify(errors)}`);

		const pure = await page.evaluate(async () => {
			const module = await import('/src/3d/world/mobileVegetationCulling.js');
			const distances = module.getMobileVegetationCullingDistancesRun141();
			const edgeVisible = module.shouldShowMobileVegetationDiscRun141(0, 0, distances.maxCenterDistanceMeters, 0);
			const beyondHidden = module.shouldShowMobileVegetationDiscRun141(0, 0, distances.maxCenterDistanceMeters + 1, 0);
			return { distances, edgeVisible, beyondHidden };
		});
		if (pure.distances.residentTerrainRadiusMeters !== 2000) {
			throw new Error(`live radius-derived resident terrain threshold is stale: ${JSON.stringify(pure)}`);
		}
		if (pure.distances.vegetationDiscRadiusMeters !== 1000 || pure.distances.marginMeters !== 100) {
			throw new Error(`vegetation culling geometry is unexpected: ${JSON.stringify(pure)}`);
		}
		if (!pure.edgeVisible || pure.beyondHidden) {
			throw new Error(`pure culling boundary behavior failed: ${JSON.stringify(pure)}`);
		}
		if (!transitions.some((line) => line.includes('origin hidden'))) {
			throw new Error(`origin vegetation was not culled at mobile spawn: ${JSON.stringify(transitions)}`);
		}
		if (!transitions.some((line) => line.includes('spawn visible'))) {
			throw new Error(`spawn vegetation was not visible at mobile spawn: ${JSON.stringify(transitions)}`);
		}
		console.log(`[checkMobileVegetationCullingRun141] distances ${JSON.stringify(pure.distances)}`);
		console.log(`[checkMobileVegetationCullingRun141] transitions ${JSON.stringify(transitions)}`);
		console.log('[checkMobileVegetationCullingRun141] PASS: radius-derived remote-disc culling is active and reversible.');
	} finally {
		await context.close();
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[checkMobileVegetationCullingRun141] FAIL:', error.message || error);
	process.exit(1);
});
