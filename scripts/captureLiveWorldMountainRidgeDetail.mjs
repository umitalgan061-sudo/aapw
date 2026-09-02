#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const WIDTH = 1536;
const HEIGHT = 1024;
const OUT_DIR = path.resolve('artifacts/live-map-mountain-naturalization');
const playwright = loadPlaywright();
if (!playwright) {
	console.error('[captureLiveWorldMountainRidgeDetail] Playwright unavailable');
	process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
try {
	const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
	const consoleErrors = [];
	const pageErrors = [];
	const requestFailures = [];
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});
	page.on('pageerror', (error) => pageErrors.push(String(error)));
	page.on('requestfailed', (request) => {
		const failure = request.failure()?.errorText ?? 'failed';
		if (request.method() === 'HEAD' && failure === 'net::ERR_ABORTED') return;
		requestFailures.push(`${request.method()} ${request.url()}: ${failure}`);
	});
	await page.goto(`${server.baseUrl}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, {
		waitUntil: 'load',
		timeout: 90_000,
	});

	const metadata = await page.evaluate(async ({ width, height }) => {
		const base = document.createElement('base');
		base.href = '/';
		document.head.prepend(base);
		const importMap = document.createElement('script');
		importMap.type = 'importmap';
		importMap.textContent = JSON.stringify({ imports: {
			three: '/src/3d/vendor/three/three.module.js',
			'three/addons/': '/src/3d/vendor/three/addons/',
		} });
		document.head.append(importMap);

		const [THREE, sceneModule, configModule, mapModule, lightingModule, waterModule, skyModule] = await Promise.all([
			import('/src/3d/vendor/three/three.module.js'),
			import('/src/3d/sceneManager.js'),
			import('/src/3d/config.js'),
			import('/src/3d/world/worldReferenceMap.js'),
			import('/src/3d/lighting.js'),
			import('/src/3d/world/water.js'),
			import('/src/3d/sky.js'),
		]);
		const { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG } = configModule;
		const { REFERENCE_RELIEF_CHAINS } = mapModule;
		const targets = REFERENCE_RELIEF_CHAINS.filter(({ id }) => ['bone-mountains', 'eastern-chain'].includes(id));
		if (targets.length !== 2) throw new Error('Bone/Eastern canonical relief targets missing');

		document.body.innerHTML = [
			'<canvas id="runtime"></canvas>',
			'<canvas id="bone-proof"></canvas>',
			'<canvas id="eastern-proof"></canvas>',
		].join('');
		Object.assign(document.body.style, { margin: '0', overflow: 'hidden', background: '#15202a' });
		const runtimeCanvas = document.getElementById('runtime');
		Object.assign(runtimeCanvas.style, { position: 'fixed', inset: '0', visibility: 'hidden' });
		for (const id of ['bone-proof', 'eastern-proof']) {
			const canvas = document.getElementById(id);
			canvas.width = width;
			canvas.height = height;
		}

		const state = sceneModule.createScene(runtimeCanvas);
		state.controls.enabled = false;
		state.renderer.setPixelRatio(1);
		state.renderer.setSize(width, height, false);
		state.renderer.outputColorSpace = THREE.SRGBColorSpace;
		await new Promise((resolve) => setTimeout(resolve, 2800));
		const sampleHeight = state.groundCollider.getGroundHeight;
		const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
		const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
		const mapWidth = WORLD_SCALE.MAP_BOUNDS.maxX - WORLD_SCALE.MAP_BOUNDS.minX;
		const mapHeight = WORLD_SCALE.MAP_BOUNDS.maxY - WORLD_SCALE.MAP_BOUNDS.minY;
		const toWorld = (nx, ny) => ({
			x: (nx * mapWidth + WORLD_SCALE.MAP_BOUNDS.minX - centerMapX) * WORLD_SCALE.METERS_PER_MAP_UNIT,
			z: (ny * mapHeight + WORLD_SCALE.MAP_BOUNDS.minY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT,
		});
		const daylight = lightingModule.updateDayNightLighting(state.lights, 0, WORLD_DEFAULTS.DAY_LENGTH_SECONDS, 0.48);
		const aspect = width / height;

		const pixelStats = (canvas) => {
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			const data = ctx.getImageData(0, 0, width, height).data;
			let count = 0;
			let sum = 0;
			let sumSq = 0;
			let dark = 0;
			let edges = 0;
			let edgeCount = 0;
			const stride = 8;
			const luma = (x, y) => {
				const offset = (y * width + x) * 4;
				return (data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722) / 255;
			};
			for (let y = 0; y < height; y += stride) {
				for (let x = 0; x < width; x += stride) {
					const value = luma(x, y);
					count += 1;
					sum += value;
					sumSq += value * value;
					if (value < 0.025) dark += 1;
					if (x + stride < width) {
						edges += Math.abs(value - luma(x + stride, y));
						edgeCount += 1;
					}
					if (y + stride < height) {
						edges += Math.abs(value - luma(x, y + stride));
						edgeCount += 1;
					}
				}
			}
			const average = sum / count;
			return {
				meanLuma: average,
				lumaStdDev: Math.sqrt(Math.max(0, sumSq / count - average * average)),
				darkRatio: dark / count,
				edgeEnergy: edges / Math.max(edgeCount, 1),
			};
		};

		const reports = {};
		for (const chain of targets) {
			const segmentIndex = Math.max(0, Math.floor((chain.points.length - 1) / 2));
			const a = chain.points[segmentIndex];
			const b = chain.points[segmentIndex + 1];
			const center = toWorld((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5);
			const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
			const centerChunkX = Math.round(center.x / chunkSize);
			const centerChunkZ = Math.round(center.z / chunkSize);
			for (let dz = -4; dz <= 4; dz += 1) {
				for (let dx = -4; dx <= 4; dx += 1) state.chunkManager.loadChunk(centerChunkX + dx, centerChunkZ + dz);
			}
			let peak = { x: center.x, z: center.z, h: sampleHeight(center.x, center.z) };
			for (let dz = -700; dz <= 700; dz += 100) {
				for (let dx = -700; dx <= 700; dx += 100) {
					const h = sampleHeight(center.x + dx, center.z + dz);
					if (h > peak.h) peak = { x: center.x + dx, z: center.z + dz, h };
				}
			}
			const tangent = new THREE.Vector2((b[0] - a[0]) * mapWidth, (b[1] - a[1]) * mapHeight).normalize();
			const normal = new THREE.Vector2(-tangent.y, tangent.x);
			const camera = new THREE.PerspectiveCamera(48, aspect, 2, 40_000);
			const cameraXZ = new THREE.Vector2(peak.x, peak.z)
				.addScaledVector(normal, 1250)
				.addScaledVector(tangent, -260);
			const cameraGround = sampleHeight(cameraXZ.x, cameraXZ.y);
			camera.position.set(cameraXZ.x, Math.max(peak.h + 720, cameraGround + 380), cameraXZ.y);
			camera.lookAt(peak.x + tangent.x * 120, peak.h + 80, peak.z + tangent.y * 120);
			camera.updateProjectionMatrix();
			camera.updateMatrixWorld(true);
			waterModule.updateWater(state.water, camera.position, 1.2 + segmentIndex * 0.17);
			skyModule.updateAuroraSky(state.sky, camera.position, 1.2 + segmentIndex * 0.17, daylight);
			state.scene.updateMatrixWorld(true);
			state.renderer.render(state.scene, camera);
			const proofId = chain.id === 'bone-mountains' ? 'bone-proof' : 'eastern-proof';
			const proof = document.getElementById(proofId);
			proof.getContext('2d').drawImage(runtimeCanvas, 0, 0, width, height);
			reports[chain.id] = {
				proofId,
				segmentIndex,
				center,
				peak,
				camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
				loadedChunkCount: state.chunkManager.loaded.size,
				renderCalls: state.renderer.info.render.calls,
				renderTriangles: state.renderer.info.render.triangles,
				pixel: pixelStats(proof),
			};
		}
		return reports;
	}, { width: WIDTH, height: HEIGHT });

	const images = {};
	for (const [id, filename] of [
		['bone-proof', 'real-bone-mountains-ridge-detail.png'],
		['eastern-proof', 'real-eastern-chain-ridge-detail.png'],
	]) {
		const png = await page.locator(`#${id}`).screenshot({ type: 'png' });
		assert.equal(png.readUInt32BE(16), WIDTH, `${filename}: width drifted`);
		assert.equal(png.readUInt32BE(20), HEIGHT, `${filename}: height drifted`);
		assert(png.length > 50_000, `${filename}: shipped proof is suspiciously small`);
		fs.writeFileSync(path.join(OUT_DIR, filename), png);
		images[filename] = {
			bytes: png.length,
			sha256: crypto.createHash('sha256').update(png).digest('hex'),
		};
	}

	assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`);
	assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
	assert.equal(requestFailures.length, 0, `request failures: ${requestFailures.join(' | ')}`);
	for (const [chainId, report] of Object.entries(metadata)) {
		assert(report.loadedChunkCount >= 60, `${chainId}: too few nearby shipped terrain chunks loaded`);
		assert(report.renderCalls > 5, `${chainId}: shipped renderer produced too few draw calls`);
		assert(report.renderTriangles > 20_000, `${chainId}: shipped renderer produced too little geometry`);
		assert(report.pixel.meanLuma > 0.025, `${chainId}: proof is effectively black`);
		assert(report.pixel.darkRatio < 0.88, `${chainId}: black-sky/dark-frame ratio is excessive`);
		assert(report.pixel.lumaStdDev > 0.035, `${chainId}: proof lacks visual tonal structure`);
		assert(report.pixel.edgeEnergy > 0.008, `${chainId}: proof lacks readable terrain detail`);
	}

	const payload = { images, metadata, consoleErrors, pageErrors, requestFailures };
	fs.writeFileSync(path.join(OUT_DIR, 'ridge-detail-metadata.json'), `${JSON.stringify(payload, null, 2)}\n`);
	console.log('LIVE_WORLD_MOUNTAIN_RIDGE_DETAIL_OK', JSON.stringify(payload));
} finally {
	await browser.close();
	await server.stop();
}
