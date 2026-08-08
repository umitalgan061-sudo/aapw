#!/usr/bin/env node
/** Run198 v3: canonical-active pagehide + clean same-document re-init with full current chunk mutation freeze. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run198-lifecycle-chunk-freeze-shadow');
const GAME3D_PATH = path.join(ROOT, 'src', '3d', 'game3d.js');
const STATE_ANCHOR = '\t\tconst state = createScene(canvas);';
const STATE_INJECTION = `${STATE_ANCHOR}\n\t\twindow.__RUN198_V3_STATES__ = window.__RUN198_V3_STATES__ || [];\n\t\twindow.__RUN198_V3_STATES__.push(state);`;
const MIME = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
	'.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.fbx': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (error) { /* try next */ }
	}
	return null;
}

function transformedGame3dSource() {
	const source = fs.readFileSync(GAME3D_PATH, 'utf8');
	assert(source.includes(STATE_ANCHOR), 'game3d state anchor missing');
	assert(!source.includes('__RUN198_V3_STATES__'), 'Run198 v3 observation hook leaked into repository source');
	return source.replace(STATE_ANCHOR, STATE_INJECTION);
}

function startServer() {
	const transformed = transformedGame3dSource();
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			if (clean === '/src/3d/game3d.js') {
				res.writeHead(200, { 'Content-Type': MIME['.js'] }); res.end(transformed); return;
			}
			const relative = clean === '/' ? 'game3d.html' : clean.replace(/^\//, '');
			const file = path.join(ROOT, relative);
			if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
			res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
			fs.createReadStream(file).pipe(res);
		} catch (error) { res.writeHead(500); res.end(String(error)); }
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function installLifecycleInstrumentation(page) {
	await page.addInitScript(() => {
		const nativeRaf = window.requestAnimationFrame.bind(window);
		const nativeCancel = window.cancelAnimationFrame.bind(window);
		const activeRafs = new Set();
		window.requestAnimationFrame = (callback) => {
			let id = 0;
			id = nativeRaf((time) => { activeRafs.delete(id); callback(time); });
			activeRafs.add(id);
			return id;
		};
		window.cancelAnimationFrame = (id) => { activeRafs.delete(id); return nativeCancel(id); };
		const nativeSetInterval = window.setInterval.bind(window);
		const nativeClearInterval = window.clearInterval.bind(window);
		const activeIntervals = new Set();
		window.setInterval = (callback, delay, ...args) => {
			const id = nativeSetInterval(callback, delay, ...args); activeIntervals.add(id); return id;
		};
		window.clearInterval = (id) => { activeIntervals.delete(id); return nativeClearInterval(id); };
		window.__RUN198_V3_INSTRUMENTATION__ = { snapshot: () => ({ raf: activeRafs.size, intervals: activeIntervals.size }) };
	});
}

async function waitGenerationReady(page, index) {
	await page.waitForFunction((i) => {
		const s = window.__RUN198_V3_STATES__?.[i];
		return Boolean(
			s?.renderer && s?.chunkManager && s?.keyboardInput && s?.player && s?.interaction && s?.worldEvents && s?.freeCamera &&
			Array.isArray(s?.npcs) && s.npcs.length > 0 && Array.isArray(s?.animals) && s.animals.length > 0 &&
			Array.isArray(s?.dragons) && s.dragons.length > 0
		);
	}, index, { timeout: 60000 });
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright unavailable');
	fs.mkdirSync(OUT, { recursive: true });
	const server = await startServer();
	const browser = await playwright.chromium.launch({ headless: true });
	const consoleErrors = [];
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		await installLifecycleInstrumentation(page);
		page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
		page.on('pageerror', (error) => consoleErrors.push(String(error)));
		await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await waitGenerationReady(page, 0);
		await page.waitForTimeout(250);

		const setup = await page.evaluate(async () => {
			const { buildClippedBridgeOwnershipTargets } = await import('/src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');
			const { createCurrentRuntimeIntegrationShadow } = await import('/src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js');
			const { createCurrentTickOwnershipShadow } = await import('/src/3d/world/worldReferenceCurrentTickOwnershipShadow.js');
			const { createLifecycleChunkFreezeShadow } = await import('/src/3d/world/worldReferenceLifecycleChunkFreezeShadow.js');
			const targets = buildClippedBridgeOwnershipTargets();
			const bridgeTarget = targets.find((entry) => entry.bridgeId === 'cersei->stannis#1') || targets[0];
			if (!bridgeTarget) throw new Error('canonical bridge target unavailable');

			const installDisposeProbes = (state) => {
				const counts = {};
				const wrap = (target, methodName, label) => {
					if (!target || typeof target[methodName] !== 'function') return;
					const original = target[methodName];
					target[methodName] = function run198V3DisposeProbe(...args) {
						counts[label] = (counts[label] || 0) + 1;
						return original.apply(this, args);
					};
				};
				wrap(state.renderer, 'dispose', 'renderer');
				wrap(state.chunkManager, 'disposeAll', 'chunkManager');
				wrap(state.keyboardInput, 'dispose', 'keyboardInput');
				wrap(state.player, 'dispose', 'player');
				wrap(state.controls, 'dispose', 'controls');
				wrap(state.freeCamera, 'dispose', 'freeCamera');
				wrap(state.worldEvents, 'dispose', 'worldEvents');
				state.npcs.forEach((entity, index) => wrap(entity, 'dispose', `npc:${index}`));
				state.animals.forEach((entity, index) => wrap(entity, 'dispose', `animal:${index}`));
				state.dragons.forEach((entity, index) => wrap(entity, 'dispose', `dragon:${index}`));
				return { snapshot: () => ({ ...counts }) };
			};

			const renderSubmission = (state) => {
				state.renderer.render(state.scene, state.camera);
				return { calls: state.renderer.info.render.calls, triangles: state.renderer.info.render.triangles };
			};
			const identity = (state) => ({
				state, scene: state.scene, renderer: state.renderer, chunkManager: state.chunkManager,
				player: state.player, keyboardInput: state.keyboardInput, freeCamera: state.freeCamera,
				npcs: [...state.npcs], animals: [...state.animals], dragons: [...state.dragons],
			});
			const setupGeneration = (state, index) => {
				const disposes = installDisposeProbes(state);
				const beforeIdentity = identity(state);
				const integration = createCurrentRuntimeIntegrationShadow({ state, profile: 'mobile' });
				const gate = createCurrentTickOwnershipShadow({ state, integration });
				const lifecycle = createLifecycleChunkFreezeShadow({ state, gate, eventTarget: window });
				const order = [];
				window.addEventListener('pagehide', () => {
					order.push({ lifecycleDisposed: lifecycle.isDisposed(), gateDisposed: gate.isDisposed(), rendererDisposes: disposes.snapshot().renderer || 0 });
				}, { capture: true, once: true });
				const currentSubmission = renderSubmission(state);
				lifecycle.activateCanonicalAtBridge(bridgeTarget.bridgeId);
				const canonicalSubmission = renderSubmission(state);
				return { index, state, disposes, beforeIdentity, integration, gate, lifecycle, order, currentSubmission, canonicalSubmission };
			};
			window.__run198v3 = { bridgeTarget, setupGeneration, generations: [] };
			const first = setupGeneration(window.__RUN198_V3_STATES__[0], 1);
			window.__run198v3.generations.push(first);
			return { bridgeId: bridgeTarget.bridgeId, lifecycleVersion: first.lifecycle.version, currentSubmission: first.currentSubmission, canonicalSubmission: first.canonicalSubmission };
		});
		assert(setup.canonicalSubmission.calls < 500 && setup.canonicalSubmission.triangles < 500000, `canonical budget exceeded: ${JSON.stringify(setup.canonicalSubmission)}`);
		await page.screenshot({ path: path.join(OUT, 'first-canonical-active.png') });
		await page.waitForTimeout(350);

		const firstFrozen = await page.evaluate(() => {
			const first = window.__run198v3.generations[0];
			first.lifecycle.assertResidentStable();
			const freeze = first.gate.getFreezeStats();
			if (!Object.keys(freeze).length || Object.values(freeze).some((entry) => entry.blockedCalls < 1)) throw new Error(`first real-tick freeze incomplete: ${JSON.stringify(freeze)}`);
			return { freeze, mutations: first.lifecycle.getMutationStats(), residentCount: first.state.chunkManager.loadedCount };
		});

		await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
		await page.waitForTimeout(150);
		const firstTeardown = await page.evaluate(() => {
			const first = window.__run198v3.generations[0];
			const lifecycle = first.lifecycle.getStats();
			if (!first.lifecycle.isDisposed() || !first.gate.isDisposed()) throw new Error(`first lifecycle did not dispose: ${JSON.stringify(lifecycle)}`);
			if (lifecycle.pagehideCount !== 1 || lifecycle.gateDisposeCount !== 1 || lifecycle.lastModeBeforeDispose !== 'canonical') throw new Error(`first lifecycle stats invalid: ${JSON.stringify(lifecycle)}`);
			if (first.order.length !== 1 || !first.order[0].lifecycleDisposed || !first.order[0].gateDisposed || first.order[0].rendererDisposes !== 0) throw new Error(`first capture order invalid: ${JSON.stringify(first.order)}`);
			const disposes = first.disposes.snapshot();
			for (const label of ['renderer', 'chunkManager', 'keyboardInput', 'player', 'controls', 'freeCamera', 'worldEvents']) {
				if (disposes[label] !== 1) throw new Error(`first ${label} dispose count=${disposes[label] || 0}`);
			}
			if (first.state.chunkManager.loadedCount !== 0) throw new Error(`first chunks remain after teardown: ${first.state.chunkManager.loadedCount}`);
			const timers = window.__RUN198_V3_INSTRUMENTATION__.snapshot();
			if (timers.raf !== 0 || timers.intervals !== 0) throw new Error(`first lifecycle timer leak: ${JSON.stringify(timers)}`);
			return { lifecycle, disposes, timers };
		});

		await page.evaluate(async () => {
			const { initGame3D } = await import('/src/3d/game3d.js');
			await initGame3D();
		});
		await waitGenerationReady(page, 1);
		await page.waitForTimeout(250);
		const secondReady = await page.evaluate(() => {
			const first = window.__run198v3.generations[0];
			const second = window.__RUN198_V3_STATES__[1];
			const fresh = {
				state: second !== first.beforeIdentity.state,
				scene: second.scene !== first.beforeIdentity.scene,
				renderer: second.renderer !== first.beforeIdentity.renderer,
				chunkManager: second.chunkManager !== first.beforeIdentity.chunkManager,
				player: second.player !== first.beforeIdentity.player,
				keyboardInput: second.keyboardInput !== first.beforeIdentity.keyboardInput,
				freeCamera: second.freeCamera !== first.beforeIdentity.freeCamera,
				npcs: second.npcs.every((entity) => !first.beforeIdentity.npcs.includes(entity)),
				animals: second.animals.every((entity) => !first.beforeIdentity.animals.includes(entity)),
				dragons: second.dragons.every((entity) => !first.beforeIdentity.dragons.includes(entity)),
			};
			if (Object.values(fresh).some((value) => !value)) throw new Error(`second generation reused runtime identity: ${JSON.stringify(fresh)}`);
			return { fresh, timers: window.__RUN198_V3_INSTRUMENTATION__.snapshot() };
		});
		assert(secondReady.timers.raf > 0, 'second init did not restart RAF');

		await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' })));
		await page.waitForTimeout(80);
		assert(await page.evaluate(() => window.__RUN198_V3_STATES__[1].freeCamera.active), 'F4 did not activate exactly once after re-init');
		await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' })));
		await page.waitForTimeout(80);
		assert(await page.evaluate(() => !window.__RUN198_V3_STATES__[1].freeCamera.active), 'F4 did not deactivate exactly once after re-init');

		const secondCanonical = await page.evaluate(() => {
			const r = window.__run198v3;
			const second = r.setupGeneration(window.__RUN198_V3_STATES__[1], 2);
			r.generations.push(second);
			return { currentSubmission: second.currentSubmission, canonicalSubmission: second.canonicalSubmission };
		});
		assert(secondCanonical.canonicalSubmission.calls < 500 && secondCanonical.canonicalSubmission.triangles < 500000, `second canonical budget exceeded: ${JSON.stringify(secondCanonical.canonicalSubmission)}`);
		await page.waitForTimeout(350);
		const secondFrozen = await page.evaluate(() => {
			const second = window.__run198v3.generations[1];
			second.lifecycle.assertResidentStable();
			const freeze = second.gate.getFreezeStats();
			if (Object.values(freeze).some((entry) => entry.blockedCalls < 1)) throw new Error(`second real-tick freeze incomplete: ${JSON.stringify(freeze)}`);
			return { freeze, mutations: second.lifecycle.getMutationStats(), residentCount: second.state.chunkManager.loadedCount };
		});
		await page.screenshot({ path: path.join(OUT, 'second-canonical-active.png') });

		await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
		await page.waitForTimeout(150);
		const secondTeardown = await page.evaluate(() => {
			const second = window.__run198v3.generations[1];
			const lifecycle = second.lifecycle.getStats();
			if (!second.lifecycle.isDisposed() || !second.gate.isDisposed()) throw new Error(`second lifecycle did not dispose: ${JSON.stringify(lifecycle)}`);
			const disposes = second.disposes.snapshot();
			for (const label of ['renderer', 'chunkManager', 'keyboardInput', 'player', 'controls', 'freeCamera', 'worldEvents']) {
				if (disposes[label] !== 1) throw new Error(`second ${label} dispose count=${disposes[label] || 0}`);
			}
			if (second.state.chunkManager.loadedCount !== 0) throw new Error(`second chunks remain after teardown: ${second.state.chunkManager.loadedCount}`);
			const timers = window.__RUN198_V3_INSTRUMENTATION__.snapshot();
			if (timers.raf !== 0 || timers.intervals !== 0) throw new Error(`second lifecycle timer leak: ${JSON.stringify(timers)}`);
			return { lifecycle, disposes, timers, order: second.order[0] };
		});

		assert(consoleErrors.length === 0, `console/page errors: ${JSON.stringify(consoleErrors)}`);
		const proof = { version: setup.lifecycleVersion, setup, firstFrozen, firstTeardown, secondReady, secondCanonical, secondFrozen, secondTeardown, consoleErrors };
		proof.checksum = hash(JSON.stringify(proof));
		fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
		console.log(`[checkLifecycleChunkFreezeShadow] LIFECYCLE: ${JSON.stringify({
			cycles: 2,
			firstResident: firstFrozen.residentCount,
			secondResident: secondFrozen.residentCount,
			firstMutationBlocks: Object.fromEntries(Object.entries(firstFrozen.mutations).map(([k, v]) => [k, v.blockedCalls])),
			secondMutationBlocks: Object.fromEntries(Object.entries(secondFrozen.mutations).map(([k, v]) => [k, v.blockedCalls])),
			rafLeaks: secondTeardown.timers.raf,
			intervalLeaks: secondTeardown.timers.intervals,
		})}`);
		console.log(`[checkLifecycleChunkFreezeShadow] BUDGET: ${JSON.stringify({ first: setup.canonicalSubmission, second: secondCanonical.canonicalSubmission })}`);
		console.log(`[checkLifecycleChunkFreezeShadow] PASS: cycles=2; canonicalPagehide=2; chunkResidentStable=true; exactDispose=true; cleanReinit=true; f4SingleToggle=true; rafLeaks=0; intervalLeaks=0; consoleErrors=0; checksum=${proof.checksum}`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkLifecycleChunkFreezeShadow] FAIL: ${error.stack || error}`);
	process.exit(1);
});
