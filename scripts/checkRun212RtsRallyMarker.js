#!/usr/bin/env node
/** Run212: prove the RTS move destination gets a bounded world-space rally marker. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run212');
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
	if (ext === '.png') return 'image/png';
	if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
	if (ext === '.svg') return 'image/svg+xml';
	if (ext === '.glb') return 'model/gltf-binary';
	if (ext === '.gltf') return 'model/gltf+json';
	if (ext === '.fbx') return 'application/octet-stream';
	return 'application/octet-stream';
}

function server() {
	const instance = http.createServer((req, res) => {
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
	return new Promise(resolve => instance.listen(0, '127.0.0.1', () => resolve(instance)));
}

async function capture(browser, base, mobile, errors) {
	const context = await browser.newContext(mobile ? {
		viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
	} : { viewport: { width: 1440, height: 900 } });
	const page = await context.newPage();
	const label = mobile ? 'mobile' : 'desktop';
	page.on('console', message => { if (message.type() === 'error') errors.push(`${label} console: ${message.text()}`); });
	page.on('pageerror', error => errors.push(`${label} pageerror: ${String(error)}`));
	try {
		await page.goto(`${base}/rts.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
		await page.waitForSelector('body[data-rts-ready="true"]', { timeout: 180000 });
		await page.waitForFunction(() => window.__WESTEROS_RTS_RALLY__?.getSnapshot, null, { timeout: 30000 });
		await page.waitForFunction(() => window.__WESTEROS_RTS_SURFACE__?.status === 'ready', null, { timeout: 60000 });
		const canvas = page.locator('#rts-canvas');
		const box = await canvas.boundingBox();
		assert(box, `${label} canvas missing`);
		const x = box.x + box.width * (mobile ? 0.58 : 0.62);
		const y = box.y + box.height * (mobile ? 0.58 : 0.55);
		await page.mouse.click(x, y, { button: 'right' });
		await page.waitForFunction(() => window.__WESTEROS_RTS_RALLY__.getSnapshot().visible === true, null, { timeout: 10000 });
		const active = await page.evaluate(() => ({
			marker: window.__WESTEROS_RTS_RALLY__.getSnapshot(),
			rts: window.__WESTEROS_RTS__.getSnapshot(),
			status: document.getElementById('rts-status')?.textContent || '',
		}));
		assert(active.marker.visible === true, `${label} marker not visible`);
		assert(active.marker.opacity > 0.1, `${label} opacity=${active.marker.opacity}`);
		assert(active.marker.position.y > 6, `${label} marker is not terrain-clamped: y=${active.marker.position.y}`);
		assert(active.status.includes('asker hedefe ilerliyor'), `${label} command did not stay owned by RTS runtime: ${active.status}`);
		assert(active.rts.selectedCount === 48, `${label} selection drifted=${active.rts.selectedCount}`);
		assert(active.rts.drawCalls < (mobile ? 500 : 2500), `${label} draw-call budget exceeded=${active.rts.drawCalls}`);
		assert(active.rts.triangles < (mobile ? 500000 : 5000000), `${label} triangle budget exceeded=${active.rts.triangles}`);
		await page.screenshot({ path: path.join(ARTIFACT_DIR, `${label}-rally-marker.png`), fullPage: true });
		await page.waitForTimeout(1900);
		const expired = await page.evaluate(() => window.__WESTEROS_RTS_RALLY__.getSnapshot());
		assert(expired.visible === false, `${label} marker did not expire`);
		return { active, expired };
	} finally {
		await context.close();
	}
}

async function main() {
	const playwright = playwrightModule();
	if (!playwright) throw new Error('Playwright unavailable');
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const s = await server();
	const browser = await playwright.chromium.launch({ headless: true });
	const errors = [];
	const base = `http://127.0.0.1:${s.address().port}`;
	try {
		const desktop = await capture(browser, base, false, errors);
		const mobile = await capture(browser, base, true, errors);
		assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
		const proof = { desktop, mobile, errors, visualEvidence: ['desktop-rally-marker.png', 'mobile-rally-marker.png'] };
		fs.writeFileSync(path.join(ARTIFACT_DIR, 'proof.json'), JSON.stringify(proof, null, 2));
		console.log(`[checkRun212RtsRallyMarker] PROOF: ${JSON.stringify(proof)}`);
		console.log('[checkRun212RtsRallyMarker] PASS: successful move command keeps existing ownership and shows a bounded world-space terrain-clamped marker on desktop/mobile');
	} finally {
		await browser.close();
		await new Promise(resolve => s.close(resolve));
	}
}

main().catch(error => {
	console.error(`[checkRun212RtsRallyMarker] FAIL: ${error.stack || error}`);
	process.exitCode = 1;
});
