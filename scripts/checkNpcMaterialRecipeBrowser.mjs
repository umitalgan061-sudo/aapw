#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';

const browser = await chromium.launch({ headless: true });
try {
	const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
	const pageErrors = [];
	page.on('pageerror', (error) => pageErrors.push(String(error)));
	const importMap = JSON.stringify({ imports: {
		three: '/src/3d/vendor/three/three.module.js',
		'three/addons/': '/src/3d/vendor/three/addons/',
	} });
	await page.route('**/__npc-material-proof.html', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'text/html; charset=utf-8',
			body: `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">${importMap}</script><script type="module">Promise.all([import('/src/3d/vendor/three/three.module.js'),import('/src/3d/gameplay/npcWorldPlacement.js'),import('/src/3d/materials/MaterialAssignmentCore.js')]).then(([THREE,npcWorldPlacement,materialCore])=>{globalThis.__npcMaterialProofModules={THREE,npcWorldPlacement,materialCore};}).catch((error)=>{globalThis.__npcMaterialProofModuleError=String(error?.stack||error);});</script></head><body></body></html>`,
		});
	});
	await page.goto(`${baseUrl}/__npc-material-proof.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
	await page.waitForFunction(() => globalThis.__npcMaterialProofModules || globalThis.__npcMaterialProofModuleError, null, { timeout: 10000 });
	const moduleBootstrapError = await page.evaluate(() => globalThis.__npcMaterialProofModuleError ?? null);
	assert.equal(moduleBootstrapError, null, `document module bootstrap failed: ${moduleBootstrapError}`);
	const proof = await page.evaluate(async () => {
		const { THREE, npcWorldPlacement, materialCore } = globalThis.__npcMaterialProofModules;
		const {
			createConfiguredNpcMaterialRecipe,
			inspectConfiguredNpcMaterials,
		} = npcWorldPlacement;
		const { applyMaterialRecipe, validateMaterialAssignment } = materialCore;

		function namedGuard() {
			const root = new THREE.Group();
			const parts = [
				['Guard_Skin_Head', 1.72],
				['Guard_Hair', 1.94],
				['Guard_Eyes', 1.78],
				['Guard_Tunic', 1.20],
				['Guard_Trousers', 0.70],
				['Guard_Boots', 0.18],
				['Guard_Belt', 0.98],
				['Guard_Armor', 1.38],
			];
			for (const [name, y] of parts) {
				const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.2), new THREE.MeshStandardMaterial({ roughness: 0.8 }));
				mesh.name = name;
				mesh.position.y = y;
				root.add(mesh);
			}
			return root;
		}

		const spawn = { id: 'recipe-proof-guard', seatId: 'proof-seat', displayName: 'Recipe Proof', modelUrl: 'assets/models/characters/proof.fbx' };
		const geography = { surface: { biome: 'cold-grassland' } };
		const named = namedGuard();
		const namedPlan = createConfiguredNpcMaterialRecipe(named, spawn, geography);
		const namedApplied = applyMaterialRecipe(named, namedPlan.recipe, { metadata: { category: 'soldier', id: spawn.id } });
		const namedValidation = validateMaterialAssignment(named, { requireGeneratedTexture: true });
		const namedPalettes = new Set();
		const namedPbr = {};
		named.traverse((node) => {
			if (!node?.isMesh) return;
			for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
				const paletteId = material?.userData?.paletteId;
				if (!paletteId) continue;
				namedPalettes.add(paletteId);
				const image = material.map?.image ?? material.map?.source?.data ?? null;
				namedPbr[paletteId] = {
					roughness: material.roughness,
					metalness: material.metalness,
					textureWidth: image?.width ?? null,
					textureHeight: image?.height ?? null,
				};
			}
		});

		const single = new THREE.Group();
		const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.5), new THREE.MeshStandardMaterial({ roughness: 0.9 }));
		body.name = 'mesh_0';
		body.geometry.computeBoundingBox();
		single.add(body);
		const layeredPlan = createConfiguredNpcMaterialRecipe(single, { ...spawn, id: 'single-surface-guard' }, { surface: { biome: 'desert' } });
		const layeredApplied = applyMaterialRecipe(single, layeredPlan.recipe, { metadata: { category: 'soldier', id: 'single-surface-guard' } });
		const layeredValidation = validateMaterialAssignment(single, { requireGeneratedTexture: true });
		const layeredMaterial = body.material;
		const bands = (layeredMaterial?.userData?.layeredBands ?? []).map((entry) => entry.palette ?? entry);

		const pbr = new THREE.Group();
		const pbrMaterial = new THREE.MeshStandardMaterial();
		pbrMaterial.map = new THREE.Texture();
		pbrMaterial.normalMap = new THREE.Texture();
		const pbrMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), pbrMaterial);
		pbrMesh.name = 'Imported_Armor';
		pbr.add(pbrMesh);
		const authored = inspectConfiguredNpcMaterials(pbr);

		const mixed = new THREE.Group();
		const mixedSkin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.3), new THREE.MeshStandardMaterial({ roughness: 0.8 }));
		mixedSkin.name = 'Guard_Skin_Head';
		const importedArmor = new THREE.MeshStandardMaterial({ roughness: 0.31, metalness: 0.82 });
		const importedColorMap = new THREE.Texture();
		const importedNormalMap = new THREE.Texture();
		importedArmor.map = importedColorMap;
		importedArmor.normalMap = importedNormalMap;
		const mixedArmor = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.4), importedArmor);
		mixedArmor.name = 'Guard_Armor';
		mixed.add(mixedSkin, mixedArmor);
		const mixedPlan = createConfiguredNpcMaterialRecipe(mixed, { ...spawn, id: 'mixed-authored-guard' }, geography);
		const mixedApplied = applyMaterialRecipe(mixed, mixedPlan.recipe, { metadata: { category: 'soldier', id: 'mixed-authored-guard' } });
		const mixedValidation = validateMaterialAssignment(mixed, { requireGeneratedTexture: true });
		const mixedProof = {
			mode: mixedPlan.mode,
			preservedCount: mixedPlan.preservedHighQualitySurfaceCount ?? 0,
			applied: mixedApplied.ok,
			validation: mixedValidation.ok,
			armorMaterialPreserved: mixedArmor.material === importedArmor,
			armorMapsPreserved: mixedArmor.material.map === importedColorMap && mixedArmor.material.normalMap === importedNormalMap,
			armorPbrPreserved: mixedArmor.material.roughness === 0.31 && mixedArmor.material.metalness === 0.82,
			skinGenerated: mixedSkin.material?.userData?.generatedByTextureFactory === true,
		};

		return {
			named: {
				mode: namedPlan.mode,
				profile: namedPlan.profile,
				overrides: namedPlan.recipe.surfaceOverrides,
				applied: namedApplied,
				validation: namedValidation,
				palettes: [...namedPalettes].sort(),
				pbr: namedPbr,
			},
			layered: {
				mode: layeredPlan.mode,
				profile: layeredPlan.profile,
				layers: layeredPlan.recipe.layers,
				applied: layeredApplied,
				validation: layeredValidation,
				bands,
			},
			authored: {
				meshCount: authored.meshCount,
				authoredTextureSlots: authored.authoredTextureSlots,
				highQualityAuthoredSlots: authored.highQualityAuthoredSlots,
			},
			mixed: mixedProof,
		};
	});

	assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
	assert.equal(proof.named.mode, 'named-parts', `named guard selected ${proof.named.mode}`);
	assert.equal(proof.named.applied.ok, true, `named surface recipe failed: ${JSON.stringify(proof.named.applied)}`);
	assert.equal(proof.named.validation.ok, true, `named material validation failed: errors=${proof.named.validation.errors.join(',')} warnings=${proof.named.validation.warnings.join(',')}`);
	const skinPalette = proof.named.palettes.find((id) => id.startsWith('skin-'));
	assert.ok(skinPalette, `named guard has no skin palette: ${JSON.stringify(proof.named.palettes)}`);
	const hairPalette = proof.named.palettes.find((id) => id.startsWith('hair-'));
	assert.ok(hairPalette, 'named guard has no hair palette');
	const eyePalette = proof.named.palettes.find((id) => id.startsWith('eye-'));
	assert.ok(eyePalette, 'named guard has no eye palette');
	assert.ok(proof.named.palettes.includes('tunic-blue'), `cold-grassland guard did not receive geographic blue tunic: ${JSON.stringify(proof.named.palettes)}`);
	assert.ok(proof.named.palettes.includes('boot'), 'named guard has no separate boot material');
	assert.ok(proof.named.palettes.includes('belt'), 'named guard has no separate belt/gear material');
	assert.ok(proof.named.palettes.includes('steel'), 'named guard has no separate armor material');
	assert.ok(proof.named.palettes.length >= 7, `named guard material distribution collapsed: ${JSON.stringify(proof.named.palettes)}`);

	const skinPbr = proof.named.pbr[skinPalette];
	const eyePbr = proof.named.pbr[eyePalette];
	const tunicPbr = proof.named.pbr['tunic-blue'];
	const steelPbr = proof.named.pbr.steel;
	assert.ok(skinPbr.roughness >= 0.65 && skinPbr.metalness === 0, `skin PBR response is implausible: ${JSON.stringify(skinPbr)}`);
	assert.ok(eyePbr.roughness <= 0.2 && eyePbr.metalness === 0, `eye PBR response is not distinct from cloth/skin: ${JSON.stringify(eyePbr)}`);
	assert.ok(tunicPbr.roughness >= 0.85 && tunicPbr.metalness === 0, `cloth PBR response is implausible: ${JSON.stringify(tunicPbr)}`);
	assert.ok(steelPbr.metalness >= 0.7 && steelPbr.roughness < tunicPbr.roughness, `armor PBR response is not distinct from cloth: ${JSON.stringify(steelPbr)}`);
	for (const paletteId of [skinPalette, hairPalette, eyePalette, 'tunic-blue', 'boot', 'belt', 'steel']) {
		const pbrRecord = proof.named.pbr[paletteId];
		assert.equal(pbrRecord?.textureWidth, 256, `${paletteId} generated texture width is not 256`);
		assert.equal(pbrRecord?.textureHeight, 256, `${paletteId} generated texture height is not 256`);
	}

	assert.equal(proof.layered.mode, 'layered-fallback', `single mesh selected ${proof.layered.mode}`);
	assert.equal(proof.layered.applied.ok, true, `layered recipe failed: ${JSON.stringify(proof.layered.applied)}`);
	assert.equal(proof.layered.validation.ok, true, `layered material validation failed: errors=${proof.layered.validation.errors.join(',')} warnings=${proof.layered.validation.warnings.join(',')}`);
	assert.equal(proof.layered.layers.length, 6, 'single-mesh fallback must have six vertical material bands');
	assert.ok(proof.layered.bands.includes('boot'), 'layered fallback lacks boots');
	assert.ok(proof.layered.bands.includes('trousers-brown'), 'desert layered fallback lacks brown trousers');
	assert.ok(proof.layered.bands.includes('belt'), 'layered fallback lacks belt/gear band');
	assert.ok(proof.layered.bands.includes('tunic-cream'), 'desert layered fallback lacks geographic cream clothing');
	assert.ok(proof.layered.bands.some((id) => id.startsWith('skin-')), 'layered fallback lacks skin band');
	assert.ok(proof.layered.bands.some((id) => id.startsWith('hair-')), 'layered fallback lacks hair band');
	assert.equal(new Set(proof.layered.bands).size, 6, `single mesh collapsed into repeated one-surface material: ${JSON.stringify(proof.layered.bands)}`);

	assert.equal(proof.authored.meshCount, 1);
	assert.equal(proof.authored.authoredTextureSlots, 1, 'authored PBR fixture was not detected');
	assert.equal(proof.authored.highQualityAuthoredSlots, 1, 'multi-map authored PBR quality signal was not detected');
	assert.equal(proof.mixed.mode, 'named-parts-preserve-authored', `mixed guard did not select preserve-capable named mode: ${JSON.stringify(proof.mixed)}`);
	assert.equal(proof.mixed.preservedCount, 1, 'mixed guard did not report one preserved high-quality surface');
	assert.equal(proof.mixed.applied, true, 'mixed guard surface recipe failed');
	assert.equal(proof.mixed.validation, true, 'mixed guard failed generated+authored validation');
	assert.equal(proof.mixed.armorMaterialPreserved, true, 'high-quality imported armor material object was replaced');
	assert.equal(proof.mixed.armorMapsPreserved, true, 'high-quality imported armor texture maps were replaced');
	assert.equal(proof.mixed.armorPbrPreserved, true, 'high-quality imported armor PBR response was replaced');
	assert.equal(proof.mixed.skinGenerated, true, 'low-quality skin surface was not dressed through shared palette material');
	console.log('NPC_MATERIAL_RECIPE_BROWSER_PASS', JSON.stringify(proof));
} finally {
	await browser.close();
}