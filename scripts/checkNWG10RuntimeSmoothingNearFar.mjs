#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(OUT_ARG ? OUT_ARG.slice('--out-dir='.length) : 'artifacts/nw-g10-runtime-smoothing');
const playwright = loadPlaywright();
if (!playwright) throw new Error('[checkNWG10RuntimeSmoothingNearFar] Playwright unavailable');
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
	const errors = [];
	page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
	page.on('pageerror', (error) => errors.push(String(error)));
	await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 20_000 });
	const proof = await page.evaluate(async () => {
		const map = document.createElement('script');
		map.type = 'importmap';
		map.textContent = JSON.stringify({ imports: { three: '/src/3d/vendor/three/three.module.js', 'three/addons/': '/src/3d/vendor/three/addons/' } });
		document.head.append(map);
		const [THREE, sceneModule, configModule, visualModule, alignment, lighting] = await Promise.all([
			import('/src/3d/vendor/three/three.module.js'), import('/src/3d/sceneManager.js'), import('/src/3d/config.js'),
			import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js'), import('/src/3d/world/worldReferenceAlignment.js'), import('/src/3d/lighting.js'),
		]);
		visualModule.installRuntimePindexTerrainPolish();
		document.body.innerHTML = '<canvas id="g10-proof"></canvas>';
		const canvas = document.getElementById('g10-proof');
		const state = sceneModule.createScene(canvas);
		state.controls.enabled = false; state.scene.fog = null; state.sky.visible = false; state.stars.visible = false;
		state.renderer.setPixelRatio(1); state.renderer.setSize(1280, 720, false); state.renderer.outputColorSpace = THREE.SRGBColorSpace;
		lighting.updateDayNightLighting(state.lights, 0, configModule.WORLD_DEFAULTS.DAY_LENGTH_SECONDS, 0.5);
		const center = alignment.normalizedReferenceToWorldXZ(3 / 16, 1 / 16, configModule.WORLD_SCALE.MAP_BOUNDS, configModule.WORLD_SCALE.METERS_PER_MAP_UNIT);
		const size = configModule.CHUNK_CONFIG.CHUNK_SIZE_METERS;
		const cx = Math.round(center.x / size); const cz = Math.round(center.z / size);
		for (let z = cz - 3; z <= cz + 3; z += 1) for (let x = cx - 3; x <= cx + 3; x += 1) state.chunkManager.loadChunk(x, z);
		const meshes = [...state.chunkManager.loaded.values()];
		const continuous = meshes.filter((mesh) => mesh.userData.runtimePindexTerrainPolish?.semanticSamplingPolicyId === 'owner-map-pindex-quality-v2-2026-08-12-v1').length;
		const camera = new THREE.PerspectiveCamera(48, 1280 / 720, 1, 6000);
		window.__g10SmoothingView = (mode) => {
			if (mode === 'near') camera.position.set(center.x - 520, 290, center.z + 610);
			else camera.position.set(center.x - 1250, 820, center.z + 1450);
			camera.lookAt(center.x, 5, center.z); camera.updateProjectionMatrix();
			state.renderer.render(state.scene, camera);
		};
		window.__g10SmoothingView('near');
		return { meshCount: meshes.length, continuousMeshes: continuous, center: [center.x, center.z], renderTriangles: state.renderer.info.render.triangles };
	});
	const capture = async (mode, filename) => {
		await page.evaluate((value) => window.__g10SmoothingView(value), mode);
		const bytes = await page.locator('#g10-proof').screenshot({ type: 'png' });
		if (bytes.length < 20_000) throw new Error(`${mode} PNG too small: ${bytes.length}`);
		fs.writeFileSync(path.join(OUT_DIR, filename), bytes);
		return { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
	};
	const near = await capture('near', 'g10-runtime-smoothed-near.png');
	const far = await capture('far', 'g10-runtime-smoothed-far.png');
	if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`);
	if (proof.meshCount < 40 || proof.continuousMeshes !== proof.meshCount) throw new Error(`continuous runtime coverage incomplete: ${proof.continuousMeshes}/${proof.meshCount}`);
	if (near.sha256 === far.sha256) throw new Error('near/far evidence frames are identical');
	const metadata = { schema: 'westeros-nw-g10-runtime-smoothing-near-far-v1', ...proof, near, far };
	fs.writeFileSync(path.join(OUT_DIR, 'g10-runtime-smoothed-near-far.json'), `${JSON.stringify(metadata, null, 2)}\n`);
	console.log(`NW_G10_RUNTIME_SMOOTHING_NEAR_FAR=${JSON.stringify(metadata)}`);
	console.log('NW_G10_RUNTIME_SMOOTHING_NEAR_FAR_OK');
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
