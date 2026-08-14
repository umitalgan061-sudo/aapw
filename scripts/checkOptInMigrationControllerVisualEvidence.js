#!/usr/bin/env node
/** Run 195 visual evidence: current -> canonical opt-in -> exact current restore. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run195-optin-migration-controller-shadow');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function loadPlaywright() { for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; }
function startServer() {
	const server = http.createServer((req, res) => {
		const relative = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'game3d.html';
		const file = path.join(ROOT, relative);
		if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
		res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
		fs.createReadStream(file).pipe(res);
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright unavailable');
	fs.mkdirSync(OUT, { recursive: true });
	const server = await startServer();
	const browser = await playwright.chromium.launch({ headless: true });
	const errors = [];
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
		page.on('pageerror', (error) => errors.push(String(error)));
		await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded' });
		await page.evaluate(async () => {
			const THREE = await import('three');
			const { WORLD_DEFAULTS } = await import('/src/3d/config.js');
			const { createGroundCollider } = await import('/src/3d/physics.js');
			const { buildClippedBridgeOwnershipTargets } = await import('/src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');
			const { createOptInMigrationControllerShadow } = await import('/src/3d/world/worldReferenceOptInMigrationControllerShadow.js');
			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x17202a);
			const collider = createGroundCollider(WORLD_DEFAULTS.WORLD_SEED);
			const rootA = new THREE.Group();
			const rootB = new THREE.Group();
			const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000, 20, 20), new THREE.MeshStandardMaterial({ color: 0x49613c, roughness: 1 }));
			ground.rotation.x = -Math.PI / 2;
			ground.position.y = collider.getGroundHeight(0, 0);
			rootA.add(ground);
			for (const [x, z] of [[-180,-80],[110,40],[220,-160]]) {
				const marker = new THREE.Mesh(new THREE.BoxGeometry(55, 110, 55), new THREE.MeshStandardMaterial({ color: 0x8a7553, roughness: 0.9 }));
				marker.position.set(x, collider.getGroundHeight(x, z) + 55, z);
				rootB.add(marker);
			}
			scene.add(rootA, rootB);
			const hemi = new THREE.HemisphereLight(0xffffff, 0x334422, 2);
			const sun = new THREE.DirectionalLight(0xffe0b0, 2.3);
			sun.position.set(400, 650, 350);
			scene.add(hemi, sun);
			const canvas = document.createElement('canvas');
			document.body.innerHTML = '';
			document.body.style.margin = '0';
			document.body.appendChild(canvas);
			const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
			renderer.setPixelRatio(1); renderer.setSize(1440, 900, false);
			const camera = new THREE.PerspectiveCamera(52, 1440/900, 0.5, 5000);
			const renderCurrent = () => { camera.position.set(700,500,850); camera.lookAt(0,0,0); camera.updateMatrixWorld(true); renderer.render(scene,camera); };
			const controller = createOptInMigrationControllerShadow({ scene, currentRoots: [rootA, rootB], currentGroundCollider: collider, profile: 'mobile' });
			const target = buildClippedBridgeOwnershipTargets().slice().sort((a,b) => a.bridgeId.localeCompare(b.bridgeId))[0];
			renderCurrent();
			window.__run195VisualActivate = () => {
				const active = controller.activateCanonicalAtBridge(target.bridgeId);
				const bridge = active.windowState.selectedBridges.find((entry) => entry.id === target.bridgeId);
				camera.position.set(bridge.centerX + 500, bridge.deckY + 260, bridge.centerZ + 500);
				camera.lookAt(bridge.centerX, bridge.deckY, bridge.centerZ); camera.updateMatrixWorld(true); renderer.render(scene,camera);
			};
			window.__run195VisualRollback = () => { controller.rollbackToCurrent(); renderCurrent(); };
			window.__run195VisualDispose = () => {
				controller.dispose(); renderer.dispose(); canvas.remove();
				ground.geometry.dispose(); ground.material.dispose();
				for (const child of rootB.children) { child.geometry.dispose(); child.material.dispose(); }
			};
		});
		await page.screenshot({ path: path.join(OUT, 'current-before.png') });
		await page.evaluate(() => window.__run195VisualActivate());
		await page.screenshot({ path: path.join(OUT, 'canonical-active.png') });
		await page.evaluate(() => window.__run195VisualRollback());
		await page.screenshot({ path: path.join(OUT, 'current-restored-visible.png') });
		await page.evaluate(() => window.__run195VisualDispose());
		if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`);
		console.log('[checkOptInMigrationControllerVisualEvidence] PASS: current/canonical/restored 1440x900 visual states captured with zero browser errors.');
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}
main().catch((error) => { console.error(`[checkOptInMigrationControllerVisualEvidence] FAIL: ${error.stack || error}`); process.exitCode = 1; });
