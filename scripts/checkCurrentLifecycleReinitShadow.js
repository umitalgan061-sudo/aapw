#!/usr/bin/env node
/** Run198: prove canonical-active pagehide teardown and same-document clean re-init without live wiring changes. */
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
	assert(!source.includes('__RUN198_LIVE_STATES__'), 'Run198 live-state hook leaked into repository source');
	return source.replace(STATE_ANCHOR, STATE_INJECTION);
}

function startServer() {
	const transformedGame3d = transformedGame3dSource();
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			if (clean === '/src/3d/game3d.js') {
				res.writeHead(200, { 'Content-Type': MIME['.js'] }); res.end(transformedGame3d); return;
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

async function installLifecycleTracker(page) {
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
		EventTarget.prototype.addEventListener = function run198TrackedAdd(type, listener, options) {
			if (!listener) return nativeAdd.call(this, type, listener, options);
			const capture = captureOf(options);
			const map = mapFor(this, type, capture, true);
			if (map.has(listener)) return nativeAdd.call(this, type, map.get(listener).wrapped, options);
			const record = { target: this, type, listener, capture, once: onceOf(options), active: true, wrapped: listener };
			if (record.once) {
				record.wrapped = function run198TrackedOnce(...args) {
					record.active = false;
					activeListeners.delete(record);
					map.delete(listener);
					return typeof listener === 'function' ? listener.apply(this, args) : listener.handleEvent(...args);
				};
			}
			map.set(listener, record);
			activeListeners.add(record);
			return nativeAdd.call(this, type, record.wrapped, options);
		};
		EventTarget.prototype.removeEventListener = function run198TrackedRemove(type, listener, options) {
			const capture = captureOf(options);
			const map = mapFor(this, type, capture, false);
			const record = map?.get(listener);
			if (record) {
				record.active = false;
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
				const byType = {};
				const byTarget = {};
				for (const record of activeListeners) {
					byType[record.type] = (byType[record.type] || 0) + 1;
					const label = targetLabel(record.target);
					byTarget[label] = (byTarget[label] || 0) + 1;
				}
				return {
					listeners: activeListeners.size,
					byType,
					byTarget,
					rafs: activeRafs.size,
					timeouts: activeTimeouts.size,
					intervals: activeIntervals.size,
				};
			},
		};
	});
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
		await installLifecycleTracker(page);
		page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
		page.on('pageerror', (error) => consoleErrors.push(String(error)));
		await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForFunction(() => Boolean(window.__RUN198_LIVE_STATES__?.[0]?.player), null, { timeout: 60000 });
		await page.waitForTimeout(350);

		const firstActive = await page.evaluate(async () => {
			const state = window.__RUN198_LIVE_STATES__[0];
			const { gameEvents } = await import('/src/3d/eventBus.js');
			const { buildClippedBridgeOwnershipTargets } = await import('/src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');
			const { createCurrentRuntimeIntegrationShadow } = await import('/src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js');
			const { createCurrentTickOwnershipShadow } = await import('/src/3d/world/worldReferenceCurrentTickOwnershipShadow.js');
			const listenerCount = () => [...gameEvents._listeners.values()].reduce((sum, set) => sum + set.size, 0);
			const dynamicDomCount = () => [...document.querySelectorAll('[class*="g3d-"]')].filter((el) => el.id !== 'game3d-loading' && !el.classList.contains('g3d-back-link')).length;
			const disposeCounts = {};
			const observeDispose = (target, label, method = 'dispose') => {
				if (!target || typeof target[method] !== 'function') return;
				const original = target[method];
				target[method] = function run198DisposeObserver(...args) {
					disposeCounts[label] = (disposeCounts[label] || 0) + 1;
					return original.apply(this, args);
				};
			};
			observeDispose(state.renderer, 'renderer');
			observeDispose(state.chunkManager, 'chunkManager', 'disposeAll');
			observeDispose(state.keyboardInput, 'keyboardInput');
			observeDispose(state.touchJoystick, 'touchJoystick');
			observeDispose(state.player, 'player');
			observeDispose(state.controls, 'controls');
			observeDispose(state.freeCamera, 'freeCamera');
			observeDispose(state.worldEvents, 'worldEvents');
			observeDispose(state.worldEventToast, 'worldEventToast');
			observeDispose(state.healthBar, 'healthBar');
			state.npcs.forEach((entity, index) => observeDispose(entity, `npc:${index}`));
			state.animals.forEach((entity, index) => observeDispose(entity, `animal:${index}`));
			state.dragons.forEach((entity, index) => observeDispose(entity, `dragon:${index}`));
			const integration = createCurrentRuntimeIntegrationShadow({ state, profile: 'mobile' });
			const gate = createCurrentTickOwnershipShadow({ state, integration });
			const targets = buildClippedBridgeOwnershipTargets();
			const bridgeTarget = targets.find((entry) => entry.bridgeId === 'cersei->stannis#1') || targets[0];
			if (!bridgeTarget) throw new Error('canonical bridge target unavailable');
			gate.activateCanonicalAtBridge(bridgeTarget.bridgeId);
			window.__run198 = { state, gameEvents, gate, bridgeTarget, listenerCount, dynamicDomCount, disposeCounts };
			return {
				tracker: window.__RUN198_TRACKER__.snapshot(),
				eventBusListeners: listenerCount(), dynamicDom: dynamicDomCount(),
				identity: { scene: state.scene.uuid, player: state.player.object3D.uuid, renderer: Boolean(state.renderer), chunkManager: Boolean(state.chunkManager) },
				bridgeId: bridgeTarget.bridgeId,
			};
		});
		await page.waitForTimeout(250);
		const firstFreeze = await page.evaluate(() => {
			const stats = window.__run198.gate.getFreezeStats();
			if (!Object.keys(stats).length || Object.values(stats).some((entry) => entry.blockedCalls < 1)) throw new Error(`first canonical tick did not freeze all targets: ${JSON.stringify(stats)}`);
			return stats;
		});
		await page.screenshot({ path: path.join(OUT, 'first-canonical-active.png') });

		const firstTeardown = await page.evaluate(async () => {
			const r = window.__run198;
			let modeBefore = null;
			window.addEventListener('pagehide', () => {
				modeBefore = r.gate.getMode();
				r.gate.dispose();
			}, { once: true, capture: true });
			window.dispatchEvent(new Event('pagehide'));
			await new Promise((resolve) => setTimeout(resolve, 80));
			if (!r.gate.isDisposed()) throw new Error('Run197 gate did not dispose at pagehide capture boundary');
			if (modeBefore !== 'canonical') throw new Error(`pagehide did not begin while canonical was active: ${modeBefore}`);
			const required = ['renderer', 'chunkManager', 'keyboardInput', 'player', 'controls', 'freeCamera', 'worldEvents', 'worldEventToast', 'healthBar'];
			for (const key of required) if (r.disposeCounts[key] !== 1) throw new Error(`${key} dispose count expected 1, got ${r.disposeCounts[key] || 0}`);
			if (Object.keys(r.disposeCounts).filter((key) => key.startsWith('npc:')).some((key) => r.disposeCounts[key] !== 1)) throw new Error('NPC dispose count mismatch');
			if (Object.keys(r.disposeCounts).filter((key) => key.startsWith('animal:')).some((key) => r.disposeCounts[key] !== 1)) throw new Error('animal dispose count mismatch');
			if (Object.keys(r.disposeCounts).filter((key) => key.startsWith('dragon:')).some((key) => r.disposeCounts[key] !== 1)) throw new Error('dragon dispose count mismatch');
			const tracker = window.__RUN198_TRACKER__.snapshot();
			if (tracker.rafs !== 0) throw new Error(`RAF leak after first pagehide: ${tracker.rafs}`);
			if (tracker.intervals !== 0) throw new Error(`interval leak after first pagehide: ${tracker.intervals}`);
			return { tracker, eventBusListeners: r.listenerCount(), dynamicDom: r.dynamicDomCount(), disposeCounts: { ...r.disposeCounts }, modeBefore };
		});

		const secondActive = await page.evaluate(async () => {
			const { initGame3D } = await import('/src/3d/game3d.js');
			await initGame3D();
			const states = window.__RUN198_LIVE_STATES__;
			if (states.length !== 2) throw new Error(`expected exactly two runtime generations, got ${states.length}`);
			const first = states[0]; const second = states[1];
			if (first === second || first.scene === second.scene || first.renderer === second.renderer || first.chunkManager === second.chunkManager || first.player === second.player) {
				throw new Error('second init reused a first-generation runtime identity');
			}
			const r = window.__run198;
			if (r.dynamicDomCount() !== firstActiveDynamicDom) throw new Error('placeholder');
			return {
				tracker: window.__RUN198_TRACKER__.snapshot(),
				eventBusListeners: r.listenerCount(), dynamicDom: r.dynamicDomCount(),
				identity: { scene: second.scene.uuid, player: second.player.object3D.uuid, rendererDistinct: first.renderer !== second.renderer, chunkManagerDistinct: first.chunkManager !== second.chunkManager },
			};
		}).catch(async (error) => {
			if (!String(error).includes('firstActiveDynamicDom')) throw error;
			return page.evaluate(() => {
				const r = window.__run198; const first = window.__RUN198_LIVE_STATES__[0]; const second = window.__RUN198_LIVE_STATES__[1];
				return {
					tracker: window.__RUN198_TRACKER__.snapshot(), eventBusListeners: r.listenerCount(), dynamicDom: r.dynamicDomCount(),
					identity: { scene: second.scene.uuid, player: second.player.object3D.uuid, rendererDistinct: first.renderer !== second.renderer, chunkManagerDistinct: first.chunkManager !== second.chunkManager },
				};
			});
		});
		assert(secondActive.dynamicDom === firstActive.dynamicDom, `dynamic DOM count changed after re-init: ${firstActive.dynamicDom} -> ${secondActive.dynamicDom}`);
		assert(secondActive.eventBusListeners === firstActive.eventBusListeners, `EventBus listener count changed after re-init: ${firstActive.eventBusListeners} -> ${secondActive.eventBusListeners}`);
		assert(secondActive.tracker.listeners === firstActive.tracker.listeners, `EventTarget listener count changed after re-init: ${firstActive.tracker.listeners} -> ${secondActive.tracker.listeners}`);
		assert(secondActive.identity.scene !== firstActive.identity.scene, 'second init scene UUID reused first scene');
		assert(secondActive.identity.player !== firstActive.identity.player, 'second init player UUID reused first player');

		const f4 = await page.evaluate(() => {
			const second = window.__RUN198_LIVE_STATES__[1];
			if (second.freeCamera.active) throw new Error('second-generation F4 camera unexpectedly active at boot');
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' }));
			const afterOne = second.freeCamera.active;
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' }));
			const afterTwo = second.freeCamera.active;
			if (!afterOne || afterTwo) throw new Error(`F4 lifecycle indicates duplicated/missing key listeners: ${afterOne}/${afterTwo}`);
			return { afterOne, afterTwo };
		});

		const secondCanonical = await page.evaluate(async () => {
			const state = window.__RUN198_LIVE_STATES__[1];
			const { createCurrentRuntimeIntegrationShadow } = await import('/src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js');
			const { createCurrentTickOwnershipShadow } = await import('/src/3d/world/worldReferenceCurrentTickOwnershipShadow.js');
			const r = window.__run198;
			const disposeCounts = {};
			const observeDispose = (target, label, method = 'dispose') => {
				if (!target || typeof target[method] !== 'function') return;
				const original = target[method];
				target[method] = function run198SecondDisposeObserver(...args) { disposeCounts[label] = (disposeCounts[label] || 0) + 1; return original.apply(this, args); };
			};
			for (const [target, label, method] of [
				[state.renderer, 'renderer'], [state.chunkManager, 'chunkManager', 'disposeAll'], [state.keyboardInput, 'keyboardInput'],
				[state.player, 'player'], [state.controls, 'controls'], [state.freeCamera, 'freeCamera'], [state.worldEvents, 'worldEvents'],
				[state.worldEventToast, 'worldEventToast'], [state.healthBar, 'healthBar'],
			]) observeDispose(target, label, method);
			state.npcs.forEach((entity, index) => observeDispose(entity, `npc:${index}`));
			state.animals.forEach((entity, index) => observeDispose(entity, `animal:${index}`));
			state.dragons.forEach((entity, index) => observeDispose(entity, `dragon:${index}`));
			const integration = createCurrentRuntimeIntegrationShadow({ state, profile: 'mobile' });
			const gate = createCurrentTickOwnershipShadow({ state, integration });
			gate.activateCanonicalAtBridge(r.bridgeTarget.bridgeId);
			window.__run198Second = { gate, disposeCounts };
			await new Promise((resolve) => setTimeout(resolve, 180));
			const stats = gate.getFreezeStats();
			if (!Object.keys(stats).length || Object.values(stats).some((entry) => entry.blockedCalls < 1)) throw new Error(`second canonical tick did not freeze all targets: ${JSON.stringify(stats)}`);
			return { stats };
		});
		await page.screenshot({ path: path.join(OUT, 'second-reinit-canonical-active.png') });

		const secondTeardown = await page.evaluate(async () => {
			const r = window.__run198; const s = window.__run198Second;
			let modeBefore = null;
			window.addEventListener('pagehide', () => { modeBefore = s.gate.getMode(); s.gate.dispose(); }, { once: true, capture: true });
			window.dispatchEvent(new Event('pagehide'));
			await new Promise((resolve) => setTimeout(resolve, 80));
			if (!s.gate.isDisposed() || modeBefore !== 'canonical') throw new Error('second lifecycle gate did not dispose from canonical mode');
			const required = ['renderer', 'chunkManager', 'keyboardInput', 'player', 'controls', 'freeCamera', 'worldEvents', 'worldEventToast', 'healthBar'];
			for (const key of required) if (s.disposeCounts[key] !== 1) throw new Error(`second ${key} dispose count expected 1, got ${s.disposeCounts[key] || 0}`);
			const tracker = window.__RUN198_TRACKER__.snapshot();
			if (tracker.rafs !== 0) throw new Error(`RAF leak after second pagehide: ${tracker.rafs}`);
			if (tracker.intervals !== 0) throw new Error(`interval leak after second pagehide: ${tracker.intervals}`);
			return { tracker, eventBusListeners: r.listenerCount(), dynamicDom: r.dynamicDomCount(), disposeCounts: { ...s.disposeCounts }, modeBefore };
		});

		assert(secondTeardown.eventBusListeners === firstTeardown.eventBusListeners, `EventBus teardown baseline drift: ${firstTeardown.eventBusListeners} -> ${secondTeardown.eventBusListeners}`);
		assert(secondTeardown.dynamicDom === firstTeardown.dynamicDom, `DOM teardown baseline drift: ${firstTeardown.dynamicDom} -> ${secondTeardown.dynamicDom}`);
		assert(secondTeardown.tracker.listeners === firstTeardown.tracker.listeners, `EventTarget teardown baseline drift: ${firstTeardown.tracker.listeners} -> ${secondTeardown.tracker.listeners}`);
		assert(secondTeardown.tracker.rafs === 0 && firstTeardown.tracker.rafs === 0, 'RAF baseline is not clean');
		assert(consoleErrors.length === 0, `console/page errors: ${JSON.stringify(consoleErrors)}`);

		const proof = {
			version: 'run198-current-lifecycle-reinit-shadow-v1',
			firstActive, firstFreeze, firstTeardown, secondActive, f4,
			secondCanonical, secondTeardown,
			consoleErrors,
		};
		proof.checksum = hash(JSON.stringify(proof));
		fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
		console.log(`[checkCurrentLifecycleReinitShadow] LIFECYCLE: ${JSON.stringify({
			firstActiveListeners: firstActive.tracker.listeners,
			teardownListeners: firstTeardown.tracker.listeners,
			secondActiveListeners: secondActive.tracker.listeners,
			teardownEventBus: secondTeardown.eventBusListeners,
			dynamicDomActive: secondActive.dynamicDom,
			dynamicDomTeardown: secondTeardown.dynamicDom,
		})}`);
		console.log(`[checkCurrentLifecycleReinitShadow] PASS: cycles=2; canonicalPagehide=2; rafLeaks=0; intervalLeaks=0; f4SingleToggle=true; cleanReinit=true; consoleErrors=0; checksum=${proof.checksum}`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkCurrentLifecycleReinitShadow] FAIL: ${error.stack || error}`);
	process.exit(1);
});
