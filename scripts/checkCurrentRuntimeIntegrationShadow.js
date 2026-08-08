#!/usr/bin/env node
/** Run 196: real createScene ownership + ChunkManager pause/resume + input/physics rollback proof. */
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
		try { return require(id); } catch (error) { /* next */ }
	}
	return null;
}

function startServer() {
	const html = `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"three":"./src/3d/vendor/three/three.module.js","three/addons/":"./src/3d/vendor/three/addons/"}}</script></head><body style="margin:0;overflow:hidden;background:#111"></body></html>`;
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			if (clean === '/' || clean === '/run196.html') {
				res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
				res.end(html);
				return;
			}
			const relative = clean.replace(/^\//, '');
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
	const errors = [];
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
		page.on('pageerror', (error) => errors.push(String(error)));
		await page.goto(`http://127.0.0.1:${server.address().port}/run196.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });

		const setup = await page.evaluate(async () => {
			window.matchMedia = (query) => ({
				matches: query.includes('pointer: coarse'), media: query, onchange: null,
				addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
			});
			const THREE = await import('three');
			const { createScene } = await import('/src/3d/sceneManager.js');
			const { KeyboardInput } = await import('/src/3d/input.js');
			const { streamAroundOrbitTarget } = await import('/src/3d/gameLoopHelpers.js');
			const { buildClippedBridgeOwnershipTargets } = await import('/src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');
			const {
				createCurrentRuntimeIntegrationShadow,
				CURRENT_RUNTIME_INTEGRATION_SHADOW_POLICY,
			} = await import('/src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js');

			const canvas = document.createElement('canvas');
			canvas.id = 'run196-current-runtime-canvas';
			document.body.appendChild(canvas);
			const state = createScene(canvas);
			state.renderer.setPixelRatio(1);
			state.renderer.setSize(1440, 900, false);

			state.realCastles = new THREE.Group();
			state.realCastles.name = 'run196-real-castles-runtime-slot';
			state.scene.add(state.realCastles);
			const playerRoot = new THREE.Group();
			playerRoot.name = 'run196-player-runtime-slot';
			const playerMarker = new THREE.Mesh(
				new THREE.CapsuleGeometry(0.6, 1.2, 4, 8),
				new THREE.MeshStandardMaterial({ color: 0x8f6f45, roughness: 0.9 }),
			);
			playerRoot.add(playerMarker);
			playerRoot.position.set(40, state.groundCollider.getGroundHeight(40, 40) + 1.2, 40);
			state.scene.add(playerRoot);
			let playerUpdateCalls = 0;
			state.player = {
				object3D: playerRoot,
				update(delta, moveDirectionXZ) {
					playerUpdateCalls += 1;
					playerRoot.position.x += moveDirectionXZ.x * delta;
					playerRoot.position.z += moveDirectionXZ.z * delta;
				},
			};
			state.keyboardInput = new KeyboardInput(window);
			state.touchJoystick = null;
			state.lastStreamChunk = { x: 0, z: 0 };
			state.controls.target.set(0, 0, 0);
			state.camera.position.set(800, 520, 1050);
			state.controls.update();
			state.camera.updateMatrixWorld(true);

			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
			const heldAxesBefore = state.keyboardInput.getAxes();
			const streamMethodBefore = state.chunkManager.streamTowards;

			const integration = createCurrentRuntimeIntegrationShadow({ state, profile: 'mobile' });
			if (integration.getMode() !== CURRENT_RUNTIME_INTEGRATION_SHADOW_POLICY.modeCurrent) throw new Error('Run196 did not start in current mode');
			if (!integration.shouldRunCurrentSimulation()) throw new Error('current simulation unexpectedly frozen at start');
			if (integration.getGroundCollider() !== state.groundCollider) throw new Error('current collider identity drifted at start');
			if (integration.inventory.roots.length < state.chunkManager.loadedCount) throw new Error('ownership inventory omitted terrain roots');

			const resourceSets = { geometries: new Set(), materials: new Set() };
			let currentDisposeEvents = 0;
			for (const root of integration.inventory.roots) {
				root.traverse((object) => {
					if (object.geometry && !resourceSets.geometries.has(object.geometry)) {
						resourceSets.geometries.add(object.geometry);
						object.geometry.addEventListener?.('dispose', () => { currentDisposeEvents += 1; });
					}
					const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
					for (const material of materials) {
						if (resourceSets.materials.has(material)) continue;
						resourceSets.materials.add(material);
						material.addEventListener?.('dispose', () => { currentDisposeEvents += 1; });
					}
				});
			}

			const pixelDigest = () => {
				const gl = state.renderer.getContext();
				const pixels = new Uint8Array(1440 * 900 * 4);
				gl.readPixels(0, 0, 1440, 900, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
				let rolling = 2166136261 >>> 0;
				for (let index = 0; index < pixels.length; index += 101) rolling = Math.imul(rolling ^ pixels[index], 16777619) >>> 0;
				return rolling.toString(16).padStart(8, '0');
			};
			const renderSnapshot = () => {
				state.renderer.render(state.scene, state.camera);
				return {
					calls: state.renderer.info.render.calls,
					triangles: state.renderer.info.render.triangles,
					pixelDigest: pixelDigest(),
				};
			};
			const baseline = renderSnapshot();
			const originalRootOrder = state.scene.children.map((child) => child.uuid);
			const targets = buildClippedBridgeOwnershipTargets();
			const target = targets.find((entry) => entry.bridgeId === 'cersei->stannis#1') || targets[0];

			function disposeObjectResources(root) {
				const textures = new Set();
				root.traverse((object) => {
					object.geometry?.dispose?.();
					const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
					for (const material of materials) {
						for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
						for (const uniform of Object.values(material.uniforms || {})) if (uniform?.value?.isTexture) textures.add(uniform.value);
						material.dispose?.();
					}
				});
				for (const texture of textures) texture.dispose?.();
			}

			window.__run196 = {
				state, integration, streamAroundOrbitTarget, target, baseline, heldAxesBefore, streamMethodBefore,
				originalRootOrder, renderSnapshot, playerRoot, playerMarker, getPlayerUpdateCalls: () => playerUpdateCalls,
				getDisposeEvents: () => currentDisposeEvents,
				disposeObjectResources,
			};
			return {
				policy: integration.version,
				baseline,
				inventoryRoots: integration.inventory.roots.length,
				inventoryTerrainRoots: integration.inventory.entries.filter((entry) => entry.label.startsWith('terrain:')).length,
				residentChunks: state.chunkManager.loadedCount,
				heldAxesBefore,
				targetBridgeId: target.bridgeId,
			};
		});

		await page.screenshot({ path: path.join(OUT, 'current-before.png') });

		const active = await page.evaluate(() => {
			const r = window.__run196;
			const state = r.state;
			const beforeLoaded = state.chunkManager.loadedCount;
			const beforeEver = state.chunkManager.everGeneratedCount;
			const beforePlayerUpdates = r.getPlayerUpdateCalls();
			const activated = r.integration.activateCanonicalAtBridge(r.target.bridgeId);
			if (r.integration.shouldRunCurrentSimulation()) throw new Error('current simulation did not freeze in canonical mode');
			if (!r.integration.inventory.roots.every((root) => root.parent === null)) throw new Error('borrowed current roots remained attached');
			if (r.integration.getGroundCollider() === state.groundCollider) throw new Error('canonical collider ownership did not activate');

			state.controls.target.set(3500, 0, 0);
			r.streamAroundOrbitTarget(state);
			if (state.chunkManager.loadedCount !== beforeLoaded || state.chunkManager.everGeneratedCount !== beforeEver) {
				throw new Error('current streaming mutated ownership while paused');
			}
			const pausedStats = r.integration.getStreamingPauseStats();
			if (pausedStats?.blockedCalls !== 1) throw new Error(`expected one blocked stream call, got ${pausedStats?.blockedCalls}`);
			const frozenAxes = r.integration.readCurrentKeyboardAxes();
			if (!frozenAxes.frozen || frozenAxes.forward !== 0 || frozenAxes.running) throw new Error('input freeze policy did not return inert axes');
			if (r.integration.runCurrentPlayerUpdate(1, { x: 50, z: 0 }, true, false)) throw new Error('current player update ran during canonical mode');
			if (r.getPlayerUpdateCalls() !== beforePlayerUpdates) throw new Error('player update side effect occurred while canonical mode was active');

			const bridge = activated.windowState.selectedBridges.find((entry) => entry.id === r.target.bridgeId);
			if (!bridge) throw new Error('canonical target bridge missing');
			const canonicalHeight = r.integration.getGroundCollider().getGroundHeight(bridge.centerX, bridge.centerZ);
			const terrainHeight = activated.windowState.plan.context.sampler(bridge.centerX, bridge.centerZ);
			if (!(canonicalHeight > terrainHeight)) throw new Error('bridge deck did not own canonical ground height');
			state.camera.position.set(bridge.centerX + 520, bridge.deckY + 260, bridge.centerZ + 520);
			state.camera.lookAt(bridge.centerX, bridge.deckY, bridge.centerZ);
			state.camera.updateMatrixWorld(true);
			const near = r.renderSnapshot();
			if (near.calls >= 500 || near.triangles >= 500000) throw new Error(`canonical mobile budget exceeded ${JSON.stringify(near)}`);
			r.activeBridge = bridge;
			return {
				near, pausedStats, canonicalHeight, terrainHeight,
				blockedCurrentPlayerUpdates: r.getPlayerUpdateCalls() - beforePlayerUpdates,
				residentChunks: beforeLoaded, everGenerated: beforeEver,
			};
		});

		await page.screenshot({ path: path.join(OUT, 'canonical-near.png') });
		const far = await page.evaluate(() => {
			const r = window.__run196;
			const bridge = r.activeBridge;
			r.state.camera.position.set(bridge.centerX + 1800, bridge.deckY + 950, bridge.centerZ + 1800);
			r.state.camera.lookAt(bridge.centerX, bridge.deckY, bridge.centerZ);
			r.state.camera.updateMatrixWorld(true);
			return r.renderSnapshot();
		});
		await page.screenshot({ path: path.join(OUT, 'canonical-far.png') });

		const rollback = await page.evaluate(() => {
			const r = window.__run196;
			const state = r.state;
			const result = r.integration.rollbackToCurrent();
			if (!result?.canonicalDisposed?.disposed) throw new Error('canonical candidate was not disposed');
			if (!r.integration.shouldRunCurrentSimulation()) throw new Error('current simulation did not resume');
			if (r.integration.getGroundCollider() !== state.groundCollider) throw new Error('current physics collider identity not restored');
			if (!r.integration.inventory.roots.every((root) => root.parent === state.scene)) throw new Error('current scene roots not restored');
			const restoredOrder = state.scene.children.map((child) => child.uuid);
			if (JSON.stringify(restoredOrder) !== JSON.stringify(r.originalRootOrder)) throw new Error('real current scene child order was not restored exactly');
			const disposeEventsBeforeResumeProbe = r.getDisposeEvents();
			if (disposeEventsBeforeResumeProbe !== 0) throw new Error(`borrowed current resources were disposed during canonical cycle: ${disposeEventsBeforeResumeProbe}`);
			const restored = r.renderSnapshot();
			if (JSON.stringify(restored) !== JSON.stringify(r.baseline)) throw new Error(`pre/post current render mismatch ${JSON.stringify({ before: r.baseline, restored })}`);
			const axesAfter = r.integration.readCurrentKeyboardAxes();
			const expectedAxes = { ...r.heldAxesBefore, frozen: false };
			if (JSON.stringify(axesAfter) !== JSON.stringify(expectedAxes)) throw new Error(`held keyboard state changed ${JSON.stringify({ expectedAxes, axesAfter })}`);
			const beforePlayerUpdates = r.getPlayerUpdateCalls();
			if (!r.integration.runCurrentPlayerUpdate(0, { x: 0, z: 0 }, false, false)) throw new Error('current player update gate did not reopen');
			if (r.getPlayerUpdateCalls() !== beforePlayerUpdates + 1) throw new Error('current player update did not resume exactly once');
			if (state.chunkManager.streamTowards !== r.streamMethodBefore) throw new Error('ChunkManager stream method identity not restored');
			return {
				restored,
				axesAfter,
				disposeEventsBeforeResumeProbe,
				transitions: r.integration.getTransitions(),
				lastStreamChunk: state.lastStreamChunk,
			};
		});

		await page.screenshot({ path: path.join(OUT, 'current-restored.png') });

		const resumeProbe = await page.evaluate(() => {
			const r = window.__run196;
			const state = r.state;
			const beforeEver = state.chunkManager.everGeneratedCount;
			state.controls.target.set(4500, 0, 0);
			r.streamAroundOrbitTarget(state);
			const generated = state.chunkManager.everGeneratedCount - beforeEver;
			if (generated <= 0) throw new Error('current ChunkManager did not resume streaming after rollback');
			return { generated, resident: state.chunkManager.loadedCount, cumulative: state.chunkManager.everGeneratedCount };
		});

		const cleanup = await page.evaluate(() => {
			const r = window.__run196;
			window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
			window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' }));
			r.state.keyboardInput.dispose();
			r.integration.dispose();
			r.state.freeCamera.dispose();
			r.state.controls.dispose();
			r.state.chunkManager.disposeAll();
			for (const child of [...r.state.scene.children]) {
				r.disposeObjectResources(child);
				r.state.scene.remove(child);
			}
			r.state.renderer.dispose();
			r.state.renderer.domElement.remove();
			const canvasCount = document.querySelectorAll('canvas').length;
			delete window.__run196;
			return { canvasCount };
		});

		assert(setup.inventoryTerrainRoots === setup.residentChunks, `terrain inventory mismatch ${setup.inventoryTerrainRoots}/${setup.residentChunks}`);
		assert(setup.inventoryRoots > setup.residentChunks, 'named current roots missing from inventory');
		assert(active.pausedStats.blockedCalls === 1, 'stream pause proof missing');
		assert(active.blockedCurrentPlayerUpdates === 0, 'player update was not frozen');
		assert(far.calls < 500 && far.triangles < 500000, `far canonical budget exceeded ${JSON.stringify(far)}`);
		assert(rollback.disposeEventsBeforeResumeProbe === 0, 'borrowed current resource disposal detected');
		assert(resumeProbe.generated > 0, 'stream resume generated no chunks');
		assert(cleanup.canvasCount === 0, `canvas leak after cleanup: ${cleanup.canvasCount}`);
		assert(errors.length === 0, `browser console/page errors: ${errors.join(' | ')}`);

		const deterministic = JSON.stringify({
			policy: setup.policy,
			inventoryRoots: setup.inventoryRoots,
			inventoryTerrainRoots: setup.inventoryTerrainRoots,
			residentChunks: setup.residentChunks,
			targetBridgeId: setup.targetBridgeId,
			baseline: setup.baseline,
			canonicalNear: active.near,
			canonicalFar: far,
			restored: rollback.restored,
			blockedStreamingCalls: active.pausedStats.blockedCalls,
			resumeGenerated: resumeProbe.generated,
			transitions: rollback.transitions,
		});
		const checksum = hash(deterministic);
		const proof = { setup, active, far, rollback, resumeProbe, consoleErrors: errors.length, checksum };
		fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
		console.log(`[checkCurrentRuntimeIntegrationShadow] BUDGET: ${JSON.stringify({ currentBefore: setup.baseline, canonicalNear: active.near, canonicalFar: far, currentAfter: rollback.restored })}`);
		console.log(`[checkCurrentRuntimeIntegrationShadow] PASS: inventory=${setup.inventoryRoots} roots/${setup.residentChunks} terrain; streamPause=${active.pausedStats.blockedCalls}; streamResume=+${resumeProbe.generated}; input=held-state-exact; physics=current-collider-restored; resourcesDisposedDuringCycle=0; renderEquality=exact; checksum=${checksum}`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkCurrentRuntimeIntegrationShadow] FAIL: ${error.stack || error}`);
	process.exitCode = 1;
});
