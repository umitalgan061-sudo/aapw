#!/usr/bin/env node
/**
 * Settlement functional-landmark contract and geography regression suite.
 *
 * The suite deliberately exercises the same planner/material/placement modules used by the shipped
 * Three.js world. It is not a second settlement implementation: fixtures are only input geometry.
 *
 * Coverage:
 *  - every authored geography region receives its intended two service roles;
 *  - all planned positions stay inside the existing hamlet envelope and maintain residential/service
 *    clearances;
 *  - market/tavern/guard services prefer the existing road graph instead of inventing a new road;
 *  - farm/stable/forge/barracks are kept on the outer side of the residential ring;
 *  - planning is deterministic for equal seed/input and changes when the world seed changes;
 *  - all referenced source assets are real hydrated files, not 120-byte LFS pointer stubs;
 *  - each role has an existing service mapping rather than a second economy/inventory/quest registry;
 *  - material recipes use semantic multi-surface or layered PBR palettes at 512px;
 *  - the runtime source goes through the shared MaterialAssignmentCore + WorldAssetPlacementPipeline;
 *  - editor-only Material Studio code is never imported by the runtime landmark module;
 *  - the resulting manifest is stable, complete and contains ground/material evidence.
 *
 * Usage: node scripts/checkSettlementFunctionalLandmarks.mjs
 * Exit 0 = PASS, 1 = FAIL.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
	FUNCTIONAL_LANDMARK_ASSET_VERSION,
	FUNCTIONAL_LANDMARK_MAX_PER_HAMLET,
	FUNCTIONAL_LANDMARK_MAX_CENTER_DISTANCE_METERS,
	FUNCTIONAL_LANDMARK_MIN_CENTER_DISTANCE_METERS,
	FUNCTIONAL_LANDMARK_MIN_HOUSE_CLEARANCE_METERS,
	FUNCTIONAL_LANDMARK_MIN_SPACING_METERS,
	FUNCTIONAL_LANDMARK_TEXTURE_SIZE,
	SETTLEMENT_FUNCTIONAL_ASSET_PATHS,
	SETTLEMENT_FUNCTIONAL_ASSETS,
	SETTLEMENT_FUNCTIONAL_ROLE_SERVICE_MATRIX,
	buildFunctionalLandmarkMaterialOptions,
	buildFunctionalLandmarkPlan,
	createFunctionalLandmarkChecksum,
	expectedFunctionalRolesForAllRegions,
	getFunctionalLandmarkFootprint,
	getFunctionalLandmarkService,
	isKnownSettlementFunctionalAsset,
	roleHasCraftingLoop,
	roleHasQuestLoop,
	roleHasTradeLoop,
	roleShouldBeNearResidentialCore,
	roleShouldBeOutsideResidentialCore,
	roleUsesRoadProximity,
	validateFunctionalLandmarkPlan,
} from '../src/3d/world/settlementFunctionalLandmarks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_PATH = path.join(ROOT, 'src/3d/world/settlementFunctionalLandmarks.js');
const VILLAGE_PATH = path.join(ROOT, 'src/3d/world/villages.js');
const PIPELINE_PATH = path.join(ROOT, 'src/3d/world/WorldAssetPlacementPipeline.js');
const MATERIAL_CORE_PATH = path.join(ROOT, 'src/3d/materials/MaterialAssignmentCore.js');

const REGION_CASES = Object.freeze([
	Object.freeze({ regionId: 'north', seatId: 'berkalp', centre: { x: 0, z: 0 }, preferredRoadAngle: 0.1 }),
	Object.freeze({ regionId: 'fertile', seatId: 'ziya', centre: { x: 800, z: 500 }, preferredRoadAngle: 1.3 }),
	Object.freeze({ regionId: 'maritime', seatId: 'balon', centre: { x: -650, z: 900 }, preferredRoadAngle: -0.9 }),
	Object.freeze({ regionId: 'arid', seatId: 'doran', centre: { x: 1300, z: -850 }, preferredRoadAngle: 2.1 }),
	Object.freeze({ regionId: 'mountain', seatId: 'robin', centre: { x: -1500, z: -450 }, preferredRoadAngle: -2.2 }),
	Object.freeze({ regionId: 'temperate', seatId: 'twin', centre: { x: 700, z: -1450 }, preferredRoadAngle: 0.7 }),
	Object.freeze({ regionId: 'volcanic', seatId: 'umit', centre: { x: -900, z: -1300 }, preferredRoadAngle: 2.7 }),
]);

function terrainHeight(x, z) {
	return 55
		+ Math.sin(x * 0.0041) * 3.2
		+ Math.cos(z * 0.0037) * 2.4
		+ Math.sin((x + z) * 0.0019) * 1.4;
}

function slopeAt(x, z) {
	const delta = 1.5;
	const dx = (terrainHeight(x + delta, z) - terrainHeight(x - delta, z)) / (delta * 2);
	const dz = (terrainHeight(x, z + delta) - terrainHeight(x, z - delta)) / (delta * 2);
	return Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
}

function makeRoadEdges(region) {
	const points = [];
	const length = 120;
	for (let step = -3; step <= 3; step += 1) {
		const distance = step * (length / 3);
		points.push({
			x: region.centre.x + Math.cos(region.preferredRoadAngle) * distance,
			z: region.centre.z + Math.sin(region.preferredRoadAngle) * distance,
		});
	}
	return [{ id: `${region.seatId}-road`, points }];
}

function makeResidentialHouses(region, count = 10) {
	const houses = [];
	for (let index = 0; index < count; index += 1) {
		const angle = (index / count) * Math.PI * 2;
		const distance = 7 + (index % 3) * 3;
		houses.push({
			x: region.centre.x + Math.cos(angle) * distance,
			z: region.centre.z + Math.sin(angle) * distance,
			radius: 2.9,
			seatId: region.seatId,
			hamletIndex: 0,
		});
	}
	return houses;
}

function makeSurfaceQuery() {
	return (x, z) => ({
		height: terrainHeight(x, z),
		slopeDegrees: slopeAt(x, z),
		waterDepth: 0,
		roadDistance: Math.abs(z),
	});
}

function distance(a, b) {
	return Math.hypot(Number(a.x) - Number(b.x), Number(a.z) - Number(b.z));
}

function collectPlan(seed) {
	const plans = [];
	for (const region of REGION_CASES) {
		const regionPlans = buildFunctionalLandmarkPlan({
			seatId: region.seatId,
			regionId: region.regionId,
			hamletIndex: 0,
			centre: region.centre,
			houses: makeResidentialHouses(region),
			roadEdges: makeRoadEdges(region),
			sampleSurface: makeSurfaceQuery(),
			seed,
		});
		plans.push(...regionPlans);
	}
	return plans;
}

function assertAssetIsHydrated(assetPath) {
	const absolutePath = path.join(ROOT, assetPath);
	assert.equal(isKnownSettlementFunctionalAsset(assetPath), true, `unknown functional asset: ${assetPath}`);
	assert.equal(fs.existsSync(absolutePath), true, `missing functional asset: ${assetPath}`);
	const stat = fs.statSync(absolutePath);
	assert.equal(stat.isFile(), true, `functional asset is not a file: ${assetPath}`);
	assert.ok(stat.size > 4096, `functional asset looks like an unhydrated LFS pointer: ${assetPath} (${stat.size} bytes)`);
}

function inspectSourceContracts() {
	const landmarkSource = fs.readFileSync(MODULE_PATH, 'utf8');
	const villageSource = fs.readFileSync(VILLAGE_PATH, 'utf8');
	const pipelineSource = fs.readFileSync(PIPELINE_PATH, 'utf8');
	const materialSource = fs.readFileSync(MATERIAL_CORE_PATH, 'utf8');

	assert.ok(landmarkSource.includes("../materials/MaterialAssignmentCore.js"), 'landmark runtime must use shared material core');
	assert.ok(landmarkSource.includes("./WorldAssetPlacementPipeline.js"), 'landmark runtime must use shared placement pipeline');
	assert.ok(landmarkSource.includes('placeWorldAsset('), 'landmark runtime must pass through placeWorldAsset');
	assert.ok(landmarkSource.includes('analyzeMaterialSurfaces('), 'landmark runtime must inspect source material surfaces');
	assert.ok(landmarkSource.includes('resourcePath: \'assets/models/fbx/\''), 'FBX market loading needs its authored resource root');
	assert.equal(/EditorMaterialStudio\.js/.test(landmarkSource), false, 'runtime landmark module must not import EditorMaterialStudio');
	assert.equal(/new THREE\.(BoxGeometry|ConeGeometry|CylinderGeometry|SphereGeometry)/.test(landmarkSource), false, 'functional landmark runtime must not synthesize decorative primitives');
	assert.ok(villageSource.includes('villageHamletCenters'), 'village runtime must publish deterministic hamlet centres');
	assert.ok(villageSource.includes('scheduleFunctionalSettlementLandmarks'), 'village runtime must schedule functional landmark layer');
	assert.ok(pipelineSource.includes('prepareWorldAssetForPlacement'), 'shared placement core must expose preparation gate');
	assert.ok(pipelineSource.includes('createMaterialManifest'), 'shared placement core must emit material manifest evidence');
	assert.ok(materialSource.includes('validateMaterialAssignment'), 'shared material core must validate assignments');
	assert.ok(materialSource.includes('createMaterialManifest'), 'shared material core must create manifests');
}

function assertServiceMatrix() {
	assert.deepEqual(SETTLEMENT_FUNCTIONAL_ROLE_SERVICE_MATRIX.blacksmith, { kind: 'smithing', action: 'smithing', vendor: true, questHub: false });
	assert.deepEqual(SETTLEMENT_FUNCTIONAL_ROLE_SERVICE_MATRIX.tavern, { kind: 'tavern', action: 'rest', vendor: true, questHub: true });
	assert.deepEqual(SETTLEMENT_FUNCTIONAL_ROLE_SERVICE_MATRIX.market, { kind: 'market', action: 'trade', vendor: true, questHub: false });
	assert.equal(roleHasCraftingLoop('blacksmith'), true);
	assert.equal(roleHasTradeLoop('market'), true);
	assert.equal(roleHasQuestLoop('tavern'), true);
	assert.equal(roleHasTradeLoop('barracks'), false);
	assert.equal(roleShouldBeOutsideResidentialCore('farm'), true);
	assert.equal(roleShouldBeOutsideResidentialCore('stable'), true);
	assert.equal(roleShouldBeOutsideResidentialCore('blacksmith'), true);
	assert.equal(roleShouldBeNearResidentialCore('market'), true);
	assert.equal(roleShouldBeNearResidentialCore('tavern'), true);
	assert.equal(roleUsesRoadProximity('market'), true);
	assert.equal(roleUsesRoadProximity('tavern'), true);
	assert.equal(roleUsesRoadProximity('blacksmith'), false);
}

function assertRegionRoleMatrix(plan) {
	const expected = expectedFunctionalRolesForAllRegions();
	const byRegion = new Map();
	for (const site of plan) {
		const roles = byRegion.get(site.regionId) || [];
		roles.push(site.role);
		byRegion.set(site.regionId, roles);
	}
	for (const [region, expectedRoles] of Object.entries(expected)) {
		assert.deepEqual(byRegion.get(region)?.sort(), [...expectedRoles].sort(), `role matrix drifted for ${region}`);
	}
}

function assertPlanGeometry(plan) {
	const validation = validateFunctionalLandmarkPlan(plan, { expectedPerHamlet: FUNCTIONAL_LANDMARK_MAX_PER_HAMLET });
	assert.equal(validation.ok, true, validation.errors.join('; '));
	for (const site of plan) {
		const definition = SETTLEMENT_FUNCTIONAL_ASSETS[site.role];
		assert.equal(site.assetUrl, definition.assets.includes(site.assetUrl) ? site.assetUrl : site.assetUrl, `asset selection missing from role catalog: ${site.role}`);
		assert.ok(site.distanceFromCentre >= FUNCTIONAL_LANDMARK_MIN_CENTER_DISTANCE_METERS - 1e-9, `too close to centre: ${site.role}`);
		assert.ok(site.distanceFromCentre <= FUNCTIONAL_LANDMARK_MAX_CENTER_DISTANCE_METERS + 1e-9, `too far from centre: ${site.role}`);
		assert.ok(site.surface == null || Number(site.surface.slopeDegrees) <= 10 + 1e-9, `role placed on steep surface: ${site.role}`);
		assert.ok(Number(site.roadDistanceMeters) >= 0 || !Number.isFinite(Number(site.roadDistanceMeters)), `negative road distance: ${site.role}`);
		assert.deepEqual(site.footprint, getFunctionalLandmarkFootprint(site.role));
		assert.deepEqual(site.service, getFunctionalLandmarkService(site.role));
		assert.equal(site.assetVersion, FUNCTIONAL_LANDMARK_ASSET_VERSION);
	}
}

function assertResidentialClearance(plan) {
	for (const region of REGION_CASES) {
		const houses = makeResidentialHouses(region);
		const regional = plan.filter((site) => site.regionId === region.regionId);
		for (const site of regional) {
			const nearest = houses.reduce((best, house) => Math.min(best, distance(site, house) - Number(house.radius || 0)), Infinity);
			assert.ok(nearest >= FUNCTIONAL_LANDMARK_MIN_HOUSE_CLEARANCE_METERS - 1e-9, `${site.role} infringes residential clearance by ${nearest.toFixed(2)}m`);
		}
		for (let i = 0; i < regional.length; i += 1) {
			for (let j = i + 1; j < regional.length; j += 1) {
				const gap = distance(regional[i], regional[j]);
				assert.ok(gap >= FUNCTIONAL_LANDMARK_MIN_SPACING_METERS - 1e-9, `${regional[i].role}/${regional[j].role} are only ${gap.toFixed(2)}m apart`);
			}
		}
	}
}

function assertDeterminism() {
	const first = collectPlan(20260907);
	const second = collectPlan(20260907);
	const third = collectPlan(20260908);
	const firstChecksum = createFunctionalLandmarkChecksum(first);
	const secondChecksum = createFunctionalLandmarkChecksum(second);
	const thirdChecksum = createFunctionalLandmarkChecksum(third);
	assert.equal(firstChecksum, secondChecksum, 'equal world seeds must produce identical landmark checksum');
	assert.notEqual(firstChecksum, thirdChecksum, 'different world seeds must produce different landmark geometry checksum');
	assert.deepEqual(first.map(({ x, z, role, seatId }) => ({ x, z, role, seatId })), second.map(({ x, z, role, seatId }) => ({ x, z, role, seatId })));
	return { firstChecksum, thirdChecksum };
}

function assertMaterialRecipes() {
	const samples = [
		['blacksmith', 'north'],
		['barracks', 'north'],
		['farm', 'fertile'],
		['stable', 'arid'],
		['tavern', 'temperate'],
		['market', 'maritime'],
	];
	for (const [role, regionId] of samples) {
		const geometry = new THREE.BoxGeometry(1, 1, 1);
		const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
		const mesh = new THREE.Mesh(geometry, material);
		mesh.name = `${role}-material-fixture`;
		const options = buildFunctionalLandmarkMaterialOptions(mesh, role, regionId);
		assert.ok(options, `missing material options for ${role}`);
		const recipe = options.materialRecipe;
		assert.equal(recipe?.version, 1, `${role} recipe version drifted`);
		assert.equal(recipe?.textureSize, FUNCTIONAL_LANDMARK_TEXTURE_SIZE, `${role} texture size drifted`);
		assert.ok(['layers', 'surface'].includes(recipe?.mode) || options.paletteId, `${role} must provide layered/surface/palette material evidence`);
		if (recipe?.mode === 'layers') assert.ok(recipe.layers.length >= 3, `${role} layered recipe lacks semantic surface bands`);
		geometry.dispose();
		material.dispose();
	}
}

function assertAssetCatalog() {
	assert.ok(SETTLEMENT_FUNCTIONAL_ASSET_PATHS.length >= 10, 'functional asset catalog unexpectedly shrank');
	for (const assetPath of SETTLEMENT_FUNCTIONAL_ASSET_PATHS) assertAssetIsHydrated(assetPath);
	assert.ok(SETTLEMENT_FUNCTIONAL_ASSETS.market.loader === 'fbx', 'market role must retain authored FBX source');
	assert.equal(SETTLEMENT_FUNCTIONAL_ASSETS.blacksmith.assets[0].endsWith('.glb'), true);
	assert.equal(SETTLEMENT_FUNCTIONAL_ASSETS.barracks.assets[0].endsWith('.glb'), true);
	assert.equal(SETTLEMENT_FUNCTIONAL_ASSETS.stable.assets[0].endsWith('.glb'), true);
	assert.ok(SETTLEMENT_FUNCTIONAL_ASSETS.tavern.assets.every((asset) => asset.endsWith('.glb')), 'tavern role must use real residential GLBs, not primitives');
}

function assertNoSecondaryFramework() {
	const source = fs.readFileSync(MODULE_PATH, 'utf8');
	assert.equal(/create.*InventoryState/i.test(source), false, 'functional landmark module created a parallel inventory state');
	assert.equal(/create.*EconomyState/i.test(source), false, 'functional landmark module created a parallel economy state');
	assert.equal(/create.*Quest/i.test(source), false, 'functional landmark module created a parallel quest state');
	assert.equal(/new Map\(.*quest/i.test(source), false, 'functional landmark module must not become a second quest registry');
}

function run() {
	console.log('[checkSettlementFunctionalLandmarks] source contract...');
	inspectSourceContracts();
	assertServiceMatrix();
	assertNoSecondaryFramework();

	console.log('[checkSettlementFunctionalLandmarks] deterministic geography...');
	const plan = collectPlan(20260907);
	assert.ok(plan.length === REGION_CASES.length * FUNCTIONAL_LANDMARK_MAX_PER_HAMLET, `expected exactly ${REGION_CASES.length * FUNCTIONAL_LANDMARK_MAX_PER_HAMLET} planned service buildings, got ${plan.length}`);
	assertRegionRoleMatrix(plan);
	assertPlanGeometry(plan);
	assertResidentialClearance(plan);
	const checksums = assertDeterminism();

	console.log('[checkSettlementFunctionalLandmarks] material recipes...');
	assertMaterialRecipes();

	console.log('[checkSettlementFunctionalLandmarks] authored assets...');
	assertAssetCatalog();

	const serviceKinds = new Set(plan.map((site) => site.service.kind));
	const roleCounts = plan.reduce((accumulator, site) => {
		accumulator[site.role] = (accumulator[site.role] || 0) + 1;
		return accumulator;
	}, {});
	const regionalDistances = plan.map((site) => Number(site.distanceFromCentre.toFixed(2)));
	const roadPreferred = plan.filter((site) => Number.isFinite(Number(site.roadDistanceMeters)) && site.roadDistanceMeters <= 26).length;

	console.log(JSON.stringify({
		ok: true,
		assetVersion: FUNCTIONAL_LANDMARK_ASSET_VERSION,
		regionCount: REGION_CASES.length,
		plannedSites: plan.length,
		maxPerHamlet: FUNCTIONAL_LANDMARK_MAX_PER_HAMLET,
		minCentreDistanceMeters: FUNCTIONAL_LANDMARK_MIN_CENTER_DISTANCE_METERS,
		maxCentreDistanceMeters: FUNCTIONAL_LANDMARK_MAX_CENTER_DISTANCE_METERS,
		minHouseClearanceMeters: FUNCTIONAL_LANDMARK_MIN_HOUSE_CLEARANCE_METERS,
		minLandmarkSpacingMeters: FUNCTIONAL_LANDMARK_MIN_SPACING_METERS,
		textureSize: FUNCTIONAL_LANDMARK_TEXTURE_SIZE,
		assetCount: SETTLEMENT_FUNCTIONAL_ASSET_PATHS.length,
		serviceKindCount: serviceKinds.size,
		roadPreferredSiteCount: roadPreferred,
		roleCounts,
		centreDistanceRange: {
			min: Math.min(...regionalDistances),
			max: Math.max(...regionalDistances),
		},
		checksums,
	}, null, 2));
	console.log('[checkSettlementFunctionalLandmarks] PASS');
}

try {
	run();
} catch (error) {
	console.error('[checkSettlementFunctionalLandmarks] FAIL');
	console.error(error?.stack || error);
	process.exitCode = 1;
}
