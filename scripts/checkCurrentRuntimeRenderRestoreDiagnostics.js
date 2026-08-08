#!/usr/bin/env node
/** Run196 focused real-createScene render/state restore guard using an explicit WebGLRenderTarget. */
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
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(html);
			return;
		}
		const file = path.join(ROOT, clean.replace(/^\//, ''));
		if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404); res.end('Not found'); return;
		}
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

			const canvas = document.createElement('canvas');
			document.body.appendChild(canvas);
			const state = createScene(canvas);
			state.renderer.setPixelRatio(1);
			state.renderer.setSize(1440, 900, false);
			state.realCastles = new THREE.Group();
			state.realCastles.name = 'run196-diagnostic-real-castles';
			state.scene.add(state.realCastles);
			const player = new THREE.Group();
			player.name = 'run196-diagnostic-player';
			state.scene.add(player);
			state.player = { object3D: player, update() {} };
			state.lastStreamChunk = { x: 0, z: 0 };
			state.controls.target.set(0, 0, 0);
			state.camera.position.set(800, 520, 1050);
			state.controls.update();
			state.camera.updateMatrixWorld(true);
			const integration = createCurrentRuntimeIntegrationShadow({ state, profile: 'mobile' });
			const target = new THREE.WebGLRenderTarget(1440, 900, { depthBuffer: true, stencilBuffer: false });

			const round = (n) => Number(Number(n).toFixed(12));
			const arr = (v) => v?.toArray ? v.toArray().map(round) : null;
			const materialState = (object) => {
				const material = object?.material;
				if (!material) return null;
				return {
					uuid: material.uuid,
					visible: material.visible,
					opacity: round(material.opacity ?? 1),
					transparent: !!material.transparent,
					depthWrite: !!material.depthWrite,
					side: material.side,
				};
			};
			const stateSnapshot = () => ({
				cameraPosition: arr(state.camera.position),
				cameraQuaternion: arr(state.camera.quaternion),
				cameraMatrix: state.camera.matrix.elements.map(round),
				cameraMatrixWorld: state.camera.matrixWorld.elements.map(round),
				controlsTarget: arr(state.controls.target),
				fog: state.scene.fog ? { density: round(state.scene.fog.density), color: state.scene.fog.color.getHex() } : null,
				background: state.scene.background?.isColor ? state.scene.background.getHex() : null,
				children: state.scene.children.map((object) => ({
					uuid: object.uuid,
					name: object.name,
					visible: object.visible,
					position: arr(object.position),
					quaternion: arr(object.quaternion),
					material: materialState(object),
				})),
				water: state.water ? {
					position: arr(state.water.position),
					time: round(state.water.material.uniforms?.uTime?.value ?? 0),
					cameraUniform: arr(state.water.material.uniforms?.uCameraPosition?.value),
				} : null,
				renderer: {
					toneMapping: state.renderer.toneMapping,
					exposure: round(state.renderer.toneMappingExposure),
					outputColorSpace: state.renderer.outputColorSpace,
					sortObjects: state.renderer.sortObjects,
				},
			});
			const renderOffscreen = () => {
				const previous = state.renderer.getRenderTarget();
				state.renderer.setRenderTarget(target);
				state.renderer.render(state.scene, state.camera);
				const calls = state.renderer.info.render.calls;
				const triangles = state.renderer.info.render.triangles;
				const pixels = new Uint8Array(1440 * 900 * 4);
				state.renderer.readRenderTargetPixels(target, 0, 0, 1440, 900, pixels);
				state.renderer.setRenderTarget(previous);
				let rolling = 2166136261 >>> 0;
				for (let index = 0; index < pixels.length; index += 101) {
					rolling = Math.imul(rolling ^ pixels[index], 16777619) >>> 0;
				}
				return { calls, triangles, digest: rolling.toString(16).padStart(8, '0') };
			};

			const before1 = renderOffscreen();
			const before2 = renderOffscreen();
			const beforeState = stateSnapshot();
			const bridgeTarget = buildClippedBridgeOwnershipTargets().find((entry) => entry.bridgeId === 'cersei->stannis#1');
			const active = integration.activateCanonicalAtBridge(bridgeTarget.bridgeId);
			const bridge = active.windowState.selectedBridges.find((entry) => entry.id === bridgeTarget.bridgeId);
			state.camera.position.set(bridge.centerX + 1200, bridge.deckY + 600, bridge.centerZ + 1200);
			state.camera.lookAt(bridge.centerX, bridge.deckY, bridge.centerZ);
			state.camera.updateMatrixWorld(true);
			const canonical = renderOffscreen();
			integration.rollbackToCurrent();
			const restoredBeforeRenderState = stateSnapshot();
			const after1 = renderOffscreen();
			const after2 = renderOffscreen();
			const restoredAfterRenderState = stateSnapshot();
			state.controls.update();
			state.camera.updateMatrixWorld(true);
			const afterControlsState = stateSnapshot();
			const afterControls = renderOffscreen();

			const stableBefore = JSON.stringify(before1) === JSON.stringify(before2);
			const stableAfter = JSON.stringify(after1) === JSON.stringify(after2);
			const stateEqualBeforeRender = JSON.stringify(beforeState) === JSON.stringify(restoredBeforeRenderState);
			const stateEqualAfterRender = JSON.stringify(beforeState) === JSON.stringify(restoredAfterRenderState);
			const stateEqualAfterControls = JSON.stringify(beforeState) === JSON.stringify(afterControlsState);
			const renderEqual = JSON.stringify(before2) === JSON.stringify(after2);
			const controlsRenderEqual = JSON.stringify(before2) === JSON.stringify(afterControls);

			target.dispose();
			integration.dispose();
			state.freeCamera.dispose();
			state.controls.dispose();
			state.chunkManager.disposeAll();
			state.renderer.dispose();
			canvas.remove();
			return {
				before1, before2, canonical, after1, after2, afterControls,
				stableBefore, stableAfter,
				stateEqualBeforeRender, stateEqualAfterRender, stateEqualAfterControls,
				renderEqual, controlsRenderEqual,
			};
		});

		fs.writeFileSync(path.join(OUT, 'diagnostic.json'), `${JSON.stringify(result, null, 2)}\n`);
		console.log(`[checkCurrentRuntimeRenderRestoreDiagnostics] RESULT: ${JSON.stringify(result)}`);
		if (!result.stableBefore || !result.stableAfter || !result.stateEqualBeforeRender || !result.stateEqualAfterRender || !result.stateEqualAfterControls || !result.renderEqual || !result.controlsRenderEqual) {
			throw new Error('explicit render-target current render/state equality guard failed');
		}
		console.log('[checkCurrentRuntimeRenderRestoreDiagnostics] PASS: explicit render target is byte-stable; rollback state/render exact; first post-rollback OrbitControls update inert.');
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkCurrentRuntimeRenderRestoreDiagnostics] FAIL: ${error.stack || error}`);
	process.exitCode = 1;
});
