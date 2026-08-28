#!/usr/bin/env node
/**
 * captureDesktopTerrainLodEvidence.mjs — GOVERNANCE.md §8.5 evidence for run 356 / ADR-0303's desktop
 * terrain distance LOD.
 *
 * The owner's standing request is "pürüzsüz coğrafya istemiyorum". After ADR-0297..0300 the height
 * field itself is no longer the limit — mesh resolution is. A vertex every 7.8 m cannot carry detail
 * finer than ~16 m, so this run's whole claim is that the ground the player stands on now resolves
 * detail it previously averaged away. That claim has to be measured, not asserted.
 *
 * Alongside four framings (two ground-level angles x near/far, per §8.5) this reports **high-frequency
 * image energy** — the mean absolute Laplacian over the rendered luminance. Fine terrain relief shows
 * up as local intensity variation, so if the near band genuinely resolves more ground detail this
 * number rises; if the change only moved triangles around without adding visible structure, it does
 * not. Triangle counts are reported next to it so cost and benefit are visible together.
 *
 * Run once per tree state and diff:
 *   node scripts/captureDesktopTerrainLodEvidence.mjs after
 *   git stash && node scripts/captureDesktopTerrainLodEvidence.mjs before && git stash pop
 *
 * Usage: `node scripts/captureDesktopTerrainLodEvidence.mjs [label]`  (label defaults to `after`)
 * Exit codes: 0 = captured. 1 = failure. 2 = Playwright unavailable.
 * @module scripts/captureDesktopTerrainLodEvidence
 */
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const WIDTH = 1280;
const HEIGHT = 860;
const LABEL = process.argv.find((value) => !value.startsWith('--') && !value.includes('/')) ?? 'after';
const OUT_DIR = path.resolve('artifacts/desktop-terrain-lod', LABEL);
/**
 * Chunk the camera stands in, overridable as `--chunk=X,Z`.
 *
 * Default (6,0) is where the world's steepest measured chunk edge lives — deliberately atypical, and
 * useful for judging geometry. It is a poor place to judge *biome*: it sits at the 94th percentile of
 * land elevation, so it is legitimately bare upland while 83% of the world's land renders green. Pass
 * a lowland chunk when the question is what the world normally looks like.
 */
const CENTER_CHUNK = (() => {
	const argument = process.argv.find((value) => value.startsWith('--chunk='));
	if (!argument) return { x: 6, z: 0 };
	const [x, z] = argument.slice('--chunk='.length).split(',').map(Number);
	return { x, z };
})();

const playwright = loadPlaywright();
if (!playwright) {
	console.error('[captureDesktopTerrainLodEvidence] SKIP: Playwright unavailable');
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
		waitUntil: 'load', timeout: 60_000,
	});

	const result = await page.evaluate(async ({ width, height, centerChunk }) => {
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
		const { WORLD_DEFAULTS, CHUNK_CONFIG } = configModule;

		document.body.innerHTML = '<canvas id="runtime-world"></canvas>';
		Object.assign(document.body.style, { margin: '0', overflow: 'hidden', background: '#0c1720' });
		const canvas = document.getElementById('runtime-world');
		Object.assign(canvas.style, { position: 'fixed', inset: '0' });

		const state = sceneModule.createScene(canvas);
		state.controls.enabled = false;
		state.renderer.setPixelRatio(1);
		state.renderer.setSize(width, height, false);

		// Put the streaming centre where the camera will stand, so the near band is centred on what the
		// shots actually show. On a pre-LOD tree this is simply an ordinary additive stream.
		state.chunkManager.streamTowards(centerChunk.x, centerChunk.z, 6);
		state.scene.updateMatrixWorld(true);
		await new Promise((resolve) => setTimeout(resolve, 2500));
		lightingModule.updateDayNightLighting(state.lights, 0, WORLD_DEFAULTS.DAY_LENGTH_SECONDS, 0.42);

		const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
		const cx = centerChunk.x * chunkSize;
		const cz = centerChunk.z * chunkSize;
		const sampleHeight = state.groundCollider.getGroundHeight;
		const ground = sampleHeight(cx, cz);

		const aspect = width / height;
		const perspective = (fov, position, target) => {
			const camera = new THREE.PerspectiveCamera(fov, aspect, 0.5, 40_000);
			camera.position.set(position.x, position.y, position.z);
			camera.lookAt(target.x, target.y, target.z);
			camera.updateProjectionMatrix();
			camera.updateMatrixWorld(true);
			return camera;
		};

		const framings = [
			{ name: 'ground-east-near', camera: perspective(60, { x: cx - 45, y: ground + 2.2, z: cz - 45 }, { x: cx + 60, y: ground + 1, z: cz + 60 }) },
			{ name: 'ground-north-near', camera: perspective(60, { x: cx + 50, y: ground + 2.2, z: cz - 40 }, { x: cx - 60, y: ground + 1, z: cz + 50 }) },
			{ name: 'ridge-east-far', camera: perspective(52, { x: cx - 340, y: ground + 90, z: cz - 340 }, { x: cx, y: ground, z: cz }) },
			{ name: 'ridge-north-far', camera: perspective(52, { x: cx + 320, y: ground + 70, z: cz - 300 }, { x: cx, y: ground, z: cz }) },
		];

		let terrainTriangles = 0;
		for (const [key, mesh] of state.chunkManager.loaded.entries()) {
			const [chunkX, chunkZ] = key.split(',').map(Number);
			if (Math.max(Math.abs(chunkX - centerChunk.x), Math.abs(chunkZ - centerChunk.z)) > 6) continue;
			terrainTriangles += (mesh.geometry.getIndex()?.count ?? 0) / 3;
		}

		const gl = state.renderer.domElement;
		const shots = [];
		for (const framing of framings) {
			state.renderer.render(state.scene, framing.camera);
			const c = document.createElement('canvas');
			c.width = gl.width;
			c.height = gl.height;
			const ctx = c.getContext('2d');
			ctx.drawImage(gl, 0, 0);
			const { data } = ctx.getImageData(0, 0, c.width, c.height);

			// Mean |Laplacian| of luminance — high-frequency image energy. Sky and water are excluded by
			// a crude luminance gate so the statistic reports on ground pixels, not on the horizon line.
			let energy = 0;
			let counted = 0;
			const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
			for (let y = 1; y < c.height - 1; y += 1) {
				for (let x = 1; x < c.width - 1; x += 1) {
					const i = (y * c.width + x) * 4;
					const centre = lum(i);
					if (centre < 12) continue;
					const laplacian = 4 * centre
						- lum(i - 4) - lum(i + 4)
						- lum(i - c.width * 4) - lum(i + c.width * 4);
					energy += Math.abs(laplacian);
					counted += 1;
				}
			}
			shots.push({
				name: framing.name,
				dataUrl: c.toDataURL('image/png'),
				highFrequencyEnergy: counted ? energy / counted : 0,
				groundPixels: counted,
			});
		}

		const histogram = {};
		for (const mesh of state.chunkManager.loaded.values()) {
			const band = mesh.userData.desktopTerrainLodSegmentsRun356 ?? 'uniform';
			histogram[band] = (histogram[band] ?? 0) + 1;
		}
		return { shots, histogram, terrainTriangles, ground, residentChunks: state.chunkManager.loadedCount };
	}, { width: WIDTH, height: HEIGHT, centerChunk: CENTER_CHUNK });

	for (const shot of result.shots) {
		fs.writeFileSync(path.join(OUT_DIR, `${shot.name}.png`), Buffer.from(shot.dataUrl.split(',')[1], 'base64'));
		console.log(
			`[captureDesktopTerrainLodEvidence] ${LABEL.padEnd(6)} ${shot.name.padEnd(18)} ` +
				`high-frequency energy ${shot.highFrequencyEnergy.toFixed(3).padStart(8)} over ${shot.groundPixels} ground px`,
		);
	}
	console.log(
		`[captureDesktopTerrainLodEvidence] ${LABEL}: ${result.residentChunks} resident chunks, bands ` +
			`${JSON.stringify(result.histogram)}, ${result.terrainTriangles.toLocaleString('en-US')} terrain triangles ` +
			`within the regrade radius, ground ${result.ground.toFixed(1)} m.`,
	);
	if (consoleErrors.length) console.log(`[captureDesktopTerrainLodEvidence] console errors: ${consoleErrors.slice(0, 4).join(' | ')}`);
	console.log(`[captureDesktopTerrainLodEvidence] Wrote ${result.shots.length} PNGs to ${OUT_DIR}`);
	process.exit(0);
} catch (error) {
	console.error('[captureDesktopTerrainLodEvidence] FAIL:', error);
	process.exit(1);
} finally {
	await browser.close();
	server.close();
}
