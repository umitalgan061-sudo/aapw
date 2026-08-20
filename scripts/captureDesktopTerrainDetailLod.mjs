#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const playwright = loadPlaywright();
if (!playwright) process.exit(2);

const OUT_DIR = path.resolve('artifacts/desktop-terrain-detail-lod');
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });

try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
	const consoleErrors = [];
	page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
	page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error)}`));
	await page.goto(`http://127.0.0.1:${server.address().port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, {
		waitUntil: 'load', timeout: 60_000,
	});

	const proof = await page.evaluate(async () => {
		const importMap = document.createElement('script');
		importMap.type = 'importmap';
		importMap.textContent = JSON.stringify({ imports: {
			three: '/src/3d/vendor/three/three.module.js',
			'three/addons/': '/src/3d/vendor/three/addons/',
		} });
		document.head.append(importMap);
		const [THREE, sceneModule, configModule, lightingModule] = await Promise.all([
			import('/src/3d/vendor/three/three.module.js'),
			import('/src/3d/sceneManager.js'),
			import('/src/3d/config.js'),
			import('/src/3d/lighting.js'),
		]);
		const { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG } = configModule;
		document.body.innerHTML = '<canvas id="terrain-detail-proof"></canvas>';
		Object.assign(document.body.style, { margin: '0', overflow: 'hidden', background: '#07131c' });
		const canvas = document.getElementById('terrain-detail-proof');
		Object.assign(canvas.style, { position: 'fixed', inset: '0' });
		const state = sceneModule.createScene(canvas);
		state.controls.enabled = false;
		state.renderer.setPixelRatio(1);
		state.renderer.setSize(1440, 960, false);
		lightingModule.updateDayNightLighting(state.lights, 0, WORLD_DEFAULTS.DAY_LENGTH_SECONDS, 0.48);
		if (state.scene.fog) state.scene.fog.density = 0;
		await new Promise((resolve) => setTimeout(resolve, 1200));

		const sampleHeight = state.groundCollider.getGroundHeight;
		const halfW = WORLD_SCALE.WORLD_WIDTH_METERS / 2;
		const halfD = WORLD_SCALE.WORLD_DEPTH_METERS / 2;
		const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
		let peak = { x: 0, z: 0, h: -Infinity };
		let lowland = { x: 0, z: 0, h: Infinity, score: -Infinity };
		for (let z = -halfD + 250; z <= halfD - 250; z += 110) {
			for (let x = -halfW + 250; x <= halfW - 250; x += 110) {
				const h = sampleHeight(x, z);
				if (h > peak.h) peak = { x, z, h };
				if (h <= sea + 5 || h >= sea + 160) continue;
				const d = 24;
				const variation = Math.abs(sampleHeight(x + d, z) - sampleHeight(x - d, z))
					+ Math.abs(sampleHeight(x, z + d) - sampleHeight(x, z - d));
				const score = variation - Math.abs(h - (sea + 55)) * 0.015;
				if (score > lowland.score) lowland = { x, z, h, score };
			}
		}
		if (!Number.isFinite(lowland.h)) lowland = { x: 0, z: 0, h: sampleHeight(0, 0), score: 0 };

		const segmentHistogram = () => {
			const histogram = {};
			for (const mesh of state.chunkManager.loaded.values()) {
				const segments = mesh.userData.desktopTerrainLodSegments ?? 'legacy';
				histogram[segments] = (histogram[segments] ?? 0) + 1;
			}
			return histogram;
		};
		const chunkCoord = (value) => Math.round(value / CHUNK_CONFIG.CHUNK_SIZE_METERS);
		const focusLod = (point) => {
			const cx = chunkCoord(point.x);
			const cz = chunkCoord(point.z);
			state.chunkManager.streamTowards(cx, cz, CHUNK_CONFIG.STREAM_RADIUS_CHUNKS);
			const mesh = state.chunkManager.getLoadedChunkMesh(cx, cz);
			return {
				cx, cz,
				segments: mesh?.userData.desktopTerrainLodSegments ?? null,
				spacing: mesh?.userData.desktopTerrainVertexSpacingMeters ?? null,
			};
		};

		const perspective = (position, target, fov = 46) => {
			const camera = new THREE.PerspectiveCamera(fov, 1440 / 960, 1, 80_000);
			camera.position.set(position.x, position.y, position.z);
			camera.lookAt(target.x, target.y, target.z);
			camera.updateProjectionMatrix();
			camera.updateMatrixWorld(true);
			return camera;
		};
		const render = (camera) => {
			state.scene.updateMatrixWorld(true);
			state.renderer.render(state.scene, camera);
			return state.renderer.domElement.toDataURL('image/png');
		};

		const initialHistogram = segmentHistogram();
		const aerial = render(perspective(
			{ x: -halfW * 0.42, y: 5200, z: halfD * 1.08 },
			{ x: -halfW * 0.08, y: 60, z: -halfD * 0.06 },
			38,
		));

		const lowlandLod = focusLod(lowland);
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const lowlandShot = render(perspective(
			{ x: lowland.x + 260, y: lowland.h + 145, z: lowland.z + 330 },
			{ x: lowland.x, y: lowland.h + 8, z: lowland.z },
			48,
		));

		const peakLod = focusLod(peak);
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const peakShot = render(perspective(
			{ x: peak.x + 720, y: peak.h + 360, z: peak.z + 820 },
			{ x: peak.x, y: peak.h * 0.62, z: peak.z },
			44,
		));

		return {
			aerial,
			lowlandShot,
			peakShot,
			peak: { x: peak.x, z: peak.z, h: peak.h },
			lowland: { x: lowland.x, z: lowland.z, h: lowland.h },
			initialHistogram,
			lowlandLod,
			peakLod,
			finalHistogram: segmentHistogram(),
		};
	});

	const images = [
		['01-aerial-oblique.png', proof.aerial],
		['02-lowland-detail-128.png', proof.lowlandShot],
		['03-peak-detail-128.png', proof.peakShot],
	];
	for (const [name, dataUrl] of images) {
		fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
	}
	const manifest = {
		peak: proof.peak,
		lowland: proof.lowland,
		initialHistogram: proof.initialHistogram,
		lowlandLod: proof.lowlandLod,
		peakLod: proof.peakLod,
		finalHistogram: proof.finalHistogram,
		consoleErrors,
	};
	fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
	if (proof.lowlandLod.segments !== 128 || proof.peakLod.segments !== 128) {
		throw new Error(`detail focus did not reach 128 segments: ${JSON.stringify({ lowland: proof.lowlandLod, peak: proof.peakLod })}`);
	}
	if (consoleErrors.length) throw new Error(`console/page errors: ${consoleErrors.slice(0, 5).join(' | ')}`);
	console.log(`[captureDesktopTerrainDetailLod] PASS: aerial + lowland@${proof.lowlandLod.spacing}m + peak@${proof.peakLod.spacing}m captured.`);
} finally {
	await browser.close();
	server.close();
}
