#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	BIOME_SURFACE_FABRIC_POLICY,
	auditBiomeSurfaceFabricCatalog,
	buildSharedMaterialSemanticManifest,
	compareBiomeSurfaceRecipes,
	listSurfaceSignalFamilies,
	resolveAssetFamilySurfaceFabric,
	resolveAssetWeathering,
	resolveBiomeSurfaceFabric,
	resolveSurfaceForSlopeAndWater,
	surfaceFabricDigest,
	validateBiomeSurfaceFabric,
} from '../src/3d/materials/biomeSurfaceFabric.js';
import { BIOME_ASSET_PROFILES } from '../src/3d/world/biomeAssetDistribution.js';

function checkPolicy() {
	assert.equal(BIOME_SURFACE_FABRIC_POLICY.textureSize, 256);
	assert.equal(BIOME_SURFACE_FABRIC_POLICY.deterministic, true);
	assert.equal(BIOME_SURFACE_FABRIC_POLICY.sharedMaterialCoreRequired, true);
	assert.equal(BIOME_SURFACE_FABRIC_POLICY.editorRuntimeAllowed, false);
}

function checkAllProfiles() {
	for (const profileId of Object.keys(BIOME_ASSET_PROFILES)) {
		for (const role of ['ground', 'rock', 'wood', 'metal']) {
			const recipe = resolveBiomeSurfaceFabric(profileId, role);
			const validation = validateBiomeSurfaceFabric(recipe);
			assert.equal(validation.ok, true, `${profileId}/${role}: ${validation.errors.join(',')}`);
			assert.equal(recipe.profileId, profileId);
			assert.equal(recipe.role, role);
			assert.ok(recipe.baseColor.startsWith('#'));
			assert.ok(Number.isFinite(recipe.roughness));
			assert.ok(Number.isFinite(recipe.normalStrength));
			assert.ok(Number.isFinite(recipe.dirtAmount));
			assert.ok(Number.isFinite(recipe.wetnessAmount));
			assert.ok(Number.isFinite(recipe.snowAmount));
		}
	}
}

function checkRegionalContrast() {
	const snow = resolveBiomeSurfaceFabric('snow', 'ground');
	const desert = resolveBiomeSurfaceFabric('desert', 'ground');
	const jungle = resolveBiomeSurfaceFabric('jungle', 'ground');
	assert.notEqual(snow.baseColor, desert.baseColor);
	assert.notEqual(desert.baseColor, jungle.baseColor);
	assert.notEqual(snow.wetnessAmount, desert.wetnessAmount);
	assert.notEqual(snow.snowAmount, jungle.snowAmount);
	assert.ok(jungle.wetnessAmount > desert.wetnessAmount);
}

function checkRockWoodMetalRoles() {
	for (const profileId of ['snow', 'mountain', 'lush', 'desert', 'jungle', 'valyria']) {
		const rock = resolveBiomeSurfaceFabric(profileId, 'rock');
		const wood = resolveBiomeSurfaceFabric(profileId, 'wood');
		const metal = resolveBiomeSurfaceFabric(profileId, 'metal');
		assert.equal(rock.role, 'rock');
		assert.equal(wood.role, 'wood');
		assert.equal(metal.role, 'metal');
		assert.ok(rock.normalStrength >= wood.normalStrength * 0.7);
		assert.ok(metal.roughness <= 0.98);
	}
}

function checkFamilyMapping() {
	const mappings = [
		['snow-pine', 'wood'],
		['oak', 'wood'],
		['palm', 'wood'],
		['reed-clump', 'wood'],
		['snow-rock', 'rock'],
		['basalt-boulder', 'rock'],
		['granite-outcrop', 'rock'],
		['dry-shrub', 'ground'],
		['sand-rock', 'rock'],
	];
	for (const [family, expectedRole] of mappings) {
		const recipe = resolveAssetFamilySurfaceFabric('temperate', family);
		assert.equal(recipe.semanticRole, expectedRole, `${family} was classified as ${recipe.semanticRole}`);
	}
}

function checkWeatheringDirection() {
	const jungle = resolveAssetWeathering('jungle', 'broadleaf-tall');
	const desert = resolveAssetWeathering('desert', 'dry-shrub');
	const snow = resolveAssetWeathering('snow', 'snow-pine');
	assert.ok(jungle.rain > desert.rain);
	assert.ok(jungle.wetness > desert.wetness);
	assert.ok(desert.dust > jungle.dust);
	assert.ok(snow.snow > desert.snow);
}

function checkSlopeExposure() {
	const flat = resolveSurfaceForSlopeAndWater('temperate', 'ground', { slopeDegrees: 0 });
	const steep = resolveSurfaceForSlopeAndWater('temperate', 'ground', { slopeDegrees: 42 });
	assert.ok(steep.weathering.exposure > flat.weathering.exposure);
	assert.ok(steep.dirtAmount >= flat.dirtAmount);
	const nearWater = resolveSurfaceForSlopeAndWater('temperate', 'ground', { waterDistanceMeters: 2 });
	assert.ok(nearWater.wetnessAmount >= flat.wetnessAmount);
}

function checkManifest() {
	const manifest = buildSharedMaterialSemanticManifest({
		assetId: 'test-asset',
		assetFamily: 'oak',
		profileId: 'lush',
		surfaces: ['ground', 'wood', 'metal'],
	});
	assert.equal(manifest.sharedMaterialCoreRequired, true);
	assert.equal(manifest.editorRuntimeImportAllowed, false);
	assert.equal(manifest.surfaces.length, 3);
	assert.equal(manifest.assetId, 'test-asset');
	assert.equal(manifest.assetFamily, 'oak');
}

function checkDigests() {
	const first = surfaceFabricDigest(resolveBiomeSurfaceFabric('lush', 'wood'));
	const second = surfaceFabricDigest(resolveBiomeSurfaceFabric('lush', 'wood'));
	const third = surfaceFabricDigest(resolveBiomeSurfaceFabric('desert', 'wood'));
	assert.equal(first, second);
	assert.notEqual(first, third);
	assert.match(first, /^[0-9a-f]{8}$/);
}

function checkCatalog() {
	const audit = auditBiomeSurfaceFabricCatalog();
	assert.equal(audit.ok, true, audit.errors.join('\n'));
	assert.equal(audit.profilesChecked, Object.keys(BIOME_ASSET_PROFILES).length);
	assert.ok(audit.surfaceSignals >= 20);
	const signals = listSurfaceSignalFamilies();
	assert.ok(signals.includes('snow-cold'));
	assert.ok(signals.includes('basalt-wet'));
	assert.ok(signals.includes('humid-green'));
}

function checkNoEditorRuntimePath() {
	const recipe = resolveBiomeSurfaceFabric('snow', 'rock');
	assert.equal(recipe.generatedLayers.includes('EditorMaterialStudio'), false);
	const manifest = buildSharedMaterialSemanticManifest({ assetId: 'a', assetFamily: 'b', profileId: 'snow' });
	assert.equal(manifest.editorRuntimeImportAllowed, false);
}

function run() {
	checkPolicy();
	checkAllProfiles();
	checkRegionalContrast();
	checkRockWoodMetalRoles();
	checkFamilyMapping();
	checkWeatheringDirection();
	checkSlopeExposure();
	checkManifest();
	checkDigests();
	checkCatalog();
	checkNoEditorRuntimePath();
	const report = {
		ok: true,
		policyId: BIOME_SURFACE_FABRIC_POLICY.id,
		profilesChecked: Object.keys(BIOME_ASSET_PROFILES).length,
		signalsChecked: listSurfaceSignalFamilies().length,
	};
	console.log(JSON.stringify(report, null, 2));
	console.log('BIOME_SURFACE_FABRIC_OK');
}

run();
