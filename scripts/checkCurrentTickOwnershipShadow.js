#!/usr/bin/env node
/** Run197: real game3d tick-chain freeze/resume proof with zero default-runtime source wiring. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run197-current-tick-ownership-shadow');
const GAME3D_PATH = path.join(ROOT, 'src', '3d', 'game3d.js');
const STATE_ANCHOR = '\t\tconst state = createScene(canvas);';
const STATE_INJECTION = `${STATE_ANCHOR}\n\t\twindow.__RUN197_LIVE_STATE__ = state;`;
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
	assert(!source.includes('__RUN197_LIVE_STATE__'), 'Run197 live-state hook leaked into repository source');
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
		await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForFunction(() => {
			const s = window.__RUN197_LIVE_STATE__;
			return Boolean(s?.player && s?.keyboardInput && s?.interaction && s?.worldEvents && Array.isArray(s?.npcs) && Array.isArray(s?.animals) && Array.isArray(s?.dragons));
		}, null, { timeout: 60000 });
		await page.waitForTimeout(250);

		const setup = await page.evaluate(async () => {
			const state = window.__RUN197_LIVE_STATE__;
			const { buildClippedBridgeOwnershipTargets } = await import('/src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');
			const { createCurrentRuntimeIntegrationShadow } = await import('/src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js');
			const { createCurrentTickOwnershipShadow } = await import('/src/3d/world/worldReferenceCurrentTickOwnershipShadow.js');
			const integration = createCurrentRuntimeIntegrationShadow({ state, profile: 'mobile' });
			const gate = createCurrentTickOwnershipShadow({ state, integration });
			const targets = buildClippedBridgeOwnershipTargets();
			const bridgeTarget = targets.find((entry) => entry.bridgeId === 'cersei->stannis#1') || targets[0];
			if (!bridgeTarget) throw new Error('canonical bridge target unavailable');

			let currentDisposeEvents = 0;
			const geometries = new Set(); const materials = new Set();
			for (const root of integration.inventory.roots) root.traverse((object) => {
				if (object.geometry && !geometries.has(object.geometry)) {
					geometries.add(object.geometry); object.geometry.addEventListener?.('dispose', () => { currentDisposeEvents += 1; });
				}
				for (const material of (Array.isArray(object.material) ? object.material : object.material ? [object.material] : [])) {
					if (materials.has(material)) continue;
					materials.add(material); material.addEventListener?.('dispose', () => { currentDisposeEvents += 1; });
				}
			});

			const methodSnapshot = () => ({
				keyboard: state.keyboardInput.getAxes,
				touchAxes: state.touchJoystick?.getAxes || null,
				touchJump: state.touchJoystick?.consumeJumpRequested || null,
				player: state.player.update,
				interaction: state.interaction.update,
				worldEvents: state.worldEvents.update,
				npcs: state.npcs.map((entity) => entity.update),
				animals: state.animals.map((entity) => entity.update),
				dragons: state.dragons.map((entity) => entity.update),
			});
			const transform = (entity) => ({ position: entity.object3D.position.toArray(), quaternion: entity.object3D.quaternion.toArray() });
			const simulationSnapshot = () => ({
				player: transform(state.player),
				npcs: state.npcs.map(transform),
				animals: state.animals.map(transform),
				dragons: state.dragons.map(transform),
				npcRefs: state.npcs.map((entity) => entity.object3D.uuid),
				animalRefs: state.animals.map((entity) => entity.object3D.uuid),
				dragonRefs: state.dragons.map((entity) => entity.object3D.uuid),
			});
			const renderSubmission = () => {
				state.renderer.render(state.scene, state.camera);
				return { calls: state.renderer.info.render.calls, triangles: state.renderer.info.render.triangles };
			};

			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
			const heldBefore = { keys: [...state.keyboardInput._keys].sort(), jumpRequested: state.keyboardInput._jumpRequested };
			const originalMethods = methodSnapshot();
			const beforeSimulation = simulationSnapshot();
			const beforeSubmission = renderSubmission();
			const active = gate.activateCanonicalAtBridge(bridgeTarget.bridgeId);
			const canonicalSubmission = renderSubmission();
			window.__run197 = {
				state, integration, gate, bridgeTarget, active, originalMethods, heldBefore, beforeSimulation, beforeSubmission,
				canonicalSubmission, methodSnapshot, simulationSnapshot, renderSubmission, getDisposeEvents: () => currentDisposeEvents,
			};
			return {
				version: gate.version,
				npcs: state.npcs.length, animals: state.animals.length, dragons: state.dragons.length,
				beforeSubmission, canonicalSubmission, inventoryRoots: integration.inventory.roots.length,
			};
		});
		await page.screenshot({ path: path.join(OUT, 'canonical-real-tick-active.png') });
		await page.waitForTimeout(350);

		const frozen = await page.evaluate(() => {
			const r = window.__run197; const state = r.state;
			const stats = r.gate.getFreezeStats();
			const entries = Object.entries(stats);
			if (!entries.length || entries.some(([, value]) => value.blockedCalls < 1)) {
				throw new Error(`one or more real-tick pause targets were not called: ${JSON.stringify(stats)}`);
			}
			const frozenSimulation = r.simulationSnapshot();
			if (JSON.stringify(frozenSimulation) !== JSON.stringify(r.beforeSimulation)) throw new Error('simulation transform drifted while real tick was paused');
			if (!state.keyboardInput._jumpRequested) throw new Error('held jump edge was consumed while canonical tick gate was active');
			const heldNow = { keys: [...state.keyboardInput._keys].sort(), jumpRequested: state.keyboardInput._jumpRequested };
			if (JSON.stringify(heldNow) !== JSON.stringify(r.heldBefore)) throw new Error('held keyboard state changed while canonical tick gate was active');
			if (r.getDisposeEvents() !== 0) throw new Error(`borrowed current resources disposed during real-tick freeze: ${r.getDisposeEvents()}`);
			if (r.canonicalSubmission.calls >= 500 || r.canonicalSubmission.triangles >= 500000) throw new Error(`canonical budget exceeded ${JSON.stringify(r.canonicalSubmission)}`);
			return { stats, frozenSimulation, heldNow, disposeEvents: r.getDisposeEvents() };
		});

		const rollback = await page.evaluate(() => {
			const r = window.__run197; const state = r.state;
			const result = r.gate.rollbackToCurrent();
			const methods = r.methodSnapshot();
			const sameArray = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
			if (methods.keyboard !== r.originalMethods.keyboard || methods.touchAxes !== r.originalMethods.touchAxes || methods.touchJump !== r.originalMethods.touchJump) throw new Error('input method identity did not restore');
			if (methods.player !== r.originalMethods.player || methods.interaction !== r.originalMethods.interaction || methods.worldEvents !== r.originalMethods.worldEvents) throw new Error('singleton update identity did not restore');
			if (!sameArray(methods.npcs, r.originalMethods.npcs) || !sameArray(methods.animals, r.originalMethods.animals) || !sameArray(methods.dragons, r.originalMethods.dragons)) throw new Error('entity update identity did not restore');
			if (JSON.stringify(r.simulationSnapshot()) !== JSON.stringify(r.beforeSimulation)) throw new Error('simulation state changed at rollback boundary');
			if (r.getDisposeEvents() !== 0) throw new Error(`borrowed current resources disposed at rollback: ${r.getDisposeEvents()}`);
			const restoredSubmission = r.renderSubmission();
			if (restoredSubmission.calls !== r.beforeSubmission.calls || restoredSubmission.triangles !== r.beforeSubmission.triangles) throw new Error(`current submission counts changed after rollback: ${JSON.stringify({ before: r.beforeSubmission, restored: restoredSubmission })}`);
			return { result, restoredSubmission, transitions: r.gate.getTransitions() };
		});
		await page.screenshot({ path: path.join(OUT, 'current-real-tick-restored.png') });

		const resumeSetup = await page.evaluate(() => {
			const r = window.__run197; const state = r.state; const observers = [];
			const counts = { player: 0, npc: 0, animal: 0, dragon: 0, interaction: 0, worldEvents: 0 };
			const observe = (target, methodName, key) => {
				if (!target || typeof target[methodName] !== 'function') throw new Error(`${key} observer target missing`);
				const own = Object.getOwnPropertyDescriptor(target, methodName) || null;
				const original = target[methodName];
				const wrapper = function run197ResumeObserver(...args) { counts[key] += 1; return original.apply(this, args); };
				Object.defineProperty(target, methodName, { configurable: true, enumerable: own?.enumerable ?? false, writable: true, value: wrapper });
				observers.push({ target, methodName, own, original, wrapper });
			};
			observe(state.player, 'update', 'player');
			observe(state.npcs[0], 'update', 'npc');
			observe(state.animals[0], 'update', 'animal');
			observe(state.dragons[0], 'update', 'dragon');
			observe(state.interaction, 'update', 'interaction');
			observe(state.worldEvents, 'update', 'worldEvents');
			r.resumeObservers = observers; r.resumeCounts = counts;
			return { observing: observers.length };
		});
		assert(resumeSetup.observing === 6, 'resume observer setup incomplete');
		await page.waitForTimeout(350);
		const resumed = await page.evaluate(() => {
			const r = window.__run197; const counts = { ...r.resumeCounts };
			if (Object.values(counts).some((count) => count < 1)) throw new Error(`real tick did not resume all observed update paths: ${JSON.stringify(counts)}`);
			for (const observer of [...r.resumeObservers].reverse()) {
				if (observer.target[observer.methodName] !== observer.wrapper) throw new Error('resume observer method changed unexpectedly');
				if (observer.own) Object.defineProperty(observer.target, observer.methodName, observer.own);
				else delete observer.target[observer.methodName];
				if (observer.target[observer.methodName] !== observer.original) throw new Error('resume observer failed to restore exact method identity');
			}
			const heldAfterResume = { keys: [...r.state.keyboardInput._keys].sort(), jumpRequested: r.state.keyboardInput._jumpRequested };
			if (heldAfterResume.jumpRequested) throw new Error('jump edge was not consumed after real tick resumed');
			return { counts, heldAfterResume, playerPosition: r.state.player.object3D.position.toArray() };
		});

		const secondCycleActive = await page.evaluate(() => {
			const r = window.__run197;
			const before = r.simulationSnapshot();
			r.secondCycleBefore = before;
			r.gate.activateCanonicalAtBridge(r.bridgeTarget.bridgeId);
			return { active: true };
		});
		assert(secondCycleActive.active, 'second canonical cycle did not activate');
		await page.waitForTimeout(220);
		const secondCycle = await page.evaluate(() => {
			const r = window.__run197;
			const stats = r.gate.getFreezeStats();
			if (Object.values(stats).some((value) => value.blockedCalls < 1)) throw new Error(`second cycle missed a tick pause: ${JSON.stringify(stats)}`);
			if (JSON.stringify(r.simulationSnapshot()) !== JSON.stringify(r.secondCycleBefore)) throw new Error('second-cycle simulation drifted while paused');
			const rolled = r.gate.rollbackToCurrent();
			if (JSON.stringify(r.simulationSnapshot()) !== JSON.stringify(r.secondCycleBefore)) throw new Error('second-cycle rollback state mismatch');
			if (r.getDisposeEvents() !== 0) throw new Error(`borrowed resources disposed after second cycle: ${r.getDisposeEvents()}`);
			return { stats, transitions: r.gate.getTransitions(), disposeEvents: r.getDisposeEvents(), rolled: Boolean(rolled) };
		});

		await page.evaluate(() => {
			const r = window.__run197;
			window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
			window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' }));
			window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
			r.gate.dispose();
		});

		assert(consoleErrors.length === 0, `console/page errors: ${consoleErrors.join(' | ')}`);
		const proof = {
			policy: setup.version,
			liveEntityCounts: { npcs: setup.npcs, animals: setup.animals, dragons: setup.dragons },
			inventoryRoots: setup.inventoryRoots,
			beforeSubmission: setup.beforeSubmission,
			canonicalSubmission: setup.canonicalSubmission,
			freezeStats: frozen.stats,
			currentDisposeEvents: frozen.disposeEvents,
			restoredSubmission: rollback.restoredSubmission,
			resumeCounts: resumed.counts,
			secondCycle: { blockedMethods: Object.keys(secondCycle.stats).length, disposeEvents: secondCycle.disposeEvents, transitionCount: secondCycle.transitions.length },
			consoleErrors,
		};
		proof.checksum = hash(JSON.stringify(proof));
		fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
		console.log(`[checkCurrentTickOwnershipShadow] BUDGET: ${JSON.stringify({ current: setup.beforeSubmission, canonical: setup.canonicalSubmission, restored: rollback.restoredSubmission })}`);
		console.log(`[checkCurrentTickOwnershipShadow] PASS: realTickFreeze=player+npc+animal+dragon+interaction+worldEvents; cycles=2; pausedMethods=${Object.keys(frozen.stats).length}; resumePaths=6; resourcesDisposed=${frozen.disposeEvents}; consoleErrors=0; checksum=${proof.checksum}`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => { console.error(`[checkCurrentTickOwnershipShadow] FAIL: ${error.stack || error.message}`); process.exitCode = 1; });
