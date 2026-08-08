#!/usr/bin/env node
/** Run196 focused real-createScene render/state restore diagnostic with layer-isolated stability. */
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
			window.matchMedia = (query) => ({ matches: query.includes('pointer: coarse'), media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
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
			state.controls.target.set(0, 0, 0); state.camera.position.set(800, 520, 1050); state.controls.update(); state.camera.updateMatrixWorld(true);
			const integration = createCurrentRuntimeIntegrationShadow({ state, profile: 'mobile' });
			const target = new THREE.WebGLRenderTarget(720, 450, { depthBuffer: true, stencilBuffer: false });

			const round = (n) => Number(Number(n).toFixed(12));
			const arr = (v) => v?.toArray ? v.toArray().map(round) : null;
			const stateSnapshot = () => ({
				cameraPosition: arr(state.camera.position), cameraQuaternion: arr(state.camera.quaternion), cameraMatrix: state.camera.matrix.elements.map(round), cameraMatrixWorld: state.camera.matrixWorld.elements.map(round), controlsTarget: arr(state.controls.target),
				fog: state.scene.fog ? { density: round(state.scene.fog.density), color: state.scene.fog.color.getHex() } : null,
				children: state.scene.children.map((object) => ({ uuid: object.uuid, name: object.name, visible: object.visible, position: arr(object.position), quaternion: arr(object.quaternion) })),
				water: state.water ? { time: round(state.water.material.uniforms?.uTime?.value ?? 0), cameraUniform: arr(state.water.material.uniforms?.uCameraPosition?.value) } : null,
				sky: state.sky ? { time: round(state.sky.material.uniforms?.uTime?.value ?? 0), night: round(state.sky.material.uniforms?.uNightFactor?.value ?? 0) } : null,
				stars: state.stars ? { time: round(state.stars.material.uniforms?.uTime?.value ?? 0), night: round(state.stars.material.uniforms?.uNightFactor?.value ?? 0) } : null,
			});
			const renderOffscreen = () => {
				const previous = state.renderer.getRenderTarget(); state.renderer.setRenderTarget(target); state.renderer.render(state.scene, state.camera);
				const calls = state.renderer.info.render.calls; const triangles = state.renderer.info.render.triangles; const pixels = new Uint8Array(720 * 450 * 4);
				state.renderer.readRenderTargetPixels(target, 0, 0, 720, 450, pixels); state.renderer.setRenderTarget(previous);
				let rolling = 2166136261 >>> 0; for (let index = 0; index < pixels.length; index += 37) rolling = Math.imul(rolling ^ pixels[index], 16777619) >>> 0;
				return { calls, triangles, digest: rolling.toString(16).padStart(8, '0') };
			};

			const direct = [...state.scene.children];
			const originalVisibility = new Map(direct.map((object) => [object, object.visible]));
			const terrain = new Set(state.chunkManager.loaded.values());
			const lights = new Set([state.lights.sun, state.lights.hemisphere]);
			const waterfalls = new Set(state.waterfalls || []);
			const opaqueWorld = new Set([...terrain, state.settlements, state.roads, state.vegetation, state.realCastles, state.player.object3D, ...lights].filter(Boolean));
			const stableAtmosphere = new Set([...opaqueWorld, state.sky, state.stars, state.water].filter(Boolean));
			const riverAndFalls = new Set([state.river, ...waterfalls].filter(Boolean));
			const profiles = {
				backgroundOnly: new Set(), skyOnly: new Set([state.sky]), starsOnly: new Set([state.stars]), waterOnly: new Set([state.water]),
				riverOnly: new Set([state.river]), waterfallsOnly: new Set([...waterfalls]), riverWaterfallsOnly: riverAndFalls,
				terrainLights: new Set([...terrain, ...lights]), opaqueWorld, stableAtmosphere,
				opaquePlusRiver: new Set([...opaqueWorld, state.river].filter(Boolean)),
				opaquePlusWaterfalls: new Set([...opaqueWorld, ...waterfalls]),
				opaquePlusRiverWaterfalls: new Set([...opaqueWorld, ...riverAndFalls]),
				allExceptRiverWaterfalls: new Set(direct.filter((object) => object !== state.river && !waterfalls.has(object))),
				fullScene: new Set(direct),
			};
			function measureProfile(include) {
				for (const object of direct) object.visible = include.has(object) && originalVisibility.get(object);
				const frames = [renderOffscreen(), renderOffscreen(), renderOffscreen()];
				return { frames, stable12: frames[0].digest === frames[1].digest, stable23: frames[1].digest === frames[2].digest };
			}
			const layerStability = {}; for (const [name, include] of Object.entries(profiles)) layerStability[name] = measureProfile(include);
			for (const [object, visible] of originalVisibility) object.visible = visible;

			const beforeState = stateSnapshot(); const before = renderOffscreen();
			const bridgeTarget = buildClippedBridgeOwnershipTargets().find((entry) => entry.bridgeId === 'cersei->stannis#1');
			const active = integration.activateCanonicalAtBridge(bridgeTarget.bridgeId); const bridge = active.windowState.selectedBridges.find((entry) => entry.id === bridgeTarget.bridgeId);
			state.camera.position.set(bridge.centerX + 1200, bridge.deckY + 600, bridge.centerZ + 1200); state.camera.lookAt(bridge.centerX, bridge.deckY, bridge.centerZ); state.camera.updateMatrixWorld(true);
			const canonical = renderOffscreen(); integration.rollbackToCurrent(); const restoredState = stateSnapshot(); const after = renderOffscreen();
			state.controls.update(); state.camera.updateMatrixWorld(true); const afterControlsState = stateSnapshot();

			const stateEqual = JSON.stringify(beforeState) === JSON.stringify(restoredState); const controlsStateEqual = JSON.stringify(beforeState) === JSON.stringify(afterControlsState);
			target.dispose(); integration.dispose(); state.freeCamera.dispose(); state.controls.dispose(); state.chunkManager.disposeAll(); state.renderer.dispose(); canvas.remove();
			return { layerStability, before, canonical, after, stateEqual, controlsStateEqual };
		});

		fs.writeFileSync(path.join(OUT, 'diagnostic.json'), `${JSON.stringify(result, null, 2)}\n`);
		const compact = Object.fromEntries(Object.entries(result.layerStability).map(([name, value]) => [name, { digests: value.frames.map((frame) => frame.digest), stable12: value.stable12, stable23: value.stable23, calls: value.frames[2].calls, triangles: value.frames[2].triangles }]));
		console.log(`[checkCurrentRuntimeRenderRestoreDiagnostics] LAYERS: ${JSON.stringify(compact)}`);
		console.log(`[checkCurrentRuntimeRenderRestoreDiagnostics] STATE: ${JSON.stringify({ stateEqual: result.stateEqual, controlsStateEqual: result.controlsStateEqual, before: result.before, canonical: result.canonical, after: result.after })}`);
		if (!result.stateEqual || !result.controlsStateEqual) throw new Error('rollback JS/Three state equality failed');
		if (!result.layerStability.backgroundOnly.stable23) throw new Error('background/readback itself is not stable');
		if (!result.layerStability.allExceptRiverWaterfalls.stable23) throw new Error('qualified static current-world visual oracle is not stable');
		console.log('[checkCurrentRuntimeRenderRestoreDiagnostics] PASS: rollback state exact; static visual oracle qualified; river/waterfall overlay variability isolated separately.');
	} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}

main().catch((error) => { console.error(`[checkCurrentRuntimeRenderRestoreDiagnostics] FAIL: ${error.stack || error}`); process.exitCode = 1; });
