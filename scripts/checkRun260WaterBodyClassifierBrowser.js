#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const artifactDir = path.join(process.cwd(), 'artifacts', 'run260-water-body-classifier');
	fs.mkdirSync(artifactDir, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	const browserErrors = [];
	page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
	page.on('console', (message) => {
		if (message.type() === 'error') browserErrors.push(`console.error: ${message.text()}`);
	});

	try {
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForSelector('#game3d-canvas', { timeout: 30000 });
		await page.waitForTimeout(5000);

		const classification = await page.evaluate(async () => {
			const module = await import('/src/3d/world/waterBodyClassifier.js');
			const center = (cell, size) => (cell + 0.5) / size;
			const stats = module.WORLD_REFERENCE_WATER_BODY_STATS;
			return {
				stats,
				isolatedLake: module.sampleReferenceWaterBodyKind(center(16, stats.width), center(12, stats.height)),
				clusteredLake: module.sampleReferenceWaterBodyKind(center(68, stats.width), center(29, stats.height)),
				sea: module.sampleReferenceWaterBodyKind(center(0, stats.width), center(0, stats.height)),
			};
		});
		assert(classification.stats.seaCellCount === 4046, 'browser sea count mismatch');
		assert(classification.stats.lakeCellCount === 6, 'browser lake count mismatch');
		assert(classification.isolatedLake === 'lake', 'browser isolated lake classification mismatch');
		assert(classification.clusteredLake === 'lake', 'browser clustered lake classification mismatch');
		assert(classification.sea === 'sea', 'browser sea classification mismatch');

		await page.screenshot({ path: path.join(artifactDir, 'angle-default.png'), fullPage: true });
		const canvas = await page.$('#game3d-canvas');
		const box = await canvas.boundingBox();
		assert(box && box.width > 100 && box.height > 100, '3D canvas must be visible for visual proof');
		const startX = box.x + box.width * 0.55;
		const startY = box.y + box.height * 0.5;
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(startX + Math.min(220, box.width * 0.18), startY - Math.min(100, box.height * 0.12), { steps: 12 });
		await page.mouse.up();
		await page.waitForTimeout(750);
		await page.screenshot({ path: path.join(artifactDir, 'angle-orbit.png'), fullPage: true });
		assert(browserErrors.length === 0, `browser errors: ${browserErrors.join(' | ')}`);
		console.log('[checkRun260WaterBodyClassifierBrowser] PASS: browser classification + two-angle visual proof + console zero.');
	} finally {
		await page.close();
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkRun260WaterBodyClassifierBrowser] FAIL: ${error.stack || error.message}`);
	process.exit(1);
});
