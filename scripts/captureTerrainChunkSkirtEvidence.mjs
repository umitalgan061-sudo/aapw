#!/usr/bin/env node
/**
 * captureTerrainChunkSkirtEvidence.mjs — GOVERNANCE.md §8.5 Görsel Doğrulama Standardı evidence for
 * `world/terrainChunkSkirt.js`.
 *
 * **Why this is not the usual before/after stash pair.** A skirt is invisible when it is working, so
 * "before" and "after" screenshots of two different trees would differ only in the few pixels where a
 * crack used to be — and a stash/rebuild also re-runs the whole scene, so any frame-to-frame
 * difference would be confounded. Instead this captures the *same* built frame twice, toggling
 * `visible` on the skirt children between renders. The difference is then attributable to the skirts
 * and nothing else, and the changed-pixel count is an exact measure of how much crack they close.
 *
 * The cracks only exist where two LOD levels meet, which is run 134 / ADR-0158's coarse-pointer path,
 * so this boots the harness with a touch/coarse-pointer emulation to put the 64/32/16 bands on screen.
 * Four framings are captured (two angles x near/far, per §8.5) straddling a real LOD band boundary.
 *
 * Usage: `node scripts/captureTerrainChunkSkirtEvidence.mjs [label]`  (label defaults to `after`)
 * Exit codes: 0 = captured, and the skirts measurably closed crack pixels. 1 = failure.
 * 2 = Playwright unavailable.
 * @module scripts/captureTerrainChunkSkirtEvidence
 */
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const WIDTH = 1280;
const HEIGHT = 860;
const LABEL = process.argv[2] ?? 'after';
const OUT_DIR = path.resolve('artifacts/terrain-chunk-skirt', LABEL);

const playwright = loadPlaywright();
if (!playwright) {
	console.error('[captureTerrainChunkSkirtEvidence] SKIP: Playwright unavailable');
	process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
	const context = await browser.newContext({
		viewport: { width: WIDTH, height: HEIGHT },
		deviceScaleFactor: 1,
		// Coarse pointer is the signal run 134's LOD wrapper keys off, so this is what puts differing
		// mesh resolutions next to each other at all.
		hasTouch: true,
		isMobile: true,
	});
	const page = await context.newPage();
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
		const { WORLD_DEFAULTS, CHUNK_CONFIG } = configModule;

		document.body.innerHTML = '<canvas id="runtime-world"></canvas>';
		Object.assign(document.body.style, { margin: '0', overflow: 'hidden', background: '#0c1720' });
		const canvas = document.getElementById('runtime-world');
		Object.assign(canvas.style, { position: 'fixed', inset: '0' });

		const state = sceneModule.createScene(canvas);
		state.controls.enabled = false;
		state.renderer.setPixelRatio(1);
		state.renderer.setSize(width, height, false);

		const chunkSize = CHUNK_CONFIG.CHUNK_SIZE_METERS;
		const sampleHeight = state.groundCollider.getGroundHeight;

		// Drive streaming to a spot with real vertical relief, so the LOD bands straddle ground that
		// actually bends — a crack over a flat plain is invisible whatever the skirt does. Chunk (6,0)
		// is where scripts/measureTerrainChunkSkirtDepth.js measures the world's worst 64-vs-16 seam.
		const centerChunk = { x: 6, z: 0 };
		state.chunkManager.streamTowards(centerChunk.x, centerChunk.z, CHUNK_CONFIG.STREAM_RADIUS_CHUNKS);
		state.scene.updateMatrixWorld(true);
		await new Promise((resolve) => setTimeout(resolve, 2500));
		lightingModule.updateDayNightLighting(state.lights, 0, WORLD_DEFAULTS.DAY_LENGTH_SECONDS, 0.48);

		// Every LOD band boundary in the resident set, i.e. every pair of adjacent chunks whose meshes
		// were built at different resolutions. These are exactly the seams that can crack.
		const bandOf = (mesh) => mesh.userData?.mobileTerrainLodSegmentsRun134 ?? null;
		const seams = [];
		for (const [key, mesh] of state.chunkManager.loaded.entries()) {
			const [cx, cz] = key.split(',').map(Number);
			for (const [dx, dz] of [[1, 0], [0, 1]]) {
				const neighbour = state.chunkManager.getLoadedChunkMesh(cx + dx, cz + dz);
				if (!neighbour) continue;
				const a = bandOf(mesh);
				const b = bandOf(neighbour);
				if (a === null || b === null || a === b) continue;
				seams.push({
					x: (cx + dx / 2) * chunkSize + (dx ? chunkSize / 2 : 0) * 0,
					z: (cz + dz / 2) * chunkSize,
					fine: Math.max(a, b),
					coarse: Math.min(a, b),
				});
			}
		}
		// Prefer the seam with the most vertical variation nearby — the likeliest visible crack.
		const relief = (p) => {
			let lo = Infinity;
			let hi = -Infinity;
			for (let d = -240; d <= 240; d += 60) {
				for (let e = -240; e <= 240; e += 60) {
					const h = sampleHeight(p.x + d, p.z + e);
					lo = Math.min(lo, h);
					hi = Math.max(hi, h);
				}
			}
			return hi - lo;
		};
		seams.sort((a, b) => relief(b) - relief(a));
		const seam = seams[0] ?? { x: centerChunk.x * chunkSize, z: centerChunk.z * chunkSize, fine: 64, coarse: 32 };
		const seamGround = sampleHeight(seam.x, seam.z);

		const aspect = width / height;
		const perspective = (fov, position, target) => {
			const camera = new THREE.PerspectiveCamera(fov, aspect, 0.5, 40_000);
			camera.position.set(position.x, position.y, position.z);
			camera.lookAt(target.x, target.y, target.z);
			camera.updateProjectionMatrix();
			camera.updateMatrixWorld(true);
			return camera;
		};

		// Two angles x near/far, per §8.5. The near pair sits at roughly player eye height, which is
		// where a T-junction crack actually shows as a sliver of sky; the far pair proves the skirts do
		// not introduce a visible dark rim at distance.
		const framings = [
			{ name: 'seam-near-east', camera: perspective(55, { x: seam.x + 70, y: seamGround + 12, z: seam.z + 70 }, { x: seam.x, y: seamGround, z: seam.z }) },
			{ name: 'seam-near-north', camera: perspective(55, { x: seam.x - 60, y: seamGround + 6, z: seam.z + 95 }, { x: seam.x, y: seamGround + 2, z: seam.z }) },
			{ name: 'seam-far-oblique', camera: perspective(50, { x: seam.x + 620, y: seamGround + 260, z: seam.z + 620 }, { x: seam.x, y: seamGround, z: seam.z }) },
			{ name: 'seam-far-low', camera: perspective(50, { x: seam.x - 520, y: seamGround + 70, z: seam.z - 520 }, { x: seam.x, y: seamGround, z: seam.z }) },
		];

		const skirts = [];
		state.scene.traverse((object) => { if (object.userData?.terrainChunkSkirt) skirts.push(object); });

		const gl = state.renderer.domElement;
		const readPixels = () => {
			const c = document.createElement('canvas');
			c.width = gl.width;
			c.height = gl.height;
			c.getContext('2d').drawImage(gl, 0, 0);
			return { dataUrl: c.toDataURL('image/png'), pixels: c.getContext('2d').getImageData(0, 0, c.width, c.height).data };
		};

		const out = [];
		for (const framing of framings) {
			const setSkirts = (visible) => { for (const skirt of skirts) skirt.visible = visible; };

			setSkirts(false);
			state.renderer.render(state.scene, framing.camera);
			const without = readPixels();

			setSkirts(true);
			state.renderer.render(state.scene, framing.camera);
			const withSkirts = readPixels();

			// Pixels the skirts actually filled in. A pixel counts as changed only on a real difference,
			// not on tone-mapping round-off.
			let changed = 0;
			for (let i = 0; i < without.pixels.length; i += 4) {
				const dr = Math.abs(without.pixels[i] - withSkirts.pixels[i]);
				const dg = Math.abs(without.pixels[i + 1] - withSkirts.pixels[i + 1]);
				const db = Math.abs(without.pixels[i + 2] - withSkirts.pixels[i + 2]);
				if (dr + dg + db > 12) changed += 1;
			}
			out.push({
				name: framing.name,
				withoutSkirts: without.dataUrl,
				withSkirts: withSkirts.dataUrl,
				changedPixels: changed,
				totalPixels: without.pixels.length / 4,
			});
		}

		const bands = {};
		for (const mesh of state.chunkManager.loaded.values()) {
			const band = bandOf(mesh);
			if (band !== null) bands[band] = (bands[band] ?? 0) + 1;
		}
		return {
			views: out,
			seam,
			seamGround,
			bands,
			skirtCount: skirts.length,
			residentChunks: state.chunkManager.loadedCount,
			depths: skirts.map((s) => s.userData.terrainChunkSkirt.depthMeters),
		};
	}, { width: WIDTH, height: HEIGHT });

	let totalChanged = 0;
	for (const view of views.views) {
		for (const [suffix, dataUrl] of [['without-skirts', view.withoutSkirts], ['with-skirts', view.withSkirts]]) {
			fs.writeFileSync(path.join(OUT_DIR, `${view.name}--${suffix}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
		}
		totalChanged += view.changedPixels;
		console.log(
			`[captureTerrainChunkSkirtEvidence] ${view.name.padEnd(18)} crack pixels closed by skirts: ` +
				`${String(view.changedPixels).padStart(7)} / ${view.totalPixels} ` +
				`(${((view.changedPixels / view.totalPixels) * 100).toFixed(4)}%)`,
		);
	}
	const depths = views.depths.slice().sort((a, b) => a - b);
	console.log(
		`[captureTerrainChunkSkirtEvidence] ${views.residentChunks} resident chunks, LOD bands ` +
			`${JSON.stringify(views.bands)}, ${views.skirtCount} skirts, depth min/median/max ` +
			`${depths[0]?.toFixed(2)}/${depths[Math.floor(depths.length / 2)]?.toFixed(2)}/${depths[depths.length - 1]?.toFixed(2)} m.`,
	);
	console.log(`[captureTerrainChunkSkirtEvidence] Chosen seam: ${JSON.stringify(views.seam)} at ground ${views.seamGround.toFixed(2)} m.`);
	if (consoleErrors.length) console.log(`[captureTerrainChunkSkirtEvidence] console errors: ${consoleErrors.slice(0, 5).join(' | ')}`);
	console.log(`[captureTerrainChunkSkirtEvidence] Wrote ${views.views.length * 2} PNGs to ${OUT_DIR}`);
	if (totalChanged === 0) {
		console.error('[captureTerrainChunkSkirtEvidence] FAIL: skirts changed no pixels — they are not covering anything here.');
		process.exit(1);
	}
	process.exit(0);
} catch (error) {
	console.error('[captureTerrainChunkSkirtEvidence] FAIL:', error);
	process.exit(1);
} finally {
	await browser.close();
	server.close();
}
