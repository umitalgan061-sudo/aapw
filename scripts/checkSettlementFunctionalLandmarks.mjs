#!/usr/bin/env node
/**
 * Static contract gate for settlement functional landmarks.
 *
 * Runtime geometry/material behaviour is exercised by checkSettlementFunctionalLandmarksBrowser.mjs
 * in a real Chromium page. This Node-only companion intentionally depends on no npm package because
 * aapw is a package-less repo and all Three.js runtime imports belong in the browser graph.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LANDMARK = path.join(ROOT, 'src/3d/world/settlementFunctionalLandmarks.js');
const VILLAGES = path.join(ROOT, 'src/3d/world/villages.js');
const PIPELINE = path.join(ROOT, 'src/3d/world/WorldAssetPlacementPipeline.js');
const MATERIAL = path.join(ROOT, 'src/3d/materials/MaterialAssignmentCore.js');

const REQUIRED_ASSET_PATHS = Object.freeze([
	'assets/models/settlements/blacksmith_bV52eTG1Aj.glb',
	'assets/models/settlements/barracks_UXCOwRBSxx.glb',
	'assets/models/settlements/barn_0QTh_KUZRYE.glb',
	'assets/models/settlements/barn_A6UkPq33aZ.glb',
	'assets/models/settlements/barn_dSsUaUlaxHk.glb',
	'assets/models/settlements/barn_vSqQNA7ez6.glb',
	'assets/models/settlements/big_barn_q1N3xn2SpC.glb',
	'assets/models/settlements/fantasy_house_dcPho4SUA3.glb',
	'assets/models/settlements/small_wooden_house.glb',
	'assets/models/fbx/Medieval_Market_.fbx',
	'assets/models/fbx/Medieval_Market_Asset_Pack.fbx',
]);

const EXPECTED_ROLES = Object.freeze(['blacksmith', 'barracks', 'farm', 'stable', 'tavern', 'market']);
const EXPECTED_REGIONS = Object.freeze(['north', 'fertile', 'maritime', 'arid', 'mountain', 'temperate', 'volcanic']);

function read(file) {
	return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function checkFiles() {
	for (const file of [LANDMARK, VILLAGES, PIPELINE, MATERIAL]) assert(fs.existsSync(file), `missing required source: ${path.relative(ROOT, file)}`);
	for (const asset of REQUIRED_ASSET_PATHS) {
		const file = path.join(ROOT, asset);
		assert(fs.existsSync(file), `missing functional source asset: ${asset}`);
		const stat = fs.statSync(file);
		assert(stat.isFile(), `functional asset is not a regular file: ${asset}`);
		assert(stat.size > 4096, `functional asset is still an LFS pointer: ${asset} (${stat.size} bytes)`);
	}
}

function checkRuntimeBoundaries() {
	const landmark = read(LANDMARK);
	const villages = read(VILLAGES);
	const pipeline = read(PIPELINE);
	const material = read(MATERIAL);

	assert(landmark.includes("from '../materials/MaterialAssignmentCore.js'"), 'landmark module bypasses shared material core');
	assert(landmark.includes("from './WorldAssetPlacementPipeline.js'"), 'landmark module bypasses shared placement pipeline');
	assert(landmark.includes('analyzeMaterialSurfaces'), 'landmark module does not inspect imported material surfaces');
	assert(landmark.includes('placeWorldAsset'), 'landmark module does not use shared placement entrypoint');
	assert(landmark.includes('textureSize: FUNCTIONAL_LANDMARK_TEXTURE_SIZE'), 'landmark module does not preserve its texture-size evidence');
	assert(!landmark.includes('EditorMaterialStudio.js'), 'EditorMaterialStudio must never enter runtime imports');
	assert(!/new THREE\.(BoxGeometry|ConeGeometry|CylinderGeometry|SphereGeometry)\b/.test(landmark), 'functional landmark layer must not synthesize primitive decoration');
	assert(villages.includes("./settlementFunctionalLandmarks.js"), 'villages runtime is not wired to functional landmark layer');
	assert(villages.includes('villageHamletCenters'), 'villages runtime does not expose deterministic hamlet centres');
	assert(villages.includes('villageHouses'), 'villages runtime does not expose house clearance inputs');
	assert(pipeline.includes('prepareWorldAssetForPlacement'), 'placement pipeline entrypoint drifted');
	assert(pipeline.includes('createMaterialManifest'), 'placement manifest evidence disappeared');
	assert(material.includes('validateMaterialAssignment'), 'material validation disappeared');
	assert(material.includes('createMaterialManifest'), 'material manifest creator disappeared');
}

function checkRoleCatalog() {
	const source = read(LANDMARK);
	for (const role of EXPECTED_ROLES) assert(source.includes(`role: '${role}'`), `missing role catalog entry: ${role}`);
	for (const region of EXPECTED_REGIONS) assert(new RegExp(`\\b${region}: Object\\.freeze\\(\\[`).test(source), `missing geographic role profile: ${region}`);
	assert(source.includes('FUNCTIONAL_LANDMARK_MIN_HOUSE_CLEARANCE_METERS'), 'residential clearance policy disappeared');
	assert(source.includes('FUNCTIONAL_LANDMARK_MIN_SPACING_METERS'), 'functional spacing policy disappeared');
	assert(source.includes('FUNCTIONAL_LANDMARK_MAX_CENTER_DISTANCE_METERS'), 'hamlet envelope policy disappeared');
	assert(source.includes('assetVersion: FUNCTIONAL_LANDMARK_ASSET_VERSION'), 'asset provenance version missing from plans');
}

function checkNoParallelSystems() {
	const source = read(LANDMARK);
	assert(!/createInteractionInventoryState|createInteractionEconomyState|createQuestTracker/.test(source), 'functional landmarks introduced a second RPG state system');
	assert(!/INTERACTION_QUESTS|EXPEDITION_BOARD_ROUTES/.test(source), 'functional landmarks copied quest definitions instead of emitting service metadata');
}

function main() {
	checkFiles();
	checkRuntimeBoundaries();
	checkRoleCatalog();
	checkNoParallelSystems();
	console.log(JSON.stringify({ ok: true, roleCount: EXPECTED_ROLES.length, regionCount: EXPECTED_REGIONS.length, assetCount: REQUIRED_ASSET_PATHS.length, textureSize: 512, maxLandmarksPerHamlet: 2 }, null, 2));
	console.log('[checkSettlementFunctionalLandmarks] PASS');
}

try {
	main();
} catch (error) {
	console.error('[checkSettlementFunctionalLandmarks] FAIL');
	console.error(error?.stack || error);
	process.exitCode = 1;
}
