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
	await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
	const proof = await page.evaluate(async () => {
		const THREE = await import('/vendor/three.module.js');
		const {
			createConfiguredNpcMaterialRecipe,
			inspectConfiguredNpcMaterials,
		} = await import('/src/3d/gameplay/npcWorldPlacement.js');
		const { applyMaterialRecipe, validateMaterialAssignment } = await import('/src/3d/materials/MaterialAssignmentCore.js');

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
		named.traverse((node) => {
			if (!node?.isMesh) return;
			for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
				if (material?.userData?.paletteId) namedPalettes.add(material.userData.paletteId);
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

		return {
			named: {
				mode: namedPlan.mode,
				profile: namedPlan.profile,
				overrides: namedPlan.recipe.surfaceOverrides,
				applied: namedApplied,
				validation: namedValidation,
				palettes: [...namedPalettes].sort(),
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
		};
	});

	assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
	assert.equal(proof.named.mode, 'named-parts', `named guard selected ${proof.named.mode}`);
	assert.equal(proof.named.applied.ok, true, `named surface recipe failed: ${JSON.stringify(proof.named.applied)}`);
	assert.equal(proof.named.validation.ok, true, `named material validation failed: ${JSON.stringify(proof.named.validation)}`);
	for (const expected of ['skin-fair', 'skin-olive', 'skin-brown', 'skin-deep']) {
		if (proof.named.palettes.includes(expected)) break;
		if (expected === 'skin-deep') assert.fail(`named guard has no skin palette: ${JSON.stringify(proof.named.palettes)}`);
	}
	assert.ok(proof.named.palettes.includes('hair-black') || proof.named.palettes.includes('hair-blonde') || proof.named.palettes.includes('hair-red'), 'named guard has no hair palette');
	assert.ok(proof.named.palettes.some((id) => id.startsWith('eye-')), 'named guard has no eye palette');
	assert.ok(proof.named.palettes.includes('tunic-blue'), `cold-grassland guard did not receive geographic blue tunic: ${JSON.stringify(proof.named.palettes)}`);
	assert.ok(proof.named.palettes.includes('boot'), 'named guard has no separate boot material');
	assert.ok(proof.named.palettes.includes('belt'), 'named guard has no separate belt/gear material');
	assert.ok(proof.named.palettes.includes('steel'), 'named guard has no separate armor material');
	assert.ok(proof.named.palettes.length >= 7, `named guard material distribution collapsed: ${JSON.stringify(proof.named.palettes)}`);

	assert.equal(proof.layered.mode, 'layered-fallback', `single mesh selected ${proof.layered.mode}`);
	assert.equal(proof.layered.applied.ok, true, `layered recipe failed: ${JSON.stringify(proof.layered.applied)}`);
	assert.equal(proof.layered.validation.ok, true, `layered validation failed: ${JSON.stringify(proof.layered.validation)}`);
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
	console.log('NPC_MATERIAL_RECIPE_BROWSER_PASS', JSON.stringify(proof));
} finally {
	await browser.close();
}
