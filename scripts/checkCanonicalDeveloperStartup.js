#!/usr/bin/env node
/** Run200 browser proof: explicit canonical startup, rollback, and production-SW offline equivalence. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run200-canonical-developer-startup');
const GAME3D = path.join(ROOT, 'src', '3d', 'game3d.js');
const ANCHOR = '\t\tconst state = createScene(canvas);';
const INJECTED = `${ANCHOR}\n\t\twindow.__RUN200_STATE__ = state;`;
const BRIDGE_ID = 'cersei->stannis#1';
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.fbx':'application/octet-stream','.glb':'model/gltf-binary','.gltf':'model/gltf+json','.bin':'application/octet-stream' };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (_) { /* try next */ }
	}
	return null;
}

function transformedGame3d() {
	const source = fs.readFileSync(GAME3D, 'utf8');
	assert(source.includes(ANCHOR), 'game3d state anchor missing');
	assert(!source.includes('__RUN200_STATE__'), 'Run200 observation hook leaked into repository source');
	return source.replace(ANCHOR, INJECTED);
}

function startServer() {
	const transformed = transformedGame3d();
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			if (clean === '/src/3d/game3d.js') {
				res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
				res.end(transformed);
				return;
			}
			const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
			const file = path.join(ROOT, relative);
			if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
				res.writeHead(404); res.end('Not found'); return;
			}
			res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
			fs.createReadStream(file).pipe(res);
		} catch (error) {
			res.writeHead(500); res.end(String(error));
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function runtimeReady() {
	const state = window.__RUN200_STATE__;
	return Boolean(state?.player && state?.keyboardInput && state?.interaction && state?.worldEvents && state?.chunkManager?.loaded?.size > 0 && state?.npcs?.length && state?.animals?.length && state?.dragons?.length);
}

async function shape(page) {
	return page.evaluate(() => {
		const s = window.__RUN200_STATE__;
		return { loadedChunks:s.chunkManager.loaded.size,npcs:s.npcs.length,animals:s.animals.length,dragons:s.dragons.length,hasPlayer:Boolean(s.player?.object3D),hasInteraction:Boolean(s.interaction),hasWorldEvents:Boolean(s.worldEvents) };
	});
}

async function importAndActivate(page) {
	return page.evaluate(async ({ bridgeId }) => {
		const { createCanonicalDeveloperStartup } = await import('/developer/canonicalDeveloperStartup.js');
		const controller = createCanonicalDeveloperStartup({ state: window.__RUN200_STATE__, profile: 'mobile', bridgeId });
		window.__RUN200_CONTROLLER__ = controller;
		return { mode:controller.getMode(),bridgeId:controller.bridgeTarget.bridgeId,version:controller.version };
	}, { bridgeId: BRIDGE_ID });
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright unavailable');
	fs.mkdirSync(OUT, { recursive: true });
	const server = await startServer();
	const browser = await playwright.chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport:{ width:1440,height:900 }, serviceWorkers:'allow' });
	const consoleErrors = [];
	try {
		const page = await context.newPage();
		page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
		page.on('pageerror', (error) => consoleErrors.push(String(error)));
		const origin = `http://127.0.0.1:${server.address().port}`;
		await page.goto(`${origin}/game3d.html`, { waitUntil:'domcontentloaded', timeout:30000 });
		await page.waitForFunction(runtimeReady, null, { timeout:60000 });
		const currentBefore = await shape(page);

		const canonical = await importAndActivate(page);
		assert(canonical.mode === 'canonical', `expected canonical mode, got ${canonical.mode}`);
		assert(canonical.bridgeId === BRIDGE_ID, `unexpected bridge ${canonical.bridgeId}`);
		await page.waitForTimeout(300);
		const stats = await page.evaluate(() => window.__RUN200_CONTROLLER__.getFreezeStats());
		assert(Object.keys(stats).length === 23, `expected 23 freeze targets, got ${Object.keys(stats).length}`);
		assert(Object.values(stats).every((entry) => entry.blockedCalls > 0), 'real tick did not hit every freeze gate');
		await page.screenshot({ path:path.join(OUT, 'canonical-active.png') });

		const rollbackMode = await page.evaluate(() => { const c=window.__RUN200_CONTROLLER__; c.rollbackToCurrent(); return c.getMode(); });
		assert(rollbackMode === 'current', 'rollback did not restore current mode');
		await page.waitForTimeout(150);
		const currentAfterRollback = await shape(page);
		assert(JSON.stringify(currentAfterRollback) === JSON.stringify(currentBefore), 'runtime shape changed across rollback');

		await page.evaluate(async () => { await navigator.serviceWorker.register('/service-worker.js'); await navigator.serviceWorker.ready; });
		await page.reload({ waitUntil:'domcontentloaded', timeout:30000 });
		await page.waitForFunction(runtimeReady, null, { timeout:60000 });
		await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout:15000 });
		const controlledOnline = await shape(page);
		// Explicit controlled import proves the unchanged production SW dynamically caches the
		// developer-only module through its existing same-origin network-first cache.put path.
		await page.evaluate(() => import('/developer/canonicalDeveloperStartup.js').then(() => true));

		await context.setOffline(true);
		await page.reload({ waitUntil:'domcontentloaded', timeout:30000 });
		await page.waitForFunction(runtimeReady, null, { timeout:60000 });
		const offlineCurrent = await shape(page);
		assert(JSON.stringify(offlineCurrent) === JSON.stringify(controlledOnline), 'offline current boot differs from controlled online boot');
		const offlineCanonical = await importAndActivate(page);
		await page.waitForTimeout(250);
		const offlineProof = await page.evaluate(() => {
			const c=window.__RUN200_CONTROLLER__, stats=c.getFreezeStats();
			const result={ mode:c.getMode(),freezeTargets:Object.keys(stats).length,allBlocked:Object.values(stats).every((entry)=>entry.blockedCalls>0) };
			c.dispose(); result.disposed=c.isDisposed(); return result;
		});
		assert(offlineProof.mode === 'canonical' && offlineProof.freezeTargets === 23 && offlineProof.allBlocked && offlineProof.disposed, 'offline canonical startup/dispose proof failed');
		await page.screenshot({ path:path.join(OUT, 'offline-current-after-canonical-dispose.png') });
		assert(consoleErrors.length === 0, `console/page errors: ${consoleErrors.join(' | ')}`);
		const proof={ currentBefore,currentAfterRollback,controlledOnline,offlineCurrent,canonical,offlineCanonical:offlineProof,consoleErrors };
		fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof,null,2)}\n`);
		console.log(`[checkCanonicalDeveloperStartup] PASS: bridge=${BRIDGE_ID}; freezeTargets=23; productionSwDynamicCache=true; offlineEquivalent=true; consoleErrors=0`);
	} finally {
		await context.setOffline(false).catch(() => {});
		await context.close().catch(() => {});
		await browser.close().catch(() => {});
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => { console.error('[checkCanonicalDeveloperStartup] FAIL:', error?.stack || error); process.exit(1); });
