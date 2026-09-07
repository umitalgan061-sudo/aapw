#!/usr/bin/env node
/**
 * Acceptance suite for biomeAssetPlacementPlanner.js.
 *
 * This suite deliberately uses a synthetic, deterministic terrain sampler so that the placement
 * planner can be tested as a pure policy layer. Browser rendering, Three.js geometry and real GLB
 * hydration belong to their existing dedicated contracts. Here we lock the seams that matter for
 * geographic realism: road/seat/water/slope exclusions, spacing, density changes, stable families,
 * seeded scale/yaw, and a clean separation between asset selection and physics authority.
 */

import assert from 'node:assert/strict';
import {
	BIOME_ASSET_PLACEMENT_POLICY,
	createBiomeAssetPlacementPlan,
	createRegionalArchitectureRing,
	createRegionalRockField,
	createRegionalSceneryRing,
	deterministicPlacementDigest,
	estimateTargetCount,
	resolvePlacementSurfaceVariant,
	summarizeRegionalAssetFamilies,
	validatePlacementPlan,
} from '../src/3d/world/biomeAssetPlacementPlanner.js';
import { BIOME_ASSET_PROFILES, resolveBiomeAssetDistribution } from '../src/3d/world/biomeAssetDistribution.js';

const BOUNDS = Object.freeze({ minX: 0, maxX: 1536, minY: 0, maxY: 1024 });
const SEA_LEVEL = 6;
const BASE_HEIGHT = 20;

function terrainHeight(x, z) {
	const hill = Math.sin(x * 0.003) * 6;
	const ridge = Math.cos(z * 0.0024) * 4;
	const diagonal = Math.sin((x + z) * 0.0016) * 3;
	return BASE_HEIGHT + hill + ridge + diagonal;
}

function flatHeight() {
	return 20;
}

function steepHeight(x, z) {
	return 20 + x * 2.2 + Math.sin(z * 0.05);
}

function basinHeight() {
	return 2;
}

function assertFinitePlan(plan) {
	assert.equal(plan.policyId, BIOME_ASSET_PLACEMENT_POLICY.id);
	assert.equal(Number.isFinite(plan.densityPerKm2), true);
	assert.equal(Number.isFinite(plan.targetCount), true);
	assert.equal(Number.isFinite(plan.placedCount), true);
	assert.equal(Array.isArray(plan.placements), true);
}

function assertNoRoadViolations(plan, roadEdges, minimum) {
	for (const placement of plan.placements) {
		assert.ok(placement.roadDistance >= minimum, `road exclusion violation at ${placement.x},${placement.z}`);
	}
}

function assertNoSeatViolations(plan, seats, minimum) {
	for (const placement of plan.placements) {
		for (const seat of seats) assert.ok(Math.hypot(placement.x - seat.x, placement.z - seat.z) >= minimum, `seat exclusion violation at ${placement.x},${placement.z}`);
	}
}

function assertSpacing(plan, minimum) {
	for (let i = 0; i < plan.placements.length; i += 1) {
		for (let j = 0; j < i; j += 1) {
			const distance = Math.hypot(plan.placements[i].x - plan.placements[j].x, plan.placements[i].z - plan.placements[j].z);
			assert.ok(distance + 1e-9 >= minimum, `spacing violation ${distance} < ${minimum}`);
		}
	}
}

function buildOptions(overrides = {}) {
	return {
		normalizedX: 0.5,
		normalizedY: 0.5,
		worldX: 480,
		worldZ: -360,
		seed: 0xCAFE1234,
		category: 'vegetation',
		sampleHeightMeters: terrainHeight,
		seaLevelMeters: SEA_LEVEL,
		seats: [],
		roadEdges: [],
		radiusMeters: 240,
		baseDensityPerKm2: 36,
		sampleOffsetMeters: 2,
		sampleCount: 28,
		minSpacingMeters: 5,
		minSeatDistanceMeters: 20,
		minRoadDistanceMeters: 10,
		...overrides,
	};
}

function checkPolicy() {
	assert.equal(BIOME_ASSET_PLACEMENT_POLICY.renderOnly, true);
	assert.equal(BIOME_ASSET_PLACEMENT_POLICY.maxSlopeDegrees, 45);
	assert.equal(BIOME_ASSET_PLACEMENT_POLICY.waterBufferMeters, 1.5);
	assert.equal(BIOME_ASSET_PLACEMENT_POLICY.roadBufferMeters, 10);
	assert.equal(BIOME_ASSET_PLACEMENT_POLICY.seatBufferMeters, 90);
	assert.equal(BIOME_ASSET_PLACEMENT_POLICY.referenceCanvas.mapCanvasWidthUnits, 9000);
	assert.equal(BIOME_ASSET_PLACEMENT_POLICY.referenceCanvas.mapCanvasHeightUnits, 7000);
}

function checkBasicPlan() {
	const plan = createBiomeAssetPlacementPlan(buildOptions());
	assertFinitePlan(plan);
	assert.equal(plan.category, 'vegetation');
	assert.ok(plan.distribution.profileId);
	assert.ok(plan.distribution.landCover.primary);
	assert.ok(plan.targetCount >= plan.placedCount);
	assertSpacing(plan, 5);
	const validation = validatePlacementPlan(plan);
	assert.equal(validation.ok, true, validation.errors.join('\n'));
	return plan;
}

function checkDeterminism() {
	const options = buildOptions({ seed: 'determinism', radiusMeters: 280, sampleCount: 40 });
	const first = createBiomeAssetPlacementPlan(options);
	const second = createBiomeAssetPlacementPlan(options);
	assert.deepEqual(second, first);
	assert.equal(deterministicPlacementDigest(second), deterministicPlacementDigest(first));
	const changedSeed = createBiomeAssetPlacementPlan({ ...options, seed: 'determinism-other' });
	assert.notEqual(deterministicPlacementDigest(changedSeed), deterministicPlacementDigest(first));
}

function checkRoadExclusion() {
	const roadEdges = [{ points: [{ x: 100, z: -250 }, { x: 100, z: 250 }] }];
	const plan = createBiomeAssetPlacementPlan(buildOptions({
		worldX: 0,
		worldZ: 0,
		radiusMeters: 350,
		roadEdges,
		minRoadDistanceMeters: 16,
		seed: 'road-exclusion',
	}));
	assertFinitePlan(plan);
	assertNoRoadViolations(plan, roadEdges, 16);
}

function checkSeatExclusion() {
	const seats = [{ x: 40, z: -30 }, { x: 220, z: 180 }];
	const plan = createBiomeAssetPlacementPlan(buildOptions({
		worldX: 120,
		worldZ: 100,
		radiusMeters: 420,
		seats,
		minSeatDistanceMeters: 125,
		seed: 'seat-exclusion',
	}));
	assertFinitePlan(plan);
	assertNoSeatViolations(plan, seats, 125);
}

function checkWaterFailClosed() {
	const plan = createBiomeAssetPlacementPlan(buildOptions({
		sampleHeightMeters: basinHeight,
		radiusMeters: 120,
		seed: 'water-fail-closed',
	}));
	assert.equal(plan.placedCount, 0);
	assert.ok(plan.targetCount >= 0);
	assert.equal(validatePlacementPlan(plan).ok, true);
}

function checkSteepFailClosed() {
	const plan = createBiomeAssetPlacementPlan(buildOptions({
		sampleHeightMeters: steepHeight,
		worldX: 10,
		worldZ: 10,
		radiusMeters: 90,
		sampleOffsetMeters: 1,
		seed: 'steep-fail-closed',
	}));
	for (const placement of plan.placements) assert.ok(placement.slopeDegrees <= 45);
	assert.equal(validatePlacementPlan(plan).ok, true);
}

function checkCandidateBudget() {
	for (const sampleCount of [0, 1, 4, 12, 24, 64, 256, 999]) {
		const plan = createBiomeAssetPlacementPlan(buildOptions({ sampleCount, seed: `budget:${sampleCount}` }));
		assertFinitePlan(plan);
		assert.ok(plan.placements.length <= 256);
		assert.equal(validatePlacementPlan(plan).ok, true);
	}
}

function checkRadiusBudget() {
	for (const radiusMeters of [-10, 0, 20, 120, 600, 2400, 9000]) {
		const plan = createBiomeAssetPlacementPlan(buildOptions({ radiusMeters, seed: `radius:${radiusMeters}` }));
		assertFinitePlan(plan);
		assert.ok(Math.hypot(...[plan.worldOrigin.x, plan.worldOrigin.z]) >= 0);
		for (const placement of plan.placements) {
			assert.ok(Math.hypot(placement.x - plan.worldOrigin.x, placement.z - plan.worldOrigin.z) <= 260.001);
		}
	}
}

function checkFamilyOutput() {
	const profiles = ['snow', 'coldGrassland', 'marsh', 'mountain', 'rockyHills', 'lush', 'desert', 'steppe', 'arid', 'coast', 'temperate', 'jungle', 'aridSteppe', 'valyria'];
	for (const profileId of profiles) {
		const profile = BIOME_ASSET_PROFILES[profileId];
		assert.ok(profile);
		assert.ok(profile.scatter.length >= 3);
		assert.ok(profile.geology.length >= 3);
		assert.ok(profile.architecture.length >= 1);
		const point = {
			snow: [0.145, 0.115],
			coldGrassland: [0.175, 0.285],
			marsh: [0.185, 0.445],
			mountain: [0.245, 0.445],
			rockyHills: [0.135, 0.505],
			lush: [0.155, 0.585],
			desert: [0.180, 0.665],
			steppe: [0.545, 0.535],
			arid: [0.660, 0.680],
			coast: [0.330, 0.455],
			temperate: [0.50, 0.50],
			jungle: [0.555, 0.900],
			aridSteppe: [0.925, 0.555],
			valyria: [0.830, 0.860],
		}[profileId];
		assert.ok(point);
		const distribution = resolveBiomeAssetDistribution(point[0], point[1], `profile:${profileId}`, { sampleCount: 3 });
		assert.equal(typeof distribution.profileId, 'string');
		assert.ok(distribution.scatter.length <= 3);
	}
}

function checkRegionalFactories() {
	const base = {
		worldX: 0,
		worldZ: 0,
		normalizedX: 0.5,
		normalizedY: 0.5,
		seed: 1234,
		sampleHeightMeters: flatHeight,
		seaLevelMeters: 6,
		seats: [],
		roadEdges: [],
		radiusMeters: 220,
	};
	const scenery = createRegionalSceneryRing(base);
	const rocks = createRegionalRockField(base);
	const architecture = createRegionalArchitectureRing(base);
	for (const plan of [scenery, rocks, architecture]) {
		assertFinitePlan(plan);
		assert.equal(validatePlacementPlan(plan).ok, true);
		assert.equal(typeof deterministicPlacementDigest(plan), 'string');
		assert.equal(deterministicPlacementDigest(plan).length, 8);
	}
	assert.equal(scenery.category, 'vegetation');
	assert.equal(rocks.category, 'geology');
	assert.equal(architecture.category, 'architecture');
}

function checkSummaries() {
	const plan = checkBasicPlan();
	const summary = summarizeRegionalAssetFamilies(plan);
	assert.ok(Array.isArray(summary));
	const total = summary.reduce((sum, row) => sum + row.count, 0);
	assert.equal(total, plan.placements.length);
	for (const row of summary) {
		assert.ok(row.family);
		assert.ok(row.count > 0);
	}
}

function checkTargetEstimate() {
	const lush = estimateTargetCount({ profileId: 'lush', normalizedX: 0.155, normalizedY: 0.585, baseDensityPerKm2: 60, radiusMeters: 300 });
	const desert = estimateTargetCount({ profileId: 'desert', normalizedX: 0.180, normalizedY: 0.665, baseDensityPerKm2: 60, radiusMeters: 300 });
	assert.ok(lush >= desert, `expected lush density >= desert, got ${lush} vs ${desert}`);
	assert.equal(estimateTargetCount({ profileId: 'does-not-exist', normalizedX: 0.5, normalizedY: 0.5, baseDensityPerKm2: 50 }), 0);
}

function checkSurfaceVariants() {
	const contexts = [
		resolveBiomeAssetDistribution(0.145, 0.115, 'surface-snow'),
		resolveBiomeAssetDistribution(0.180, 0.665, 'surface-desert'),
		resolveBiomeAssetDistribution(0.555, 0.900, 'surface-jungle'),
	];
	for (const context of contexts) {
		const dry = resolvePlacementSurfaceVariant(context, { waterDepth: 0, slopeDegrees: 2 });
		assert.ok(dry.surface);
		assert.ok(dry.material);
		const wet = resolvePlacementSurfaceVariant(context, { waterDepth: 1, slopeDegrees: 2 });
		assert.equal(wet.surface, 'wet-edge');
		const steep = resolvePlacementSurfaceVariant(context, { waterDepth: 0, slopeDegrees: 35 });
		assert.ok(steep.surface === 'exposed-rock' || steep.surface === 'default');
	}
}

function checkInputValidation() {
	assert.throws(() => createBiomeAssetPlacementPlan(buildOptions({ sampleHeightMeters: null })), /sampleHeightMeters is required/);
	assert.throws(() => createBiomeAssetPlacementPlan(buildOptions({ normalizedX: -1 })), /normalized map coordinates must be in/);
	assert.throws(() => createBiomeAssetPlacementPlan(buildOptions({ normalizedY: 2 })), /normalized map coordinates must be in/);
	assert.throws(() => createBiomeAssetPlacementPlan(buildOptions({ sampleCount: 'many' })), /finite/);
}

function checkSpacingAndFamilyDiversity() {
	const seeds = ['a', 'b', 'c', 'd', 'e', 'f'];
	const familyDigests = new Set();
	for (const seed of seeds) {
		const plan = createBiomeAssetPlacementPlan(buildOptions({ seed, sampleCount: 32, radiusMeters: 500 }));
		assertSpacing(plan, 5);
		familyDigests.add(summarizeRegionalAssetFamilies(plan).map((row) => row.family).join('|'));
	}
	assert.ok(familyDigests.size >= 2, `seed family diversity collapsed to ${familyDigests.size} variants`);
}

function checkArchitectureUsesNamedRealCandidates() {
	for (const profileId of Object.keys(BIOME_ASSET_PROFILES)) {
		const profile = BIOME_ASSET_PROFILES[profileId];
		for (const candidate of profile.architecture) {
			assert.match(candidate.asset, /^assets\/models\/settlements\//);
			assert.match(candidate.asset, /\.(glb|fbx)$/);
			assert.ok(candidate.role);
			assert.ok(candidate.weight > 0);
		}
	}
}

function checkClimateDensityDirection() {
	const lushDistribution = resolveBiomeAssetDistribution(0.155, 0.585, 'climate-direction');
	const jungleDistribution = resolveBiomeAssetDistribution(0.555, 0.900, 'climate-direction');
	const desertDistribution = resolveBiomeAssetDistribution(0.180, 0.665, 'climate-direction');
	assert.ok(jungleDistribution.densityMultiplier > desertDistribution.densityMultiplier);
	assert.ok(lushDistribution.densityMultiplier > desertDistribution.densityMultiplier);
	assert.ok(jungleDistribution.scatter.some((item) => ['broadleaf-tall', 'broadleaf-round', 'palm', 'fern-clump'].includes(item.family)));
}

function checkNoGameplayFields() {
	const plan = checkBasicPlan();
	for (const placement of plan.placements) {
		assert.equal('health' in placement, false);
		assert.equal('damage' in placement, false);
		assert.equal('faction' in placement, false);
		assert.equal('quest' in placement, false);
		assert.equal('collider' in placement, false);
	}
}

function run() {
	checkPolicy();
	checkBasicPlan();
	checkDeterminism();
	checkRoadExclusion();
	checkSeatExclusion();
	checkWaterFailClosed();
	checkSteepFailClosed();
	checkCandidateBudget();
	checkRadiusBudget();
	checkFamilyOutput();
	checkRegionalFactories();
	checkSummaries();
	checkTargetEstimate();
	checkSurfaceVariants();
	checkInputValidation();
	checkSpacingAndFamilyDiversity();
	checkArchitectureUsesNamedRealCandidates();
	checkClimateDensityDirection();
	checkNoGameplayFields();
	const sample = createBiomeAssetPlacementPlan(buildOptions({ normalizedX: 0.555, normalizedY: 0.900, seed: 'final-report', sampleCount: 20, radiusMeters: 300 }));
	const report = {
		ok: true,
		policyId: BIOME_ASSET_PLACEMENT_POLICY.id,
		profileId: sample.profileId,
		densityPerKm2: sample.densityPerKm2,
		targetCount: sample.targetCount,
		placedCount: sample.placedCount,
		placementRatio: sample.placementRatio,
		familySummary: summarizeRegionalAssetFamilies(sample),
		digest: deterministicPlacementDigest(sample),
	};
	console.log(JSON.stringify(report, null, 2));
	console.log('BIOME_ASSET_PLACEMENT_PLANNER_OK');
}

run();
