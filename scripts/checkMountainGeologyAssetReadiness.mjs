#!/usr/bin/env node
import assert from 'node:assert/strict';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const playwright = loadPlaywright();
if (!playwright) {
	console.error('[checkMountainGeologyAssetReadiness] Playwright unavailable');
	process.exit(2);
}

const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const errors = [];
	page.on('pageerror', (error) => errors.push(String(error)));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	await page.goto(`${server.baseUrl}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, {
		waitUntil: 'load',
		timeout: 90_000,
	});

	const reports = await page.evaluate(async () => {
		const base = document.createElement('base');
		base.href = '/';
		document.head.prepend(base);
		const importMap = document.createElement('script');
		importMap.type = 'importmap';
		importMap.textContent = JSON.stringify({ imports: {
			three: '/src/3d/vendor/three/three.module.js',
			'three/addons/': '/src/3d/vendor/three/addons/',
		} });
		document.head.append(importMap);

		const [{ GLTFLoader }, materialCore] = await Promise.all([
			import('/src/3d/vendor/three/addons/loaders/GLTFLoader.js'),
			import('/src/3d/materials/MaterialAssignmentCore.js'),
		]);
		const {
			analyzeMaterialSurfaces,
			validateMaterialAssignment,
			createMaterialManifest,
		} = materialCore;
		const loader = new GLTFLoader();
		const assets = [
			{ id: 'rocky-terrain', src: '/assets/models/fbx/rocky_terrain_low_poly.glb', category: 'geology' },
			{ id: 'desert-rocks', src: '/assets/models/fbx/desert_rocks.glb', category: 'geology' },
		];
		const output = [];
		for (const asset of assets) {
			const gltf = await loader.loadAsync(asset.src);
			const root = gltf.scene;
			root.userData.assetId = asset.id;
			root.userData.assetCategory = asset.category;
			root.userData.assetSrc = asset.src;
			const analysis = analyzeMaterialSurfaces(root);
			const validation = validateMaterialAssignment(root);
			const manifest = createMaterialManifest(root, { metadata: asset });
			let pbrMaterialCount = 0;
			let texturedMaterialCount = 0;
			let normalMappedMaterialCount = 0;
			let namedMaterialCount = 0;
			for (const surface of analysis.surfaces) {
				const material = surface.material;
				if (!material) continue;
				if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) pbrMaterialCount += 1;
				if (material.map || material.aoMap || material.roughnessMap || material.metalnessMap) texturedMaterialCount += 1;
				if (material.normalMap || material.bumpMap) normalMappedMaterialCount += 1;
				if (material.name) namedMaterialCount += 1;
			}
			output.push({
				...asset,
				meshCount: analysis.meshCount,
				surfaceCount: analysis.surfaceCount,
				uvMeshCount: analysis.uvMeshCount,
				placeholder: analysis.placeholder,
				pbrMaterialCount,
				texturedMaterialCount,
				normalMappedMaterialCount,
				namedMaterialCount,
				validation: {
					ok: validation.ok,
					errors: validation.errors,
					warnings: validation.warnings,
					materialSlotCount: validation.materialSlotCount,
					generatedMaterialCount: validation.generatedMaterialCount,
				},
				manifestSurfaceCount: manifest.surfaces.length,
				manifestRecipe: manifest.recipe,
			});
		}
		return output;
	});

	assert.equal(errors.length, 0, `geology asset browser errors: ${errors.join(' | ')}`);
	assert.equal(reports.length, 2, 'expected both hydrated geology GLBs');
	let totalMeshes = 0;
	let totalSurfaces = 0;
	let totalPbr = 0;
	for (const report of reports) {
		assert(report.meshCount > 0, `${report.id}: no renderable meshes`);
		assert(report.surfaceCount > 0, `${report.id}: no material surfaces`);
		assert(report.uvMeshCount > 0, `${report.id}: no UV-bearing meshes for authored material response`);
		assert.equal(report.placeholder, false, `${report.id}: geology asset is marked placeholder`);
		assert.equal(report.validation.ok, true, `${report.id}: shared material validation failed: ${report.validation.errors.join(',')}`);
		assert(report.validation.materialSlotCount > 0, `${report.id}: no material slots`);
		assert(report.pbrMaterialCount > 0, `${report.id}: no standard/physical PBR materials survived GLB import`);
		assert.equal(report.manifestSurfaceCount, report.surfaceCount, `${report.id}: material manifest lost surfaces`);
		assert.equal(report.manifestRecipe, null, `${report.id}: readiness audit unexpectedly rewrote original materials`);
		assert.equal(report.validation.generatedMaterialCount, 0,
			`${report.id}: readiness audit must preserve source materials rather than auto-dressing them`);
		totalMeshes += report.meshCount;
		totalSurfaces += report.surfaceCount;
		totalPbr += report.pbrMaterialCount;
	}
	assert(totalMeshes >= 2 && totalSurfaces >= 2 && totalPbr >= 2,
		'hydrated geology asset family lacks usable mesh/material coverage');
	console.log('MOUNTAIN_GEOLOGY_ASSET_READINESS_OK', JSON.stringify({ reports, errors }));
} finally {
	await browser.close();
	await server.stop();
}
