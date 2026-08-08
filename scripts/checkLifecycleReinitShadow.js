#!/usr/bin/env node
/** Run198: canonical pagehide teardown + clean same-page re-init lifecycle proof. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.env.RUN198_REPO_ROOT || path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run198-lifecycle-reinit-shadow');
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

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright unavailable');
	fs.mkdirSync(OUT, { recursive: true });
	const server = await startServer();
	const browser = await playwright.chromium.launch({ headless: true });
	const consoleErrors = [];
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
		page.on('pageerror', (error) => consoleErrors.push(String(error)));
		await page.addInitScript(() => {
			const nativeRaf = window.requestAnimationFrame.bind(window);
			const nativeCancelRaf = window.cancelAnimationFrame.bind(window);
			const activeRaf = new Set();
			window.requestAnimationFrame = (callback) => {
				let id = 0;
				id = nativeRaf((time) => { activeRaf.delete(id); callback(time); });
				activeRaf.add(id);
				return id;
			};
			window.cancelAnimationFrame = (id) => { activeRaf.delete(id); return nativeCancelRaf(id); };

			const nativeSetTimeout = window.setTimeout.bind(window);
			const nativeClearTimeout = window.clearTimeout.bind(window);
			const nativeSetInterval = window.setInterval.bind(window);
			const nativeClearInterval = window.clearInterval.bind(window);
			const activeTimeouts = new Set();
			const activeIntervals = new Set();
			window.setTimeout = (callback, delay, ...args) => {
				let id = 0;
				id = nativeSetTimeout((...innerArgs) => { activeTimeouts.delete(id); callback(...innerArgs); }, delay, ...args);
				activeTimeouts.add(id);
				return id;
			};
			window.clearTimeout = (id) => { activeTimeouts.delete(id); return nativeClearTimeout(id); };
			window.setInterval = (callback, delay, ...args) => {
				const id = nativeSetInterval(callback, delay, ...args);
				activeIntervals.add(id);
				return id;
			};
			window.clearInterval = (id) => { activeIntervals.delete(id); return nativeClearInterval(id); };

			const nativeAdd = EventTarget.prototype.addEventListener;
			const nativeRemove = EventTarget.prototype.removeEventListener;
			const records = [];
			const captureOf = (options) => typeof options === 'boolean' ? options : Boolean(options?.capture);
			EventTarget.prototype.addEventListener = function run198TrackedAdd(type, listener, options) {
				const capture = captureOf(options);
				const once = typeof options === 'object' && Boolean(options?.once);
				if (listener && !once && !records.some((record) => record.active && record.target === this && record.type === type && record.listener === listener && record.capture === capture)) {
					records.push({ target: this, type, listener, capture, active: true });
				}
				return nativeAdd.call(this, type, listener, options);
			};
			EventTarget.prototype.removeEventListener = function run198TrackedRemove(type, listener, options) {
				const capture = captureOf(options);
				for (const record of records) {
					if (record.active && record.target === this && record.type === type && record.listener === listener && record.capture === capture) record.active = false;
				}
				return nativeRemove.call(this, type, listener, options);
			};
			const isConnectedTarget = (target) => target === window || target === document || (typeof Node !== 'undefined' && target instanceof Node && target.isConnected);
			const targetLabel = (target) => {
				if (target === window) return 'window';
				if (target === document) return 'document';
				if (target instanceof Element) {
					const classes = [...target.classList].sort().join('.');
					return `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}${classes ? `.${classes}` : ''}`;
				}
				return target?.constructor?.name || 'EventTarget';
			};
			window.__RUN198_INSTRUMENTATION__ = {
				snapshot() {
					const listeners = records.filter((record) => record.active && isConnectedTarget(record.target))
						.map((record) => `${targetLabel(record.target)}|${record.type}|${record.capture ? 'capture' : 'bubble'}`).sort();
					return { raf: activeRaf.size, timeouts: activeTimeouts.size, intervals: activeIntervals.size, listeners };
				},
			};
		});

		await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForFunction(() => {
			const states = window.__RUN198_LIVE_STATES__;
			const s = states?.[0];
			return Boolean(s?.player && s?.keyboardInput && s?.interaction && s?.worldEvents && s?.renderer && Array.isArray(s?.npcs) && Array.isArray(s?.animals) && Array.isArray(s?.dragons));
		}, null, { timeout: 60000 });
		await page.waitForTimeout(250);

		const setup = await page.evaluate(async () => {
			const { gameEvents } = await import('/src/3d/eventBus.js');
			const { buildClippedBridgeOwnershipTargets } = await import('/src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');
			const { createCurrentRuntimeIntegrationShadow } = await import('/src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js');
			const { createCurrentTickOwnershipShadow } = await import('/src/3d/world/worldReferenceCurrentTickOwnershipShadow.js');
			const { createLifecycleReinitShadow } = await import('/src/3d/world/worldReferenceLifecycleReinitShadow.js');
			const targets = buildClippedBridgeOwnershipTargets();
			const bridgeTarget = targets.find((entry) => entry.bridgeId === 'cersei->stannis#1') || targets[0];
			if (!bridgeTarget) throw new Error('canonical bridge target unavailable');

			const eventBusSignature = () => [...gameEvents._listeners.entries()]
				.map(([name, handlers]) => `${name}:${handlers.size}`).sort();
			const domSignature = () => [...document.body.children]
				.map((el) => `${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].sort().join('.')}`).sort();
			const renderSubmission = (state) => {
				state.renderer.render(state.scene, state.camera);
				return { calls: state.renderer.info.render.calls, triangles: state.renderer.info.render.triangles };
			};

			function installResourceTracker(state) {
				const geometries = new Map();
				const materials = new Map();
				const textures = new Map();
				const watch = (map, value) => {
					if (!value || map.has(value) || typeof value.addEventListener !== 'function') return;
					const record = { disposeEvents: 0 };
					map.set(value, record);
					value.addEventListener('dispose', () => { record.disposeEvents += 1; });
				};
				state.scene.traverse((object) => {
					watch(geometries, object.geometry);
					const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
					for (const material of list) {
						watch(materials, material);
						for (const value of Object.values(material)) if (value?.isTexture) watch(textures, value);
					}
				});
				const summarize = (map) => {
					const values = [...map.values()];
					return {
						total: values.length,
						disposed: values.filter((record) => record.disposeEvents > 0).length,
						repeatDisposals: values.filter((record) => record.disposeEvents > 1).length,
						maxDisposeEvents: values.reduce((max, record) => Math.max(max, record.disposeEvents), 0),
					};
				};
				return { snapshot: () => ({ geometries: summarize(geometries), materials: summarize(materials), textures: summarize(textures) }) };
			}

			function installDisposeProbes(state) {
				const records = [];
				const wrap = (target, methodName, label) => {
					if (!target || typeof target[methodName] !== 'function') return;
					const own = Object.getOwnPropertyDescriptor(target, methodName) || null;
					const original = target[methodName];
					const record = { label, count: 0, target, methodName, own, original, wrapper: null };
					record.wrapper = function run198DisposeProbe(...args) { record.count += 1; return original.apply(this, args); };
					Object.defineProperty(target, methodName, { configurable: true, enumerable: own?.enumerable ?? false, writable: true, value: record.wrapper });
					records.push(record);
				};
				wrap(state.renderer, 'dispose', 'renderer');
				wrap(state.chunkManager, 'disposeAll', 'chunkManager');
				wrap(state.keyboardInput, 'dispose', 'keyboardInput');
				wrap(state.touchJoystick, 'dispose', 'touchJoystick');
				wrap(state.player, 'dispose', 'player');
				wrap(state.controls, 'dispose', 'controls');
				wrap(state.freeCamera, 'dispose', 'freeCamera');
				wrap(state.interactionPrompt, 'dispose', 'interactionPrompt');
				wrap(state.dialogueBox, 'dispose', 'dialogueBox');
				wrap(state.perfPanel, 'dispose', 'perfPanel');
				wrap(state.worldEvents, 'dispose', 'worldEvents');
				wrap(state.worldEventToast, 'dispose', 'worldEventToast');
				wrap(state.controlsHelp, 'dispose', 'controlsHelp');
				wrap(state.settlementCompass, 'dispose', 'settlementCompass');
				wrap(state.settlementDiscovery, 'dispose', 'settlementDiscovery');
				wrap(state.dayNightClock, 'dispose', 'dayNightClock');
				wrap(state.playerHealth, 'dispose', 'playerHealth');
				wrap(state.healthBar, 'dispose', 'healthBar');
				state.npcs.forEach((entity, i) => wrap(entity, 'dispose', `npc:${i}`));
				state.animals.forEach((entity, i) => wrap(entity, 'dispose', `animal:${i}`));
				state.dragons.forEach((entity, i) => wrap(entity, 'dispose', `dragon:${i}`));
				return {
					snapshot: () => Object.fromEntries(records.map((record) => [record.label, record.count])),
				};
			}

			function identitySnapshot(state) {
				return {
					state, scene: state.scene, renderer: state.renderer, chunkManager: state.chunkManager, groundCollider: state.groundCollider,
					player: state.player, keyboardInput: state.keyboardInput, touchJoystick: state.touchJoystick || null,
					interaction: state.interaction, worldEvents: state.worldEvents, freeCamera: state.freeCamera,
					npcs: [...state.npcs], animals: [...state.animals], dragons: [...state.dragons],
				};
			}

			function setupGeneration(state, index) {
				const resources = installResourceTracker(state);
				const disposes = installDisposeProbes(state);
				const identities = identitySnapshot(state);
				const integration = createCurrentRuntimeIntegrationShadow({ state, profile: 'mobile' });
				const gate = createCurrentTickOwnershipShadow({ state, integration });
				const lifecycle = createLifecycleReinitShadow({ eventTarget: window, gate });
				const order = [];
				window.addEventListener('pagehide', () => {
					order.push({ lifecycleDisposed: lifecycle.isDisposed(), gateDisposed: gate.isDisposed(), rendererDisposeCount: disposes.snapshot().renderer || 0 });
				}, { capture: true, once: true });
				const currentSubmission = renderSubmission(state);
				const active = gate.activateCanonicalAtBridge(bridgeTarget.bridgeId);
				const canonicalSubmission = renderSubmission(state);
				const generation = { index, state, resources, disposes, identities, integration, gate, lifecycle, order, currentSubmission, canonicalSubmission, active };
				window.__run198.generations.push(generation);
				return generation;
			}

			window.__run198 = {
				gameEvents, bridgeTarget, generations: [], setupGeneration, eventBusSignature, domSignature,
				renderSubmission, instrumentation: window.__RUN198_INSTRUMENTATION__,
			};
			const first = setupGeneration(window.__RUN198_LIVE_STATES__[0], 1);
			return {
				bridgeId: bridgeTarget.bridgeId,
				lifecycleVersion: first.lifecycle.version,
				currentSubmission: first.currentSubmission,
				canonicalSubmission: first.canonicalSubmission,
			};
		});
		await page.screenshot({ path: path.join(OUT, 'first-canonical-active.png') });
		await page.waitForTimeout(350);

		const firstFrozen = await page.evaluate(() => {
			const first = window.__run198.generations[0];
			const stats = first.gate.getFreezeStats();
			if (!Object.keys(stats).length || Object.values(stats).some((value) => value.blockedCalls < 1)) throw new Error(`first generation tick freeze incomplete: ${JSON.stringify(stats)}`);
			const resources = first.resources.snapshot();
			if (resources.geometries.disposed || resources.materials.disposed) throw new Error(`current resources disposed before first pagehide: ${JSON.stringify(resources)}`);
			if (first.canonicalSubmission.calls >= 500 || first.canonicalSubmission.triangles >= 500000) throw new Error(`first canonical budget exceeded: ${JSON.stringify(first.canonicalSubmission)}`);
			return { freezeStats: stats, resources };
		});
		assert(firstFrozen.resources.geometries.total > 0 && firstFrozen.resources.materials.total > 0, 'first resource inventory unexpectedly empty');

		await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
		await page.waitForTimeout(180);
		const firstTeardown = await page.evaluate(() => {
			const r = window.__run198; const first = r.generations[0];
			const lifecycle = first.lifecycle.getStats();
			if (!first.gate.isDisposed() || !first.lifecycle.isDisposed()) throw new Error('first canonical lifecycle did not dispose before current teardown');
			if (lifecycle.pagehideCount !== 1 || lifecycle.gateDisposeCount !== 1 || lifecycle.lastReason !== 'pagehide' || lifecycle.lastModeBeforeGateDispose !== 'canonical') throw new Error(`first lifecycle stats invalid: ${JSON.stringify(lifecycle)}`);
			if (first.order.length !== 1 || !first.order[0].lifecycleDisposed || !first.order[0].gateDisposed || first.order[0].rendererDisposeCount !== 0) throw new Error(`capture ordering invalid: ${JSON.stringify(first.order)}`);
			const disposes = first.disposes.snapshot();
			for (const label of ['renderer', 'chunkManager', 'keyboardInput', 'player', 'controls', 'freeCamera', 'worldEvents']) {
				if (disposes[label] !== 1) throw new Error(`${label} dispose count after first pagehide = ${disposes[label]}`);
			}
			const resources = first.resources.snapshot();
			if (resources.geometries.disposed !== resources.geometries.total) throw new Error(`first geometry cleanup incomplete: ${JSON.stringify(resources.geometries)}`);
			if (resources.materials.disposed !== resources.materials.total) throw new Error(`first material cleanup incomplete: ${JSON.stringify(resources.materials)}`);
			const instrumentation = r.instrumentation.snapshot();
			if (instrumentation.raf !== 0) throw new Error(`RAF leaked after first teardown: ${JSON.stringify(instrumentation)}`);
			const baseline = { instrumentation, eventBus: r.eventBusSignature(), dom: r.domSignature() };
			r.postFirstTeardown = baseline;
			return { lifecycle, disposes, resources, baseline, order: first.order[0] };
		});

		const reinit = await page.evaluate(async () => {
			const r = window.__run198;
			const { initGame3D } = await import('/src/3d/game3d.js');
			await initGame3D();
			const states = window.__RUN198_LIVE_STATES__ || [];
			if (states.length !== 2) throw new Error(`expected exactly 2 live-state generations, got ${states.length}`);
			const first = r.generations[0]; const secondState = states[1];
			if (!secondState?.player || !secondState?.renderer || !secondState?.keyboardInput || !secondState?.freeCamera) throw new Error('second init did not reach clean current runtime readiness');
			const fresh = {
				state: secondState !== first.identities.state,
				scene: secondState.scene !== first.identities.scene,
				renderer: secondState.renderer !== first.identities.renderer,
				chunkManager: secondState.chunkManager !== first.identities.chunkManager,
				groundCollider: secondState.groundCollider !== first.identities.groundCollider,
				player: secondState.player !== first.identities.player,
				keyboardInput: secondState.keyboardInput !== first.identities.keyboardInput,
				interaction: secondState.interaction !== first.identities.interaction,
				worldEvents: secondState.worldEvents !== first.identities.worldEvents,
				freeCamera: secondState.freeCamera !== first.identities.freeCamera,
				npcs: secondState.npcs.every((entity) => !first.identities.npcs.includes(entity)),
				animals: secondState.animals.every((entity) => !first.identities.animals.includes(entity)),
				dragons: secondState.dragons.every((entity) => !first.identities.dragons.includes(entity)),
			};
			if (Object.values(fresh).some((value) => !value)) throw new Error(`second init reused current runtime identity: ${JSON.stringify(fresh)}`);
			return { fresh, instrumentation: r.instrumentation.snapshot(), eventBus: r.eventBusSignature(), dom: r.domSignature() };
		});
		assert(reinit.instrumentation.raf > 0, 'second init did not restart RAF');
		await page.waitForTimeout(220);

		await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' })));
		await page.waitForTimeout(120);
		const f4Active = await page.evaluate(() => window.__RUN198_LIVE_STATES__[1].freeCamera.active);
		assert(f4Active, 'F4 free camera did not activate after second init');
		await page.screenshot({ path: path.join(OUT, 'second-current-reinit-f4-wide.png') });
		await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F4' })));
		await page.waitForTimeout(80);
		const f4Inactive = await page.evaluate(() => !window.__RUN198_LIVE_STATES__[1].freeCamera.active);
		assert(f4Inactive, 'F4 free camera did not deactivate after second init');
		await page.screenshot({ path: path.join(OUT, 'second-current-reinit.png') });

		const secondSetup = await page.evaluate(() => {
			const r = window.__run198;
			const second = r.setupGeneration(window.__RUN198_LIVE_STATES__[1], 2);
			return { currentSubmission: second.currentSubmission, canonicalSubmission: second.canonicalSubmission };
		});
		await page.waitForTimeout(350);
		const secondFrozen = await page.evaluate(() => {
			const second = window.__run198.generations[1];
			const stats = second.gate.getFreezeStats();
			if (!Object.keys(stats).length || Object.values(stats).some((value) => value.blockedCalls < 1)) throw new Error(`second generation tick freeze incomplete: ${JSON.stringify(stats)}`);
			const resources = second.resources.snapshot();
			if (resources.geometries.disposed || resources.materials.disposed) throw new Error(`current resources disposed before second pagehide: ${JSON.stringify(resources)}`);
			if (second.canonicalSubmission.calls >= 500 || second.canonicalSubmission.triangles >= 500000) throw new Error(`second canonical budget exceeded: ${JSON.stringify(second.canonicalSubmission)}`);
			return { freezeStats: stats, resources };
		});
		assert(secondFrozen.resources.geometries.total > 0 && secondFrozen.resources.materials.total > 0, 'second resource inventory unexpectedly empty');
		await page.screenshot({ path: path.join(OUT, 'second-canonical-active.png') });

		await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
		await page.waitForTimeout(180);
		const secondTeardown = await page.evaluate(() => {
			const r = window.__run198; const second = r.generations[1];
			const lifecycle = second.lifecycle.getStats();
			if (!second.gate.isDisposed() || !second.lifecycle.isDisposed()) throw new Error('second canonical lifecycle did not dispose before current teardown');
			if (lifecycle.pagehideCount !== 1 || lifecycle.gateDisposeCount !== 1 || lifecycle.lastReason !== 'pagehide' || lifecycle.lastModeBeforeGateDispose !== 'canonical') throw new Error(`second lifecycle stats invalid: ${JSON.stringify(lifecycle)}`);
			if (second.order.length !== 1 || !second.order[0].lifecycleDisposed || !second.order[0].gateDisposed || second.order[0].rendererDisposeCount !== 0) throw new Error(`second capture ordering invalid: ${JSON.stringify(second.order)}`);
			const disposes = second.disposes.snapshot();
			for (const label of ['renderer', 'chunkManager', 'keyboardInput', 'player', 'controls', 'freeCamera', 'worldEvents']) {
				if (disposes[label] !== 1) throw new Error(`${label} dispose count after second pagehide = ${disposes[label]}`);
			}
			const resources = second.resources.snapshot();
			if (resources.geometries.disposed !== resources.geometries.total) throw new Error(`second geometry cleanup incomplete: ${JSON.stringify(resources.geometries)}`);
			if (resources.materials.disposed !== resources.materials.total) throw new Error(`second material cleanup incomplete: ${JSON.stringify(resources.materials)}`);
			const instrumentation = r.instrumentation.snapshot();
			if (instrumentation.raf !== 0) throw new Error(`RAF leaked after second teardown: ${JSON.stringify(instrumentation)}`);
			const baseline = { instrumentation, eventBus: r.eventBusSignature(), dom: r.domSignature() };
			if (JSON.stringify(baseline) !== JSON.stringify(r.postFirstTeardown)) throw new Error(`cumulative lifecycle leak after second teardown: ${JSON.stringify({ first: r.postFirstTeardown, second: baseline })}`);
			return { lifecycle, disposes, resources, baseline, order: second.order[0] };
		});

		assert(consoleErrors.length === 0, `console/page errors: ${JSON.stringify(consoleErrors)}`);
		const proof = {
			policy: 'run198-lifecycle-reinit-shadow-v1',
			bridgeId: setup.bridgeId,
			budgets: {
				firstCurrent: setup.currentSubmission,
				firstCanonical: setup.canonicalSubmission,
				secondCurrent: secondSetup.currentSubmission,
				secondCanonical: secondSetup.canonicalSubmission,
			},
			freshIdentityCount: Object.values(reinit.fresh).filter(Boolean).length,
			freshIdentityTotal: Object.keys(reinit.fresh).length,
			firstLifecycle: firstTeardown.lifecycle,
			secondLifecycle: secondTeardown.lifecycle,
			firstResources: firstTeardown.resources,
			secondResources: secondTeardown.resources,
			postTeardownBaseline: firstTeardown.baseline,
			postSecondTeardown: secondTeardown.baseline,
			captureOrdering: [firstTeardown.order, secondTeardown.order],
			f4Reinit: Boolean(f4Active && f4Inactive),
			consoleErrors,
		};
		const checksumBasis = {
			policy: proof.policy,
			bridgeId: proof.bridgeId,
			budgets: proof.budgets,
			freshIdentityCount: proof.freshIdentityCount,
			freshIdentityTotal: proof.freshIdentityTotal,
			firstLifecycle: proof.firstLifecycle,
			secondLifecycle: proof.secondLifecycle,
			firstResourceTotals: { geometries: proof.firstResources.geometries.total, materials: proof.firstResources.materials.total },
			secondResourceTotals: { geometries: proof.secondResources.geometries.total, materials: proof.secondResources.materials.total },
			listenerSignature: proof.postTeardownBaseline.instrumentation.listeners,
			eventBusSignature: proof.postTeardownBaseline.eventBus,
			f4Reinit: proof.f4Reinit,
		};
		proof.checksum = hash(JSON.stringify(checksumBasis));
		fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);

		const budget = proof.budgets;
		const summary = [
			'generations=2',
			'captureBeforeCurrentTeardown=2/2',
			`rafAfterTeardown=${proof.postTeardownBaseline.instrumentation.raf}/${proof.postSecondTeardown.instrumentation.raf}`,
			`connectedListeners=${proof.postTeardownBaseline.instrumentation.listeners.length}/${proof.postSecondTeardown.instrumentation.listeners.length}`,
			`eventBus=${proof.postTeardownBaseline.eventBus.length}/${proof.postSecondTeardown.eventBus.length}`,
			`freshIdentities=${proof.freshIdentityCount}/${proof.freshIdentityTotal}`,
			`geometryDisposed=${proof.firstResources.geometries.disposed}/${proof.firstResources.geometries.total}+${proof.secondResources.geometries.disposed}/${proof.secondResources.geometries.total}`,
			`materialDisposed=${proof.firstResources.materials.disposed}/${proof.firstResources.materials.total}+${proof.secondResources.materials.disposed}/${proof.secondResources.materials.total}`,
			'f4Reinit=pass',
			'consoleErrors=0',
			`checksum=${proof.checksum}`,
		].join('; ');
		console.log(`[checkLifecycleReinitShadow] BUDGET: ${JSON.stringify(budget)}`);
		console.log(`[checkLifecycleReinitShadow] PASS: ${summary}`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkLifecycleReinitShadow] FAIL: ${error.stack || error.message}`);
	process.exitCode = 1;
});
