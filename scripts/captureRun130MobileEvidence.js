#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');
async function main() {
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const out = path.resolve('artifacts/run130-mobile');
	fs.mkdirSync(out, { recursive: true });
	const server = await startStaticServer();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	const errors = [];
	try {
		const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
		const page = await context.newPage();
		page.on('pageerror', (e) => errors.push(`page:${e.message}`));
		page.on('console', (m) => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await page.waitForFunction(() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'), { timeout: 60000 });
		await page.screenshot({ path: path.join(out, 'mobile-near.png'), fullPage: true });
		await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' })));
		await page.keyboard.down('KeyW');
		await page.waitForTimeout(1400);
		await page.keyboard.up('KeyW');
		await page.screenshot({ path: path.join(out, 'mobile-f4-far.png'), fullPage: true });
		await context.close();
		if (errors.length) throw new Error(errors.join('\n'));
		console.log(`[run130-visual] PASS: 2 screenshots at ${out}; zero console/page errors.`);
	} finally { await browser.close(); server.close(); }
}
main().catch((e) => { console.error('[run130-visual] FAIL:', e); process.exit(1); });
