#!/usr/bin/env node
/** Run210: prove a fresh service-worker install can boot the owner-surface RTS fully offline. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
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

async function main() {
	const playwright = playwrightModule();
	if (!playwright) throw new Error('Playwright unavailable');
	const s = await server();
	const browser = await playwright.chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' });
	const page = await context.newPage();
	const errors = [];
	page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
	page.on('pageerror', error => errors.push(String(error)));
	const base = `http://127.0.0.1:${s.address().port}`;
	try {
		await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
		await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.register('./service-worker.js');
			await navigator.serviceWorker.ready;
			if (registration.installing) await new Promise(resolve => registration.installing.addEventListener('statechange', () => registration.installing?.state === 'activated' && resolve(), { once: false }));
		});
		await page.waitForFunction(async () => {
			const shell = await caches.open('westeros-shell-v11');
			const media = await caches.open('westeros-media-v4');
			const required = [
				await shell.match(new URL('./rts.html', location.href).href),
				await shell.match(new URL('./src/3d/rts/rtsSurfaceTexture.js', location.href).href),
				await media.match(new URL('./assets/textures/yüzey/overlay/overlay.png', location.href).href),
			];
			return required.every(Boolean);
		}, null, { timeout: 180000 });
		await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30000 });
		await context.setOffline(true);
		await page.goto(`${base}/rts.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
		await page.waitForSelector('body[data-rts-ready="true"]', { timeout: 180000 });
		await page.waitForFunction(() => window.__WESTEROS_RTS_SURFACE__?.status === 'ready', null, { timeout: 60000 });
		const snapshot = await page.evaluate(() => ({
			surface: { ...window.__WESTEROS_RTS_SURFACE__ },
			rts: window.__WESTEROS_RTS__?.getSnapshot?.(),
			controlled: navigator.serviceWorker.controller !== null,
		}));
		assert(snapshot.controlled === true, 'offline RTS page is not service-worker controlled');
		assert(snapshot.surface?.status === 'ready', `offline surface status=${snapshot.surface?.status}`);
		assert(snapshot.surface?.sourceWidth === 3072 && snapshot.surface?.sourceHeight === 3072, 'offline source dimensions drifted');
		assert(snapshot.rts?.selectedCount === 48, 'offline RTS selection state drifted');
		assert(errors.length === 0, `offline console/page errors: ${errors.join(' | ')}`);
		console.log(`[checkRun210RtsSurfaceOffline] PROOF: ${JSON.stringify(snapshot)}`);
		console.log('[checkRun210RtsSurfaceOffline] PASS: fresh SW install -> network offline -> RTS + owner surface booted from cache with zero errors');
	} finally {
		await context.setOffline(false).catch(() => {});
		await context.close();
		await browser.close();
		await new Promise(resolve => s.close(resolve));
	}
}

main().catch(error => {
	console.error(`[checkRun210RtsSurfaceOffline] FAIL: ${error.stack || error}`);
	process.exitCode = 1;
});
