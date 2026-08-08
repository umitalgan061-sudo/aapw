#!/usr/bin/env node
/** Run196 focused diagnostic/guard for real createScene render state before and after rollback. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run196-current-runtime-render-restore');
const MIME = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (error) { /* next */ }
	}
	return null;
}

function startServer() {
	const html = `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"three":"./src/3d/vendor/three/three.module.js","three/addons/":"./src/3d/vendor/three/addons/"}}</script></head><body></body></html>`;
	const server = http.createServer((req, res) => {
		const clean = decodeURIComponent(req.url.split('?')[0]);
		if (clean === '/' || clean === '/run196-diagnostic.html') {
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return;
		}
		const file = path.join(ROOT, clean.replace(/^\//, ''));
		if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
		res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
		fs.createReadStream(file).pipe(res);
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright unavailable');
	fs.mkdirSync(OUT, { recursive: true });
	const server = await startServer();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		await page.goto(`http://127.0.0.1:${server.address().port}/run196-diagnostic.html`, { waitUntil: 'domcontentloaded' });
		const result = await page.evaluate(async () => {
			window.matchMedia = (query) => ({
				matches: query.includes('pointer: coarse'), media: query,
				addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
			});
			const THREE = await import('three');
			const { createScene } = await import('/src/3d/sceneManager.js');
			const { buildClippedBridgeOwnershipTargets } = await import('/src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');
			const { createCurrentRuntimeIntegrationShadow } = await import('/src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js');
			const canvas = document.createElement('canvas'); document.body.appendChild(canvas);
			const state = createScene(canvas);
			state.renderer.setPixelRatio(1); state.renderer.setSize(1440, 900, false);
			state.realCastles = new THREE.Group(); state.realCastles.name = 'run196-diagnostic-real-castles'; state.scene.add(state.realCastles);
			const player = new THREE.Group(); player.name = 'run196-diagnostic-player'; state.scene.add(player);
			state.player = { object3D: player, update() {} };
			state.lastStreamChunk = { x: 0, z: 0 };
			state.controls.target.set(0, 0, 0);
			state.camera.position.set(800, 520, 1050);
			state.controls.update(); state.camera.updateMatrixWorld(true);
			const integration = createCurrentRuntimeIntegrationShadow({ state, profile: 'mobile' });

			const round = (n) => Number(Number(n).toFixed(12));
			const arr = (v) => v?.toArray ? v.toArray().map(round) : null;
			const materialState = (object) => {
				const m = object?.material;
				if (!m) return null;
				return { uuid: m.uuid, visible: m.visible, opacity: round(m.opacity ?? 1), transparent: !!m.transparent, depthWrite: !!m.depthWrite, side: m.side };
			};
			const stateSnapshot = () => ({
				cameraPosition: arr(state.camera.position),
				cameraQuaternion: arr(state.camera.quaternion),
				cameraMatrix: state.camera.matrix.elements.map(round),
				cameraMatrixWorld: state.camera.matrixWorld.elements.map(round),
				controlsTarget: arr(state.controls.target),
				fog: state.scene.fog ? { density: round(state.scene.fog.density), color: state.scene.fog.color.getHex() } : null,
				background: state.scene.background?.isColor ? state.scene.background.getHex() : null,
				children: state.scene.children.map((o) => ({ uuid: o.uuid, name: o.name, visible: o.visible, position: arr(o.position), quaternion: arr(o.quaternion), material: materialState(o) })),
				water: state.water ? { position: arr(state.water.position), time: round(state.water.material.uniforms?.uTime?.value ?? 0), cameraUniform: arr(state.water.material.uniforms?.uCameraPosition?.value) } : null,
				sky: state.sky ? { position: arr(state.sky.position), material: materialState(state.sky) } : null,
				stars: state.stars ? { position: arr(state.stars.position), material: materialState(state.stars) } : null,
				renderer: { toneMapping: state.renderer.toneMapping, exposure: round(state.renderer.toneMappingExposure), outputColorSpace: state.renderer.outputColorSpace, sortObjects: state.renderer.sortObjects },
			});
			const pixelDigest = () => {
				const gl = state.renderer.getContext(); const pixels = new Uint8Array(1440 * 900 * 4);
				gl.readPixels(0, 0, 1440, 900, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
				let rolling = 2166136261 >>> 0;
				for (let i = 0; i < pixels.length; i += 101) rolling = Math.imul(rolling ^ pixels[i], 16777619) >>> 0;
				return rolling.toString(16).padStart(8, '0');
			};
			const render = () => { state.renderer.render(state.scene, state.camera); return { calls: state.renderer.info.render.calls, triangles: state.renderer.info.render.triangles, digest: pixelDigest() }; };

			const beforeState = stateSnapshot();
			const before1 = render();
			const before2 = render();
			const beforeAfterTwoFramesState = stateSnapshot();
			const target = buildClippedBridgeOwnershipTargets().find((x) => x.bridgeId === 'cersei->stannis#1');
			const active = integration.activateCanonicalAtBridge(target.bridgeId);
			const bridge = active.windowState.selectedBridges.find((x) => x.id === target.bridgeId);
			state.camera.position.set(bridge.centerX + 1200, bridge.deckY + 600, bridge.centerZ + 1200);
			state.camera.lookAt(bridge.centerX, bridge.deckY, bridge.centerZ); state.camera.updateMatrixWorld(true);
			const canonical = render();
			integration.rollbackToCurrent();
			const restoredBeforeRenderState = stateSnapshot();
			const after1 = render();
			const restoredAfterOneFrameState = stateSnapshot();
			const after2 = render();
			const restoredAfterTwoFramesState = stateSnapshot();
			state.controls.update(); state.camera.updateMatrixWorld(true);
			const afterControlsUpdateState = stateSnapshot();
			const afterControls = render();

			const stableBefore = JSON.stringify(before1) === JSON.stringify(before2);
			const stableAfter = JSON.stringify(after1) === JSON.stringify(after2);
			const stateEqualBeforeRollbackRender = JSON.stringify(beforeAfterTwoFramesState) === JSON.stringify(restoredBeforeRenderState);
			const stateEqualAfterRender = JSON.stringify(beforeAfterTwoFramesState) === JSON.stringify(restoredAfterTwoFramesState);
			const stateEqualAfterControls = JSON.stringify(beforeAfterTwoFramesState) === JSON.stringify(afterControlsUpdateState);
			const renderEqual = JSON.stringify(before2) === JSON.stringify(after2);
			const controlsRenderEqual = JSON.stringify(before2) === JSON.stringify(afterControls);

			integration.dispose(); state.freeCamera.dispose(); state.controls.dispose(); state.chunkManager.disposeAll(); state.renderer.dispose(); canvas.remove();
			return { before1, before2, canonical, after1, after2, afterControls, stableBefore, stableAfter, stateEqualBeforeRollbackRender, stateEqualAfterRender, stateEqualAfterControls, renderEqual, controlsRenderEqual, beforeState, beforeAfterTwoFramesState, restoredBeforeRenderState, restoredAfterOneFrameState, restoredAfterTwoFramesState, afterControlsUpdateState };
		});
		fs.writeFileSync(path.join(OUT, 'diagnostic.json'), `${JSON.stringify(result, null, 2)}\n`);
		console.log(`[checkCurrentRuntimeRenderRestoreDiagnostics] RESULT: ${JSON.stringify({ before1: result.before1, before2: result.before2, canonical: result.canonical, after1: result.after1, after2: result.after2, afterControls: result.afterControls, stableBefore: result.stableBefore, stableAfter: result.stableAfter, stateEqualBeforeRollbackRender: result.stateEqualBeforeRollbackRender, stateEqualAfterRender: result.stateEqualAfterRender, stateEqualAfterControls: result.stateEqualAfterControls, renderEqual: result.renderEqual, controlsRenderEqual: result.controlsRenderEqual })}`);
		if (!result.stableBefore || !result.stableAfter || !result.stateEqualBeforeRollbackRender || !result.stateEqualAfterRender || !result.stateEqualAfterControls || !result.renderEqual || !result.controlsRenderEqual) {
			console.error('[checkCurrentRuntimeRenderRestoreDiagnostics] STATE_BEFORE:', JSON.stringify(result.beforeAfterTwoFramesState));
			console.error('[checkCurrentRuntimeRenderRestoreDiagnostics] STATE_RESTORED:', JSON.stringify(result.restoredBeforeRenderState));
			console.error('[checkCurrentRuntimeRenderRestoreDiagnostics] STATE_AFTER_CONTROLS:', JSON.stringify(result.afterControlsUpdateState));
			throw new Error('real current render/state equality diagnostic failed');
		}
		console.log('[checkCurrentRuntimeRenderRestoreDiagnostics] PASS: consecutive current frames stable; rollback state/render exact; first post-rollback OrbitControls update inert.');
	} finally {
		await browser.close(); await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => { console.error(`[checkCurrentRuntimeRenderRestoreDiagnostics] FAIL: ${error.stack || error}`); process.exitCode = 1; });
