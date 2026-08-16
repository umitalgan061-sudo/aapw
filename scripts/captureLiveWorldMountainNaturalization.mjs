#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const WIDTH = 1536;
const HEIGHT = 1024;
const OUT_DIR = path.resolve('artifacts/live-map-mountain-naturalization');
const need = (condition, message) => { if (!condition) throw new Error(`[captureLiveWorldMountainNaturalization] ${message}`); };

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
		const [THREE, sceneModule, configModule, waterModule, lightingModule] = await Promise.all([
			import('/src/3d/vendor/three/three.module.js'),
			import('/src/3d/sceneManager.js'),
			import('/src/3d/config.js'),
			import('/src/3d/world/water.js'),
			import('/src/3d/lighting.js'),
		]);
		const { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG } = configModule;
		document.body.innerHTML = [
			'<canvas id="runtime-world"></canvas>',
			'<canvas id="proof-world"></canvas>',
			'<canvas id="proof-coast"></canvas>',
			'<canvas id="proof-mountain"></canvas>',
		].join('');
		Object.assign(document.body.style, { margin: '0', overflow: 'hidden', background: '#0c1720' });
		const runtimeCanvas = document.getElementById('runtime-world');
		Object.assign(runtimeCanvas.style, { position: 'fixed', inset: '0', visibility: 'hidden' });
		for (const id of ['proof-world', 'proof-coast', 'proof-mountain']) {
			const canvas = document.getElementById(id);
			canvas.width = width;
			canvas.height = height;
		}

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
		const worldWidth = worldBounds.maxX - worldBounds.minX;
		const worldDepth = worldBounds.maxZ - worldBounds.minZ;
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
		state.water.geometry.computeBoundingBox();
		const waterExtent = state.water.geometry.boundingBox.max.x - state.water.geometry.boundingBox.min.x;
		const waterScale = Math.max(worldWidth, worldDepth) * 1.04 / waterExtent;
		state.water.scale.set(waterScale, 1, waterScale);
		state.water.position.set(0, state.water.position.y, 0);
		const daylight = lightingModule.updateDayNightLighting(state.lights, 0, WORLD_DEFAULTS.DAY_LENGTH_SECONDS, 0.48);
		state.scene.background.copy(daylight.horizonColor);
		await new Promise((resolve) => setTimeout(resolve, 3500));

		const sampleHeight = state.groundCollider.getGroundHeight;
		const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
		const dirs = Array.from({ length: 12 }, (_, index) => {
			const angle = index / 12 * Math.PI * 2;
			return { x: Math.cos(angle), z: Math.sin(angle) };
		});
		let coast = null;
		for (let z = worldBounds.minZ + 800; z <= worldBounds.maxZ - 800; z += 280) {
			for (let x = worldBounds.minX + 800; x <= worldBounds.maxX - 800; x += 280) {
				const h = sampleHeight(x, z);
				if (h < sea - 12 || h > sea + 90) continue;
				const samples = dirs.map((dir) => ({ dir, h: sampleHeight(x + dir.x * 700, z + dir.z * 700) }));
				const low = samples.reduce((a, b) => b.h < a.h ? b : a);
				const high = samples.reduce((a, b) => b.h > a.h ? b : a);
				if (low.h > sea - 3 || high.h < sea + 35) continue;
				const score = high.h - low.h;
				if (!coast || score > coast.score) coast = { x, z, h, score, lowH: low.h, highH: high.h, waterDir: low.dir };
			}
		}
		if (!coast) throw new Error('[captureLiveWorldMountainNaturalization/browser] no coast target found');
		let peak = { x: 0, z: 0, h: -Infinity };
		for (let z = worldBounds.minZ + 300; z <= worldBounds.maxZ - 300; z += 180) {
			for (let x = worldBounds.minX + 300; x <= worldBounds.maxX - 300; x += 180) {
				const h = sampleHeight(x, z);
				if (h > peak.h) peak = { x, z, h };
			}
		}

		const makeCamera = (fov, position, target) => {
			const camera = new THREE.PerspectiveCamera(fov, width / height, 2, 60_000);
			camera.position.set(position.x, position.y, position.z);
			camera.lookAt(target.x, target.y, target.z);
			camera.updateProjectionMatrix();
			camera.updateMatrixWorld(true);
			return camera;
		};
		const worldCamera = makeCamera(38,
			{ x: worldWidth * 0.11, y: Math.max(terrainBounds.max.y + 5200, worldDepth * 0.68), z: worldDepth * 1.38 },
			{ x: 0, y: terrainBounds.min.y + (terrainBounds.max.y - terrainBounds.min.y) * 0.18, z: 0 });
		const waterDir = new THREE.Vector2(coast.waterDir.x, coast.waterDir.z).normalize();
		const coastXZ = new THREE.Vector2(coast.x, coast.z).addScaledVector(waterDir, 1750);
		const coastCamera = makeCamera(48,
			{ x: coastXZ.x, y: Math.max(coast.h + 900, sampleHeight(coastXZ.x, coastXZ.y) + 340), z: coastXZ.y },
			{ x: coast.x - waterDir.x * 650, y: coast.h + 170, z: coast.z - waterDir.y * 650 });
		const outward = new THREE.Vector2(peak.x, peak.z);
		if (outward.lengthSq() < 1) outward.set(0.7, 0.7);
		outward.normalize();
		const mountainXZ = new THREE.Vector2(peak.x, peak.z).addScaledVector(outward, 1850);
		const mountainCamera = makeCamera(46,
			{ x: mountainXZ.x, y: Math.max(peak.h + 1050, sampleHeight(mountainXZ.x, mountainXZ.y) + 380), z: mountainXZ.y },
			{ x: peak.x - outward.x * 650, y: peak.h - 80, z: peak.z - outward.y * 650 });

		const renderView = (camera, id, elapsed) => {
			waterModule.updateWater(state.water, camera.position, elapsed);
			state.renderer.render(state.scene, camera);
			document.getElementById(id).getContext('2d').drawImage(runtimeCanvas, 0, 0, width, height);
			return { cameraType: camera.type, renderCalls: state.renderer.info.render.calls, renderTriangles: state.renderer.info.render.triangles };
		};
		return {
			terrainMeshCount: terrainMeshes.length,
			terrainVertexCount: terrainMeshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0),
			waterMaterialType: state.water.material.type,
			coast,
			peak,
			worldStats: renderView(worldCamera, 'proof-world', 0.73),
			coastStats: renderView(coastCamera, 'proof-coast', 1.67),
			mountainStats: renderView(mountainCamera, 'proof-mountain', 2.41),
		};
	}, { width: WIDTH, height: HEIGHT });

	const images = {};
	for (const [id, filename] of [['proof-world', 'real-world-oblique.png'], ['proof-coast', 'real-coast-oblique.png'], ['proof-mountain', 'real-mountain-oblique.png']]) {
		const png = await page.locator(`#${id}`).screenshot({ type: 'png' });
		fs.writeFileSync(path.join(OUT_DIR, filename), png);
		need(png.readUInt32BE(16) === WIDTH && png.readUInt32BE(20) === HEIGHT, `${filename} dimensions drifted`);
		need(png.length > 50_000, `${filename} too small`);
		images[filename] = { bytes: png.length, sha256: crypto.createHash('sha256').update(png).digest('hex') };
	}
	fs.writeFileSync(path.join(OUT_DIR, 'metadata.json'), `${JSON.stringify({ images, consoleErrors, pageErrors, requestFailures, ...frame }, null, 2)}\n`);
	need(consoleErrors.length === 0 && pageErrors.length === 0 && requestFailures.length === 0, 'browser/runtime errors present');
	need(frame.terrainMeshCount >= 550 && frame.terrainVertexCount > 2_000_000, 'full live terrain not loaded');
	need(frame.waterMaterialType === 'ShaderMaterial', 'shipped water shader missing');
	need(frame.worldStats.renderCalls > 500 && frame.worldStats.renderTriangles > 1_000_000, 'far view lacks full shipped scene');
	need(frame.coast.highH - frame.coast.lowH > 30, 'coast target lacks relief');
	need(Number.isFinite(frame.peak.h) && frame.peak.h > 500, 'mountain target lacks large relief');
	console.log('LIVE_WORLD_MOUNTAIN_NATURALIZATION_OK', JSON.stringify({ images, terrainMeshes: frame.terrainMeshCount, peakHeight: frame.peak.h }));
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
