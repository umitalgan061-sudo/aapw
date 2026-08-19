#!/usr/bin/env node
/**
 * checkCameraContract.js — live-browser OrbitControls and camera-collision regression contract.
 * Pins the existing camera configuration, listener cleanup and one-frame wall-avoidance behavior
 * without changing runtime code or owner-visible camera tuning values.
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

// Run 348 periodic-platform-control finding: this script's own `page.goto()` used a hardcoded
// 15000ms timeout, well under this project's own documented `game3d.html` boot cost (~9-13s typical,
// 20s+ outliers under sandbox contention — see e.g. `game3dSmokeChecksSettlementDiscovery.js`'s own
// run-332 RCA comment). Reproduced twice in a row in this session (real timeouts, not a one-off
// flake) while every other `game3d.html`-navigating check in this codebase's active smoke suite
// already uses a 30000ms `NAV_TIMEOUT_MS` for the same reason. Bumped to match that existing
// convention rather than introducing a third, inconsistent value.
const NAV_TIMEOUT_MS = 30_000;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkCameraContract] SKIP: Playwright is not available in this environment.');
		process.exit(2);
	}
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createOrbitCamera, resolveCameraCollision } = await import('/src/3d/camera.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };
			const close = (a, b, tolerance = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
			const vectorClose = (a, b, tolerance = 1e-6) => a.distanceTo(b) <= tolerance;

			const dom = document.createElement('div');
			dom.style.width = '1280px';
			dom.style.height = '720px';
			document.body.appendChild(dom);
			const listeners = new Map();
			const originalAdd = dom.addEventListener.bind(dom);
			const originalRemove = dom.removeEventListener.bind(dom);
			dom.addEventListener = (type, listener, options) => {
				if (!listeners.has(type)) listeners.set(type, new Set());
				listeners.get(type).add(listener);
				return originalAdd(type, listener, options);
			};
			dom.removeEventListener = (type, listener, options) => {
				listeners.get(type)?.delete(listener);
				return originalRemove(type, listener, options);
			};

			const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
			camera.position.set(0, 80, 120);
			const beforeCreate = camera.position.clone();
			const controls = createOrbitCamera(camera, dom);
			fail(controls.object === camera && controls.domElement === dom, 'OrbitControls camera/DOM binding drifted');
			fail(vectorClose(controls.target, new THREE.Vector3(0, 0, 0)), 'OrbitControls target is no longer world origin');
			fail(controls.enableDamping === true && close(controls.dampingFactor, 0.08), 'OrbitControls damping contract drifted');
			fail(close(controls.minDistance, 20) && close(controls.maxDistance, 1800), 'OrbitControls default distance limits drifted');
			fail(close(controls.maxPolarAngle, Math.PI / 2 - 0.05), 'OrbitControls maxPolarAngle drifted');
			fail(dom.style.touchAction === 'none', 'OrbitControls touch-action contract drifted');
			fail(vectorClose(camera.position, beforeCreate), 'initial OrbitControls update unexpectedly moved an already-valid camera pose');
			for (const type of ['contextmenu', 'pointerdown', 'pointercancel', 'wheel']) {
				fail((listeners.get(type)?.size || 0) === 1, `expected one active ${type} listener after OrbitControls creation`);
			}
			const listenerCountBeforeDispose = [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
			fail(listenerCountBeforeDispose === 4, `expected 4 tracked OrbitControls listeners, got ${listenerCountBeforeDispose}`);
			controls.dispose();
			const listenerCountAfterDispose = [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
			fail(listenerCountAfterDispose === 0, `OrbitControls dispose left ${listenerCountAfterDispose} tracked listener(s)`);
			dom.remove();

			const customDom = document.createElement('div');
			document.body.appendChild(customDom);
			const customCamera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
			customCamera.position.set(0, 10, 20);
			const customControls = createOrbitCamera(customCamera, customDom, { minDistance: 4.5, maxDistance: 42 });
			fail(close(customControls.minDistance, 4.5) && close(customControls.maxDistance, 42), 'custom OrbitControls distance limits are not respected');
			fail(customControls.enableDamping === true && close(customControls.dampingFactor, 0.08), 'custom OrbitControls lost shared damping policy');
			customControls.dispose();
			customDom.remove();

			const raycaster = new THREE.Raycaster();
			const target = new THREE.Vector3(0, 0, 0);
			const desired = new THREE.Vector3(0, 0, 10);
			const desiredSnapshot = desired.clone();
			const noCandidates = resolveCameraCollision(raycaster, target, desired, [], 0.5, 2);
			fail(noCandidates === desired, 'empty-collidable fast path should preserve desiredPosition identity');
			fail(vectorClose(desired, desiredSnapshot), 'empty-collidable path mutated desiredPosition');

			const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
			wall.position.set(0, 0, 5);
			wall.updateMatrixWorld(true);
			const zeroDesired = target.clone();
			const zeroDistance = resolveCameraCollision(raycaster, target, zeroDesired, [wall], 0.5, 2);
			fail(zeroDistance === zeroDesired, 'zero-distance fast path should preserve desiredPosition identity');

			const resolved = resolveCameraCollision(raycaster, target, desired, [wall], 0.5, 2);
			fail(resolved !== desired, 'occluded camera should return a pulled-in Vector3');
			fail(vectorClose(desired, desiredSnapshot), 'collision resolution mutated desiredPosition');
			fail(close(resolved.x, 0) && close(resolved.y, 0) && close(resolved.z, 3.5), `wall resolution ${resolved.toArray()} != expected 3.5m`);
			fail(close(raycaster.near, 0) && close(raycaster.far, 10), 'camera Raycaster near/far bounds drifted');

			const minClamped = resolveCameraCollision(raycaster, target, desired, [wall], 3.5, 2);
			fail(close(minClamped.z, 2), `camera minimum-distance clamp ${minClamped.z} != 2m`);

			const farWall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
			farWall.position.set(0, 0, 15);
			farWall.updateMatrixWorld(true);
			const outsideRay = resolveCameraCollision(raycaster, target, desired, [farWall], 0.5, 2);
			fail(outsideRay === desired, 'collider beyond desired camera distance should be ignored');

			wall.geometry.dispose();
			wall.material.dispose();
			farWall.geometry.dispose();
			farWall.material.dispose();

			return {
				listenerCountBeforeDispose,
				listenerCountAfterDispose,
				minDistance: controls.minDistance,
				maxDistance: controls.maxDistance,
				dampingFactor: controls.dampingFactor,
				maxPolarAngle: controls.maxPolarAngle,
				resolvedDistance: resolved.distanceTo(target),
				minClampedDistance: minClamped.distanceTo(target),
			};
		});
		assert(result.listenerCountBeforeDispose === 4 && result.listenerCountAfterDispose === 0, 'OrbitControls listener teardown escaped browser contract');
		console.log(`[checkCameraContract] PASS: OrbitControls ${result.minDistance}-${result.maxDistance}m, damping ${result.dampingFactor.toFixed(2)}, maxPolar ${result.maxPolarAngle.toFixed(3)}rad, DOM listeners ${result.listenerCountBeforeDispose}->${result.listenerCountAfterDispose}; collision 10m desired->${result.resolvedDistance.toFixed(1)}m, min clamp ${result.minClampedDistance.toFixed(1)}m, far-hit rejection PASS.`);
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkCameraContract] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
