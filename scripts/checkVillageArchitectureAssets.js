#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = path.join(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'src/3d/world/villages.js');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'village-architecture-assets');

function assertHydratedGlbs() {
	const source = fs.readFileSync(SOURCE_PATH, 'utf8');
	assert(!source.includes('EditorMaterialStudio'), 'runtime villages must not import editor-only Material Studio UI');
	assert(source.includes('WorldAssetPlacementPipeline.js'), 'village models must use the shared placement core');
	assert(source.includes('placeWorldAsset('), 'village models must pass through placeWorldAsset');
	assert(source.includes('bodyMesh.setColorAt(houseCount, wallTint)'), 'procedural village fabric must carry regional wall tint per instance');
	assert(source.includes('roofMesh.setColorAt(houseCount, roofTint)'), 'procedural village fabric must carry regional roof tint per instance');
	assert(source.includes('AssetLoader.disposeObject3D(source)'), 'late GLB completion must dispose source after village teardown');
	assert(source.includes('factoryCached'), 'village teardown must distinguish shared factory-cache materials from local materials');
	const assetPaths = [...new Set([...source.matchAll(/assetUrl:\s*'([^']+\.glb)'/g)].map((match) => match[1]))];
	assert(assetPaths.length >= 6, `expected regional model diversity, found only ${assetPaths.length} GLB family/families`);
	for (const assetPath of assetPaths) {
		const absolute = path.join(ROOT, assetPath);
		assert(fs.existsSync(absolute), `missing repository asset: ${assetPath}`);
		const head = fs.readFileSync(absolute).subarray(0, 160);
		assert(!head.toString('utf8').startsWith('version https://git-lfs.github.com/spec'), `${assetPath} is still an LFS pointer; selective hydration did not run`);
		assert.equal(head.subarray(0, 4).toString('ascii'), 'glTF', `${assetPath} is not a hydrated binary GLB`);
	}
	return assetPaths;
}

async function main() {
	const assetPaths = assertHydratedGlbs();
	const playwright = loadPlaywright();
	if (!playwright) {
		console.error('[checkVillageArchitectureAssets] FAIL: Playwright is required for shipped Three.js proof.');
		process.exit(2);
	}
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
		const pageErrors = [];
		const consoleErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error.message || error)));
		page.on('console', (message) => {
			if (message.type() === 'error') consoleErrors.push(message.text());
		});
		await page.goto(`http://127.0.0.1:${port}/scripts/village-architecture-harness.html`, {
			waitUntil: 'domcontentloaded', timeout: 30000,
		});

		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const {
				VILLAGE_ARCHITECTURE_PROFILES,
				resolveVillageArchitectureProfile,
				upgradeVillageArchitectureAssets,
				disposeVillages,
			} = await import('/src/3d/world/villages.js');

			const seatIds = ['berkalp', 'ziya', 'stannis', 'doran', 'robin', 'twin', 'umit'];
			const expectedRegions = ['north', 'fertile', 'maritime', 'arid', 'mountain', 'temperate', 'volcanic'];
			const villageGroup = new THREE.Group();
			villageGroup.name = 'browser-proof-villages';
			villageGroup.userData.villageLandmarkSites = seatIds.map((seatId, index) => ({
				seatId,
				x: (index - 3) * 19,
				z: index % 2 === 0 ? -8 : 8,
				yaw: (index - 3) * 0.18,
				houseIndex: index,
				stepStartIndex: index * 3,
				stepCount: 3,
				targetFootprintMeters: 7.2 + (index % 3) * 0.7,
			}));
			const sampleHeightMeters = (x, z) => 120 + x * 0.002 + z * 0.001;
			const loader = new AssetLoader({ events: { emit() {} } });
			const evidence = await upgradeVillageArchitectureAssets({
				assetLoader: loader,
				villageGroup,
				sampleHeightMeters,
				seaLevelMeters: 0,
				roadEdges: [],
			});

			const architectureGroup = villageGroup.getObjectByName('village-architectural-assets');
			const manifestProof = evidence.manifests.map((entry) => ({
				seatId: entry.seatId,
				region: entry.region,
				assetUrl: entry.assetUrl,
				textureSize: entry.textureSize,
				recipeMode: entry.manifest?.recipe?.mode ?? null,
				recipePalette: entry.manifest?.recipe?.basePaletteId ?? null,
				layerPalettes: (entry.manifest?.recipe?.layers || []).map((layer) => layer.palette),
				generatedMaterialCount: entry.manifest?.validation?.generatedMaterialCount ?? 0,
				meshCount: entry.manifest?.validation?.meshCount ?? 0,
				surfaceCount: entry.manifest?.validation?.surfaceCount ?? 0,
				paletteIds: [...new Set((entry.manifest?.surfaces || []).map((surface) => surface.paletteId).filter(Boolean))],
				groundingMode: entry.manifest?.placementFootprint?.groundingMode ?? null,
				heightRange: entry.manifest?.placementFootprint?.heightRange ?? null,
				placementSurfaceHeight: entry.manifest?.placementSurface?.height ?? null,
			}));

			const lifecycleGroup = new THREE.Group();
			lifecycleGroup.userData.villageLandmarkSites = [{
				seatId: 'berkalp', x: 0, z: 0, yaw: 0, houseIndex: 0,
				stepStartIndex: 0, stepCount: 3, targetFootprintMeters: 7.2,
			}];
			let releaseLateLoad;
			let lateGeometryDisposed = false;
			let lateMaterialDisposed = false;
			const lateGeometry = new THREE.BoxGeometry(5, 4, 5);
			const lateMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
			lateGeometry.addEventListener('dispose', () => { lateGeometryDisposed = true; });
			lateMaterial.addEventListener('dispose', () => { lateMaterialDisposed = true; });
			const lateSource = new THREE.Mesh(lateGeometry, lateMaterial);
			const lateLoader = {
				loadModel() {
					return new Promise((resolve) => { releaseLateLoad = () => resolve(lateSource); });
				},
			};
			const lifecyclePromise = upgradeVillageArchitectureAssets({
				assetLoader: lateLoader,
				villageGroup: lifecycleGroup,
				sampleHeightMeters: () => 120,
				seaLevelMeters: 0,
				roadEdges: [],
			});
			await Promise.resolve();
			disposeVillages(lifecycleGroup);
			releaseLateLoad();
			const lifecycleEvidence = await lifecyclePromise;
			const lateAssetCount = lifecycleGroup.getObjectByName('village-architectural-assets')?.children.length ?? 0;

			const ownershipGroup = new THREE.Group();
			const sharedTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
			const ownedTexture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
			let sharedTextureDisposed = false;
			let ownedTextureDisposed = false;
			let cachedMaterialDisposed = false;
			let layeredMaterialDisposed = false;
			let ownedMaterialDisposed = false;
			sharedTexture.addEventListener('dispose', () => { sharedTextureDisposed = true; });
			ownedTexture.addEventListener('dispose', () => { ownedTextureDisposed = true; });
			const cachedMaterial = new THREE.MeshStandardMaterial({ map: sharedTexture });
			cachedMaterial.userData.generatedByTextureFactory = true;
			cachedMaterial.userData.cacheKey = 'test:cached-house';
			cachedMaterial.addEventListener('dispose', () => { cachedMaterialDisposed = true; });
			const layeredMaterial = new THREE.MeshStandardMaterial({ map: sharedTexture });
			layeredMaterial.userData.generatedByTextureFactory = true;
			layeredMaterial.userData.layeredBands = ['stone', 'house', 'thatch'];
			layeredMaterial.addEventListener('dispose', () => { layeredMaterialDisposed = true; });
			const ownedMaterial = new THREE.MeshStandardMaterial({ map: ownedTexture });
			ownedMaterial.addEventListener('dispose', () => { ownedMaterialDisposed = true; });
			ownershipGroup.add(
				new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), cachedMaterial),
				new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), layeredMaterial),
				new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ownedMaterial),
			);
			disposeVillages(ownershipGroup);

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0xa8bfd1);
			scene.add(new THREE.HemisphereLight(0xf4f6ff, 0x4d4b3a, 2));
			const sun = new THREE.DirectionalLight(0xffedcf, 3.2);
			sun.position.set(80, 140, 90);
			scene.add(sun);
			const ground = new THREE.Mesh(
				new THREE.PlaneGeometry(210, 90),
				new THREE.MeshStandardMaterial({ color: 0x65784c, roughness: 1 }),
			);
			ground.rotation.x = -Math.PI / 2;
			ground.position.y = 119.8;
			scene.add(ground);
			scene.add(villageGroup);
			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setSize(1440, 820, false);
			renderer.outputColorSpace = THREE.SRGBColorSpace;
			document.body.appendChild(renderer.domElement);
			const camera = new THREE.PerspectiveCamera(42, 1440 / 820, 0.1, 600);
			camera.position.set(100, 176, 170);
			camera.lookAt(0, 124, 0);
			renderer.render(scene, camera);

			const profileTints = seatIds.map((seatId) => {
				const profile = resolveVillageArchitectureProfile(seatId);
				return { wall: profile?.proceduralWallHex ?? null, roof: profile?.proceduralRoofHex ?? null };
			});
			return {
				evidence: {
					ok: evidence.ok,
					requestedSiteCount: evidence.requestedSiteCount,
					upgradedCount: evidence.upgradedCount,
					missingAssetCount: evidence.missingAssetCount,
					placementFailureCount: evidence.placementFailureCount,
					textureSize: evidence.textureSize,
				},
				assetCount: architectureGroup?.children?.length ?? 0,
				regions: seatIds.map((seatId) => resolveVillageArchitectureProfile(seatId)?.id ?? null),
				expectedRegions,
				profileCount: Object.keys(VILLAGE_ARCHITECTURE_PROFILES).length,
				profileTints,
				manifestProof,
				lifecycle: {
					disposed: lifecycleEvidence.disposed === true,
					ok: lifecycleEvidence.ok,
					upgradedCount: lifecycleEvidence.upgradedCount,
					lateAssetCount,
					lateGeometryDisposed,
					lateMaterialDisposed,
				},
				ownership: {
					sharedTextureDisposed,
					ownedTextureDisposed,
					cachedMaterialDisposed,
					layeredMaterialDisposed,
					ownedMaterialDisposed,
				},
			};
		});

		assert.equal(result.evidence.ok, true, `architecture evidence failed: ${JSON.stringify({ ...result.evidence, successfulSeats: result.manifestProof.map((proof) => proof.seatId) })}`);
		assert.equal(result.evidence.requestedSiteCount, 7);
		assert.equal(result.evidence.upgradedCount, 7);
		assert.equal(result.evidence.missingAssetCount, 0, 'real GLB load must have missing asset=0');
		assert.equal(result.evidence.placementFailureCount, 0, 'all synthetic qualified sites must pass shared placement');
		assert.equal(result.evidence.textureSize, 256);
		assert.equal(result.assetCount, 7);
		assert.deepEqual(result.regions, result.expectedRegions, 'seat geography must resolve to seven distinct regional architecture profiles');
		assert(result.profileCount >= 7);
		assert.equal(new Set(result.profileTints.map((tint) => tint.wall)).size, 7, 'all geographic village profiles need distinct procedural wall tint');
		assert.equal(new Set(result.profileTints.map((tint) => tint.roof)).size, 7, 'all geographic village profiles need distinct procedural roof tint');
		assert.equal(result.lifecycle.disposed, true, 'teardown race must be reported as disposed');
		assert.equal(result.lifecycle.ok, false, 'disposed upgrade must not report a successful complete hydration');
		assert.equal(result.lifecycle.upgradedCount, 0, 'no asset may attach after village teardown');
		assert.equal(result.lifecycle.lateAssetCount, 0, 'late GLB must not be attached after teardown');
		assert.equal(result.lifecycle.lateGeometryDisposed, true, 'late GLB geometry must be disposed after teardown');
		assert.equal(result.lifecycle.lateMaterialDisposed, true, 'late GLB material must be disposed after teardown');
		assert.equal(result.ownership.sharedTextureDisposed, false, 'factory-cache texture must remain owned by the shared cache');
		assert.equal(result.ownership.cachedMaterialDisposed, false, 'factory-cache material must remain owned by the shared cache');
		assert.equal(result.ownership.layeredMaterialDisposed, true, 'uncached layered wrapper material must be disposed locally');
		assert.equal(result.ownership.ownedTextureDisposed, true, 'village-owned texture must still be disposed locally');
		assert.equal(result.ownership.ownedMaterialDisposed, true, 'village-owned material must still be disposed locally');
		for (const proof of result.manifestProof) {
			assert(proof.generatedMaterialCount > 0, `${proof.region}: no generated PBR material`);
			assert(proof.meshCount > 0 && proof.surfaceCount > 0, `${proof.region}: no renderable material surfaces`);
			assert.equal(proof.textureSize, 256, `${proof.region}: wrong texture size`);
			assert(proof.groundingMode === 'embedded-low-side' || proof.groundingMode === 'terrain-conform', `${proof.region}: footprint grounding not recorded`);
			assert(Number.isFinite(proof.heightRange) && proof.heightRange < 0.25, `${proof.region}: excessive synthetic ground height range ${proof.heightRange}`);
			assert(Number.isFinite(proof.placementSurfaceHeight), `${proof.region}: placement surface missing`);
			if (proof.recipeMode === 'layers') {
				assert(proof.layerPalettes.length >= 3, `${proof.region}: single-mesh fallback is not materially layered`);
			} else {
				assert(proof.paletteIds.length > 0, `${proof.region}: multi-surface model has no palette evidence`);
			}
		}
		assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
		assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(' | ')}`);
		await page.screenshot({ path: path.join(ARTIFACT_DIR, 'regional-village-assets.png'), fullPage: true });
		console.log('VILLAGE_ARCHITECTURE_ASSET_PASS', JSON.stringify({
			assets: assetPaths.length,
			...result.evidence,
			regions: result.regions,
			profileTints: result.profileTints,
			lifecycle: result.lifecycle,
			ownership: result.ownership,
			proof: result.manifestProof,
			pageErrors: pageErrors.length,
			consoleErrors: consoleErrors.length,
		}));
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[checkVillageArchitectureAssets] FAIL', error);
	process.exit(1);
});