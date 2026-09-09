#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BIOME_ASSET_DISTRIBUTION_POLICY } from '../src/3d/world/biomeAssetDistribution.js';
import { BIOME_ASSET_PLACEMENT_POLICY } from '../src/3d/world/biomeAssetPlacementPlanner.js';
import { BIOME_SURFACE_FABRIC_POLICY } from '../src/3d/materials/biomeSurfaceFabric.js';

const FILES = Object.freeze([
	'src/3d/world/biomeAssetDistribution.js',
	'src/3d/world/biomeAssetPlacementPlanner.js',
	'src/3d/materials/biomeSurfaceFabric.js',
]);

function read(path) {
	return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function checkPolicies() {
	assert.equal(BIOME_ASSET_DISTRIBUTION_POLICY.deterministic, true);
	assert.equal(BIOME_ASSET_PLACEMENT_POLICY.renderOnly, true);
	assert.equal(BIOME_SURFACE_FABRIC_POLICY.sharedMaterialCoreRequired, true);
	assert.equal(BIOME_SURFACE_FABRIC_POLICY.editorRuntimeAllowed, false);
}

function checkNoEditorImports() {
	for (const path of FILES) {
		const source = read(path);
		assert.equal(/EditorMaterialStudio/.test(source), false, `editor material UI leaked into ${path}`);
	}
}

function checkNoThreeImport() {
	for (const path of ['src/3d/world/biomeAssetDistribution.js', 'src/3d/world/biomeAssetPlacementPlanner.js', 'src/3d/materials/biomeSurfaceFabric.js']) {
		const source = read(path);
		assert.equal(/from ['"]three['"]/.test(source), false, `${path} should remain DOM/geometry agnostic`);
	}
}

function checkNoSecondMaterialKeywordSurface() {
	const source = read('src/3d/materials/biomeSurfaceFabric.js');
	assert.equal(/new\s+Mesh(Standard|Physical|Basic)Material/.test(source), false);
	assert.equal(/onBeforeCompile/.test(source), false);
	assert.equal(/ShaderMaterial/.test(source), false);
}

function checkPlannerDoesNotOwnPhysics() {
	const source = read('src/3d/world/biomeAssetPlacementPlanner.js');
	for (const forbidden of ['createCollider', 'Raycaster', 'PhysicsBody', 'collisionResponse', 'applyGravity']) {
		assert.equal(source.includes(forbidden), false, `planner owns forbidden gameplay/physics symbol ${forbidden}`);
	}
}

function checkDistributionDoesNotOwnPlacement() {
	const source = read('src/3d/world/biomeAssetDistribution.js');
	for (const forbidden of ['Object3D', 'MeshStandardMaterial', 'InstancedMesh', 'createCollider', 'addToScene']) {
		assert.equal(source.includes(forbidden), false, `distribution policy owns forbidden render/placement symbol ${forbidden}`);
	}
}

function checkSurfaceDoesNotOwnAssetLoading() {
	const source = read('src/3d/materials/biomeSurfaceFabric.js');
	for (const forbidden of ['AssetLoader', 'GLTFLoader', 'FBXLoader', 'fetch(', 'XMLHttpRequest']) {
		assert.equal(source.includes(forbidden), false, `surface fabric owns forbidden asset-loading mechanism ${forbidden}`);
	}
}

function checkSharedContractMentions() {
	const planner = read('src/3d/world/biomeAssetPlacementPlanner.js');
	const surface = read('src/3d/materials/biomeSurfaceFabric.js');
	assert.ok(planner.includes('WorldAssetPlacementPipeline'));
	assert.ok(surface.includes('MaterialAssignmentCore'));
	assert.ok(surface.includes('second material'));
}

function run() {
	checkPolicies();
	checkNoEditorImports();
	checkNoThreeImport();
	checkNoSecondMaterialKeywordSurface();
	checkPlannerDoesNotOwnPhysics();
	checkDistributionDoesNotOwnPlacement();
	checkSurfaceDoesNotOwnAssetLoading();
	checkSharedContractMentions();
	console.log(JSON.stringify({
		ok: true,
		policyIds: {
			distribution: BIOME_ASSET_DISTRIBUTION_POLICY.id,
			placement: BIOME_ASSET_PLACEMENT_POLICY.id,
			surface: BIOME_SURFACE_FABRIC_POLICY.id,
		},
		filesChecked: FILES.length,
	}));
	console.log('BIOME_DISTRIBUTION_SINGLE_AUTHORITY_OK');
}

run();
