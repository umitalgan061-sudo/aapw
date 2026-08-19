#!/usr/bin/env node
/** Run198: canonical-active pagehide teardown + clean same-document re-init proof. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run198-current-lifecycle-reinit-shadow');
const GAME3D_PATH = path.join(ROOT, 'src', '3d', 'game3d.js');
const STATE_ANCHOR = '\t\tconst state = createScene(canvas);';
const STATE_INJECTION = `${STATE_ANCHOR}\n\t\twindow.__RUN198_LIVE_STATES__ = window.__RUN198_LIVE_STATES__ || [];\n\t\twindow.__RUN198_LIVE_STATES__.push(state);`;
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
	assert(!source.includes('__RUN198_LIVE_STATES__'), 'Run198 observation hook leaked into repository source');
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

async function installTrackerAndEarlyLifecycleOwner(page) {
	await page.addInitScript(() => {
		const nativeAdd = EventTarget.prototype.addEventListener;
		const nativeRemove = EventTarget.prototype.removeEventListener;
		const targetMaps = new WeakMap();
		const activeListeners = new Set();
		const captureOf = (options) => typeof options === 'boolean' ? options : Boolean(options?.capture);
		const onceOf = (options) => typeof options === 'object' && Boolean(options?.once);
		const mapFor = (target, type, capture, create) => {
			let byType = targetMaps.get(target);
			if (!byType && create) { byType = new Map(); targetMaps.set(target, byType); }
			if (!byType) return null;
			const key = `${type}|${capture ? 1 : 0}`;
			let map = byType.get(key);
			if (!map && create) { map = new Map(); byType.set(key, map); }
			return map || null;
		};
		EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
			if (!listener) return nativeAdd.call(this, type, listener, options);
			const capture = captureOf(options);
			const map = mapFor(this, type, capture, true);
			const existing = map.get(listener);
			if (existing) return nativeAdd.call(this, type, existing.wrapped, options);
			const record = { target: this, type, listener, capture, once: onceOf(options), wrapped: listener };
			if (record.once) {
				record.wrapped = function trackedOnce(...args) {
					activeListeners.delete(record);
					map.delete(listener);
					return typeof listener === 'function' ? listener.apply(this, args) : listener.handleEvent(...args);
				};
			}
			map.set(listener, record);
			activeListeners.add(record);
			return nativeAdd.call(this, type, record.wrapped, options);
		};
		EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
			const capture = captureOf(options);
			const map = mapFor(this, type, capture, false);
			const record = map?.get(listener);
			if (record) {
				activeListeners.delete(record);
				map.delete(listener);
				return nativeRemove.call(this, type, record.wrapped, options);
			}
			return nativeRemove.call(this, type, listener, options);
		};

		const nativeRaf = window.requestAnimationFrame.bind(window);
		const nativeCancelRaf = window.cancelAnimationFrame.bind(window);
		const activeRafs = new Set();
		window.requestAnimationFrame = (callback) => {
			let id = 0;
			id = nativeRaf((time) => { activeRafs.delete(id); callback(time); });
			activeRafs.add(id);
			return id;
		};
		window.cancelAnimationFrame = (id) => { activeRafs.delete(id); return nativeCancelRaf(id); };

		const nativeSetTimeout = window.setTimeout.bind(window);
		const nativeClearTimeout = window.clearTimeout.bind(window);
		const activeTimeouts = new Set();
		window.setTimeout = (callback, delay, ...args) => {
			let id = 0;
			id = nativeSetTimeout((...inner) => { activeTimeouts.delete(id); callback(...inner); }, delay, ...args);
			activeTimeouts.add(id);
			return id;
		};
		window.clearTimeout = (id) => { activeTimeouts.delete(id); return nativeClearTimeout(id); };
		const nativeSetInterval = window.setInterval.bind(window);
		const nativeClearInterval = window.clearInterval.bind(window);
		const activeIntervals = new Set();
		window.setInterval = (callback, delay, ...args) => {
			const id = nativeSetInterval(callback, delay, ...args); activeIntervals.add(id); return id;
		};
		window.clearInterval = (id) => { activeIntervals.delete(id); return nativeClearInterval(id); };

		const targetLabel = (target) => target === window ? 'window' : target === document ? 'document' : target?.tagName || target?.constructor?.name || 'unknown';
		window.__RUN198_TRACKER__ = {
			snapshot() {
				const byType = {}; const byTarget = {};
				for (const record of activeListeners) {
					byType[record.type] = (byType[record.type] || 0) + 1;
					const label = targetLabel(record.target);
					byTarget[label] = (byTarget[label] || 0) + 1;
				}
				return { listeners: activeListeners.size, byType, byTarget, rafs: activeRafs.size, timeouts: activeTimeouts.size, intervals: activeIntervals.size };
			},
		};

		window.__RUN198_GATE_TO_DISPOSE__ = null;
		window.__RUN198_GATE_DISPOSE_LOG__ = [];
		window.__RUN198_LIFECYCLE_ORDER__ = [];
		window.addEventListener('pagehide', () => {
			const gate = window.__RUN198_GATE_TO_DISPOSE__;
			if (!gate) return;
			const modeBefore = gate.getMode();
			window.__RUN198_LIFECYCLE_ORDER__.push('gate-dispose');
			let error = null;
			try { gate.dispose(); } catch (caught) { error = String(caught?.stack || caught); }
			window.__RUN198_GATE_DISPOSE_LOG__.push({ modeBefore, disposed: gate.isDisposed(), error });
			window.__RUN198_GATE_TO_DISPOSE__ = null;
		});
	});
}

function activeStateReady(index) {
	return ({ index }) => {
		const state = window.__RUN198_LIVE_STATES__?.[index];
		return Boolean(
			state?.player && state?.keyboardInput && state?.interaction && state?.worldEvents &&
			Array.isArray(state?.npcs) && state.npcs.length > 0 &&
			Array.isArray(state?.animals) && state.animals.length > 0 &&
			Array.isArray(state?.dragons) && state.dragons.length > 0
		);
	};
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
		await installTrackerAndEarlyLifecycleOwner(page);
		page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
		page.on('pageerror', (error) => consoleErrors.push(String(error)));
		await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		await page.waitForFunction(activeStateReady(0), { index: 0 }, { timeout: 60000 });
		await page.waitForTimeout(300);

		const firstActive = await page.evaluate(async () => {
			const state = window.__RUN198_LIVE_STATES__[0];
			const { gameEvents } = await import('/src/3d/eventBus.js');
			const { buildClippedBridgeOwnershipTargets } = await import('/src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');
			const { createCurrentRuntimeIntegrationShadow } = await import('/src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js');
			const { createCurrentTickOwnershipShadow } = await import('/src/3d/world/worldReferenceCurrentTickOwnershipShadow.js');
			const listenerCount = () => [...gameEvents._listeners.values()].reduce((sum, set) => sum + set.size, 0);
			const dynamicDomCount = () => [...document.querySelectorAll('[class*="g3d-"]')].filter((el) => el.id !== 'game3d-loading' && !el.classList.contains('g3d-back-link')).length;
			const disposeCounts = {};
			const observe = (target, label, method = 'dispose') => {
				if (!target || typeof target[method] !== 'function') return;
				const original = target[method];
				target[method] = function run198DisposeObserver(...args) {
					disposeCounts[label] = (disposeCounts[label] || 0) + 1;
					if (label === 'renderer') window.__RUN198_LIFECYCLE_ORDER__.push('runtime-renderer-dispose');
					return original.apply(this, args);
				};
			};
			for (const [target, label, method] of [
				[state.renderer, 'renderer'], [state.chunkManager, 'chunkManager', 'disposeAll'], [state.keyboardInput, 'keyboardInput'], [state.touchJoystick, 'touchJoystick'],
				[state.player, 'player'], [state.controls, 'controls'], [state.freeCamera, 'freeCamera'], [state.worldEvents, 'worldEvents'],
				[state.worldEventToast, 'worldEventToast'], [state.healthBar, 'healthBar'],
			]) observe(target, label, method);
			state.npcs.forEach((entity, index) => observe(entity, `npc:${index}`));
			state.animals.forEach((entity, index) => observe(entity, `animal:${index}`));
			state.dragons.forEach((entity, index) => observe(entity, `dragon:${index}`));
			const integration = createCurrentRuntimeIntegrationShadow({ state, profile: 'mobile' });
			const gate = createCurrentTickOwnershipShadow({ state, integration });
			const targets = buildClippedBridgeOwnershipTargets();
			const bridgeTarget = targets.find((entry) => entry.bridgeId === 'cersei->stannis#1') || targets[0];
			if (!bridgeTarget) throw new Error('canonical bridge target unavailable');
			gate.activateCanonicalAtBridge(bridgeTarget.bridgeId);
			window.__RUN198_GATE_TO_DISPOSE__ = gate;
			window.__run198 = { state, gameEvents, gate, bridgeTarget, listenerCount, dynamicDomCount, disposeCounts };
			return { tracker: window.__RUN198_TRACKER__.snapshot(), eventBusListeners: listenerCount(), dynamicDom: dynamicDomCount(), identity: { scene: state.scene.uuid, player: state.player.object3D.uuid } };
		});
		await page.waitForTimeout(250);
		const firstFreeze = await page.evaluate(() => {
			const stats = window.__run198.gate.getFreezeStats();
			if (!Object.keys(stats).length || Object.values(stats).some((entry) => entry.blockedCalls < 1)) throw new Error(`first canonical tick did not freeze all targets: ${JSON.stringify(stats)}`);
			return stats;
		});
		await page.screenshot({ path: path.join(OUT, 'first-canonical-active.png') });

		await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
		await page.waitForTimeout(100);
		const firstTeardown = await page.evaluate(() => {
			const r = window.__run198;
			const gateLog = window.__RUN198_GATE_DISPOSE_LOG__.at(-1);
			if (!gateLog || gateLog.modeBefore !== 'canonical' || !gateLog.disposed || gateLog.error) throw new Error(`early gate teardown failed: ${JSON.stringify(gateLog)}`);
			const order = [...window.__RUN198_LIFECYCLE_ORDER__];
			if (order.indexOf('gate-dispose') < 0 || order.indexOf('runtime-renderer-dispose') < 0 || order.indexOf('gate-dispose') > order.indexOf('runtime-renderer-dispose')) throw new Error(`lifecycle order invalid: ${JSON.stringify(order)}`);
			const required = ['renderer', 'chunkManager', 'keyboardInput', 'player', 'controls', 'freeCamera', 'worldEvents', 'worldEventToast', 'healthBar'];
			for (const key of required) if (r.disposeCounts[key] !== 1) throw new Error(`${key} dispose count expected 1, got ${r.disposeCounts[key] || 0}`);
			for (const prefix of ['npc:', 'animal:', 'dragon:']) {
				const keys = Object.keys(r.disposeCounts).filter((key) => key.startsWith(prefix));
				if (!keys.length || keys.some((key) => r.disposeCounts[key] !== 1)) throw new Error(`${prefix} dispose counts incomplete`);
			}
			const tracker = window.__RUN198_TRACKER__.snapshot();
			if (tracker.rafs !== 0 || tracker.timeouts !== 0 || tracker.intervals !== 0) throw new Error(`async handle leak after first pagehide: ${JSON.stringify(tracker)}`);
			return { tracker, eventBusListeners: r.listenerCount(), dynamicDom: r.dynamicDomCount(), disposeCounts: { ...r.disposeCounts }, gateLog, order };
		});

		await page.evaluate(async () => { const { initGame3D } = await import('/src/3d/game3d.js'); await initGame3D(); });
		await page.waitForFunction(activeStateReady(1), { index: 1 }, { timeout: 60000 });
		await page.waitForTimeout(300);
		const secondActive = await page.evaluate(() => {
			const first = window.__RUN198_LIVE_STATES__[0]; const second = window.__RUN198_LIVE_STATES__[1]; const r = window.__run198;
			if (first === second || first.scene === second.scene || first.renderer === second.renderer || first.chunkManager === second.chunkManager || first.player === second.player) throw new Error('second init reused first-generation runtime identity');
			return { tracker: window.__RUN198_TRACKER__.snapshot(), eventBusListeners: r.listenerCount(), dynamicDom: r.dynamicDomCount(), identity: { scene: second.scene.uuid, player: second.player.object3D.uuid, rendererDistinct: true, chunkManagerDistinct: true } };
		});
		assert(secondActive.dynamicDom === firstActive.dynamicDom, `active DOM drift ${firstActive.dynamicDom}->${secondActive.dynamicDom}`);
		assert(secondActive.eventBusListeners === firstActive.eventBusListeners, `active EventBus drift ${firstActive.eventBusListeners}->${secondActive.eventBusListeners}`);
		assert(secondActive.tracker.listeners === firstActive.tracker.listeners, `active EventTarget drift ${firstActive.tracker.listeners}->${secondActive.tracker.listeners}`);
		assert(secondActive.identity.scene !== firstActive.identity.scene && secondActive.identity.player !== firstActive.identity.player, 'second generation UUID identity reused');

		const f4 = await page.evaluate(() => {
			const second = window.__RUN198_LIVE_STATES__[1];
			if (second.freeCamera.active) throw new Error('F4 active unexpectedly after second boot');
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' })); const afterOne = second.freeCamera.active;
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' })); const afterTwo = second.freeCamera.active;
			if (!afterOne || afterTwo) throw new Error(`F4 duplicated/missing key listener: ${afterOne}/${afterTwo}`);
			return { afterOne, afterTwo };
		});

		const secondCanonical = await page.evaluate(async () => {
			const state = window.__RUN198_LIVE_STATES__[1]; const r = window.__run198;
			const { createCurrentRuntimeIntegrationShadow } = await import('/src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js');
			const { createCurrentTickOwnershipShadow } = await import('/src/3d/world/worldReferenceCurrentTickOwnershipShadow.js');
			const disposeCounts = {};
			const observe = (target, label, method = 'dispose') => {
				if (!target || typeof target[method] !== 'function') return;
				const original = target[method];
				target[method] = function run198SecondDisposeObserver(...args) {
					disposeCounts[label] = (disposeCounts[label] || 0) + 1;
					if (label === 'renderer') window.__RUN198_LIFECYCLE_ORDER__.push('runtime-renderer-dispose');
					return original.apply(this, args);
				};
			};
			for (const [target, label, method] of [
				[state.renderer, 'renderer'], [state.chunkManager, 'chunkManager', 'disposeAll'], [state.keyboardInput, 'keyboardInput'], [state.touchJoystick, 'touchJoystick'],
				[state.player, 'player'], [state.controls, 'controls'], [state.freeCamera, 'freeCamera'], [state.worldEvents, 'worldEvents'],
				[state.worldEventToast, 'worldEventToast'], [state.healthBar, 'healthBar'],
			]) observe(target, label, method);
			state.npcs.forEach((entity, index) => observe(entity, `npc:${index}`));
			state.animals.forEach((entity, index) => observe(entity, `animal:${index}`));
			state.dragons.forEach((entity, index) => observe(entity, `dragon:${index}`));
			window.__RUN198_LIFECYCLE_ORDER__ = [];
			const integration = createCurrentRuntimeIntegrationShadow({ state, profile: 'mobile' });
			const gate = createCurrentTickOwnershipShadow({ state, integration });
			gate.activateCanonicalAtBridge(r.bridgeTarget.bridgeId);
			window.__RUN198_GATE_TO_DISPOSE__ = gate;
			window.__run198Second = { gate, disposeCounts };
			return { active: true };
		});
		assert(secondCanonical.active, 'second canonical activation missing');
		await page.waitForTimeout(250);
		const secondFreeze = await page.evaluate(() => {
			const stats = window.__run198Second.gate.getFreezeStats();
			if (!Object.keys(stats).length || Object.values(stats).some((entry) => entry.blockedCalls < 1)) throw new Error(`second canonical tick did not freeze all targets: ${JSON.stringify(stats)}`);
			return stats;
		});
		await page.screenshot({ path: path.join(OUT, 'second-reinit-canonical-active.png') });

		await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
		await page.waitForTimeout(100);
		const secondTeardown = await page.evaluate(() => {
			const r = window.__run198; const s = window.__run198Second;
			const gateLog = window.__RUN198_GATE_DISPOSE_LOG__.at(-1);
			if (!gateLog || gateLog.modeBefore !== 'canonical' || !gateLog.disposed || gateLog.error) throw new Error(`second early gate teardown failed: ${JSON.stringify(gateLog)}`);
			const order = [...window.__RUN198_LIFECYCLE_ORDER__];
			if (order.indexOf('gate-dispose') < 0 || order.indexOf('runtime-renderer-dispose') < 0 || order.indexOf('gate-dispose') > order.indexOf('runtime-renderer-dispose')) throw new Error(`second lifecycle order invalid: ${JSON.stringify(order)}`);
			const required = ['renderer', 'chunkManager', 'keyboardInput', 'player', 'controls', 'freeCamera', 'worldEvents', 'worldEventToast', 'healthBar'];
			for (const key of required) if (s.disposeCounts[key] !== 1) throw new Error(`second ${key} dispose count expected 1, got ${s.disposeCounts[key] || 0}`);
			for (const prefix of ['npc:', 'animal:', 'dragon:']) {
				const keys = Object.keys(s.disposeCounts).filter((key) => key.startsWith(prefix));
				if (!keys.length || keys.some((key) => s.disposeCounts[key] !== 1)) throw new Error(`second ${prefix} dispose counts incomplete`);
			}
			const tracker = window.__RUN198_TRACKER__.snapshot();
			if (tracker.rafs !== 0 || tracker.timeouts !== 0 || tracker.intervals !== 0) throw new Error(`async handle leak after second pagehide: ${JSON.stringify(tracker)}`);
			return { tracker, eventBusListeners: r.listenerCount(), dynamicDom: r.dynamicDomCount(), disposeCounts: { ...s.disposeCounts }, gateLog, order };
		});

		assert(secondTeardown.eventBusListeners === firstTeardown.eventBusListeners, `teardown EventBus drift ${firstTeardown.eventBusListeners}->${secondTeardown.eventBusListeners}`);
		assert(secondTeardown.dynamicDom === firstTeardown.dynamicDom, `teardown DOM drift ${firstTeardown.dynamicDom}->${secondTeardown.dynamicDom}`);
		assert(secondTeardown.tracker.listeners === firstTeardown.tracker.listeners, `teardown EventTarget drift ${firstTeardown.tracker.listeners}->${secondTeardown.tracker.listeners}`);
		assert(consoleErrors.length === 0, `console/page errors: ${JSON.stringify(consoleErrors)}`);

		const proof = { version: 'run198-current-lifecycle-reinit-shadow-v3', firstActive, firstFreeze, firstTeardown, secondActive, f4, secondFreeze, secondTeardown, consoleErrors };
		proof.checksum = hash(JSON.stringify(proof));
		fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
		console.log(`[checkCurrentLifecycleReinitShadow] LIFECYCLE: ${JSON.stringify({ firstActiveListeners: firstActive.tracker.listeners, teardownListeners: firstTeardown.tracker.listeners, secondActiveListeners: secondActive.tracker.listeners, teardownEventBus: secondTeardown.eventBusListeners, dynamicDomActive: secondActive.dynamicDom, dynamicDomTeardown: secondTeardown.dynamicDom })}`);
		console.log(`[checkCurrentLifecycleReinitShadow] PASS: cycles=2; canonicalPagehide=2; gateBeforeRuntimeDispose=2; rafLeaks=0; timeoutLeaks=0; intervalLeaks=0; f4SingleToggle=true; cleanReinit=true; consoleErrors=0; checksum=${proof.checksum}`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkCurrentLifecycleReinitShadow] FAIL: ${error.stack || error}`);
	process.exit(1);
});
