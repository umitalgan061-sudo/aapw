#!/usr/bin/env node
/** Run180 V2: same real-scene assertions as V1 without the intentional 404 harness request. */
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkWindGrassSceneIntegrationRun180V2] SKIP: Playwright unavailable.');
		process.exit(2);
	}

	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 430, height: 932 },
		screen: { width: 430, height: 932 },
		deviceScaleFactor: 2,
		isMobile: true,
		hasTouch: true,
		userAgent: 'WesterosPWA-Run180GrassIntegrationV2/1.0',
	});
	const page = await context.newPage();
	const consoleErrors = [];
	const pageErrors = [];
	page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
	page.on('pageerror', (error) => pageErrors.push(String(error)));

	try {
		await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/run180-scene-harness.html`, {
			waitUntil: 'domcontentloaded', timeout: 15000,
		});

		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { createScene } = await import('/src/3d/sceneManager.js');
			const { PLAYER_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');
			const { WORLD_SCALE } = await import('/src/3d/config.js');
			const { mapToWorldXZ } = await import('/src/3d/world/settlements.js');
			const { disposeVegetation } = await import('/src/3d/world/vegetation.js');
			const fail = (condition, message) => { if (!condition) throw new Error(message); };

			const state = createScene(document.getElementById('run180-canvas'));
			const grass = state.grass;
			const mesh = grass?.children?.[0];
			fail(Boolean(grass && mesh?.isInstancedMesh), 'real createScene did not expose grass InstancedMesh');
			fail(mesh.frustumCulled === false, 'grass first-frame recenter safety is not active');
			fail(mesh.userData.run180FirstFrameSafe === true, 'Run180 safety marker missing');
			fail(state.grassStats === grass.userData.run179WindGrass, 'grassStats does not reference live metadata');
			fail(state.grassStats.isMobileClass === true, 'mobile/coarse scene did not select mobile grass budget');

			const initialCell = { ...state.grassStats.centerCell };
			const spawn = mapToWorldXZ(
				PLAYER_CONFIG.SPAWN_MAP_X,
				PLAYER_CONFIG.SPAWN_MAP_Y,
				WORLD_SCALE.MAP_BOUNDS,
				WORLD_SCALE.METERS_PER_MAP_UNIT,
			);
			const groundY = state.groundCollider.getGroundHeight(spawn.x, spawn.z);
			const offset = PLAYER_CONFIG.CAMERA_INITIAL_OFFSET_METERS;
			state.camera.position.set(spawn.x + offset.x, groundY + offset.y, spawn.z + offset.z);
			state.camera.lookAt(spawn.x, groundY + PLAYER_CONFIG.CAMERA_TARGET_HEIGHT_METERS, spawn.z);
			state.camera.updateMatrixWorld(true);
			state.camera.updateProjectionMatrix();

			const expectedCell = {
				x: Math.round(state.camera.position.x / 120),
				z: Math.round(state.camera.position.z / 120),
			};
			fail(initialCell.x !== expectedCell.x || initialCell.z !== expectedCell.z, 'camera relocation did not change grass cell');

			state.renderer.render(state.scene, state.camera);
			const recenteredCell = { ...state.grassStats.centerCell };
			fail(
				recenteredCell.x === expectedCell.x && recenteredCell.z === expectedCell.z,
				`first render did not recenter grass: ${JSON.stringify({ initialCell, expectedCell, recenteredCell })}`,
			);
			fail(mesh.count > 0 && mesh.count <= 1200, `mobile grass count ${mesh.count} outside 1..1200`);

			grass.visible = false;
			state.renderer.render(state.scene, state.camera);
			const withoutGrass = {
				calls: state.renderer.info.render.calls,
				triangles: state.renderer.info.render.triangles,
			};
			grass.visible = true;
			state.renderer.render(state.scene, state.camera);
			const withGrass = {
				calls: state.renderer.info.render.calls,
				triangles: state.renderer.info.render.triangles,
			};
			const trianglesPerPatch = mesh.geometry.index.count / 3;
			const expectedGrassTriangles = mesh.count * trianglesPerPatch;
			const drawCallDelta = withGrass.calls - withoutGrass.calls;
			const triangleDelta = withGrass.triangles - withoutGrass.triangles;
			fail(drawCallDelta === 1, `grass draw-call delta ${drawCallDelta} != 1`);
			fail(triangleDelta === expectedGrassTriangles, `grass triangle delta ${triangleDelta} != ${expectedGrassTriangles}`);

			let geometryDisposed = 0;
			let materialDisposed = 0;
			mesh.geometry.addEventListener('dispose', () => geometryDisposed++);
			mesh.material.addEventListener('dispose', () => materialDisposed++);
			disposeVegetation(state.vegetation);
			fail(geometryDisposed === 1 && materialDisposed === 1, `grass teardown ${geometryDisposed}/${materialDisposed}`);
			state.controls.dispose();
			state.freeCamera.dispose();
			state.chunkManager.disposeAll();
			state.renderer.dispose();

			return {
				initialCell,
				recenteredCell,
				patches: mesh.count,
				trianglesPerPatch,
				drawCallDelta,
				triangleDelta,
			};
		});

		assert(consoleErrors.length === 0 && pageErrors.length === 0, `console/page errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
		console.log(
			`[checkWindGrassSceneIntegrationRun180V2] PASS: bootstrap cell (${result.initialCell.x},${result.initialCell.z}) -> ` +
			`player-camera cell (${result.recenteredCell.x},${result.recenteredCell.z}) on first render; ` +
			`${result.patches} mobile patches are really submitted as +${result.drawCallDelta} draw call / ` +
			`+${result.triangleDelta.toLocaleString('en-US')} triangles (${result.trianglesPerPatch}/patch), teardown PASS.`,
		);
	} finally {
		await context.close();
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(`[checkWindGrassSceneIntegrationRun180V2] FAIL: ${error?.stack || error}`);
	process.exit(1);
});
