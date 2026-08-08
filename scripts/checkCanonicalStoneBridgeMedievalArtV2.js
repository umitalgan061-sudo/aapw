#!/usr/bin/env node
/** Run191 corrective medieval-art V2 renderer + visual qualification. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HARNESS_URL = '/scripts/fixtures/run191-bridge-harness.html';
const CORE_FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'run191-stone-bridges.json');
const OUT_DIR = path.join(ROOT, 'artifacts', 'run191-stone-bridge-art-v2');
const OUT_REPORT = path.join(OUT_DIR, 'proof.json');
const EXPECTED_CORE_CHECKSUM = '13fadc3dbc3d3554c583215883614a56b5e9ee406ae74d66e335fd56fe4cf7f4';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (error) { /* try next */ }
	}
	return null;
}

function startServer() {
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
			const file = path.join(ROOT, relative);
			if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
				res.writeHead(404); res.end('Not found'); return;
			}
			res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
			fs.createReadStream(file).pipe(res);
		} catch (error) {
			res.writeHead(500); res.end(String(error));
		}
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function renderScene(page, bridge, mode) {
	return page.evaluate(async ({ bridge, mode }) => {
		const THREE = await import('three');
		const art = await import('/src/3d/world/worldReferenceStoneBridgeMedievalArtV2.js');
		const canvas = document.getElementById('run191-canvas');
		canvas.width = 1280;
		canvas.height = 720;
		const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
		renderer.setPixelRatio(1);
		renderer.setSize(1280, 720, false);
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.35;
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0xaebdc3);
		const group = art.createCanonicalStoneBridgeMedievalArtV2({ bridges: [bridge] });
		for (const child of group.children) child.frustumCulled = false;
		scene.add(group);
		const dx = bridge.endX - bridge.startX;
		const dz = bridge.endZ - bridge.startZ;
		const length = Math.hypot(dx, dz) || 1;
		const ax = dx / length;
		const az = dz / length;
		const sx = -az;
		const sz = ax;
		const archBaseY = bridge.deckY - 0.6 - bridge.archRiseMeters;
		const waterWidth = mode === 'detail' ? 170 : 720;
		const waterLength = mode === 'detail' ? Math.max(520, bridge.structuralSpanMeters + 80) : Math.max(4200, bridge.structuralSpanMeters + 400);
		const water = new THREE.Mesh(
			new THREE.PlaneGeometry(waterLength, waterWidth),
			new THREE.MeshStandardMaterial({ color: 0x56899b, roughness: 0.28, metalness: 0, transparent: true, opacity: 0.92 }),
		);
		water.rotation.x = -Math.PI / 2;
		water.rotation.z = -bridge.yawRadians;
		water.position.set(bridge.centerX, archBaseY - 1.35, bridge.centerZ);
		scene.add(water);
		const bank = new THREE.Mesh(
			new THREE.PlaneGeometry(waterLength + 420, waterWidth + 500),
			new THREE.MeshStandardMaterial({ color: 0x788060, roughness: 1, metalness: 0 }),
		);
		bank.rotation.x = -Math.PI / 2;
		bank.rotation.z = -bridge.yawRadians;
		bank.position.set(bridge.centerX, archBaseY - 2.1, bridge.centerZ);
		scene.add(bank);
		const ambient = new THREE.AmbientLight(0xffffff, 3.6);
		const hemi = new THREE.HemisphereLight(0xffeed1, 0x556270, 3.8);
		const key = new THREE.DirectionalLight(0xffe0aa, 6.5);
		key.position.set(bridge.centerX + sx * 480 - ax * 260, bridge.deckY + 650, bridge.centerZ + sz * 480 - az * 260);
		const fill = new THREE.DirectionalLight(0xc9e0ff, 3.4);
		fill.position.set(bridge.centerX - sx * 320 + ax * 160, bridge.deckY + 280, bridge.centerZ - sz * 320 + az * 160);
		scene.add(ambient, hemi, key, fill);
		const camera = new THREE.PerspectiveCamera(mode === 'detail' ? 42 : 50, 1280 / 720, 0.1, 20000);
		if (mode === 'detail') {
			const along = Math.min(bridge.structuralSpanMeters * 0.42, 155);
			const lookX = bridge.startX + ax * along;
			const lookZ = bridge.startZ + az * along;
			camera.position.set(lookX + sx * 34 - ax * 8, bridge.deckY + 13, lookZ + sz * 34 - az * 8);
			camera.lookAt(lookX + ax * 5, bridge.deckY - bridge.archRiseMeters * 0.46, lookZ + az * 5);
		} else {
			const lookAlong = Math.min(bridge.structuralSpanMeters * 0.22, 690);
			const lookX = bridge.startX + ax * lookAlong;
			const lookZ = bridge.startZ + az * lookAlong;
			camera.position.set(bridge.startX + sx * 165 - ax * 55, bridge.deckY + 76, bridge.startZ + sz * 165 - az * 55);
			camera.lookAt(lookX, bridge.deckY - bridge.archRiseMeters * 0.38, lookZ);
		}
		renderer.render(scene, camera);
		const predicted = { drawCalls: 0, triangles: 0, instances: 0 };
		for (const child of group.children) {
			if (!child.isInstancedMesh || child.count <= 0) continue;
			const trianglesPerInstance = child.geometry.index ? child.geometry.index.count / 3 : child.geometry.getAttribute('position').count / 3;
			predicted.drawCalls += 1;
			predicted.triangles += trianglesPerInstance * child.count;
			predicted.instances += child.count;
		}
		const actual = { drawCalls: renderer.info.render.calls - 2, triangles: renderer.info.render.triangles };
		const gl = renderer.getContext();
		const pixels = new Uint8Array(1280 * 720 * 4);
		gl.readPixels(0, 0, 1280, 720, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
		let luminanceSum = 0;
		let darkPixels = 0;
		let warmStonePixels = 0;
		const pixelCount = pixels.length / 4;
		for (let index = 0; index < pixels.length; index += 4) {
			const r = pixels[index];
			const g = pixels[index + 1];
			const b = pixels[index + 2];
			const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
			luminanceSum += luminance;
			if (luminance < 35) darkPixels += 1;
			if (r > g && g > b && r > 90 && b < 155) warmStonePixels += 1;
		}
		const texture = group.children.map((child) => child.material?.map).find(Boolean);
		const textureCanvas = texture?.image;
		let textureRange = null;
		if (textureCanvas) {
			const ctx = textureCanvas.getContext('2d');
			const data = ctx.getImageData(0, 0, textureCanvas.width, textureCanvas.height).data;
			let min = 255;
			let max = 0;
			for (let index = 0; index < data.length; index += 16) {
				const lum = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
				min = Math.min(min, lum);
				max = Math.max(max, lum);
			}
			textureRange = { min: Math.round(min), max: Math.round(max), range: Math.round(max - min), width: textureCanvas.width, height: textureCanvas.height };
		}
		const geometrySet = new Set(group.children.map((child) => child.geometry).filter(Boolean));
		const materialSet = new Set(group.children.map((child) => child.material).filter(Boolean));
		const textureSet = new Set([...materialSet].map((material) => material.map).filter(Boolean));
		let geometryDisposals = 0;
		let materialDisposals = 0;
		let textureDisposals = 0;
		for (const geometry of geometrySet) geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
		for (const material of materialSet) material.addEventListener('dispose', () => { materialDisposals += 1; });
		for (const item of textureSet) item.addEventListener('dispose', () => { textureDisposals += 1; });
		art.disposeCanonicalStoneBridgeMedievalArtV2(group);
		const dispose = {
			children: group.children.length,
			geometryDisposals,
			materialDisposals,
			textureDisposals,
			expectedGeometries: geometrySet.size,
			expectedMaterials: materialSet.size,
			expectedTextures: textureSet.size,
		};
		window.__run191ArtV2 = { renderer, scene };
		return {
			bridgeId: bridge.id,
			archCount: bridge.archCount,
			mode,
			predicted,
			actual,
			readability: {
				averageLuminance: Math.round((luminanceSum / pixelCount) * 100) / 100,
				darkPixelRatio: Math.round((darkPixels / pixelCount) * 10000) / 10000,
				warmStonePixelRatio: Math.round((warmStonePixels / pixelCount) * 10000) / 10000,
				textureRange,
			},
			dispose,
		};
	}, { bridge, mode });
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright unavailable');
	const core = JSON.parse(fs.readFileSync(CORE_FIXTURE, 'utf8'));
	assert(core.checksum === EXPECTED_CORE_CHECKSUM, `Run191 core fixture drifted: ${core.checksum}`);
	assert(core.policy === 'stone-arch-bridge', 'owner bridge policy drifted');
	const detailBridge = core.bridges.find((bridge) => bridge.id === 'robin->berkalp#1');
	const longBridge = core.bridges.find((bridge) => bridge.id === 'umit->doran#1');
	assert(detailBridge?.archCount === 14, 'detail bridge fixture mismatch');
	assert(longBridge?.archCount === 87, 'long bridge fixture mismatch');
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const server = await startServer();
	const browser = await playwright.chromium.launch({ headless: true });
	const errors = [];
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
		page.on('pageerror', (error) => errors.push(String(error)));
		await page.goto(`http://127.0.0.1:${server.address().port}${HARNESS_URL}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		const detail = await renderScene(page, detailBridge, 'detail');
		await page.screenshot({ path: path.join(OUT_DIR, 'medieval-masonry-closeup.png') });
		await page.reload({ waitUntil: 'domcontentloaded' });
		const long = await renderScene(page, longBridge, 'perspective');
		await page.screenshot({ path: path.join(OUT_DIR, 'medieval-multiarch-perspective.png') });
		for (const result of [detail, long]) {
			assert(result.predicted.drawCalls === 5, `${result.mode} expected 5 bridge draw calls, got ${result.predicted.drawCalls}`);
			assert(result.readability.averageLuminance > 80, `${result.mode} image still too dark: ${result.readability.averageLuminance}`);
			assert(result.readability.darkPixelRatio < 0.28, `${result.mode} dark-pixel ratio too high: ${result.readability.darkPixelRatio}`);
			assert(result.readability.warmStonePixelRatio > 0.01, `${result.mode} warm stone surface not materially visible: ${result.readability.warmStonePixelRatio}`);
			assert(result.readability.textureRange?.width === 512 && result.readability.textureRange?.height === 512, `${result.mode} masonry texture resolution mismatch`);
			assert(result.readability.textureRange.range > 70, `${result.mode} masonry texture contrast too low: ${result.readability.textureRange.range}`);
			assert(result.dispose.children === 0, `${result.mode} bridge group did not teardown`);
			assert(result.dispose.geometryDisposals === result.dispose.expectedGeometries, `${result.mode} geometry disposal mismatch`);
			assert(result.dispose.materialDisposals === result.dispose.expectedMaterials, `${result.mode} material disposal mismatch`);
			assert(result.dispose.textureDisposals === result.dispose.expectedTextures, `${result.mode} texture disposal mismatch`);
		}
		assert(errors.length === 0, `art V2 console/page errors: ${errors.join(' | ')}`);
		for (const name of ['medieval-masonry-closeup.png', 'medieval-multiarch-perspective.png']) {
			const file = path.join(OUT_DIR, name);
			assert(fs.statSync(file).size > 25000, `${name} is unexpectedly small/blank: ${fs.statSync(file).size} bytes`);
		}
		const report = {
			version: 'run191-medieval-stone-bridge-art-v2-proof',
			coreChecksum: core.checksum,
			detail,
			long,
			images: ['medieval-masonry-closeup.png', 'medieval-multiarch-perspective.png'],
		};
		fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2) + '\n');
		console.log(`[checkCanonicalStoneBridgeMedievalArtV2] PASS: core ${core.checksum}; 512px ashlar/mortar texture; detail luma ${detail.readability.averageLuminance}/dark ${detail.readability.darkPixelRatio}; long luma ${long.readability.averageLuminance}/dark ${long.readability.darkPixelRatio}; five batched bridge submissions; teardown PASS.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error('[checkCanonicalStoneBridgeMedievalArtV2] FAIL:', error?.stack || error);
	process.exit(1);
});
