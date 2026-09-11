#!/usr/bin/env node
/** Two-angle mobile visual evidence for Run 136 vegetation LOD. */
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const outDir = path.resolve(__dirname, '..', 'artifacts', 'run136-mobile-vegetation-lod');
	fs.mkdirSync(outDir, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
	const page = await context.newPage();
	try {
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await page.waitForFunction(() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'), { timeout: 60000 });
		await page.waitForTimeout(1500);
		await page.screenshot({ path: path.join(outDir, 'mobile-near.png'), fullPage: true });
		await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' })));
		await page.waitForTimeout(1000);
		await page.screenshot({ path: path.join(outDir, 'mobile-f4-far.png'), fullPage: true });
		console.log('[captureRun136MobileVegetationEvidence] PASS: 2 mobile views captured.');
	} finally {
		await context.close();
		await browser.close();
		server.close();
	}
}
main().catch((error) => { console.error(error); process.exit(1); });
