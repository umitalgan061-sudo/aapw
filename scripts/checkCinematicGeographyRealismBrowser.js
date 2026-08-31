#!/usr/bin/env node
'use strict';

const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkCinematicGeographyRealismBrowser] SKIP: Playwright is not available.');
		process.exit(2);
	}

	const server = await startStaticServer();
	const browser = await playwright.chromium.launch({
		headless: true,
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
	});

	try {
		const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
		const pageErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error)));
		await page.goto(`http://127.0.0.1:${server.address().port}/scripts/cinematicGeographyRealismHarness.html`, {
			waitUntil: 'domcontentloaded',
			timeout: 30000,
		});
		await page.waitForFunction(() => document.body.dataset.cinematicGeographyHarness !== 'loading', null, { timeout: 30000 });
		const result = await page.evaluate(() => ({
			state: document.body.dataset.cinematicGeographyHarness,
			proof: JSON.parse(document.getElementById('cinematic-geography-result').textContent || '{}'),
		}));

		assert(result.state === 'ready', `harness state ${result.state}: ${result.proof.error || 'unknown error'}`);
		assert(result.proof.ok === true, `WebGL proof failed: ${result.proof.error || 'unknown error'}`);
		assert(result.proof.shaderErrors.length === 0, `shader errors: ${result.proof.shaderErrors.join(' | ')}`);
		assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
		assert(result.proof.programCount >= 3, `expected terrain/water/road programs, got ${result.proof.programCount}`);
		assert(result.proof.allProgramsRunnable === true, 'at least one WebGL program is not runnable');
		assert(result.proof.terrainNaturalTransition === 'v1-slope-aspect-shelter', 'terrain natural transition revision drifted');
		assert(result.proof.waterBreakerRevision === 'v1-bathymetry-directed-irregular-lace', 'water breaker revision drifted');
		assert(result.proof.waterMetadata === true, 'water breaker telemetry missing');
		assert(result.proof.roadEdgeErosion === true, 'road edge erosion telemetry missing');
		assert(result.proof.roadDrawCallsAdded === 0, 'road realism added draw calls');

		console.log(`[checkCinematicGeographyRealismBrowser] PASS: ${result.proof.programCount} runnable WebGL programs; slope/aspect terrain, directional irregular surf, and eroded road shoulders.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkCinematicGeographyRealismBrowser] FAIL: ${error?.stack || error}`);
	process.exit(1);
});

