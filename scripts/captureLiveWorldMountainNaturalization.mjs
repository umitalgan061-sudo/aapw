#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const WIDTH = 1536;
const HEIGHT = 1024;
const OUT_DIR = path.resolve('artifacts/live-map-mountain-naturalization');
const need = (condition, message) => {
	if (!condition) throw new Error(`[captureLiveWorldMountainNaturalization] ${message}`);
};

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
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});
	page.on('pageerror', (error) => pageErrors.push(String(error)));
	page.on('requestfailed', (request) => {
		const failure = request.failure()?.errorText ?? 'failed';
		// Chromium aborts HEAD bodies served by the tiny static proof server after receiving the
		// headers. That is not an asset-load failure; real missing files still surface as HTTP 404
		// console errors and remain a hard failure below.
		if (request.method() === 'HEAD' && failure === 'net::ERR_ABORTED') return;
		requestFailures.push(`${request.method()} ${request.url()}: ${failure}`);
	});
	await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, {
		waitUntil: 'load',
		timeout: 30_000,
	});

	const frame = await page.evaluate(async ({ width, height }) => {
		// The blank visual harness lives below /scripts/fixtures/, while shipped createScene()
		// resolves authored model URLs from the application root. Mirror game3d.html's root-relative
		// document semantics so asset preflights do not accidentally request /scripts/fixtures/assets/.
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

		const [THREE, sceneModule, configModule, waterModule, lightingModule, skyModule, reliefModule, alignmentModule] = await Promise.all([
			import('/src/3d/vendor/three/three.module.js'),
			import('/src/3d/sceneManager.js'),
			import('/src/3d/config.js'),
			import('/src/3d/world/water.js'),
			import('/src/3d/lighting.js'),
			import('/src/3d/sky.js'),
			import('/src/3d/world/worldReferenceMountainRelief.js'),
			import('/src/3d/world/worldReferenceAlignment.js'),
		]);
		const { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG } = configModule;
		const { WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY } = reliefModule;
		const { WORLD_REFERENCE_ALIGNMENT } = alignmentModule;

		document.body.innerHTML = [
			'<canvas id="runtime-world"></canvas>',
			'<canvas id="proof-topdown"></canvas>',
			'<canvas id="proof-mountain"></canvas>',
			'<canvas id="proof-pass"></canvas>',
		].join('');
		Object.assign(document.body.style, { margin: '0', overflow: 'hidden', background: '#0c1720' });
		const runtimeCanvas = document.getElementById('runtime-world');
		Object.assign(runtimeCanvas.style, { position: 'fixed', inset: '0', visibility: 'hidden' });
		for (const id of ['proof-topdown', 'proof-mountain', 'proof-pass']) {
			const canvas = document.getElementById(id);
			canvas.width = width;
			canvas.height = height;
		}

		const state = sceneModule.createScene(runtimeCanvas);
		state.controls.enabled = false;
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
		const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
		const minChunkX = Math.ceil(worldBounds.minX / chunkSize - 0.5);
		const maxChunkX = Math.floor(worldBounds.maxX / chunkSize + 0.5);
		const minChunkZ = Math.ceil(worldBounds.minZ / chunkSize - 0.5);
		const maxChunkZ = Math.floor(worldBounds.maxZ / chunkSize + 0.5);
		for (let z = minChunkZ; z <= maxChunkZ; z += 1) {
			for (let x = minChunkX; x <= maxChunkX; x += 1) state.chunkManager.loadChunk(x, z);
		}

		const terrainMeshes = [...state.chunkManager.loaded.values()].filter((mesh) => {
			const coord = mesh.userData.chunkCoord;
			if (!coord) return false;
			mesh.visible = coord.x >= minChunkX && coord.x <= maxChunkX && coord.z >= minChunkZ && coord.z <= maxChunkZ;
			return mesh.visible;
		});
		state.scene.updateMatrixWorld(true);
		const terrainBounds = new THREE.Box3();
		for (const mesh of terrainMeshes) {
			mesh.geometry.computeBoundingBox();
			terrainBounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
		}
		await new Promise((resolve) => setTimeout(resolve, 3200));

		const sampleHeight = state.groundCollider.getGroundHeight;
		let peak = { x: 0, z: 0, h: -Infinity };
		for (let z = worldBounds.minZ + 250; z <= worldBounds.maxZ - 250; z += 150) {
			for (let x = worldBounds.minX + 250; x <= worldBounds.maxX - 250; x += 150) {
				const h = sampleHeight(x, z);
				if (h > peak.h) peak = { x, z, h };
			}
		}

		const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
		const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
		const passProfile = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains['vale-chain'];
		const pass = passProfile?.passes?.[0];
		if (!pass) throw new Error('[captureLiveWorldMountainNaturalization/browser] canonical Vale pass missing');
		const passX = (pass.center[0] * WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits - centerMapX) * WORLD_SCALE.METERS_PER_MAP_UNIT;
		const passZ = (pass.center[1] * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
		const passH = sampleHeight(passX, passZ);

		const daylight = lightingModule.updateDayNightLighting(state.lights, 0, WORLD_DEFAULTS.DAY_LENGTH_SECONDS, 0.48);
		const aspect = width / height;
		const orthoHeight = Math.max(worldDepth * 1.08, worldWidth / aspect * 1.08);
		const orthoWidth = orthoHeight * aspect;
		const topCamera = new THREE.OrthographicCamera(-orthoWidth / 2, orthoWidth / 2, orthoHeight / 2, -orthoHeight / 2, 2, 60_000);
		topCamera.position.set(0, Math.max(terrainBounds.max.y + 14_000, 15_000), 0);
		topCamera.up.set(0, 0, -1);
		topCamera.lookAt(0, 0, 0);
		topCamera.updateProjectionMatrix();
		topCamera.updateMatrixWorld(true);

		const makePerspective = (fov, position, target) => {
			const camera = new THREE.PerspectiveCamera(fov, aspect, 2, 60_000);
			camera.position.set(position.x, position.y, position.z);
			camera.lookAt(target.x, target.y, target.z);
			camera.updateProjectionMatrix();
			camera.updateMatrixWorld(true);
			return camera;
		};
		const peakOutward = new THREE.Vector2(peak.x, peak.z);
		if (peakOutward.lengthSq() < 1) peakOutward.set(0.72, 0.69);
		peakOutward.normalize();
		const mountainXZ = new THREE.Vector2(peak.x, peak.z).addScaledVector(peakOutward, 1850);
		const mountainCamera = makePerspective(46,
			{ x: mountainXZ.x, y: Math.max(peak.h + 1050, sampleHeight(mountainXZ.x, mountainXZ.y) + 420), z: mountainXZ.y },
			{ x: peak.x - peakOutward.x * 600, y: peak.h - 85, z: peak.z - peakOutward.y * 600 });

		const passDirection = new THREE.Vector2(passX || 1, passZ || 1).normalize();
		const passCameraXZ = new THREE.Vector2(passX, passZ).addScaledVector(passDirection, 1350);
		const passCamera = makePerspective(50,
			{ x: passCameraXZ.x, y: Math.max(passH + 680, sampleHeight(passCameraXZ.x, passCameraXZ.y) + 330), z: passCameraXZ.y },
			{ x: passX - passDirection.x * 250, y: passH + 80, z: passZ - passDirection.y * 250 });

		const pixelMetrics = (canvas) => {
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			const { data } = ctx.getImageData(0, 0, width, height);
			let count = 0;
			let sum = 0;
			let sumSq = 0;
			let dark = 0;
			let edgeSum = 0;
			let edgeCount = 0;
			const stride = 8;
			const lumaAt = (x, y) => {
				const offset = (y * width + x) * 4;
				return (data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722) / 255;
			};
			for (let y = 0; y < height; y += stride) {
				for (let x = 0; x < width; x += stride) {
					const luma = lumaAt(x, y);
					count += 1;
					sum += luma;
					sumSq += luma * luma;
					if (luma < 0.025) dark += 1;
					if (x + stride < width) {
						edgeSum += Math.abs(luma - lumaAt(x + stride, y));
						edgeCount += 1;
					}
					if (y + stride < height) {
						edgeSum += Math.abs(luma - lumaAt(x, y + stride));
						edgeCount += 1;
					}
				}
			}
			const mean = sum / count;
			return {
				meanLuma: mean,
				lumaStdDev: Math.sqrt(Math.max(0, sumSq / count - mean * mean)),
				darkRatio: dark / count,
				edgeEnergy: edgeCount > 0 ? edgeSum / edgeCount : 0,
			};
		};

		const renderView = (camera, id, elapsed, { auditFog = false } = {}) => {
			const savedFog = state.scene.fog;
			if (auditFog) state.scene.fog = null;
			waterModule.updateWater(state.water, camera.position, elapsed);
			skyModule.updateAuroraSky(state.sky, camera.position, elapsed, daylight);
			state.renderer.render(state.scene, camera);
			const canvas = document.getElementById(id);
			canvas.getContext('2d').drawImage(runtimeCanvas, 0, 0, width, height);
			state.scene.fog = savedFog;
			return {
				cameraType: camera.type,
				renderCalls: state.renderer.info.render.calls,
				renderTriangles: state.renderer.info.render.triangles,
				pixel: pixelMetrics(canvas),
			};
		};

		return {
			terrainMeshCount: terrainMeshes.length,
			terrainVertexCount: terrainMeshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0),
			waterMaterialType: state.water.material.type,
			waterFullWorld: Boolean(state.water.userData?.waterDepthField?.fullWorld ?? state.water.userData?.fullWorld ?? state.water.children?.some((child) => child.userData?.fullWorld)),
			peak,
			pass: { id: pass.id, x: passX, z: passZ, h: passH },
			topStats: renderView(topCamera, 'proof-topdown', 0.73, { auditFog: true }),
			mountainStats: renderView(mountainCamera, 'proof-mountain', 1.67),
			passStats: renderView(passCamera, 'proof-pass', 2.41),
		};
	}, { width: WIDTH, height: HEIGHT });

	const images = {};
	for (const [id, filename] of [
		['proof-topdown', 'real-full-world-topdown.png'],
		['proof-mountain', 'real-highest-relief-oblique.png'],
		['proof-pass', 'real-authored-pass-oblique.png'],
	]) {
		const png = await page.locator(`#${id}`).screenshot({ type: 'png' });
		fs.writeFileSync(path.join(OUT_DIR, filename), png);
		need(png.readUInt32BE(16) === WIDTH && png.readUInt32BE(20) === HEIGHT, `${filename} dimensions drifted`);
		need(png.length > 50_000, `${filename} too small`);
		images[filename] = {
			bytes: png.length,
			sha256: crypto.createHash('sha256').update(png).digest('hex'),
		};
	}

	const metadata = { images, consoleErrors, pageErrors, requestFailures, ...frame };
	fs.writeFileSync(path.join(OUT_DIR, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
	need(consoleErrors.length === 0 && pageErrors.length === 0 && requestFailures.length === 0, 'browser/runtime errors present');
	need(frame.terrainMeshCount >= 550 && frame.terrainVertexCount > 2_000_000, 'full live terrain not loaded');
	need(frame.waterMaterialType === 'ShaderMaterial', 'shipped water shader missing');
	need(frame.peak.h > 500, `highest live relief too low: ${frame.peak.h}`);
	need(Number.isFinite(frame.pass.h), 'authored pass ground sample is non-finite');
	for (const [label, stats] of Object.entries({ top: frame.topStats, mountain: frame.mountainStats, pass: frame.passStats })) {
		need(stats.renderCalls > (label === 'top' ? 500 : 250) && stats.renderTriangles > 1_000_000, `${label} view lacks full shipped scene`);
		need(stats.pixel.meanLuma > 0.025, `${label} view is effectively black`);
		need(stats.pixel.lumaStdDev > 0.012, `${label} view lacks tonal relief`);
		need(stats.pixel.edgeEnergy > 0.003, `${label} view lacks visible structure`);
		need(stats.pixel.darkRatio < 0.92, `${label} view has excessive black coverage`);
	}
	console.log('LIVE_WORLD_MOUNTAIN_NATURALIZATION_OK', JSON.stringify({
		images,
		terrainMeshes: frame.terrainMeshCount,
		peakHeight: frame.peak.h,
		pass: frame.pass,
		pixel: {
			top: frame.topStats.pixel,
			mountain: frame.mountainStats.pixel,
			pass: frame.passStats.pixel,
		},
	}));
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
