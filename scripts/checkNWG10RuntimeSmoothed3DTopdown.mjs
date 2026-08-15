#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const WIDTH = 1536;
const HEIGHT = 1024;
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(OUT_ARG ? OUT_ARG.slice('--out-dir='.length) : 'artifacts/nw-g10-runtime-smoothing');
const PNG_PATH = path.join(OUT_DIR, 'g10-runtime-smoothed-full-world-3d-topdown.png');
const META_PATH = path.join(OUT_DIR, 'g10-runtime-smoothed-full-world-3d-topdown.json');
const EXPECTED_SAMPLING_POLICY = 'owner-map-pindex-quality-v2-2026-08-12-v1';
const need = (condition, message) => { if (!condition) throw new Error(`[checkNWG10RuntimeSmoothed3DTopdown] ${message}`); };

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
	await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 20_000 });

	const frame = await page.evaluate(async ({ width, height, expectedSamplingPolicy }) => {
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
		const installation = surfaceModule.installRuntimePindexTerrainPolish();
		document.body.innerHTML = '<canvas id="runtime-world"></canvas><canvas id="proof"></canvas>';
		Object.assign(document.body.style, { margin: '0', overflow: 'hidden', background: '#0c1720' });
		const runtimeCanvas = document.getElementById('runtime-world');
		const proofCanvas = document.getElementById('proof');
		Object.assign(runtimeCanvas.style, { position: 'fixed', inset: '0', visibility: 'hidden' });
		Object.assign(proofCanvas.style, { display: 'block', width: `${width}px`, height: `${height}px` });
		proofCanvas.width = width; proofCanvas.height = height;

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
			const visible = x >= minChunkX && x <= maxChunkX && z >= minChunkZ && z <= maxChunkZ;
			mesh.visible = visible;
			return visible;
		});
		state.scene.updateMatrixWorld(true);
		const terrainBounds = new THREE.Box3();
		for (const mesh of terrainMeshes) {
			mesh.geometry.computeBoundingBox();
			terrainBounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
		}

		const summaries = terrainMeshes.map((mesh) => mesh.userData.runtimePindexTerrainPolish);
		const continuousSemanticMeshes = summaries.filter((summary) => summary?.semanticSamplingPolicyId === expectedSamplingPolicy).length;
		const boundaryBlendVertices = summaries.reduce((sum, summary) => sum + (summary?.boundaryBlendVertices ?? 0), 0);
		const maxBoundaryBlend = Math.max(0, ...summaries.map((summary) => summary?.maxBoundaryBlend ?? 0));
		const totalSurfaceWeight = summaries.reduce((sum, summary) => sum + Object.values(summary?.surfaceWeightSums ?? {}).reduce((a, b) => a + b, 0), 0);
		const totalVertices = terrainMeshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);

		const centerX = 0;
		const centerZ = 0;
		const worldWidth = worldBounds.maxX - worldBounds.minX;
		const worldDepth = worldBounds.maxZ - worldBounds.minZ;
		state.water.geometry.computeBoundingBox();
		const waterExtent = state.water.geometry.boundingBox.max.x - state.water.geometry.boundingBox.min.x;
		const waterScale = Math.max(worldWidth, worldDepth) * 1.04 / waterExtent;
		state.water.scale.set(waterScale, 1, waterScale);
		state.water.position.set(centerX, state.water.position.y, centerZ);
		const daylight = lightingModule.updateDayNightLighting(state.lights, 0, WORLD_DEFAULTS.DAY_LENGTH_SECONDS, 0.5);
		state.scene.background.copy(daylight.horizonColor);

		const aspect = width / height;
		const halfWidth = Math.max(worldWidth / 2, worldDepth * aspect / 2) * 1.025;
		const halfHeight = halfWidth / aspect;
		const cameraHeight = terrainBounds.max.y + Math.max(worldWidth, worldDepth) * 0.72;
		const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, cameraHeight - terrainBounds.min.y + 2_000);
		camera.up.set(0, 0, -1);
		camera.position.set(centerX, cameraHeight, centerZ);
		camera.lookAt(centerX, 0, centerZ);
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld(true);
		waterModule.updateWater(state.water, camera.position, 0);

		const overlayObjects = [];
		state.scene.traverse((object) => {
			if (!object.visible) return;
			if (object.isGridHelper || object.userData?.visibleGeoCellOverlay === true || /(?:geo.?cell|pindex).*(?:grid|overlay)|(?:grid|overlay).*(?:geo.?cell|pindex)/i.test(`${object.type} ${object.name}`)) {
				overlayObjects.push(`${object.type}:${object.name || '(unnamed)'}`);
			}
		});

		state.renderer.render(state.scene, camera);
		const context = proofCanvas.getContext('2d', { willReadFrequently: true });
		context.drawImage(runtimeCanvas, 0, 0, width, height);
		const pixels = context.getImageData(0, 0, width, height).data;
		const colorDistance = (a, b) => (Math.abs(pixels[a] - pixels[b]) + Math.abs(pixels[a + 1] - pixels[b + 1]) + Math.abs(pixels[a + 2] - pixels[b + 2])) / 3;
		const worldToPixelX = (x) => (x - (centerX - halfWidth)) / (2 * halfWidth) * width;
		const worldToPixelY = (z) => (z - (centerZ - halfHeight)) / (2 * halfHeight) * height;
		const xMin = Math.max(2, Math.ceil(worldToPixelX(worldBounds.minX)));
		const xMax = Math.min(width - 3, Math.floor(worldToPixelX(worldBounds.maxX)));
		const yMin = Math.max(2, Math.ceil(worldToPixelY(worldBounds.minZ)));
		const yMax = Math.min(height - 3, Math.floor(worldToPixelY(worldBounds.maxZ)));
		const verticalEnergy = (x) => {
			let sum = 0; let count = 0;
			for (let y = yMin; y <= yMax; y += 4) { sum += colorDistance((y * width + x - 1) * 4, (y * width + x + 1) * 4); count += 1; }
			return sum / Math.max(1, count);
		};
		const horizontalEnergy = (y) => {
			let sum = 0; let count = 0;
			for (let x = xMin; x <= xMax; x += 4) { sum += colorDistance(((y - 1) * width + x) * 4, ((y + 1) * width + x) * 4); count += 1; }
			return sum / Math.max(1, count);
		};
		const ratios = [];
		for (let edge = minChunkX; edge < maxChunkX; edge += 1) {
			const x = Math.round(worldToPixelX((edge + 0.5) * size));
			if (x < xMin + 8 || x > xMax - 8) continue;
			const baseline = (verticalEnergy(x - 6) + verticalEnergy(x + 6)) / 2;
			ratios.push(verticalEnergy(x) / Math.max(0.25, baseline));
		}
		for (let edge = minChunkZ; edge < maxChunkZ; edge += 1) {
			const y = Math.round(worldToPixelY((edge + 0.5) * size));
			if (y < yMin + 8 || y > yMax - 8) continue;
			const baseline = (horizontalEnergy(y - 6) + horizontalEnergy(y + 6)) / 2;
			ratios.push(horizontalEnergy(y) / Math.max(0.25, baseline));
		}
		const viewDirection = camera.getWorldDirection(new THREE.Vector3());
		return {
			cameraType: camera.type,
			downDot: viewDirection.dot(new THREE.Vector3(0, -1, 0)),
			terrainMeshCount: terrainMeshes.length,
			terrainVertexCount: totalVertices,
			continuousSemanticMeshes,
			boundaryBlendVertices,
			maxBoundaryBlend,
			totalSurfaceWeight,
			waterMaterialType: state.water.material.type,
			renderCalls: state.renderer.info.render.calls,
			renderTriangles: state.renderer.info.render.triangles,
			overlayObjects,
			meanGridEnergyRatio: ratios.reduce((sum, value) => sum + value, 0) / Math.max(1, ratios.length),
			maxGridEnergyRatio: Math.max(0, ...ratios),
		};
	}, { width: WIDTH, height: HEIGHT, expectedSamplingPolicy: EXPECTED_SAMPLING_POLICY });

	const png = await page.locator('#proof').screenshot({ type: 'png' });
	const renderSha256 = crypto.createHash('sha256').update(png).digest('hex');
	const metadata = { schema: 'westeros-nw-g10-runtime-smoothed-full-world-3d-v1', renderSha256, pngBytes: png.length, consoleErrors, pageErrors, requestFailures, ...frame };
	fs.writeFileSync(PNG_PATH, png);
	fs.writeFileSync(META_PATH, `${JSON.stringify(metadata, null, 2)}\n`);

	need(png.readUInt32BE(16) === WIDTH && png.readUInt32BE(20) === HEIGHT, 'PNG dimensions drifted');
	need(png.length > 40_000, `PNG too small: ${png.length}`);
	need(consoleErrors.length === 0 && pageErrors.length === 0 && requestFailures.length === 0, 'browser/runtime errors present');
	need(frame.cameraType === 'OrthographicCamera' && frame.downDot > 0.999999, 'capture is not true vertical orthographic 3D');
	need(frame.terrainMeshCount >= 550 && frame.terrainVertexCount > 2_000_000, 'full runtime terrain was not loaded');
	need(frame.continuousSemanticMeshes === frame.terrainMeshCount, `continuous semantic pass missing on ${frame.terrainMeshCount - frame.continuousSemanticMeshes} mesh(es)`);
	need(frame.boundaryBlendVertices > 10_000 && frame.maxBoundaryBlend > 0.1, 'continuous boundary reconstruction is not present in the real runtime mesh set');
	need(Math.abs(frame.totalSurfaceWeight - frame.terrainVertexCount) < frame.terrainVertexCount * 2e-6, 'runtime surface weights do not partition unity');
	need(frame.waterMaterialType === 'ShaderMaterial', 'runtime water shader missing');
	need(frame.renderCalls > 500 && frame.renderTriangles > 1_000_000, 'render does not contain the complete runtime world');
	need(frame.overlayObjects.length === 0, `explicit grid overlay found: ${frame.overlayObjects.join(', ')}`);
	need(frame.meanGridEnergyRatio < 2.8 && frame.maxGridEnergyRatio < 7.5, `regular chunk-grid energy detected: ${frame.meanGridEnergyRatio}/${frame.maxGridEnergyRatio}`);
	console.log(`NW_G10_RUNTIME_SMOOTHED_3D_TOPDOWN=${JSON.stringify({ renderSha256, pngBytes: png.length, terrainMeshes: frame.terrainMeshCount, boundaryBlendVertices: frame.boundaryBlendVertices, meanGridEnergyRatio: frame.meanGridEnergyRatio })}`);
	console.log('NW_G10_RUNTIME_SMOOTHED_3D_TOPDOWN_OK');
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
