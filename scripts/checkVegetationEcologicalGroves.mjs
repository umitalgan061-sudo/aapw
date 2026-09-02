#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	VEGETATION_SPATIAL_PATTERN_POLICY,
	createVegetation,
	disposeVegetation,
	pickTemperateSpeciesIndexForHabitat,
	vegetationGrovePatternForClimate,
	vegetationSpeciesId,
} from '../src/3d/world/vegetation.js';
import { resolveTerrainForestSuitability } from '../src/3d/world/terrainBiomeShading.js';

const RADIUS_METERS = 1500;
const DENSITY_PER_KM2 = 30;
const GRID_CELL_METERS = 300;
const SEED = 0x47524f56;
const SETTLEMENT_RADIUS_METERS = 900;
const SPECIES_ROLL_SAMPLES = 1000;

function collectTreePositions(group) {
	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const quaternion = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const points = [];
	for (const mesh of group.children) {
		if (!mesh?.isInstancedMesh || !mesh.name.endsWith('-trunks')) continue;
		for (let index = 0; index < mesh.count; index += 1) {
			mesh.getMatrixAt(index, matrix);
			matrix.decompose(position, quaternion, scale);
			points.push([position.x, position.z]);
		}
	}
	return points;
}

function gridStats(points) {
	const cellsPerAxis = Math.ceil((RADIUS_METERS * 2) / GRID_CELL_METERS);
	const counts = new Array(cellsPerAxis * cellsPerAxis).fill(0);
	for (const [x, z] of points) {
		const column = Math.max(0, Math.min(cellsPerAxis - 1, Math.floor((x + RADIUS_METERS) / GRID_CELL_METERS)));
		const row = Math.max(0, Math.min(cellsPerAxis - 1, Math.floor((z + RADIUS_METERS) / GRID_CELL_METERS)));
		counts[row * cellsPerAxis + column] += 1;
	}
	const mean = counts.reduce((sum, value) => sum + value, 0) / counts.length;
	const variance = counts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / counts.length;
	return {
		coefficientOfVariation: Math.sqrt(variance) / mean,
		emptyCellFraction: counts.filter((value) => value === 0).length / counts.length,
		maxCellCount: Math.max(...counts),
	};
}

function meanNearestNeighbourMeters(points) {
	let sum = 0;
	for (let index = 0; index < points.length; index += 1) {
		let nearest = Infinity;
		for (let other = 0; other < points.length; other += 1) {
			if (index === other) continue;
			const dx = points[index][0] - points[other][0];
			const dz = points[index][1] - points[other][1];
			nearest = Math.min(nearest, Math.hypot(dx, dz));
		}
		sum += nearest;
	}
	return sum / points.length;
}

function angularPocketStats(points, centerX = 0, centerZ = 0, sectorCount = 16) {
	const counts = new Array(sectorCount).fill(0);
	const distances = [];
	for (const [x, z] of points) {
		const dx = x - centerX;
		const dz = z - centerZ;
		const angle = (Math.atan2(dz, dx) + Math.PI * 2) % (Math.PI * 2);
		const sector = Math.min(sectorCount - 1, Math.floor((angle / (Math.PI * 2)) * sectorCount));
		counts[sector] += 1;
		distances.push(Math.hypot(dx, dz));
	}
	return {
		counts,
		occupiedSectors: counts.filter((value) => value > 0).length,
		emptySectors: counts.filter((value) => value === 0).length,
		maxSectorCount: Math.max(...counts),
		minRadiusMeters: Math.min(...distances),
		maxRadiusMeters: Math.max(...distances),
	};
}

function broadleafCountForSuitability(suitability) {
	let broadleaf = 0;
	for (let index = 0; index < SPECIES_ROLL_SAMPLES; index += 1) {
		const roll = (index + 0.5) / SPECIES_ROLL_SAMPLES;
		const species = vegetationSpeciesId(pickTemperateSpeciesIndexForHabitat(roll, { suitability }));
		if (species === 'round') broadleaf += 1;
		else assert.equal(species, 'pine', 'temperate habitat picker emitted a non-temperate species');
	}
	return broadleaf;
}

function build(seed) {
	return createVegetation({
		sampleHeightMeters: () => 100,
		seaLevelMeters: 0,
		seed,
		seats: [],
		roadEdges: [],
		radiusMeters: RADIUS_METERS,
		densityPerKm2: DENSITY_PER_KM2,
	});
}

function buildSettlement(seed) {
	return createVegetation({
		sampleHeightMeters: () => 100,
		seaLevelMeters: 0,
		seed,
		seats: [{ x: 0, z: 0, id: 'settlement-pocket-fixture' }],
		roadEdges: [],
		radiusMeters: SETTLEMENT_RADIUS_METERS,
		densityPerKm2: 0,
	});
}

assert.equal(VEGETATION_SPATIAL_PATTERN_POLICY.id,
	'vegetation-ecological-grove-scatter-2026-09-01-v4-habitat-species');
assert.equal(VEGETATION_SPATIAL_PATTERN_POLICY.temperateHabitatAuthority,
	'terrainBiomeShading.resolveTerrainForestSuitability');
assert.equal(VEGETATION_SPATIAL_PATTERN_POLICY.temperateSpeciesCompositionAuthority,
	'terrainBiomeShading.resolveTerrainForestSuitability');
assert.equal(VEGETATION_SPATIAL_PATTERN_POLICY.temperateBroadleafSparseHabitatChance, 0.08);
assert.equal(VEGETATION_SPATIAL_PATTERN_POLICY.temperateBroadleafStrongHabitatChance, 0.40);
assert(VEGETATION_SPATIAL_PATTERN_POLICY.groveTreeCountMin >= 7);
assert(VEGETATION_SPATIAL_PATTERN_POLICY.groveTreeCountMax <= 24);
assert(VEGETATION_SPATIAL_PATTERN_POLICY.groveTreeCountMax > VEGETATION_SPATIAL_PATTERN_POLICY.groveTreeCountMin);
assert(VEGETATION_SPATIAL_PATTERN_POLICY.settlementGroveCountMin >= 2);
assert(VEGETATION_SPATIAL_PATTERN_POLICY.settlementGroveCountMax <= 5);
assert(VEGETATION_SPATIAL_PATTERN_POLICY.settlementGroveCountMax > VEGETATION_SPATIAL_PATTERN_POLICY.settlementGroveCountMin);
assert(VEGETATION_SPATIAL_PATTERN_POLICY.settlementGroveCenterMinMeters > 90,
	'settlement woodland centres must remain beyond the canonical seat exclusion');
assert(VEGETATION_SPATIAL_PATTERN_POLICY.settlementGroveCenterMinMeters
	- VEGETATION_SPATIAL_PATTERN_POLICY.settlementGroveRadiusMaxMeters >= 90,
	'settlement woodland lobes must not geometrically force trees through the seat exclusion');
assert(VEGETATION_SPATIAL_PATTERN_POLICY.settlementTreeBudgetMin >= 24
	&& VEGETATION_SPATIAL_PATTERN_POLICY.settlementTreeBudgetMax <= 56,
	'settlement woodland budget must remain near the historical ~40-tree performance envelope');

const sparseBroadleaf = broadleafCountForSuitability(0);
const mixedBroadleaf = broadleafCountForSuitability(0.5);
const strongBroadleaf = broadleafCountForSuitability(1);
assert.equal(sparseBroadleaf, 80, 'sparse habitat must retain only an 8% broadleaf remnant');
assert.equal(mixedBroadleaf, 240, 'mid-strength habitat must interpolate to a 24% broadleaf share');
assert.equal(strongBroadleaf, 400, 'strong forest habitat must preserve the historical 40% broadleaf share');
assert(sparseBroadleaf < mixedBroadleaf && mixedBroadleaf < strongBroadleaf,
	'broadleaf share must increase monotonically with the visible terrain forest habitat');
assert.equal(
	vegetationSpeciesId(pickTemperateSpeciesIndexForHabitat(0.90, { suitability: 0 })),
	'pine',
	'a high roll that becomes broadleaf in strong forest must remain pine in sparse/treeline habitat',
);
assert.equal(
	vegetationSpeciesId(pickTemperateSpeciesIndexForHabitat(0.90, { suitability: 1 })),
	'round',
	'strong forest must retain the historic broadleaf endpoint',
);

const temperatePattern = vegetationGrovePatternForClimate({ tundra: 0, permanentIce: 0 });
const coldPattern = vegetationGrovePatternForClimate({ tundra: 0.85, permanentIce: 0.75 });
assert(coldPattern.groveRadiusMeters < temperatePattern.groveRadiusMeters,
	'cold-climate conifers should form tighter shelter groves');
assert(coldPattern.backgroundChance < temperatePattern.backgroundChance,
	'cold-climate conifers should leave stronger grove/clearing contrast');
assert(coldPattern.groveRadiusMeters >= 100 && temperatePattern.groveRadiusMeters <= 220);

const first = build(SEED);
const second = build(SEED);
const different = build(SEED ^ 0x01010101);
const settlementFirst = buildSettlement(SEED);
const settlementSecond = buildSettlement(SEED);
const settlementDifferent = buildSettlement(SEED ^ 0x01010101);
try {
	const firstPoints = collectTreePositions(first.group);
	const secondPoints = collectTreePositions(second.group);
	const differentPoints = collectTreePositions(different.group);

	assert(first.placedCount >= Math.floor(first.targetCount * 0.70),
		`terrain habitat gating removed too much of the bounded tree budget: ${first.placedCount}/${first.targetCount}`);
	assert(first.placedCount <= first.targetCount);
	assert(first.baseHabitatRejected > 0, 'temperate base scatter never exercised terrain habitat rejection');
	assert.equal(firstPoints.length, first.placedCount, 'every placed tree must have exactly one trunk position');
	assert.deepEqual(firstPoints, secondPoints, 'same seed must reproduce the exact grove pattern');
	assert.notDeepEqual(firstPoints.slice(0, 40), differentPoints.slice(0, 40), 'different seed must move grove geography');
	assert(firstPoints.every(([x, z]) => Math.hypot(x, z) <= RADIUS_METERS + 1e-6),
		'grove satellites must remain inside the vegetation owner radius');

	const spatial = gridStats(firstPoints);
	const nearest = meanNearestNeighbourMeters(firstPoints);
	assert(spatial.coefficientOfVariation >= 1.10,
		`occupancy variation too uniform for ecological groves: ${spatial.coefficientOfVariation}`);
	assert(spatial.emptyCellFraction >= 0.28,
		`clearing fraction too small for patchy woodland: ${spatial.emptyCellFraction}`);
	assert(spatial.maxCellCount >= 9,
		`no locally dense grove formed: max 300m-cell count=${spatial.maxCellCount}`);
	assert(nearest <= 95,
		`trees remain too evenly separated for a grove pattern: mean nearest=${nearest}`);
	assert.equal(first.group.userData.vegetationSpatialPattern.policyId, VEGETATION_SPATIAL_PATTERN_POLICY.id);
	assert.equal(first.group.userData.vegetationSpatialPattern.deterministic, true);
	assert.equal(first.group.userData.vegetationSpatialPattern.baseDensityPerKm2, DENSITY_PER_KM2);
	assert.equal(first.group.userData.vegetationSpatialPattern.temperateHabitatAuthority,
		'terrainBiomeShading.resolveTerrainForestSuitability');
	assert.equal(first.group.userData.vegetationSpatialPattern.temperateSpeciesCompositionAuthority,
		'terrainBiomeShading.resolveTerrainForestSuitability');
	assert.equal(first.group.userData.vegetationSpatialPattern.temperateBroadleafSparseHabitatChance, 0.08);
	assert.equal(first.group.userData.vegetationSpatialPattern.temperateBroadleafStrongHabitatChance, 0.40);
	assert.equal(first.group.userData.vegetationSpatialPattern.baseHabitatRejected, first.baseHabitatRejected);

	const placedHabitatMean = firstPoints.reduce((sum, [x, z]) => sum + resolveTerrainForestSuitability({
		heightAboveSeaMeters: 100,
		slopeDegrees: 0,
		worldX: x,
		worldZ: z,
	}).suitability, 0) / firstPoints.length;
	let baselineHabitatSum = 0;
	let baselineHabitatCount = 0;
	for (let z = -RADIUS_METERS; z <= RADIUS_METERS; z += 150) {
		for (let x = -RADIUS_METERS; x <= RADIUS_METERS; x += 150) {
			if (Math.hypot(x, z) > RADIUS_METERS) continue;
			baselineHabitatSum += resolveTerrainForestSuitability({
				heightAboveSeaMeters: 100,
				slopeDegrees: 0,
				worldX: x,
				worldZ: z,
			}).suitability;
			baselineHabitatCount++;
		}
	}
	const baselineHabitatMean = baselineHabitatSum / baselineHabitatCount;
	assert(placedHabitatMean > baselineHabitatMean + 0.035,
		`tree scatter did not move toward terrain forest habitat: ${placedHabitatMean} <= ${baselineHabitatMean}`);

	const settlementPoints = collectTreePositions(settlementFirst.group);
	const settlementSecondPoints = collectTreePositions(settlementSecond.group);
	const settlementDifferentPoints = collectTreePositions(settlementDifferent.group);
	assert.equal(settlementFirst.placedCount, settlementFirst.targetCount,
		'flat settlement fixture must retain its bounded local woodland budget');
	assert.equal(settlementFirst.clusterSeatCount, 1);
	assert.equal(settlementFirst.settlementWoodlandSeatCount, 1);
	assert.deepEqual(settlementPoints, settlementSecondPoints,
		'same seed must reproduce identical settlement woodland pockets');
	assert.notDeepEqual(settlementPoints, settlementDifferentPoints,
		'different seed must rotate/re-shape settlement woodland pockets');
	assert(settlementPoints.length >= VEGETATION_SPATIAL_PATTERN_POLICY.settlementTreeBudgetMin
		&& settlementPoints.length <= VEGETATION_SPATIAL_PATTERN_POLICY.settlementTreeBudgetMax,
		`settlement woodland budget escaped policy: ${settlementPoints.length}`);

	const settlementAngular = angularPocketStats(settlementPoints);
	assert(settlementAngular.minRadiusMeters >= 90 - 1e-6,
		`settlement woodland invaded the seat exclusion: ${settlementAngular.minRadiusMeters}`);
	assert(settlementAngular.maxRadiusMeters <= 308,
		`settlement woodland escaped its bounded influence envelope: ${settlementAngular.maxRadiusMeters}`);
	assert(settlementAngular.emptySectors >= 4,
		`settlement vegetation refilled a near-continuous annulus: ${JSON.stringify(settlementAngular.counts)}`);
	assert(settlementAngular.occupiedSectors <= 12,
		`settlement woodland became too ring-like: ${JSON.stringify(settlementAngular.counts)}`);
	assert(settlementAngular.maxSectorCount >= Math.ceil(settlementPoints.length * 0.16),
		`settlement woodland lost locally dominant grove pockets: ${JSON.stringify(settlementAngular.counts)}`);
	assert.equal(settlementFirst.group.userData.vegetationSpatialPattern.settlementPattern,
		'asymmetric-woodland-pockets');

	console.log('[checkVegetationEcologicalGroves] PASS', JSON.stringify({
		placedCount: first.placedCount,
		coefficientOfVariation: Number(spatial.coefficientOfVariation.toFixed(3)),
		emptyCellFraction: Number(spatial.emptyCellFraction.toFixed(3)),
		maxCellCount: spatial.maxCellCount,
		meanNearestNeighbourMeters: Number(nearest.toFixed(2)),
		baseHabitatRejected: first.baseHabitatRejected,
		placedHabitatMean: Number(placedHabitatMean.toFixed(3)),
		baselineHabitatMean: Number(baselineHabitatMean.toFixed(3)),
		temperateSpeciesBroadleafCounts: {
			sparse: sparseBroadleaf,
			mixed: mixedBroadleaf,
			strong: strongBroadleaf,
		},
		temperateGroveRadiusMeters: temperatePattern.groveRadiusMeters,
		coldGroveRadiusMeters: Number(coldPattern.groveRadiusMeters.toFixed(1)),
		settlementTreeCount: settlementPoints.length,
		settlementOccupiedSectors: settlementAngular.occupiedSectors,
		settlementEmptySectors: settlementAngular.emptySectors,
		settlementMaxSectorCount: settlementAngular.maxSectorCount,
		settlementRadiusMeters: [
			Number(settlementAngular.minRadiusMeters.toFixed(1)),
			Number(settlementAngular.maxRadiusMeters.toFixed(1)),
		],
	}));
} finally {
	disposeVegetation(first.group);
	disposeVegetation(second.group);
	disposeVegetation(different.group);
	disposeVegetation(settlementFirst.group);
	disposeVegetation(settlementSecond.group);
	disposeVegetation(settlementDifferent.group);
}