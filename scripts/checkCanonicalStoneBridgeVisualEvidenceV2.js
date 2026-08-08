#!/usr/bin/env node
/** Run191 visual evidence refinement: readable masonry close-up + long multi-arch perspective. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HARNESS_URL = '/scripts/fixtures/run191-bridge-harness.html';
const FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'run191-stone-bridges.json');
const OUT_DIR = path.join(ROOT, 'artifacts', 'run191-stone-bridges-v2');
const EXPECTED_CHECKSUM = '13fadc3dbc3d3554c583215883614a56b5e9ee406ae74d66e335fd56fe4cf7f4';
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

async function renderEvidence(page, bridge, mode) {
	return page.evaluate(async ({ bridge, mode }) => {
		const THREE = await import('three');
		const { createCanonicalStoneBridgeGeometry } = await import('/src/3d/world/worldReferenceStoneBridgeShadow.js');
		const canvas = document.getElementById('run191-canvas');
		canvas.width = 1280;
		canvas.height = 720;
		const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
		renderer.setPixelRatio(1);
		renderer.setSize(1280, 720, false);
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.45;
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0xb9c5ca);
		const group = createCanonicalStoneBridgeGeometry({ bridges: [bridge] });
		for (const child of group.children) {
			child.frustumCulled = false;
			if (child.material?.map) child.material.map.anisotropy = 4;
		}
		scene.add(group);
		const dx = bridge.endX - bridge.startX;
		const dz = bridge.endZ - bridge.startZ;
		const length = Math.hypot(dx, dz) || 1;
		const ax = dx / length;
		const az = dz / length;
		const sx = -az;
		const sz = ax;
		const archBaseY = bridge.deckY - 0.6 - bridge.archRiseMeters;
		const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x7f8265, roughness: 1, metalness: 0 });
		const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x4a7b8d, roughness: 0.32, metalness: 0, transparent: true, opacity: 0.92 });
		const ground = new THREE.Mesh(new THREE.PlaneGeometry(mode === 'detail' ? 360 : 5200, mode === 'detail' ? 260 : 1500), groundMaterial);
		ground.rotation.x = -Math.PI / 2;
		ground.position.set(bridge.centerX, archBaseY - 0.8, bridge.centerZ);
		scene.add(ground);
		const water = new THREE.Mesh(new THREE.PlaneGeometry(mode === 'detail' ? 300 : 4600, mode === 'detail' ? 110 : 900), waterMaterial);
		water.rotation.x = -Math.PI / 2;
		water.position.set(bridge.centerX, archBaseY - 0.55, bridge.centerZ);
		scene.add(water);
		const ambient = new THREE.AmbientLight(0xffffff, 2.2);
		const hemi = new THREE.HemisphereLight(0xfff0d2, 0x556170, 3.2);
		const key = new THREE.DirectionalLight(0xffdfad, 5.5);
		key.position.set(bridge.centerX + sx * 500 - ax * 300, bridge.deckY + 800, bridge.centerZ + sz * 500 - az * 300);
		const fill = new THREE.DirectionalLight(0xb9d8ff, 2.0);
		fill.position.set(bridge.centerX - sx * 350 + ax * 200, bridge.deckY + 350, bridge.centerZ - sz * 350 + az * 200);
		scene.add(ambient, hemi, key, fill);
		const camera = new THREE.PerspectiveCamera(mode === 'detail' ? 46 : 52, 1280 / 720, 0.1, 20000);
		let lookX;
		let lookZ;
		if (mode === 'detail') {
			const along = Math.min(bridge.structuralSpanMeters * 0.42, 155);
			lookX = bridge.startX + ax * along;
			lookZ = bridge.startZ + az * along;
			camera.position.set(
				lookX + sx * 46 - ax * 18,
				bridge.deckY + 20,
				lookZ + sz * 46 - az * 18,
			);
			camera.lookAt(lookX + ax * 10, bridge.deckY - bridge.archRiseMeters * 0.42, lookZ + az * 10);
		} else {
			const along = Math.min(bridge.structuralSpanMeters * 0.16, 520);
			lookX = bridge.startX + ax * along;
			lookZ = bridge.startZ + az * along;
			camera.position.set(
				bridge.startX + sx * 230 - ax * 90,
				bridge.deckY + 115,
				bridge.startZ + sz * 230 - az * 90,
			);
			camera.lookAt(lookX, bridge.deckY - bridge.archRiseMeters * 0.32, lookZ);
		}
		renderer.render(scene, camera);
		const result = {
			drawCalls: renderer.info.render.calls,
			triangles: renderer.info.render.triangles,
			bridgeId: bridge.id,
			archCount: bridge.archCount,
			mode,
		};
		window.__run191V2 = { renderer, scene, group };
		return result;
	}, { bridge, mode });
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright unavailable');
	const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
	assert(fixture.checksum === EXPECTED_CHECKSUM, `Run191 core fixture drifted: ${fixture.checksum}`);
	const detailBridge = fixture.bridges.find((bridge) => bridge.id === 'robin->berkalp#1');
	const longBridge = fixture.bridges.find((bridge) => bridge.id === 'umit->doran#1');
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
		const detail = await renderEvidence(page, detailBridge, 'detail');
		await page.screenshot({ path: path.join(OUT_DIR, 'bridge-masonry-detail.png') });
		const long = await renderEvidence(page, longBridge, 'perspective');
		await page.screenshot({ path: path.join(OUT_DIR, 'bridge-long-perspective.png') });
		assert(detail.drawCalls >= 4 && detail.drawCalls <= 8, `unexpected detail draw calls: ${detail.drawCalls}`);
		assert(long.drawCalls >= 4 && long.drawCalls <= 8, `unexpected long draw calls: ${long.drawCalls}`);
		assert(detail.triangles > 0 && long.triangles > 0, 'visual proof rendered zero triangles');
		assert(errors.length === 0, `visual evidence console/page errors: ${errors.join(' | ')}`);
		for (const name of ['bridge-masonry-detail.png', 'bridge-long-perspective.png']) {
			const file = path.join(OUT_DIR, name);
			assert(fs.statSync(file).size > 15000, `${name} is unexpectedly small/blank: ${fs.statSync(file).size} bytes`);
		}
		const report = {
			version: 'run191-medieval-stone-bridge-visual-evidence-v2',
			coreChecksum: fixture.checksum,
			detail,
			long,
			images: ['bridge-masonry-detail.png', 'bridge-long-perspective.png'],
		};
		fs.writeFileSync(path.join(OUT_DIR, 'visual-proof.json'), JSON.stringify(report, null, 2) + '\n');
		console.log(`[checkCanonicalStoneBridgeVisualEvidenceV2] PASS: detail ${detail.bridgeId}/${detail.archCount} arches + long ${long.bridgeId}/${long.archCount} arches, two readable 1280x720 evidence frames, zero console/page errors.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error('[checkCanonicalStoneBridgeVisualEvidenceV2] FAIL:', error?.stack || error);
	process.exit(1);
});
