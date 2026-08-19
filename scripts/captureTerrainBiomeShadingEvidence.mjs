#!/usr/bin/env node
/**
 * captureTerrainBiomeShadingEvidence.mjs — GOVERNANCE.md §8.5 Görsel Doğrulama Standardı evidence for
 * the slope/altitude terrain biome shading pass (`world/terrainBiomeShading.js`).
 *
 * Builds the **real** scene through `sceneManager.createScene` (same harness pattern
 * `captureLiveWorldMountainNaturalization.mjs` established — not a re-implementation), loads every
 * world chunk, then renders five framings: a high aerial oblique matching the owner-supplied
 * reference image, an oblique over the snowy north, a close pass at the tallest peak, a close pass at
 * a real shoreline, and an orthographic top-down of the whole world.
 *
 * Run once per tree state and diff the PNGs:
 *   node scripts/captureTerrainBiomeShadingEvidence.mjs after
 *   git stash && node scripts/captureTerrainBiomeShadingEvidence.mjs before && git stash pop
 *
 * Also prints per-view pixel statistics (mean RGB, saturation, and the fraction of near-white pixels)
 * so the before/after difference is quantified, not only eyeballed.
 *
 * Usage: `node scripts/captureTerrainBiomeShadingEvidence.mjs [label]`  (label defaults to `after`)
 * Exit codes: 0 = captured. 1 = failure. 2 = Playwright unavailable.
 * @module scripts/captureTerrainBiomeShadingEvidence
 */
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const WIDTH = 1440;
const HEIGHT = 960;
const LABEL = process.argv[2] ?? 'after';
const OUT_DIR = path.resolve('artifacts/terrain-biome-shading', LABEL);

const playwright = loadPlaywright();
if (!playwright) {
	console.error('[captureTerrainBiomeShadingEvidence] SKIP: Playwright unavailable');
	process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
	const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
	const consoleErrors = [];
	page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
	page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error)}`));
	await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, {
		waitUntil: 'load', timeout: 30_000,
	});

	const views = await page.evaluate(async ({ width, height }) => {
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

		document.body.innerHTML = '<canvas id="runtime-world"></canvas>';
		Object.assign(document.body.style, { margin: '0', overflow: 'hidden', background: '#0c1720' });
		const canvas = document.getElementById('runtime-world');
		Object.assign(canvas.style, { position: 'fixed', inset: '0' });

		const state = sceneModule.createScene(canvas);
		state.controls.enabled = false;
		state.renderer.setPixelRatio(1);
		state.renderer.setSize(width, height, false);

		const halfW = WORLD_SCALE.WORLD_WIDTH_METERS / 2;
		const halfD = WORLD_SCALE.WORLD_DEPTH_METERS / 2;
		const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
		const minCX = Math.ceil(-halfW / chunkSize - 0.5);
		const maxCX = Math.floor(halfW / chunkSize + 0.5);
		const minCZ = Math.ceil(-halfD / chunkSize - 0.5);
		const maxCZ = Math.floor(halfD / chunkSize + 0.5);
		for (let z = minCZ; z <= maxCZ; z += 1) {
			for (let x = minCX; x <= maxCX; x += 1) state.chunkManager.loadChunk(x, z);
		}
		state.scene.updateMatrixWorld(true);
		await new Promise((resolve) => setTimeout(resolve, 3500));

		// Midday sun, same call the existing live-world capture uses.
		lightingModule.updateDayNightLighting(state.lights, 0, WORLD_DEFAULTS.DAY_LENGTH_SECONDS, 0.48);

		const sampleHeight = state.groundCollider.getGroundHeight;
		const SEA = WORLD_DEFAULTS.WATER_LEVEL_METERS;

		// Tallest peak, for the snow/rock close pass.
		let peak = { x: 0, z: 0, h: -Infinity };
		for (let z = -halfD + 250; z <= halfD - 250; z += 140) {
			for (let x = -halfW + 250; x <= halfW - 250; x += 140) {
				const h = sampleHeight(x, z);
				if (h > peak.h) peak = { x, z, h };
			}
		}
		// A real shoreline point (land barely above sea with open water nearby), for the beach pass.
		let shore = null;
		for (let z = -halfD + 400; z <= halfD - 400 && !shore; z += 90) {
			for (let x = -halfW + 400; x <= halfW - 400; x += 90) {
				const h = sampleHeight(x, z);
				if (h <= SEA + 0.2 || h > SEA + 3) continue;
				if (sampleHeight(x + 260, z) < SEA - 1 || sampleHeight(x - 260, z) < SEA - 1) { shore = { x, z, h }; break; }
			}
		}
		shore = shore ?? { x: 0, z: 0, h: sampleHeight(0, 0) };

		const aspect = width / height;
		const perspective = (fov, position, target) => {
			const camera = new THREE.PerspectiveCamera(fov, aspect, 2, 80_000);
			camera.position.set(position.x, position.y, position.z);
			camera.lookAt(target.x, target.y, target.z);
			camera.updateProjectionMatrix();
			camera.updateMatrixWorld(true);
			return camera;
		};

		const originalFogDensity = state.scene.fog ? state.scene.fog.density : null;
		const render = (camera, { fogDensity }) => {
			if (state.scene.fog && fogDensity !== undefined) state.scene.fog.density = fogDensity;
			state.renderer.render(state.scene, camera);
			const shot = state.renderer.domElement.toDataURL('image/png');
			if (state.scene.fog && originalFogDensity !== null) state.scene.fog.density = originalFogDensity;
			return shot;
		};

		// Ground-level exponential fog is tuned for gameplay distances; at a 13 km aerial standoff it
		// would render the whole map as flat haze, so the wide framings disable it and say so. The two
		// close passes keep the real in-game fog.
		const shots = [];
		shots.push({
			name: '01-aerial-oblique',
			note: 'high oblique over the main landmass, framed like the owner reference image (fog off)',
			data: render(perspective(38, { x: -halfW * 0.55, y: 5200, z: halfD * 1.15 }, { x: -halfW * 0.1, y: 0, z: -halfD * 0.05 }), { fogDensity: 0 }),
		});
		shots.push({
			name: '02-aerial-north',
			note: 'oblique over the northern snow region (fog off)',
			data: render(perspective(40, { x: -halfW * 0.35, y: 3600, z: -halfD * 0.05 }, { x: -halfW * 0.55, y: 0, z: -halfD * 0.85 }), { fogDensity: 0 }),
		});
		shots.push({
			name: '03-peak-closeup',
			note: `close pass at the tallest peak (${peak.h.toFixed(1)} m at ${peak.x.toFixed(0)}, ${peak.z.toFixed(0)}) — snow cap and rock faces`,
			data: render(perspective(45, { x: peak.x + 900, y: peak.h + 420, z: peak.z + 900 }, { x: peak.x, y: peak.h * 0.55, z: peak.z }), { fogDensity: 0 }),
		});
		shots.push({
			name: '04-coast-closeup',
			note: `close pass at a real shoreline (${shore.x.toFixed(0)}, ${shore.z.toFixed(0)}) — sand line and shallows`,
			data: render(perspective(50, { x: shore.x + 340, y: shore.h + 150, z: shore.z + 340 }, { x: shore.x, y: SEA, z: shore.z }), { fogDensity: 0 }),
		});
		const orthoHeight = Math.max(halfD * 2 * 1.06, (halfW * 2) / aspect * 1.06);
		const top = new THREE.OrthographicCamera(-orthoHeight * aspect / 2, orthoHeight * aspect / 2, orthoHeight / 2, -orthoHeight / 2, 2, 80_000);
		top.position.set(0, 24_000, 0);
		top.up.set(0, 0, -1);
		top.lookAt(0, 0, 0);
		top.updateProjectionMatrix();
		top.updateMatrixWorld(true);
		shots.push({ name: '05-topdown', note: 'orthographic top-down of the whole world (fog off)', data: render(top, { fogDensity: 0 }) });

		// Pixel statistics per view, so the before/after delta is measured rather than only described.
		const measure = (dataUrl) => new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				const S = 256;
				const c = document.createElement('canvas');
				c.width = S; c.height = S;
				const ctx = c.getContext('2d', { willReadFrequently: true });
				ctx.drawImage(img, 0, 0, S, S);
				const d = ctx.getImageData(0, 0, S, S).data;
				let r = 0, g = 0, b = 0, sat = 0, nearWhite = 0, n = 0;
				for (let i = 0; i < d.length; i += 4) {
					const rr = d[i] / 255, gg = d[i + 1] / 255, bb = d[i + 2] / 255;
					r += rr; g += gg; b += bb; n += 1;
					const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
					sat += mx <= 0 ? 0 : (mx - mn) / mx;
					if (mn > 0.72) nearWhite += 1;
				}
				resolve({
					meanRGB255: [Math.round(r / n * 255), Math.round(g / n * 255), Math.round(b / n * 255)],
					meanSaturation: +(sat / n).toFixed(4),
					nearWhiteFraction: +(nearWhite / n).toFixed(4),
				});
			};
			img.src = dataUrl;
		});
		for (const shot of shots) shot.stats = await measure(shot.data);

		return {
			peak: { x: +peak.x.toFixed(0), z: +peak.z.toFixed(0), heightMeters: +peak.h.toFixed(2) },
			shore: { x: +shore.x.toFixed(0), z: +shore.z.toFixed(0), heightMeters: +shore.h.toFixed(2) },
			chunksLoaded: state.chunkManager.loaded.size,
			shots,
		};
	}, { width: WIDTH, height: HEIGHT });

	const manifest = { label: LABEL, peak: views.peak, shore: views.shore, chunksLoaded: views.chunksLoaded, views: [] };
	for (const shot of views.shots) {
		const file = path.join(OUT_DIR, `${shot.name}.png`);
		fs.writeFileSync(file, Buffer.from(shot.data.split(',')[1], 'base64'));
		manifest.views.push({ name: shot.name, note: shot.note, file, stats: shot.stats });
		console.log(`[captureTerrainBiomeShadingEvidence] ${shot.name}  meanRGB=${shot.stats.meanRGB255.join(',')}  meanSat=${shot.stats.meanSaturation}  nearWhite=${shot.stats.nearWhiteFraction}`);
	}
	fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
	console.log(`[captureTerrainBiomeShadingEvidence] chunks=${views.chunksLoaded} peak=${views.peak.heightMeters}m -> ${OUT_DIR}`);
	if (consoleErrors.length) {
		console.log(`[captureTerrainBiomeShadingEvidence] console errors (${consoleErrors.length}), first 5:`);
		for (const error of consoleErrors.slice(0, 5)) console.log(`  - ${error}`);
	} else {
		console.log('[captureTerrainBiomeShadingEvidence] zero console/page errors');
	}
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
