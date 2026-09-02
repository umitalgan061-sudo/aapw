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
	assert(source.includes('MAX_ARCHITECTURE_ASSETS_PER_HAMLET = 2'), 'hamlets must bound real residential upgrades to two');
	assert(source.includes('MIN_ARCHITECTURE_ASSET_SPACING_METERS = 22'), 'real residential upgrades must be spatially separated');
	assert(source.includes('secondaryAssetUrl'), 'regional profiles must provide a bounded secondary silhouette');
	assert(source.includes('targetWidthMeters: type.width'), 'real houses must retain the authored procedural parcel width');
	assert(source.includes('targetDepthMeters: type.depth'), 'real houses must retain the authored procedural parcel depth');
	assert(source.includes('Math.min(targetWidth / sourceWidth, targetDepth / sourceDepth)'), 'real houses must fit both parcel axes');
	assert(source.includes('bodyMesh.setColorAt(houseCount, wallTint)'), 'procedural village fabric must carry regional wall tint');
	assert(source.includes('roofMesh.setColorAt(houseCount, roofTint)'), 'procedural village fabric must carry regional roof tint');
	assert(source.includes('AssetLoader.disposeObject3D(source)'), 'late GLB completion must dispose source after teardown');
	assert(source.includes('factoryCached'), 'village teardown must preserve shared material-cache ownership');
	const assetPaths = [...new Set([...source.matchAll(/\b(?:assetUrl|secondaryAssetUrl):\s*'([^']+\.glb)'/g)].map((match) => match[1]))];
	assert(assetPaths.length >= 6, `expected regional model diversity, found ${assetPaths.length}`);
	for (const assetPath of assetPaths) {
		const absolute = path.join(ROOT, assetPath);
		assert(fs.existsSync(absolute), `missing repository asset: ${assetPath}`);
		const head = fs.readFileSync(absolute).subarray(0, 160);
		assert(!head.toString('utf8').startsWith('version https://git-lfs.github.com/spec'), `${assetPath} is still an LFS pointer`);
		assert.equal(head.subarray(0, 4).toString('ascii'), 'glTF', `${assetPath} is not a hydrated GLB`);
	}
	return assetPaths;
}

async function main() {
	const assetPaths = assertHydratedGlbs();
	const playwright = loadPlaywright();
	if (!playwright) throw new Error('Playwright is required for shipped Three.js proof');
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const server = await startStaticServer();
	const { port } = server.address();
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
		const pageErrors = [];
		const consoleErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error.message || error)));
		page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
		await page.goto(`http://127.0.0.1:${port}/scripts/village-architecture-harness.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });

		const result = await page.evaluate(async () => {
			const THREE = await import('three');
			const { AssetLoader } = await import('/src/3d/assetLoader.js');
			const { analyzeMaterialSurfaces, autoAssignMaterials } = await import('/src/3d/materials/MaterialAssignmentCore.js');
			const { VILLAGE_ARCHITECTURE_PROFILES, resolveVillageArchitectureProfile, upgradeVillageArchitectureAssets, disposeVillages } = await import('/src/3d/world/villages.js');
			const seatIds = ['berkalp', 'ziya', 'stannis', 'doran', 'robin', 'twin', 'umit'];
			const expectedRegions = ['north', 'fertile', 'maritime', 'arid', 'mountain', 'temperate', 'volcanic'];
			const villageGroup = new THREE.Group();
			villageGroup.name = 'browser-proof-villages';
			villageGroup.userData.villageLandmarkSites = seatIds.flatMap((seatId, seatIndex) => [0, 1].map((assetIndex) => ({
				seatId, assetIndex, x: (seatIndex - 3) * 34 + assetIndex * 12, z: assetIndex === 0 ? -9 : 9,
				yaw: (seatIndex - 3) * 0.18 + assetIndex * 0.11,
				houseIndex: seatIndex * 2 + assetIndex, stepStartIndex: (seatIndex * 2 + assetIndex) * 3, stepCount: 3,
				targetWidthMeters: 7.2 + ((seatIndex + assetIndex) % 3) * 0.7,
				targetDepthMeters: 4.6 + ((seatIndex + assetIndex) % 2) * 0.5,
				targetFootprintMeters: 8.6,
			})));
			const sampleHeightMeters = (x, z) => 120 + x * 0.002 + z * 0.001;
			const loader = new AssetLoader({ events: { emit() {} } });
			const evidence = await upgradeVillageArchitectureAssets({ assetLoader: loader, villageGroup, sampleHeightMeters, seaLevelMeters: 0, roadEdges: [] });
			const successfulSeats = evidence.manifests.map((entry) => entry.seatId);
			const failedSeats = seatIds.filter((seatId) => !successfulSeats.includes(seatId));
			const failureDiagnostics = [];
			for (const seatId of failedSeats) {
				const profile = resolveVillageArchitectureProfile(seatId);
				const source = await loader.loadModel(profile.assetUrl, { fallbackSize: 8 });
				const probe = source.clone(true);
				const before = analyzeMaterialSurfaces(probe);
				const auto = autoAssignMaterials(probe, {
					metadata: { id: `diagnostic-${seatId}`, name: profile.label, category: 'settlement', src: profile.assetUrl },
					paletteId: profile.paletteId, textureSize: 256,
				});
				const after = analyzeMaterialSurfaces(probe);
				failureDiagnostics.push({
					seatId, region: profile.id, assetUrl: profile.assetUrl,
					meshCount: before.meshCount, surfaceCount: before.surfaceCount, uvMeshCount: before.uvMeshCount,
					namedSurfaceCount: before.namedSurfaceCount, autoOk: auto.ok, autoError: auto.error || null,
					afterMeshCount: after.meshCount, afterSurfaceCount: after.surfaceCount,
				});
			}

			const manifestProof = evidence.manifests.map((entry) => ({
				seatId: entry.seatId, assetIndex: entry.assetIndex, region: entry.region, assetUrl: entry.assetUrl, textureSize: entry.textureSize,
				footprint: entry.footprint,
				recipeMode: entry.manifest?.recipe?.mode ?? null,
				basePaletteId: entry.manifest?.recipe?.basePaletteId ?? null,
				layerPalettes: (entry.manifest?.recipe?.layers || []).map((layer) => layer.palette),
				generatedMaterialCount: entry.manifest?.validation?.generatedMaterialCount ?? 0,
				meshCount: entry.manifest?.validation?.meshCount ?? 0,
				surfaceCount: entry.manifest?.validation?.surfaceCount ?? 0,
				paletteIds: [...new Set((entry.manifest?.surfaces || []).map((surface) => surface.paletteId).filter(Boolean))],
				groundingMode: entry.manifest?.placementFootprint?.groundingMode ?? null,
				heightRange: entry.manifest?.placementFootprint?.heightRange ?? null,
				placementSurfaceHeight: entry.manifest?.placementSurface?.height ?? null,
			}));

			const sourceSurfaceProof = (villageGroup.getObjectByName('village-architectural-assets')?.children || []).map((object) => ({
				name: object.name,
				region: object.userData?.architectureRegion ?? null,
				surfaces: analyzeMaterialSurfaces(object).surfaces.map((surface) => {
					const original = surface.mesh?.userData?.originalMaterial;
					const originalMaterials = Array.isArray(original) ? original : [original];
					return {
						key: surface.key,
						meshName: surface.meshName || '',
						originalMaterialName: originalMaterials[surface.materialIndex]?.name || '',
						classifiedSlot: surface.slot || null,
						generatedPaletteId: surface.material?.userData?.paletteId || null,
					};
				}),
			}));

			const lifecycleGroup = new THREE.Group();
			lifecycleGroup.userData.villageLandmarkSites = [{ seatId: 'berkalp', assetIndex: 0, x: 0, z: 0, yaw: 0, houseIndex: 0, stepStartIndex: 0, stepCount: 3, targetWidthMeters: 5.2, targetDepthMeters: 4.4, targetFootprintMeters: 7.2 }];
			let releaseLateLoad;
			let lateGeometryDisposed = false;
			let lateMaterialDisposed = false;
			const lateGeometry = new THREE.BoxGeometry(5, 4, 5);
			const lateMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
			lateGeometry.addEventListener('dispose', () => { lateGeometryDisposed = true; });
			lateMaterial.addEventListener('dispose', () => { lateMaterialDisposed = true; });
			const lateSource = new THREE.Mesh(lateGeometry, lateMaterial);
			const lateLoader = { loadModel: () => new Promise((resolve) => { releaseLateLoad = () => resolve(lateSource); }) };
			const lifecyclePromise = upgradeVillageArchitectureAssets({ assetLoader: lateLoader, villageGroup: lifecycleGroup, sampleHeightMeters: () => 120, seaLevelMeters: 0, roadEdges: [] });
			await Promise.resolve();
			disposeVillages(lifecycleGroup);
			releaseLateLoad();
			const lifecycleEvidence = await lifecyclePromise;

			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0xa8bfd1);
			scene.add(new THREE.HemisphereLight(0xf4f6ff, 0x4d4b3a, 2));
			const sun = new THREE.DirectionalLight(0xffedcf, 3.2); sun.position.set(80, 140, 90); scene.add(sun);
			const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 100), new THREE.MeshStandardMaterial({ color: 0x65784c, roughness: 1 }));
			ground.rotation.x = -Math.PI / 2; ground.position.y = 119.8; scene.add(ground, villageGroup);
			const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
			renderer.setSize(1440, 820, false); renderer.outputColorSpace = THREE.SRGBColorSpace; document.body.appendChild(renderer.domElement);
			const camera = new THREE.PerspectiveCamera(42, 1440 / 820, 0.1, 600); camera.position.set(105, 184, 190); camera.lookAt(0, 124, 0); renderer.render(scene, camera);
			return {
				evidence: { ok: evidence.ok, requestedSiteCount: evidence.requestedSiteCount, upgradedCount: evidence.upgradedCount, missingAssetCount: evidence.missingAssetCount, placementFailureCount: evidence.placementFailureCount, textureSize: evidence.textureSize },
				assetCount: villageGroup.getObjectByName('village-architectural-assets')?.children.length ?? 0,
				regions: seatIds.map((seatId) => resolveVillageArchitectureProfile(seatId)?.id ?? null), expectedRegions,
				profileCount: Object.keys(VILLAGE_ARCHITECTURE_PROFILES).length,
				profileTints: seatIds.map((seatId) => { const p = resolveVillageArchitectureProfile(seatId); return { wall: p?.proceduralWallHex ?? null, roof: p?.proceduralRoofHex ?? null }; }),
				manifestProof, sourceSurfaceProof, failureDiagnostics,
				lifecycle: { disposed: lifecycleEvidence.disposed === true, ok: lifecycleEvidence.ok, upgradedCount: lifecycleEvidence.upgradedCount, lateAssetCount: lifecycleGroup.getObjectByName('village-architectural-assets')?.children.length ?? 0, lateGeometryDisposed, lateMaterialDisposed },
			};
		});

		assert.equal(result.evidence.ok, true, `architecture evidence failed: ${JSON.stringify({ ...result.evidence, successfulSeats: result.manifestProof.map((p) => p.seatId), failureDiagnostics: result.failureDiagnostics })}`);
		assert.equal(result.evidence.requestedSiteCount, 14);
		assert.equal(result.evidence.upgradedCount, 14);
		assert.equal(result.evidence.missingAssetCount, 0, 'real GLB load must have missing asset=0');
		assert.equal(result.evidence.placementFailureCount, 0, 'all qualified sites must pass shared placement');
		assert.equal(result.evidence.textureSize, 256);
		assert.equal(result.assetCount, 14);
		assert.deepEqual(result.regions, result.expectedRegions);
		assert.equal(new Set(result.manifestProof.map((proof) => `${proof.seatId}:${proof.assetIndex}`)).size, 14, 'dual residential upgrades need unique site manifests');
		for (const seatId of ['berkalp', 'ziya', 'stannis', 'doran', 'robin', 'twin', 'umit']) {
			const silhouettes = new Set(result.manifestProof.filter((proof) => proof.seatId === seatId).map((proof) => proof.assetUrl));
			assert.equal(silhouettes.size, 2, `${seatId}: dual residential upgrades must use distinct real silhouettes`);
		}
		assert(result.profileCount >= 7);
		assert.equal(new Set(result.profileTints.map((t) => t.wall)).size, 7);
		assert.equal(new Set(result.profileTints.map((t) => t.roof)).size, 7);
		assert.equal(result.sourceSurfaceProof.length, 14, 'source surface evidence must cover every hydrated house');
		assert(result.sourceSurfaceProof.every((entry) => entry.surfaces.length > 0), 'source surface evidence must expose every house mesh/material family');
		assert.equal(result.lifecycle.disposed, true);
		assert.equal(result.lifecycle.ok, false);
		assert.equal(result.lifecycle.upgradedCount, 0);
		assert.equal(result.lifecycle.lateAssetCount, 0);
		assert.equal(result.lifecycle.lateGeometryDisposed, true);
		assert.equal(result.lifecycle.lateMaterialDisposed, true);
		for (const proof of result.manifestProof) {
			assert(proof.generatedMaterialCount > 0, `${proof.region}: no generated PBR material`);
			assert(proof.meshCount > 0 && proof.surfaceCount > 0, `${proof.region}: no renderable surfaces`);
			assert.equal(proof.textureSize, 256, `${proof.region}: wrong texture size`);
			assert(['embedded-low-side', 'terrain-conform'].includes(proof.groundingMode), `${proof.region}: footprint grounding missing`);
			assert(Number.isFinite(proof.heightRange) && proof.heightRange < 0.25, `${proof.region}: excessive synthetic height range`);
			assert(Number.isFinite(proof.placementSurfaceHeight), `${proof.region}: placement surface missing`);
			const footprint = proof.footprint;
			assert(footprint && ['targetWidth', 'targetDepth', 'fittedWidth', 'fittedDepth'].every((key) => Number.isFinite(footprint[key])), `${proof.region}: parcel footprint evidence missing`);
			assert(footprint.fittedWidth <= footprint.targetWidth + 1e-6, `${proof.region}: GLB overflows procedural parcel width`);
			assert(footprint.fittedDepth <= footprint.targetDepth + 1e-6, `${proof.region}: GLB overflows procedural parcel depth`);
			const fittedAxisRatio = Math.max(footprint.fittedWidth / footprint.targetWidth, footprint.fittedDepth / footprint.targetDepth);
			assert(fittedAxisRatio >= 0.999 && fittedAxisRatio <= 1.000001, `${proof.region}: uniform GLB fit must touch one parcel axis without overflow`);
			if (proof.recipeMode === 'layers') assert(proof.layerPalettes.length >= 3, `${proof.region}: layered fallback too shallow`);
			else {
				assert.equal(proof.recipeMode, 'auto', `${proof.region}: unexpected material recipe mode`);
				assert(proof.basePaletteId, `${proof.region}: auto material palette missing from manifest recipe`);
			}
		}
		assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
		assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(' | ')}`);
		await page.screenshot({ path: path.join(ARTIFACT_DIR, 'regional-village-assets.png'), fullPage: true });
		console.log('VILLAGE_ARCHITECTURE_ASSET_PASS', JSON.stringify({ assets: assetPaths.length, ...result.evidence, regions: result.regions, proof: result.manifestProof, sourceSurfaceProof: result.sourceSurfaceProof, pageErrors: pageErrors.length, consoleErrors: consoleErrors.length }));
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[checkVillageArchitectureAssets] FAIL', error);
	process.exit(1);
});
