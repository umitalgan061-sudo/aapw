#!/usr/bin/env node
/** Run196: real createScene ownership + streaming/input/physics rollback preflight. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run196-current-runtime-integration-shadow');
const MIME = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (error) { /* try next */ }
	}
	return null;
}

function startServer() {
	const html = `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"three":"./src/3d/vendor/three/three.module.js","three/addons/":"./src/3d/vendor/three/addons/"}}</script></head><body style="margin:0;overflow:hidden"></body></html>`;
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			if (clean === '/' || clean === '/run196.html') {
				res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return;
			}
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
		await page.goto(`http://127.0.0.1:${server.address().port}/run196.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });

		const setup = await page.evaluate(async () => {
			window.matchMedia = (query) => ({ matches: query.includes('pointer: coarse'), media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
			const THREE = await import('three');
			const { createScene } = await import('/src/3d/sceneManager.js');
			const { KeyboardInput } = await import('/src/3d/input.js');
			const { streamAroundOrbitTarget } = await import('/src/3d/gameLoopHelpers.js');
			const { buildClippedBridgeOwnershipTargets } = await import('/src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');
			const { createCurrentRuntimeIntegrationShadow, CURRENT_RUNTIME_INTEGRATION_SHADOW_POLICY } = await import('/src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js');

			const canvas = document.createElement('canvas'); canvas.id = 'run196-current-runtime-canvas'; document.body.appendChild(canvas);
			const state = createScene(canvas);
			state.renderer.setPixelRatio(1); state.renderer.setSize(1440, 900, false);
			state.realCastles = new THREE.Group(); state.realCastles.name = 'run196-real-castles-runtime-slot'; state.scene.add(state.realCastles);
			const playerRoot = new THREE.Group(); playerRoot.name = 'run196-player-runtime-slot';
			playerRoot.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0x8f6f45, roughness: 0.9 })));
			playerRoot.position.set(40, state.groundCollider.getGroundHeight(40, 40) + 1.2, 40); state.scene.add(playerRoot);
			let playerUpdateCalls = 0;
			state.player = { object3D: playerRoot, update(delta, move) { playerUpdateCalls += 1; playerRoot.position.x += move.x * delta; playerRoot.position.z += move.z * delta; } };
			state.keyboardInput = new KeyboardInput(window); state.touchJoystick = null; state.lastStreamChunk = { x: 0, z: 0 };
			state.controls.target.set(0, 0, 0); state.camera.position.set(800, 520, 1050); state.controls.update(); state.camera.updateMatrixWorld(true);
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));

			const integration = createCurrentRuntimeIntegrationShadow({ state, profile: 'mobile' });
			if (integration.getMode() !== CURRENT_RUNTIME_INTEGRATION_SHADOW_POLICY.modeCurrent) throw new Error('did not start current');
			if (!state.grass || !integration.inventory.roots.includes(state.grass)) throw new Error('Run180 grass missing from ownership inventory');
			if (integration.inventory.roots.length + integration.inventory.infrastructureCount !== integration.inventory.directSceneRootCount) throw new Error('direct scene ownership accounting mismatch');
			if (integration.getGroundCollider() !== state.groundCollider) throw new Error('current collider identity drifted');

			let currentDisposeEvents = 0;
			const geometries = new Set(); const materials = new Set();
			for (const root of integration.inventory.roots) root.traverse((object) => {
				if (object.geometry && !geometries.has(object.geometry)) { geometries.add(object.geometry); object.geometry.addEventListener?.('dispose', () => { currentDisposeEvents += 1; }); }
				for (const material of (Array.isArray(object.material) ? object.material : object.material ? [object.material] : [])) {
					if (materials.has(material)) continue; materials.add(material); material.addEventListener?.('dispose', () => { currentDisposeEvents += 1; });
				}
			});

			const renderTarget = new THREE.WebGLRenderTarget(720, 450, { depthBuffer: true, stencilBuffer: false });
			const digestPixels = (pixels) => { let rolling = 2166136261 >>> 0; for (let i = 0; i < pixels.length; i += 37) rolling = Math.imul(rolling ^ pixels[i], 16777619) >>> 0; return rolling.toString(16).padStart(8, '0'); };
			const renderStatic = () => {
				const grassVisible = state.grass.visible; state.grass.visible = false;
				const previous = state.renderer.getRenderTarget(); state.renderer.setRenderTarget(renderTarget); state.renderer.render(state.scene, state.camera);
				const result = { calls: state.renderer.info.render.calls, triangles: state.renderer.info.render.triangles };
				const pixels = new Uint8Array(720 * 450 * 4); state.renderer.readRenderTargetPixels(renderTarget, 0, 0, 720, 450, pixels); result.digest = digestPixels(pixels);
				state.renderer.setRenderTarget(previous); state.grass.visible = grassVisible; return result;
			};
			const renderFull = () => { state.renderer.render(state.scene, state.camera); return { calls: state.renderer.info.render.calls, triangles: state.renderer.info.render.triangles }; };
			const snapshot = () => ({
				cameraPosition: state.camera.position.toArray(), cameraQuaternion: state.camera.quaternion.toArray(), controlsTarget: state.controls.target.toArray(),
				playerPosition: playerRoot.position.toArray(), playerQuaternion: playerRoot.quaternion.toArray(), lastStreamChunk: state.lastStreamChunk ? { ...state.lastStreamChunk } : null,
				loadedKeys: [...state.chunkManager.loaded.keys()].sort(), everGeneratedCount: state.chunkManager.everGeneratedCount,
				rootOrder: state.scene.children.map((child) => child.uuid), grassUuid: state.grass.uuid, grassParent: state.grass.parent?.uuid || null,
			});
			const staticBefore = renderStatic(); const staticBefore2 = renderStatic();
			if (JSON.stringify(staticBefore) !== JSON.stringify(staticBefore2)) throw new Error('all-except-grass static oracle is not stable before transaction');
			const fullBefore = renderFull(); const stateBefore = snapshot();
			const targets = buildClippedBridgeOwnershipTargets(); const bridgeTarget = targets.find((entry) => entry.bridgeId === 'cersei->stannis#1') || targets[0];
			window.__run196 = { state, integration, streamAroundOrbitTarget, bridgeTarget, renderStatic, renderFull, staticBefore, fullBefore, stateBefore, heldAxesBefore: state.keyboardInput.getAxes(), streamMethodBefore: state.chunkManager.streamTowards, grassBefore: state.grass, getPlayerUpdateCalls: () => playerUpdateCalls, getDisposeEvents: () => currentDisposeEvents, renderTarget };
			return { policy: integration.version, inventoryRoots: integration.inventory.roots.length, infrastructureCount: integration.inventory.infrastructureCount, directSceneRootCount: integration.inventory.directSceneRootCount, inventoryTerrainRoots: integration.inventory.entries.filter((entry) => entry.label.startsWith('terrain:')).length, residentChunks: state.chunkManager.loadedCount, staticBefore, fullBefore, targetBridgeId: bridgeTarget.bridgeId };
		});

		await page.screenshot({ path: path.join(OUT, 'current-before.png') });
		const active = await page.evaluate(() => {
			const r = window.__run196; const state = r.state; const beforeLoaded = state.chunkManager.loadedCount; const beforeEver = state.chunkManager.everGeneratedCount; const beforePlayerUpdates = r.getPlayerUpdateCalls();
			const activated = r.integration.activateCanonicalAtBridge(r.bridgeTarget.bridgeId);
			if (r.integration.shouldRunCurrentSimulation()) throw new Error('current simulation did not freeze');
			if (!r.integration.inventory.roots.every((root) => root.parent === null)) throw new Error('borrowed current root remained attached');
			if (state.grass.parent !== null) throw new Error('Run180 grass remained attached');
			state.controls.target.set(3500, 0, 0); r.streamAroundOrbitTarget(state);
			if (state.chunkManager.loadedCount !== beforeLoaded || state.chunkManager.everGeneratedCount !== beforeEver) throw new Error('current streaming mutated while paused');
			const pausedStats = r.integration.getStreamingPauseStats(); if (pausedStats?.blockedCalls !== 1) throw new Error(`blocked stream calls ${pausedStats?.blockedCalls}`);
			const frozenAxes = r.integration.readCurrentKeyboardAxes(); if (!frozenAxes.frozen || frozenAxes.forward !== 0 || frozenAxes.running) throw new Error('input freeze failed');
			if (r.integration.runCurrentPlayerUpdate(1, { x: 50, z: 0 }, true, false)) throw new Error('current player update ran');
			if (r.getPlayerUpdateCalls() !== beforePlayerUpdates) throw new Error('player update side effect occurred');
			const bridge = activated.windowState.selectedBridges.find((entry) => entry.id === r.bridgeTarget.bridgeId); if (!bridge) throw new Error('target bridge missing');
			const canonicalHeight = r.integration.getGroundCollider().getGroundHeight(bridge.centerX, bridge.centerZ); const terrainHeight = activated.windowState.plan.context.sampler(bridge.centerX, bridge.centerZ); if (!(canonicalHeight > terrainHeight)) throw new Error('bridge collider precedence missing');
			state.camera.position.set(bridge.centerX + 520, bridge.deckY + 260, bridge.centerZ + 520); state.camera.lookAt(bridge.centerX, bridge.deckY, bridge.centerZ); state.camera.updateMatrixWorld(true);
			const near = r.renderFull(); if (near.calls >= 500 || near.triangles >= 500000) throw new Error(`canonical near budget exceeded ${JSON.stringify(near)}`);
			r.bridge = bridge;
			return { near, pausedStats, canonicalHeight, terrainHeight, residentChunks: beforeLoaded, everGenerated: beforeEver };
		});
		await page.screenshot({ path: path.join(OUT, 'canonical-near.png') });

		const far = await page.evaluate(() => {
			const r = window.__run196; const b = r.bridge; r.state.camera.position.set(b.centerX + 1800, b.deckY + 950, b.centerZ + 1800); r.state.camera.lookAt(b.centerX, b.deckY, b.centerZ); r.state.camera.updateMatrixWorld(true); return r.renderFull();
		});
		await page.screenshot({ path: path.join(OUT, 'canonical-far.png') });

		const rollback = await page.evaluate(() => {
			const r = window.__run196; const state = r.state; const result = r.integration.rollbackToCurrent();
			if (!result?.canonicalDisposed?.disposed) throw new Error('canonical candidate not disposed');
			if (!r.integration.shouldRunCurrentSimulation() || r.integration.getGroundCollider() !== state.groundCollider) throw new Error('current simulation/physics not restored');
			if (!r.integration.inventory.roots.every((root) => root.parent === state.scene)) throw new Error('current roots not restored');
			if (state.grass !== r.grassBefore || state.grass.parent !== state.scene) throw new Error('grass identity/parent not restored');
			if (r.getDisposeEvents() !== 0) throw new Error(`borrowed current resources disposed: ${r.getDisposeEvents()}`);
			const stateAfter = { cameraPosition: state.camera.position.toArray(), cameraQuaternion: state.camera.quaternion.toArray(), controlsTarget: state.controls.target.toArray(), playerPosition: state.player.object3D.position.toArray(), playerQuaternion: state.player.object3D.quaternion.toArray(), lastStreamChunk: state.lastStreamChunk ? { ...state.lastStreamChunk } : null, loadedKeys: [...state.chunkManager.loaded.keys()].sort(), everGeneratedCount: state.chunkManager.everGeneratedCount, rootOrder: state.scene.children.map((child) => child.uuid), grassUuid: state.grass.uuid, grassParent: state.grass.parent?.uuid || null };
			if (JSON.stringify(stateAfter) !== JSON.stringify(r.stateBefore)) throw new Error('current runtime snapshot did not restore exactly');
			const staticAfter = r.renderStatic(); if (JSON.stringify(staticAfter) !== JSON.stringify(r.staticBefore)) throw new Error(`static visual rollback mismatch ${JSON.stringify({ before: r.staticBefore, after: staticAfter })}`);
			const fullAfter = r.renderFull(); if (fullAfter.calls !== r.fullBefore.calls || fullAfter.triangles !== r.fullBefore.triangles) throw new Error('full current submission counts changed');
			const axesAfter = r.integration.readCurrentKeyboardAxes(); const expectedAxes = { ...r.heldAxesBefore, frozen: false }; if (JSON.stringify(axesAfter) !== JSON.stringify(expectedAxes)) throw new Error('held keyboard state changed');
			const beforeUpdates = r.getPlayerUpdateCalls(); if (!r.integration.runCurrentPlayerUpdate(0, { x: 0, z: 0 }, false, false) || r.getPlayerUpdateCalls() !== beforeUpdates + 1) throw new Error('current player update did not resume');
			if (state.chunkManager.streamTowards !== r.streamMethodBefore) throw new Error('streamTowards method identity not restored');
			state.controls.update(); state.camera.updateMatrixWorld(true);
			return { staticAfter, fullAfter, axesAfter, pausedStats: result.pausedStats, transitions: r.integration.getTransitions(), disposeEvents: r.getDisposeEvents() };
		});
		await page.screenshot({ path: path.join(OUT, 'current-restored.png') });

		const resumeProbe = await page.evaluate(() => {
			const r = window.__run196; const state = r.state; const beforeEver = state.chunkManager.everGeneratedCount; state.controls.target.set(4500, 0, 0); r.streamAroundOrbitTarget(state); const generated = state.chunkManager.everGeneratedCount - beforeEver; if (generated <= 0) throw new Error('current streaming did not resume'); return { generated, resident: state.chunkManager.loadedCount, cumulative: state.chunkManager.everGeneratedCount };
		});

		await page.evaluate(() => {
			const r = window.__run196; window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' })); r.state.keyboardInput.dispose(); r.integration.dispose(); r.renderTarget.dispose(); r.state.freeCamera.dispose(); r.state.controls.dispose(); r.state.chunkManager.disposeAll(); r.state.renderer.dispose(); r.state.renderer.domElement.remove(); delete window.__run196;
		});

		assert(setup.inventoryTerrainRoots === setup.residentChunks, `terrain inventory ${setup.inventoryTerrainRoots}/${setup.residentChunks}`);
		assert(setup.inventoryRoots + setup.infrastructureCount === setup.directSceneRootCount, 'direct root accounting mismatch');
		assert(active.pausedStats.blockedCalls === 1, 'stream pause proof missing');
		assert(far.calls < 500 && far.triangles < 500000, `far budget exceeded ${JSON.stringify(far)}`);
		assert(rollback.disposeEvents === 0, 'borrowed disposal detected');
		assert(resumeProbe.generated > 0, 'stream resume proof missing');
		assert(errors.length === 0, `browser console/page errors: ${errors.join(' | ')}`);

		const deterministic = JSON.stringify({ policy: setup.policy, inventoryRoots: setup.inventoryRoots, residentChunks: setup.residentChunks, targetBridgeId: setup.targetBridgeId, staticBefore: setup.staticBefore, staticAfter: rollback.staticAfter, fullBefore: setup.fullBefore, fullAfter: rollback.fullAfter, canonicalNear: active.near, canonicalFar: far, blockedStreamingCalls: active.pausedStats.blockedCalls, resumeGenerated: resumeProbe.generated, transitions: rollback.transitions });
		const checksum = hash(deterministic);
		const proof = { setup, active, far, rollback, resumeProbe, consoleErrors: errors.length, visualOracle: 'all-current-scene-except-run180-time-varying-grass', checksum };
		fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
		console.log(`[checkCurrentRuntimeIntegrationShadow] BUDGET: ${JSON.stringify({ currentBefore: setup.fullBefore, canonicalNear: active.near, canonicalFar: far, currentAfter: rollback.fullAfter })}`);
		console.log(`[checkCurrentRuntimeIntegrationShadow] PASS: inventory=${setup.inventoryRoots}/${setup.directSceneRootCount} direct roots with ${setup.infrastructureCount} light infrastructure; terrain=${setup.residentChunks}; grass=borrowed+restored; streamPause=${active.pausedStats.blockedCalls}; streamResume=+${resumeProbe.generated}; input=held-state-exact; physics=current-collider-restored; resourcesDisposedDuringCycle=0; staticVisualRollback=byte-exact; fullSubmissionRollback=exact; checksum=${checksum}`);
	} finally {
		await browser.close(); await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => { console.error(`[checkCurrentRuntimeIntegrationShadow] FAIL: ${error.stack || error}`); process.exitCode = 1; });
