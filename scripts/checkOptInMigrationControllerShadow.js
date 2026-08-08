#!/usr/bin/env node
/** Run 195: reversible opt-in scene/collider replacement boundary proof. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run195-optin-migration-controller-shadow');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function loadPlaywright() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch (error) { /* next */ }
	}
	return null;
}

function startServer() {
	const server = http.createServer((req, res) => {
		try {
			const clean = decodeURIComponent(req.url.split('?')[0]);
			const relative = clean === '/' ? 'game3d.html' : clean.replace(/^\//, '');
			const file = path.join(ROOT, relative);
			if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
			res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
			fs.createReadStream(file).pipe(res);
		} catch (error) { res.writeHead(500); res.end(String(error)); }
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
		await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
		const initial = await page.evaluate(async () => {
			const THREE = await import('three');
			const { WORLD_DEFAULTS } = await import('/src/3d/config.js');
			const { createGroundCollider } = await import('/src/3d/physics.js');
			const { buildClippedBridgeOwnershipTargets } = await import('/src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');
			const {
				OPT_IN_MIGRATION_CONTROLLER_SHADOW_POLICY,
				createOptInMigrationControllerShadow,
			} = await import('/src/3d/world/worldReferenceOptInMigrationControllerShadow.js');

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x17202a);
			const currentGroundCollider = createGroundCollider(WORLD_DEFAULTS.WORLD_SEED);
			const currentRootA = new THREE.Group();
			currentRootA.name = 'run195-current-world-root-a';
			const currentRootB = new THREE.Group();
			currentRootB.name = 'run195-current-world-root-b';
			const ground = new THREE.Mesh(
				new THREE.PlaneGeometry(1000, 1000, 12, 12),
				new THREE.MeshStandardMaterial({ color: 0x49613c, roughness: 1 }),
			);
			ground.rotation.x = -Math.PI / 2;
			ground.position.y = currentGroundCollider.getGroundHeight(0, 0);
			currentRootA.add(ground);
			const marker = new THREE.Mesh(
				new THREE.BoxGeometry(65, 120, 65),
				new THREE.MeshStandardMaterial({ color: 0x8a7553, roughness: 0.9 }),
			);
			marker.position.set(110, currentGroundCollider.getGroundHeight(110, 40) + 60, 40);
			currentRootB.add(marker);
			const unaffected = new THREE.Group();
			unaffected.name = 'run195-unaffected-root';
			scene.add(currentRootA, unaffected, currentRootB);
			const originalOrder = scene.children.map((child) => child.uuid);
			const light = new THREE.HemisphereLight(0xffffff, 0x334422, 2.0);
			const sun = new THREE.DirectionalLight(0xffe0b0, 2.3);
			sun.position.set(400, 650, 350);
			scene.add(light, sun);
			const originalFullOrder = scene.children.map((child) => child.uuid);

			const canvas = document.createElement('canvas');
			canvas.width = 1440; canvas.height = 900;
			document.body.innerHTML = '';
			document.body.style.margin = '0';
			document.body.appendChild(canvas);
			const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
			renderer.setPixelRatio(1);
			renderer.setSize(1440, 900, false);
			const camera = new THREE.PerspectiveCamera(52, 1440 / 900, 0.5, 5000);
			camera.position.set(700, 500, 850);
			camera.lookAt(0, 0, 0);
			camera.updateMatrixWorld(true);

			const pixelDigest = () => {
				const gl = renderer.getContext();
				const pixels = new Uint8Array(1440 * 900 * 4);
				gl.readPixels(0, 0, 1440, 900, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
				let rolling = 2166136261 >>> 0;
				for (let index = 0; index < pixels.length; index += 97) rolling = Math.imul(rolling ^ pixels[index], 16777619) >>> 0;
				return rolling.toString(16).padStart(8, '0');
			};
			const renderSnapshot = () => {
				renderer.render(scene, camera);
				return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, pixelDigest: pixelDigest() };
			};

			const baseline = renderSnapshot();
			const controller = createOptInMigrationControllerShadow({
				scene,
				currentRoots: [currentRootA, currentRootB],
				currentGroundCollider,
				profile: 'mobile',
			});
			if (controller.getMode() !== OPT_IN_MIGRATION_CONTROLLER_SHADOW_POLICY.modeCurrent) throw new Error('controller did not start current');
			if (controller.getGroundCollider() !== currentGroundCollider) throw new Error('current collider identity drifted');
			const targets = buildClippedBridgeOwnershipTargets();
			const target = targets.slice().sort((a, b) => a.bridgeId.localeCompare(b.bridgeId))[0];
			const activated = controller.activateCanonicalAtBridge(target.bridgeId);
			if (currentRootA.parent || currentRootB.parent) throw new Error('current roots remained attached during canonical mode');
			if (controller.getMode() !== OPT_IN_MIGRATION_CONTROLLER_SHADOW_POLICY.modeCanonical) throw new Error('canonical mode not active');
			if (controller.getGroundCollider() === currentGroundCollider) throw new Error('ground ownership did not switch');
			const bridge = activated.windowState.selectedBridges.find((entry) => entry.id === target.bridgeId);
			if (!bridge) throw new Error('target bridge missing after activation');
			const deckHeight = controller.getGroundCollider().getGroundHeight(bridge.centerX, bridge.centerZ);
			if (!(deckHeight > activated.windowState.plan.context.sampler(bridge.centerX, bridge.centerZ))) throw new Error('canonical ground collider did not own bridge deck');
			camera.position.set(bridge.centerX + 500, bridge.deckY + 260, bridge.centerZ + 500);
			camera.lookAt(bridge.centerX, bridge.deckY, bridge.centerZ);
			camera.updateMatrixWorld(true);
			const canonical = renderSnapshot();
			if (canonical.calls >= 500 || canonical.triangles >= 500000) throw new Error(`canonical mobile budget exceeded ${JSON.stringify(canonical)}`);

			window.__run195Rollback = () => {
				const disposedCanonical = controller.rollbackToCurrent();
				if (!disposedCanonical?.disposed) throw new Error('canonical rollback did not dispose candidate');
				if (controller.getGroundCollider() !== currentGroundCollider) throw new Error('current collider identity not restored');
				if (currentRootA.parent !== scene || currentRootB.parent !== scene) throw new Error('current roots not restored');
				const restoredFullOrder = scene.children.map((child) => child.uuid);
				if (JSON.stringify(restoredFullOrder) !== JSON.stringify(originalFullOrder)) throw new Error('scene child order not restored exactly');
				camera.position.set(700, 500, 850);
				camera.lookAt(0, 0, 0);
				camera.updateMatrixWorld(true);
				const restored = renderSnapshot();
				if (JSON.stringify(restored) !== JSON.stringify(baseline)) throw new Error(`pre/post render mismatch ${JSON.stringify({ baseline, restored })}`);
				let failedActivationRestored = false;
				try { controller.activateCanonicalAtBridge('run195-unknown-bridge'); } catch (error) {
					failedActivationRestored = currentRootA.parent === scene && currentRootB.parent === scene
						&& controller.getMode() === OPT_IN_MIGRATION_CONTROLLER_SHADOW_POLICY.modeCurrent;
				}
				if (!failedActivationRestored) throw new Error('failed activation did not preserve current ownership');
				const secondActivation = controller.activateCanonicalAtBridge(target.bridgeId);
				const secondGeneration = secondActivation.generation;
				controller.rollbackToCurrent();
				if (currentRootA.parent !== scene || currentRootB.parent !== scene) throw new Error('second rollback failed');
				const transitions = controller.getTransitions();
				controller.dispose();
				if (!controller.isDisposed()) throw new Error('controller dispose state missing');
				renderer.dispose();
				canvas.remove();
				ground.geometry.dispose(); ground.material.dispose(); marker.geometry.dispose(); marker.material.dispose();
				return {
					restored,
					disposedCanonical,
					failedActivationRestored,
					secondGeneration,
					transitions,
					canvasCount: document.querySelectorAll('canvas').length,
					originalOrder,
				};
			};

			return {
				policy: controller.version,
				baseline,
				canonical,
				targetBridgeId: target.bridgeId,
				generation: activated.generation,
				deckClearanceMeters: deckHeight - activated.windowState.plan.context.sampler(bridge.centerX, bridge.centerZ),
			};
		});

		await page.screenshot({ path: path.join(OUT, 'canonical-optin-active.png') });
		const finish = await page.evaluate(() => window.__run195Rollback());
		await page.screenshot({ path: path.join(OUT, 'current-restored.png') });
		assert(finish.canvasCount === 0, `renderer canvas leak: ${finish.canvasCount}`);
		assert(finish.failedActivationRestored === true, 'failed activation rollback guard failed');
		assert(errors.length === 0, `browser console/page errors: ${errors.join(' | ')}`);
		const deterministic = JSON.stringify({
			policy: initial.policy,
			baseline: initial.baseline,
			canonical: initial.canonical,
			targetBridgeId: initial.targetBridgeId,
			deckClearanceMm: Math.round(initial.deckClearanceMeters * 1000),
			secondGeneration: finish.secondGeneration,
			transitions: finish.transitions,
		});
		const checksum = hash(deterministic);
		const proof = { ...initial, restored: finish.restored, transitions: finish.transitions, consoleErrors: errors.length, checksum };
		fs.writeFileSync(path.join(OUT, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
		console.log(`[checkOptInMigrationControllerShadow] BUDGET: ${JSON.stringify({ currentBefore: initial.baseline, canonical: initial.canonical, currentAfter: finish.restored })}`);
		console.log(`[checkOptInMigrationControllerShadow] PASS: target=${initial.targetBridgeId} currentCollider=restored rootIdentity=restored renderEquality=exact failedActivation=safe cycles=2 checksum=${checksum}`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkOptInMigrationControllerShadow] FAIL: ${error.stack || error}`);
	process.exitCode = 1;
});
