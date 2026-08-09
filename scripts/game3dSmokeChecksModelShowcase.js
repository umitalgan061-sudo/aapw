/**
 * Focused browser contract for `world/modelShowcase.js`.
 *
 * Uses real Three.js objects with a synthetic asset loader for precise placement/lifecycle checks,
 * then decodes all eight real runtime GLBs and rejects any placeholder, empty mesh graph, or
 * non-finite rendered bounds.
 * @module scripts/game3dSmokeChecksModelShowcase
 */

const NAV_TIMEOUT_MS = 15000;

/**
 * @param {import('playwright').Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkModelShowcase(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/scripts/fixtures/run180-scene-harness.html`, {
			waitUntil: 'domcontentloaded',
			timeout: NAV_TIMEOUT_MS,
		});
		result = await page.evaluate(async () => {
			const THREE = await import('/src/3d/vendor/three/three.module.js');
			const {
				MODEL_SHOWCASE_ASSIGNMENTS,
				normalizeShowcaseModel,
				spawnModelShowcase,
			} = await import('/src/3d/world/modelShowcase.js');

			const expectedUrls = [
				'assets/models/characters/casual_confidence_runtime.glb',
				'assets/models/characters/elven_warrior_runtime.glb',
				'assets/models/props/iron_throne/iron_throne_textured_runtime.glb',
				'assets/models/creatures/dragons/storm_dragon_textured_runtime.glb',
				'assets/models/creatures/dragons/verdant_dragon_textured_runtime.glb',
				'assets/models/creatures/dragons/frostwing_dragon_textured_runtime.glb',
				'assets/models/creatures/dragons/golden_ember_dragon_textured_runtime.glb',
				'assets/models/creatures/dragons/obsidian_wyvern_textured_runtime.glb',
			];
			const loadedUrls = [];
			const resources = [];
			const fakeAssetLoader = {
				async loadModel(url) {
					loadedUrls.push(url);
					const geometry = new THREE.BoxGeometry(2, 4, 6);
					const material = new THREE.MeshStandardMaterial({ color: 0x8b6f47 });
					const resource = { geometryDisposed: false, materialDisposed: false };
					geometry.addEventListener('dispose', () => { resource.geometryDisposed = true; });
					material.addEventListener('dispose', () => { resource.materialDisposed = true; });
					resources.push(resource);
					const root = new THREE.Group();
					root.add(new THREE.Mesh(geometry, material));
					return root;
				},
			};

			const anchor = { x: 120, z: -80 };
			const sampleGroundY = (x, z) => 7 + (x * 0.01) - (z * 0.005);
			const showcase = await spawnModelShowcase({
				assetLoader: fakeAssetLoader,
				anchor,
				sampleGroundY,
			});
			const parent = new THREE.Group();
			parent.add(showcase.object3D);

			const ids = MODEL_SHOWCASE_ASSIGNMENTS.map(({ id }) => id);
			const urls = MODEL_SHOWCASE_ASSIGNMENTS.map(({ modelUrl }) => modelUrl);
			const assignmentSetComplete = MODEL_SHOWCASE_ASSIGNMENTS.length === 8
				&& new Set(ids).size === 8
				&& new Set(urls).size === 8
				&& expectedUrls.every((url) => urls.includes(url));
			const loadedExactlyOnce = loadedUrls.length === 8
				&& expectedUrls.every((url) => loadedUrls.filter((loaded) => loaded === url).length === 1);

			const epsilon = 1e-5;
			const transformsCorrect = MODEL_SHOWCASE_ASSIGNMENTS.every((assignment, index) => {
				const model = showcase.models[index];
				const bounds = new THREE.Box3().setFromObject(model);
				const size = bounds.getSize(new THREE.Vector3());
				const center = bounds.getCenter(new THREE.Vector3());
				const maxDimension = Math.max(size.x, size.y, size.z);
				const expectedX = anchor.x + assignment.offsetXMeters;
				const expectedZ = anchor.z + assignment.offsetZMeters;
				const expectedGround = sampleGroundY(expectedX, expectedZ);
				const expectedLift = assignment.liftMeters ?? 0;
				return Math.abs(maxDimension - assignment.targetMaxDimensionMeters) < epsilon
					&& Math.abs(center.x - expectedX) < epsilon
					&& Math.abs(center.z - expectedZ) < epsilon
					&& Math.abs(bounds.min.y - (expectedGround + expectedLift)) < epsilon
					&& model.name === assignment.id
					&& model.userData.showcaseAssetUrl === assignment.modelUrl
					&& Math.abs(model.userData.showcaseGroundY - expectedGround) < epsilon
					&& model.userData.showcaseLiftMeters === expectedLift;
			});
			const shadowsEnabled = showcase.models.every((model) => {
				let meshes = 0;
				let enabled = true;
				model.traverse((node) => {
					if (!node.isMesh) return;
					meshes += 1;
					enabled = enabled && node.castShadow && node.receiveShadow;
				});
				return meshes > 0 && enabled;
			});

			let emptyBoundsRejected = false;
			try {
				normalizeShowcaseModel(new THREE.Group(), {
					worldX: 0,
					worldZ: 0,
					groundY: 0,
					targetMaxDimensionMeters: 1,
					rotationYRadians: 0,
				});
			} catch {
				emptyBoundsRejected = true;
			}

			showcase.dispose();
			showcase.dispose();
			const disposedIdempotently = showcase.object3D.parent === null
				&& resources.length === 8
				&& resources.every(({ geometryDisposed, materialDisposed }) => (
					geometryDisposed && materialDisposed
				));

			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const realAssetLoader = new AssetLoader();
			const realShowcase = await spawnModelShowcase({
				assetLoader: {
					loadModel: (url, options) => realAssetLoader.loadModel(`/${url}`, options),
				},
				anchor: { x: 0, z: 0 },
				sampleGroundY: () => 0,
			});
			const realGlbDiagnostics = realShowcase.models.map((model) => {
					let meshCount = 0;
					let placeholderFound = false;
					model.traverse((node) => {
						if (node.isMesh) meshCount += 1;
						placeholderFound ||= node.userData.isPlaceholder === true;
					});
					const bounds = new THREE.Box3().setFromObject(model);
					const finiteBounds = [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z]
						.every(Number.isFinite);
					return { id: model.name, meshCount, placeholderFound, finiteBounds };
				});
			const realGlbsParsed = realShowcase.models.length === 8
				&& realGlbDiagnostics.every(({ meshCount, placeholderFound, finiteBounds }) => (
					meshCount > 0 && !placeholderFound && finiteBounds
				));
			realShowcase.dispose();
			if (!realGlbsParsed) {
				throw new Error(`Real GLB diagnostics: ${JSON.stringify(realGlbDiagnostics)}`);
			}

			return {
				assignmentSetComplete,
				loadedExactlyOnce,
				groupComplete: showcase.models.length === 8 && showcase.object3D.children.length === 8,
				transformsCorrect,
				shadowsEnabled,
				emptyBoundsRejected,
				disposedIdempotently,
				realGlbsParsed,
			};
		});
	} catch (error) {
		result = { error: String(error) };
	}
	await page.close();
	const ok = result && Object.values(result).every((value) => value === true);
	const details = ok
		? '8 real GLBs parse without placeholders; placement, shadows, and idempotent disposal pass'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'owner model showcase placement/lifecycle', ok, details };
}

module.exports = { checkModelShowcase };
