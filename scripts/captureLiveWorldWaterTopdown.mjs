#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const WIDTH = 1536;
const HEIGHT = 1024;
const OUT_DIR = path.resolve('artifacts/live-map-shallow-water-visual');
const PNG_PATH = path.join(OUT_DIR, 'live-world-water-topdown.png');
const META_PATH = path.join(OUT_DIR, 'live-world-water-topdown.json');
const need = (condition, message) => { if (!condition) throw new Error(`[captureLiveWorldWaterTopdown] ${message}`); };

const playwright = loadPlaywright();
need(playwright, 'Playwright unavailable');
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
	const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
	const consoleErrors = [];
	const pageErrors = [];
	const requestFailures = [];
	page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
	page.on('pageerror', (error) => pageErrors.push(String(error)));
	page.on('requestfailed', (request) => requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`));
	await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 30_000 });

	const frame = await page.evaluate(async ({ width, height }) => {
		const importMap = document.createElement('script');
		importMap.type = 'importmap';
		importMap.textContent = JSON.stringify({ imports: {
			three: '/src/3d/vendor/three/three.module.js',
			'three/addons/': '/src/3d/vendor/three/addons/',
		} });
		document.head.append(importMap);
		const [THREE, sceneModule, configModule, surfaceModule, waterModule, lightingModule] = await Promise.all([
			import('/src/3d/vendor/three/three.module.js'),
			import('/src/3d/sceneManager.js'),
			import('/src/3d/config.js'),
			import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js'),
			import('/src/3d/world/water.js'),
			import('/src/3d/lighting.js'),
		]);
		const { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG } = configModule;
		surfaceModule.installRuntimePindexTerrainPolish();
		document.body.innerHTML = '<canvas id="runtime-world"></canvas><canvas id="proof"></canvas>';
		Object.assign(document.body.style, { margin: '0', overflow: 'hidden', background: '#0c1720' });
		const runtimeCanvas = document.getElementById('runtime-world');
		const proofCanvas = document.getElementById('proof');
		Object.assign(runtimeCanvas.style, { position: 'fixed', inset: '0', visibility: 'hidden' });
		proofCanvas.width = width;
		proofCanvas.height = height;

		const state = sceneModule.createScene(runtimeCanvas);
		state.controls.enabled = false;
		state.scene.fog = null;
		state.sky.visible = false;
		state.stars.visible = false;
		state.renderer.setPixelRatio(1);
		state.renderer.setSize(width, height, false);
		state.renderer.outputColorSpace = THREE.SRGBColorSpace;

		const worldBounds = {
			minX: -WORLD_SCALE.WORLD_WIDTH_METERS / 2,
			maxX: WORLD_SCALE.WORLD_WIDTH_METERS / 2,
			minZ: -WORLD_SCALE.WORLD_DEPTH_METERS / 2,
			maxZ: WORLD_SCALE.WORLD_DEPTH_METERS / 2,
		};
		const size = CHUNK_CONFIG.CHUNK_SIZE_METERS;
		const minChunkX = Math.ceil(worldBounds.minX / size - 0.5);
		const maxChunkX = Math.floor(worldBounds.maxX / size + 0.5);
		const minChunkZ = Math.ceil(worldBounds.minZ / size - 0.5);
		const maxChunkZ = Math.floor(worldBounds.maxZ / size + 0.5);
		for (let z = minChunkZ; z <= maxChunkZ; z += 1) {
			for (let x = minChunkX; x <= maxChunkX; x += 1) state.chunkManager.loadChunk(x, z);
		}
		const terrainMeshes = [...state.chunkManager.loaded.values()].filter((mesh) => {
			const { x, z } = mesh.userData.chunkCoord;
			mesh.visible = x >= minChunkX && x <= maxChunkX && z >= minChunkZ && z <= maxChunkZ;
			return mesh.visible;
		});
		state.scene.updateMatrixWorld(true);
		const terrainBounds = new THREE.Box3();
		for (const mesh of terrainMeshes) {
			mesh.geometry.computeBoundingBox();
			terrainBounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
		}

		const worldWidth = worldBounds.maxX - worldBounds.minX;
		const worldDepth = worldBounds.maxZ - worldBounds.minZ;
		state.water.geometry.computeBoundingBox();
		const waterExtent = state.water.geometry.boundingBox.max.x - state.water.geometry.boundingBox.min.x;
		const waterScale = Math.max(worldWidth, worldDepth) * 1.04 / waterExtent;
		state.water.scale.set(waterScale, 1, waterScale);
		state.water.position.set(0, state.water.position.y, 0);
		const daylight = lightingModule.updateDayNightLighting(state.lights, 0, WORLD_DEFAULTS.DAY_LENGTH_SECONDS, 0.5);
		state.scene.background.copy(daylight.horizonColor);

		const aspect = width / height;
		const halfWidth = Math.max(worldWidth / 2, worldDepth * aspect / 2) * 1.025;
		const halfHeight = halfWidth / aspect;
		const cameraHeight = terrainBounds.max.y + Math.max(worldWidth, worldDepth) * 0.72;
		const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, cameraHeight - terrainBounds.min.y + 2000);
		camera.up.set(0, 0, -1);
		camera.position.set(0, cameraHeight, 0);
		camera.lookAt(0, 0, 0);
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld(true);
		waterModule.updateWater(state.water, camera.position, 0.73);
		state.renderer.render(state.scene, camera);
		proofCanvas.getContext('2d').drawImage(runtimeCanvas, 0, 0, width, height);
		const viewDirection = camera.getWorldDirection(new THREE.Vector3());
		return {
			cameraType: camera.type,
			downDot: viewDirection.dot(new THREE.Vector3(0, -1, 0)),
			terrainMeshCount: terrainMeshes.length,
			terrainVertexCount: terrainMeshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0),
			waterMaterialType: state.water.material.type,
			renderCalls: state.renderer.info.render.calls,
			renderTriangles: state.renderer.info.render.triangles,
		};
	}, { width: WIDTH, height: HEIGHT });

	const png = await page.locator('#proof').screenshot({ type: 'png' });
	const renderSha256 = crypto.createHash('sha256').update(png).digest('hex');
	const metadata = { schema: 'westeros-live-world-water-topdown-v1', renderSha256, pngBytes: png.length, consoleErrors, pageErrors, requestFailures, ...frame };
	fs.writeFileSync(PNG_PATH, png);
	fs.writeFileSync(META_PATH, `${JSON.stringify(metadata, null, 2)}\n`);
	need(png.readUInt32BE(16) === WIDTH && png.readUInt32BE(20) === HEIGHT, 'PNG dimensions drifted');
	need(png.length > 40_000, `PNG too small: ${png.length}`);
	need(consoleErrors.length === 0 && pageErrors.length === 0 && requestFailures.length === 0, 'browser/runtime errors present');
	need(frame.cameraType === 'OrthographicCamera' && frame.downDot > 0.999999, 'capture is not true vertical orthographic 3D');
	need(frame.terrainMeshCount >= 550 && frame.terrainVertexCount > 2_000_000, 'full live terrain not loaded');
	need(frame.waterMaterialType === 'ShaderMaterial', 'shipped water shader missing');
	need(frame.renderCalls > 500 && frame.renderTriangles > 1_000_000, 'render does not contain full live world');
	console.log('LIVE_WORLD_WATER_TOPDOWN_OK', JSON.stringify({ renderSha256, pngBytes: png.length, terrainMeshes: frame.terrainMeshCount }));
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
