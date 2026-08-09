#!/usr/bin/env node
/** Run200: browser proof for opt-in canonical startup, rollback, and offline current fallback. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run200-canonical-developer-startup');
const GAME3D_PATH = path.join(ROOT, 'src', '3d', 'game3d.js');
const STATE_ANCHOR = '\t\tconst state = createScene(canvas);';
const STATE_INJECTION = `${STATE_ANCHOR}\n\t\twindow.__RUN200_STATE__ = state;`;
const BRIDGE_ID = 'cersei->stannis#1';
const MIME = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.fbx': 'application/octet-stream',
	'.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (error) { /* try next */ }
	}
	return null;
}

function transformedGame3dSource() {
	const source = fs.readFileSync(GAME3D_PATH, 'utf8');
	assert(source.includes(STATE_ANCHOR), 'game3d state anchor missing');
	assert(!source.includes('__RUN200_STATE__'), 'Run200 observation hook leaked into repository source');
	return source.replace(STATE_ANCHOR, STATE_INJECTION);
}

function startServer() {
	const transformed = transformedGame3dSource();
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
	return Boolean(
		state?.player && state?.keyboardInput && state?.interaction && state?.worldEvents &&
		Array.isArray(state?.npcs) && state.npcs.length > 0 &&
		Array.isArray(state?.animals) && state.animals.length > 0 &&
		Array.isArray(state?.dragons) && state.dragons.length > 0 &&
		state?.chunkManager?.loaded?.size > 0
	);
}

async function captureRuntimeShape(page) {
	return page.evaluate(() => {
		const state = window.__RUN200_STATE__;
		return {
			loadedChunks: state.chunkManager.loaded.size,
			npcs: state.npcs.length,
			animals: state.animals.length,
			dragons: state.dragons.length,
			hasPlayer: Boolean(state.player?.object3D),
			hasInteraction: Boolean(state.interaction),
			hasWorldEvents: Boolean(state.worldEvents),
		};
	});
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright unavailable');
	fs.mkdirSync(OUT, { recursive: true });
	const server = await startServer();
	const browser = await playwright.chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow' });
	const consoleErrors = [];
	try {
		const page = await context.newPage();
		page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
		page.on('pageerror', (error) => consoleErrors.push(String(error)));
		const origin = `http://127.0.0.1:${server.address().port}`;
		await page.goto(`${origin}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForFunction(runtimeReady, null, { timeout: 60000 });
		const currentBefore = await captureRuntimeShape(page);

		const canonical = await page.evaluate(async ({ bridgeId }) => {
			const state = window.__RUN200_STATE__;
			const { createCanonicalDeveloperStartup } = await import('/src/3d/world/worldReferenceCanonicalDeveloperStartup.js');
			const controller = createCanonicalDeveloperStartup({ state, profile: 'mobile', bridgeId });
			window.__RUN200_CONTROLLER__ = controller;
			return {
				mode: controller.getMode(),
				bridgeId: controller.bridgeTarget.bridgeId,
				version: controller.version,
			};
		}, { bridgeId: BRIDGE_ID });
		assert(canonical.mode === 'canonical', `expected canonical mode, got ${canonical.mode}`);
		assert(canonical.bridgeId === BRIDGE_ID, `unexpected bridge target ${canonical.bridgeId}`);
		await page.waitForTimeout(300);
		const freezeStats = await page.evaluate(() => window.__RUN200_CONTROLLER__.getFreezeStats());
		assert(Object.keys(freezeStats).length > 0, 'canonical freeze stats empty');
		assert(Object.values(freezeStats).every((entry) => entry.blockedCalls > 0), 'real tick did not hit every canonical freeze gate');
		await page.screenshot({ path: path.join(OUT, 'canonical-active.png') });

		const rollback = await page.evaluate(() => {
			const controller = window.__RUN200_CONTROLLER__;
			const result = controller.rollbackToCurrent();
			return { mode: controller.getMode(), result };
		});
		assert(rollback.mode === 'current', 'rollback did not restore current mode');
		await page.waitForTimeout(150);
		const currentAfterRollback = await captureRuntimeShape(page);
		assert(JSON.stringify(currentAfterRollback) === JSON.stringify(currentBefore), 'runtime shape changed across canonical rollback');

		await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.register('/service-worker.js');
			await navigator.serviceWorker.ready;
			await registration.update();
		});
		await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForFunction(runtimeReady, null, { timeout: 60000 });
		await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
		const controlledOnline = await captureRuntimeShape(page);

		await context.setOffline(true);
		await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForFunction(runtimeReady, null, { timeout: 60000 });
		const offlineCurrent = await captureRuntimeShape(page);
		assert(JSON.stringify(offlineCurrent) === JSON.stringify(controlledOnline), 'offline current boot shape differs from service-worker-controlled online boot');

		const offlineCanonical = await page.evaluate(async ({ bridgeId }) => {
			const state = window.__RUN200_STATE__;
			const { createCanonicalDeveloperStartup } = await import('/src/3d/world/worldReferenceCanonicalDeveloperStartup.js');
			const controller = createCanonicalDeveloperStartup({ state, profile: 'mobile', bridgeId });
			await new Promise((resolve) => setTimeout(resolve, 250));
			const stats = controller.getFreezeStats();
			const result = {
				mode: controller.getMode(),
				bridgeId: controller.bridgeTarget.bridgeId,
				freezeTargets: Object.keys(stats).length,
				allBlocked: Object.values(stats).every((entry) => entry.blockedCalls > 0),
			};
			controller.dispose();
			result.modeAfterDispose = controller.isDisposed() ? 'disposed' : controller.getMode();
			return result;
		}, { bridgeId: BRIDGE_ID });
		assert(offlineCanonical.mode === 'canonical', 'offline developer startup did not enter canonical mode');
		assert(offlineCanonical.allBlocked, 'offline canonical startup did not freeze every real tick target');
		assert(offlineCanonical.modeAfterDispose === 'disposed', 'offline canonical startup did not dispose cleanly');
		await page.screenshot({ path: path.join(OUT, 'offline-current-after-canonical-dispose.png') });

		await context.setOffline(false);
		await page.evaluate(() => window.__RUN200_CONTROLLER__?.dispose?.());
		assert(consoleErrors.length === 0, `console/page errors: ${consoleErrors.join(' | ')}`);
		const proof = { currentBefore, currentAfterRollback, controlledOnline, offlineCurrent, canonical, offlineCanonical, consoleErrors };
		fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
		console.log(`[checkCanonicalDeveloperStartup] PASS: bridge=${BRIDGE_ID}; freezeTargets=${offlineCanonical.freezeTargets}; offlineEquivalent=true; consoleErrors=0`);
	} finally {
		await context.setOffline(false).catch(() => {});
		await context.close().catch(() => {});
		await browser.close().catch(() => {});
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error('[checkCanonicalDeveloperStartup] FAIL:', error?.stack || error);
	process.exit(1);
});
