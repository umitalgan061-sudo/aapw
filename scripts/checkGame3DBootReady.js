#!/usr/bin/env node
const { startStaticServer, loadPlaywright } = require('./devServerHelper');

(async () => {
	const server = await startStaticServer();
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright unavailable');
	const browser = await playwright.chromium.launch({ headless: true });
	const page = await browser.newPage();
	const errors = [];
	let externalBlocked = 0;
	page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
	page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
	await page.route('**/*', (route, request) => {
		const url = request.url();
		if (url.startsWith(server.baseUrl) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
		externalBlocked += 1;
		return route.abort();
	});
	try {
		await page.goto(`${server.baseUrl}/game3d.html`, { waitUntil: 'commit', timeout: 30_000 });
		const state = await page.waitForFunction(() => {
			const el = document.getElementById('game3d-loading');
			return el?.classList.contains('g3d-loading-hidden') ? 'ready' : el?.classList.contains('g3d-loading-error') ? 'error' : false;
		}, null, { timeout: 60_000, polling: 250 }).then((handle) => handle.jsonValue());
		if (state !== 'ready' || errors.length || externalBlocked) throw new Error(`state=${state} errors=${errors.join('; ')} externalBlocked=${externalBlocked}`);
		console.log('GAME3D_BOOT_READY_OK');
	} finally { await page.close(); await browser.close(); await server.stop(); }
})().catch((error) => { console.error(`[checkGame3DBootReady] FAIL: ${error.stack || error}`); process.exit(1); });