#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	VEGETATION_SPATIAL_PATTERN_POLICY,
	createVegetation,
	disposeVegetation,
	vegetationGrovePatternForClimate,
} from '../src/3d/world/vegetation.js';

const RADIUS_METERS = 1500;
const DENSITY_PER_KM2 = 30;
const GRID_CELL_METERS = 300;
const SEED = 0x47524f56;

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

assert.equal(VEGETATION_SPATIAL_PATTERN_POLICY.id, 'vegetation-ecological-grove-scatter-2026-08-26-v1');
assert(VEGETATION_SPATIAL_PATTERN_POLICY.groveTreeCountMin >= 7);
assert(VEGETATION_SPATIAL_PATTERN_POLICY.groveTreeCountMax <= 24);
assert(VEGETATION_SPATIAL_PATTERN_POLICY.groveTreeCountMax > VEGETATION_SPATIAL_PATTERN_POLICY.groveTreeCountMin);

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
try {
	const firstPoints = collectTreePositions(first.group);
	const secondPoints = collectTreePositions(second.group);
	const differentPoints = collectTreePositions(different.group);

	assert.equal(first.placedCount, first.targetCount, 'flat-land fixture must retain the requested total tree budget');
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

	console.log('[checkVegetationEcologicalGroves] PASS', JSON.stringify({
		placedCount: first.placedCount,
		coefficientOfVariation: Number(spatial.coefficientOfVariation.toFixed(3)),
		emptyCellFraction: Number(spatial.emptyCellFraction.toFixed(3)),
		maxCellCount: spatial.maxCellCount,
		meanNearestNeighbourMeters: Number(nearest.toFixed(2)),
		temperateGroveRadiusMeters: temperatePattern.groveRadiusMeters,
		coldGroveRadiusMeters: Number(coldPattern.groveRadiusMeters.toFixed(1)),
	}));
} finally {
	disposeVegetation(first.group);
	disposeVegetation(second.group);
	disposeVegetation(different.group);
}
