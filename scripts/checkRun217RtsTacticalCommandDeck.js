#!/usr/bin/env node
/** Run217: desktop/mobile browser proof for the additive RTS tactical command deck. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run217-rts-tactical-command-deck');
const assert = (value, message) => { if (!value) throw new Error(message); };

function playwrightModule() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch {}
	}
	return null;
}

function contentType(file) {
	const ext = path.extname(file).toLowerCase();
	if (ext === '.html') return 'text/html; charset=utf-8';
	if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
	if (ext === '.css') return 'text/css; charset=utf-8';
	if (ext === '.json' || ext === '.webmanifest') return ext === '.webmanifest' ? 'application/manifest+json' : 'application/json; charset=utf-8';
	if (ext === '.svg') return 'image/svg+xml';
	if (ext === '.png') return 'image/png';
	if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
	if (ext === '.glb') return 'model/gltf-binary';
	if (ext === '.gltf') return 'model/gltf+json';
	return 'application/octet-stream';
}

function startServer() {
	const server = http.createServer((req, res) => {
		const clean = decodeURIComponent(req.url.split('?')[0]);
		const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
		const file = path.resolve(ROOT, relative);
		if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404);
			res.end('Not found');
			return;
		}
		res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
		fs.createReadStream(file).pipe(res);
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function openRts(browser, base, options) {
	const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
	const page = await context.newPage();
	const errors = [];
	page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
	page.on('pageerror', (error) => errors.push(String(error)));
	await page.goto(`${base}/rts.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
	await page.waitForSelector('body[data-rts-ready="true"]', { timeout: 180000 });
	await page.waitForFunction(() => Boolean(window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__?.getSnapshot));
	await page.waitForSelector('#rts-tactical-command-deck');
	await page.waitForTimeout(700);
	return { context, page, errors };
}

async function desktopProof(browser, base) {
	const opened = await openRts(browser, base, { viewport: { width: 1440, height: 900 } });
	const { page, errors } = opened;
	try {
		let snapshot = await page.evaluate(() => window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__.getSnapshot());
		assert(snapshot.unitCount === 48, `desktop unit count drifted: ${snapshot.unitCount}`);
		assert(snapshot.selectedCount === 48, `desktop initial selection drifted: ${snapshot.selectedCount}`);
		assert(snapshot.drawCalls < 2500, `desktop draw-call budget exceeded: ${snapshot.drawCalls}`);
		assert(snapshot.triangles < 5000000, `desktop triangle budget exceeded: ${snapshot.triangles}`);

		await page.click('[data-action="clear"]');
		await page.waitForFunction(() => window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__.getSnapshot().selectedCount === 0);
		await page.click('[data-action="select-all"]');
		await page.waitForFunction(() => window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__.getSnapshot().selectedCount === 48);

		await page.click('[data-action="move"]');
		snapshot = await page.evaluate(() => window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__.getSnapshot());
		assert(snapshot.moveMode === true, 'desktop tactical move delegation failed');
		await page.click('[data-action="move"]');
		snapshot = await page.evaluate(() => window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__.getSnapshot());
		assert(snapshot.moveMode === false, 'desktop tactical move toggle-off failed');

		await page.keyboard.press('KeyH');
		snapshot = await page.evaluate(() => window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__.getSnapshot());
		assert(snapshot.collapsed === true, 'desktop H collapse failed');
		await page.keyboard.press('KeyH');
		snapshot = await page.evaluate(() => window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__.getSnapshot());
		assert(snapshot.collapsed === false, 'desktop H expand failed');

		const up = page.locator('[data-pan="up"]');
		await up.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'mouse', button: 0 });
		await page.waitForFunction(() => window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__.getSnapshot().activePanCodes.includes('KeyW'));
		await page.waitForTimeout(350);
		await up.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'mouse', button: 0 });
		await page.waitForFunction(() => window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__.getSnapshot().activePanCodes.length === 0);
		await page.click('[data-action="zoom-in"]');
		await page.click('[data-action="zoom-out"]');
		await page.click('[data-action="focus"]');
		await page.waitForTimeout(150);

		snapshot = await page.evaluate(() => window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__.getSnapshot());
		assert(snapshot.panDispatchCount >= 1, 'desktop camera pan was not delegated');
		assert(snapshot.historyCount >= 2, `desktop command history too short: ${snapshot.historyCount}`);
		assert(errors.length === 0, `desktop console/page errors: ${errors.join(' | ')}`);
		await page.screenshot({ path: path.join(OUT, 'desktop-command-deck-near.png'), fullPage: true });

		await page.keyboard.down('KeyW');
		await page.keyboard.down('KeyD');
		await page.waitForTimeout(650);
		await page.keyboard.up('KeyD');
		await page.keyboard.up('KeyW');
		await page.mouse.wheel(0, 900);
		await page.waitForTimeout(350);
		await page.screenshot({ path: path.join(OUT, 'desktop-command-deck-far.png'), fullPage: true });
		assert(errors.length === 0, `desktop far-view errors: ${errors.join(' | ')}`);
		return snapshot;
	} finally {
		await opened.context.close();
	}
}

async function mobileProof(browser, base) {
	const opened = await openRts(browser, base, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
	const { page, errors } = opened;
	try {
		const panelVisible = await page.isVisible('#rts-tactical-command-deck');
		assert(panelVisible, 'mobile tactical command deck hidden');
		const sizes = await page.locator('.rts-tactical-camera button').evaluateAll((buttons) => buttons.map((button) => {
			const rect = button.getBoundingClientRect();
			return { width: rect.width, height: rect.height };
		}));
		assert(sizes.length === 6, `mobile camera control count drifted: ${sizes.length}`);
		assert(sizes.every(({ width, height }) => width >= 44 && height >= 44), `mobile touch target below 44px: ${JSON.stringify(sizes)}`);

		await page.click('[data-action="clear"]');
		await page.waitForFunction(() => window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__.getSnapshot().selectedCount === 0);
		await page.click('[data-action="select-all"]');
		await page.waitForFunction(() => window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__.getSnapshot().selectedCount === 48);
		const right = page.locator('[data-pan="right"]');
		await right.dispatchEvent('pointerdown', { pointerId: 9, pointerType: 'touch', button: 0 });
		await page.waitForTimeout(220);
		await right.dispatchEvent('pointerup', { pointerId: 9, pointerType: 'touch', button: 0 });
		await page.waitForFunction(() => window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__.getSnapshot().activePanCodes.length === 0);
		await page.click('[data-action="zoom-in"]');
		await page.waitForTimeout(150);

		const snapshot = await page.evaluate(() => window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__.getSnapshot());
		assert(snapshot.unitCount === 48 && snapshot.selectedCount === 48, `mobile selection drift: ${JSON.stringify(snapshot)}`);
		assert(snapshot.drawCalls < 500, `mobile draw-call budget exceeded: ${snapshot.drawCalls}`);
		assert(snapshot.triangles < 500000, `mobile triangle budget exceeded: ${snapshot.triangles}`);
		assert(snapshot.panDispatchCount >= 1, 'mobile camera pan delegation failed');
		assert(errors.length === 0, `mobile console/page errors: ${errors.join(' | ')}`);
		await page.screenshot({ path: path.join(OUT, 'mobile-command-deck.png'), fullPage: true });
		return snapshot;
	} finally {
		await opened.context.close();
	}
}

async function main() {
	const playwright = playwrightModule();
	if (!playwright) throw new Error('Playwright unavailable');
	fs.mkdirSync(OUT, { recursive: true });
	const server = await startServer();
	const browser = await playwright.chromium.launch({ headless: true });
	const base = `http://127.0.0.1:${server.address().port}`;
	try {
		const desktop = await desktopProof(browser, base);
		const mobile = await mobileProof(browser, base);
		const proof = {
			desktop,
			mobile,
			visualEvidence: ['desktop-command-deck-near.png', 'desktop-command-deck-far.png', 'mobile-command-deck.png'],
			consoleErrors: 0,
			tacticalCommandDeck: true,
		};
		fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
		console.log(`[checkRun217RtsTacticalCommandDeck] PROOF: ${JSON.stringify(proof)}`);
		console.log('[checkRun217RtsTacticalCommandDeck] PASS: command delegation, selection clear/all, move toggle, H panel, camera pan/zoom, desktop/mobile budgets and zero console/page errors');
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkRun217RtsTacticalCommandDeck] FAIL: ${error.stack || error}`);
	process.exitCode = 1;
});
