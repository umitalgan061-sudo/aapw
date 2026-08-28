#!/usr/bin/env node
/**
 * Nothing may grow in a river (run 393).
 *
 * `isPlaceablePosition` kept vegetation and village buildings clear of the sea, the seats and the
 * road network, but nothing knew where the rivers were — and a river runs *above* sea level, so the
 * waterline test could never exclude one. Measured against the real rendered ribbons before the fix:
 * 96 of 14344 scattered instances stood within 8 m of a river ribbon, some within half a metre of
 * the centreline, i.e. trees growing mid-stream.
 *
 * This measures the shipped world the way a player sees it: instance transforms out of the live
 * vegetation group, against the vertices of the river meshes actually in the scene — not against a
 * recomputed course. That distinction matters, and cost a measurement round: the exclusion is applied
 * to the traced polyline, but the ribbon is resampled and re-grounded (run 390) and wanders from it,
 * so an 11 m exclusion still left 28 instances near a ribbon while 18 m leaves none.
 */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

/** How close an instance may come to a river ribbon vertex before it counts as standing in the water. */
const NEAR_RIVER_METERS = 8;
/** Ceiling on instances that close. Zero: a tree in a river is never right. */
const MAX_INSTANCES_IN_RIVER = 0;
/** Guards against the exclusion being widened until the world is empty rather than until it is correct. */
const MIN_VEGETATION_INSTANCES = 12000;

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.log('[vegetation-river] SKIP: Playwright unavailable.');
		return;
	}
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	const page = await browser.newPage();
	const pageErrors = [];
	page.on('pageerror', (error) => pageErrors.push(String(error.message)));
	try {
		await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, {
			waitUntil: 'load',
			timeout: 90000,
		});
		const result = await page.evaluate(async ({ nearMeters }) => {
			const importMap = document.createElement('script');
			importMap.type = 'importmap';
			importMap.textContent = JSON.stringify({ imports: {
				three: '/src/3d/vendor/three/three.module.js',
				'three/addons/': '/src/3d/vendor/three/addons/',
			} });
			document.head.append(importMap);
			const THREE = await import('/src/3d/vendor/three/three.module.js');
			const { createScene } = await import('/src/3d/sceneManager.js');
			document.body.innerHTML = '<canvas id="vegetation-river-canvas"></canvas>';
			const state = createScene(document.getElementById('vegetation-river-canvas'));
			state.scene.updateMatrixWorld(true);

			const scratch = new THREE.Vector3();
			const riverXZ = [];
			state.scene.traverse((object) => {
				const isRiver = object === state.river || (object.name && object.name.startsWith('river-'));
				if (!isRiver || !object.geometry) return;
				const position = object.geometry.getAttribute('position');
				for (let i = 0; i < position.count; i += 1) {
					scratch.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
					riverXZ.push(scratch.x, scratch.z);
				}
			});

			const matrix = new THREE.Matrix4();
			const instances = [];
			state.vegetation.updateMatrixWorld(true);
			state.vegetation.traverse((object) => {
				if (!object.isInstancedMesh) return;
				for (let i = 0; i < object.count; i += 1) {
					object.getMatrixAt(i, matrix);
					scratch.setFromMatrixPosition(matrix).applyMatrix4(object.matrixWorld);
					instances.push([scratch.x, scratch.z]);
				}
			});

			let inRiver = 0;
			let closestMeters = Infinity;
			const offenders = [];
			for (const [x, z] of instances) {
				let best = Infinity;
				for (let i = 0; i < riverXZ.length; i += 2) {
					const distance = Math.hypot(x - riverXZ[i], z - riverXZ[i + 1]);
					if (distance < best) {
						best = distance;
						if (best < 0.5) break;
					}
				}
				if (best < closestMeters) closestMeters = best;
				if (best < nearMeters) {
					inRiver += 1;
					if (offenders.length < 5) offenders.push({ x: Math.round(x), z: Math.round(z), metres: Number(best.toFixed(1)) });
				}
			}
			return {
				instances: instances.length,
				riverVertices: riverXZ.length / 2,
				inRiver,
				closestMeters: Number(closestMeters.toFixed(2)),
				offenders,
			};
		}, { nearMeters: NEAR_RIVER_METERS });

		const failures = [];
		if (result.riverVertices < 100) {
			// Without river geometry this check would pass by measuring nothing at all.
			failures.push(`only ${result.riverVertices} river vertices in the scene — nothing to measure against`);
		}
		if (result.instances < MIN_VEGETATION_INSTANCES) {
			failures.push(`only ${result.instances} vegetation instances (min ${MIN_VEGETATION_INSTANCES}) — the exclusion may be emptying the world`);
		}
		if (result.inRiver > MAX_INSTANCES_IN_RIVER) {
			failures.push(
				`${result.inRiver} vegetation instance(s) stand within ${NEAR_RIVER_METERS}m of a river ribbon `
					+ `(max ${MAX_INSTANCES_IN_RIVER}) — e.g. ${JSON.stringify(result.offenders)}`,
			);
		}
		if (pageErrors.length) failures.push(`page errors: ${JSON.stringify(pageErrors.slice(0, 3))}`);

		if (failures.length) {
			console.error(`[vegetation-river] FAIL: ${failures.join('; ')}`);
			process.exitCode = 1;
			return;
		}
		console.log(
			`[vegetation-river] PASS: ${result.instances} vegetation instances, ${result.riverVertices} river ribbon `
				+ `vertices, 0 within ${NEAR_RIVER_METERS}m; closest stands ${result.closestMeters}m from the water.`,
		);
	} finally {
		await page.close();
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error(`[vegetation-river] FAIL: ${error.message}`);
	process.exit(1);
});
