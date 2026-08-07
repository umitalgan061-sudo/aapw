#!/usr/bin/env node
/** Browser integration gate for run-138 mobile vegetation distance culling. */

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
		userAgent: 'WesterosPWA-MobileVegetationCullingGate/1.0',
	});
	const page = await context.newPage();
	const info = [];
	const errors = [];
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
		if (message.type() === 'info' && message.text().includes('[mobileVegetationCulling]')) info.push(message.text());
	});
	page.on('pageerror', (error) => errors.push(String(error)));
	try {
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await page.waitForFunction(
			() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'),
			{ timeout: 60000, polling: 250 },
		);
		await page.waitForTimeout(1500);
		if (errors.length) throw new Error(`console/page errors: ${JSON.stringify(errors)}`);
		if (!info.some((line) => line.includes('origin hidden'))) {
			throw new Error(`origin vegetation was not culled at mobile spawn: ${JSON.stringify(info)}`);
		}
		if (!info.some((line) => line.includes('spawn visible'))) {
			throw new Error(`spawn vegetation was not visible at mobile spawn: ${JSON.stringify(info)}`);
		}
		console.log(`[checkMobileVegetationCulling] transitions ${JSON.stringify(info)}`);
		console.log('[checkMobileVegetationCulling] PASS: remote vegetation disc hidden; spawn disc visible.');
	} finally {
		await context.close();
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[checkMobileVegetationCulling] FAIL:', error.message || error);
	process.exit(1);
});
