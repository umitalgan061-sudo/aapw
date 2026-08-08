#!/usr/bin/env node
/** Run197: prove reversible gameplay tick freeze over the Run196 current-runtime transaction. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run197-gameplay-tick-freeze-shadow');
const MIME = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (error) { /* try next */ }
	}
	return null;
}

function startServer() {
	const html = '<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"three":"./src/3d/vendor/three/three.module.js","three/addons/":"./src/3d/vendor/three/addons/"}}</script></head><body style="margin:0;overflow:hidden"></body></html>';
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			if (clean === '/' || clean === '/run197.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; }
			const file = path.join(ROOT, clean.replace(/^\//, ''));
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
	const errors = [];
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
		page.on('pageerror', (error) => errors.push(String(error)));
		await page.goto(`http://127.0.0.1:${server.address().port}/run197.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });

		const setup = await page.evaluate(async () => {
			window.matchMedia = (query) => ({ matches: query.includes('pointer: coarse'), media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
			const THREE = await import('three');
			const { createScene } = await import('/src/3d/sceneManager.js');
			const { updateEntitiesSafely, updateSystemSafely } = await import('/src/3d/safeMode.js');
			const { buildClippedBridgeOwnershipTargets } = await import('/src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');
			const { createGameplayTickFreezeShadow } = await import('/src/3d/world/worldReferenceGameplayTickFreezeShadow.js');
			const canvas = document.createElement('canvas'); document.body.appendChild(canvas);
			const state = createScene(canvas);
			state.renderer.setPixelRatio(1); state.renderer.setSize(1440, 900, false);
			state.realCastles = new THREE.Group(); state.scene.add(state.realCastles);
			const counters = { player: 0, npc: 0, animal: 0, dragon: 0, interaction: 0, worldEvents: 0 };
			const makeRoot = (name, x) => { const root = new THREE.Group(); root.name = name; root.position.set(x, state.groundCollider.getGroundHeight(x, 30) + 1, 30); root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial())); state.scene.add(root); return root; };
			const playerRoot = makeRoot('run197-player', 20);
			state.player = { object3D: playerRoot, update() { counters.player += 1; playerRoot.position.x += 1; } };
			state.npcs = [{ object3D: makeRoot('run197-npc', 24), update() { counters.npc += 1; this.object3D.position.x += 1; }, dispose() {} }];
			state.animals = [{ object3D: makeRoot('run197-animal', 28), isFleeing: false, update() { counters.animal += 1; this.object3D.position.x += 1; }, dispose() {} }];
			state.dragons = [{ object3D: makeRoot('run197-dragon', 32), update() { counters.dragon += 1; this.object3D.position.x += 1; }, dispose() {} }];
			state.interaction = { update() { counters.interaction += 1; }, dispose() {} };
			state.worldEvents = { update() { counters.worldEvents += 1; }, dispose() {} };
			state.lastStreamChunk = { x: 0, z: 0 }; state.keyboardInput = null; state.touchJoystick = null;
			const originalMethods = {
				player: state.player.update, npc: state.npcs[0].update, animal: state.animals[0].update,
				dragon: state.dragons[0].update, interaction: state.interaction.update, worldEvents: state.worldEvents.update,
			};
			const controller = createGameplayTickFreezeShadow({ state, profile: 'mobile' });
			const target = buildClippedBridgeOwnershipTargets()[0];
			const snapshot = () => ({
				player: playerRoot.position.toArray(), npc: state.npcs[0].object3D.position.toArray(), animal: state.animals[0].object3D.position.toArray(), dragon: state.dragons[0].object3D.position.toArray(),
				rootOrder: state.scene.children.map((child) => child.uuid), loaded: [...state.chunkManager.loaded.keys()].sort(), ever: state.chunkManager.everGeneratedCount,
			});
			const runGameplaySlice = () => {
				state.player.update(1 / 60, { x: 0, z: 0 }, false, false);
				const playerPos = state.player.object3D.position;
				state.npcs = updateEntitiesSafely({ entities: state.npcs, scene: state.scene, label: 'NPC', update: (npc) => npc.update(1 / 60, playerPos) });
				updateSystemSafely({ disabled: false, label: 'Interaction controller', update: () => state.interaction.update(state.npcs, playerPos) });
				state.animals = updateEntitiesSafely({ entities: state.animals, scene: state.scene, label: 'Animal', update: (animal) => animal.update(1 / 60, playerPos, []) });
				state.dragons = updateEntitiesSafely({ entities: state.dragons, scene: state.scene, label: 'Dragon', update: (dragon) => dragon.update(1 / 60, playerPos) });
				updateSystemSafely({ disabled: false, label: 'World-event system', update: () => state.worldEvents.update(1 / 60, 0.5), disposeOnError: () => state.worldEvents.dispose() });
			};
			const render = () => { state.renderer.render(state.scene, state.camera); return { calls: state.renderer.info.render.calls, triangles: state.renderer.info.render.triangles }; };
			window.__run197 = { state, controller, target, counters, originalMethods, snapshot, runGameplaySlice, render };
			return { policy: controller.version, before: snapshot(), submission: render(), targetBridgeId: target.bridgeId };
		});
		await page.screenshot({ path: path.join(OUT, 'current-before.png') });

		const active = await page.evaluate(() => {
			const r = window.__run197; const before = r.snapshot(); r.before = before; r.controller.activateCanonicalAtBridge(r.target.bridgeId);
			if (r.controller.shouldRunCurrentSimulation()) throw new Error('current simulation should be frozen');
			r.runGameplaySlice(); r.runGameplaySlice();
			if (Object.values(r.counters).some((value) => value !== 0)) throw new Error(`original gameplay update ran while canonical active: ${JSON.stringify(r.counters)}`);
			const after = r.snapshot(); if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('current gameplay state mutated while canonical active');
			const stats = r.controller.getGameplayPauseStats();
			if (!stats || stats.length !== 6 || stats.some((entry) => entry.blockedCalls !== 2)) throw new Error(`unexpected gameplay pause stats ${JSON.stringify(stats)}`);
			return { stats, submission: r.render() };
		});
		await page.screenshot({ path: path.join(OUT, 'canonical-active.png') });

		const restored = await page.evaluate(() => {
			const r = window.__run197; const result = r.controller.rollbackToCurrent();
			if (!r.controller.shouldRunCurrentSimulation()) throw new Error('current simulation did not resume');
			const methods = r.originalMethods;
			if (r.state.player.update !== methods.player || r.state.npcs[0].update !== methods.npc || r.state.animals[0].update !== methods.animal || r.state.dragons[0].update !== methods.dragon || r.state.interaction.update !== methods.interaction || r.state.worldEvents.update !== methods.worldEvents) throw new Error('one or more gameplay update method identities were not restored');
			if (JSON.stringify(r.snapshot()) !== JSON.stringify(r.before)) throw new Error('rollback did not restore exact current state');
			r.runGameplaySlice();
			if (Object.values(r.counters).some((value) => value !== 1)) throw new Error(`gameplay did not resume exactly once: ${JSON.stringify(r.counters)}`);
			const postResume = { ...r.counters };
			const firstBlocked = result.blocked.map((entry) => ({ label: entry.label, blockedCalls: entry.blockedCalls }));
			const submission = r.render();
			return { firstBlocked, postResume, submission, transitions: r.controller.getTransitions() };
		});
		await page.screenshot({ path: path.join(OUT, 'current-restored.png') });

		const secondCycle = await page.evaluate(() => {
			const r = window.__run197; const before = r.snapshot(); const beforeCounters = { ...r.counters };
			r.controller.activateCanonicalAtBridge(r.target.bridgeId); r.runGameplaySlice();
			if (JSON.stringify(r.counters) !== JSON.stringify(beforeCounters)) throw new Error('second canonical cycle leaked gameplay update');
			r.controller.rollbackToCurrent(); if (JSON.stringify(r.snapshot()) !== JSON.stringify(before)) throw new Error('second rollback state mismatch');
			if (r.state.player.update !== r.originalMethods.player || r.state.worldEvents.update !== r.originalMethods.worldEvents) throw new Error('second rollback method identity mismatch');
			r.controller.dispose(); return { transitions: r.controller.getTransitions(), disposed: r.controller.isDisposed() };
		});

		assert(errors.length === 0, `console/page errors: ${JSON.stringify(errors)}`);
		const proof = { setup, active, restored, secondCycle, consoleErrors: errors };
		fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
		console.log(`[checkGameplayTickFreezeShadow] BUDGET: ${JSON.stringify({ currentBefore: setup.submission, canonical: active.submission, currentRestored: restored.submission })}`);
		console.log('[checkGameplayTickFreezeShadow] PASS: six live game-tick update targets (player/NPC/animal/dragon/interaction/world-event) are instance-paused during canonical ownership, exact update identities/state restore on rollback, a real post-rollback tick resumes all six once, second cycle is reversible, console/page errors=0.');
	} finally {
		await browser.close(); await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => { console.error(`[checkGameplayTickFreezeShadow] FAIL: ${error.stack || error}`); process.exitCode = 1; });
