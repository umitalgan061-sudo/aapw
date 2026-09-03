#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitArchitectureToProceduralFootprint, selectVillageArchitectureLandmarks } from '../src/3d/world/villages.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'src/3d/world/villages.js'), 'utf8');

assert(source.includes('architectureCandidatesHere.push({'), 'all authored hamlet houses must become deterministic upgrade candidates');
assert(source.includes('landmarkSites.push(...selectVillageArchitectureLandmarks(architectureCandidatesHere))'), 'completed hamlets must select real landmarks after procedural placement');
assert(!source.includes('architectureSitesHere.every'), 'greedy first-compatible landmark selection must not return');

const candidates = [
	{ seatId: 'stannis', houseIndex: 3, x: 0, z: 0 },
	{ seatId: 'stannis', houseIndex: 7, x: 23, z: 0 },
	{ seatId: 'stannis', houseIndex: 11, x: -34, z: 0 },
	{ seatId: 'stannis', houseIndex: 15, x: 35, z: 0 },
];
const snapshot = JSON.stringify(candidates);
const selected = selectVillageArchitectureLandmarks(candidates);
const replay = selectVillageArchitectureLandmarks(candidates);

assert.deepEqual(selected.map((site) => site.houseIndex), [11, 15], 'real silhouettes must use the farthest valid authored pair');
assert.deepEqual(selected.map((site) => site.assetIndex), [0, 1], 'primary/secondary silhouette assignment must remain stable');
assert.equal(selected[0].distributionDistanceMeters, 69);
assert.equal(selected[1].distributionDistanceMeters, 69);
assert.deepEqual(replay, selected, 'landmark selection must replay deterministically without RNG');
assert.equal(JSON.stringify(candidates), snapshot, 'selection must not mutate authored house candidates');

const noPair = selectVillageArchitectureLandmarks([
	{ seatId: 'ziya', houseIndex: 4, x: 0, z: 0 },
	{ seatId: 'ziya', houseIndex: 8, x: 10, z: 0 },
	{ seatId: 'ziya', houseIndex: 12, x: 20, z: 0 },
]);
assert.deepEqual(noPair.map((site) => site.houseIndex), [4], 'hamlet must fail closed to one detail asset when no pair clears 22m');
assert.equal(noPair[0].assetIndex, 0);
assert.equal(noPair[0].distributionDistanceMeters, 0);

const tie = selectVillageArchitectureLandmarks([
	{ seatId: 'robin', houseIndex: 2, x: -30, z: 0 },
	{ seatId: 'robin', houseIndex: 6, x: 30, z: 0 },
	{ seatId: 'robin', houseIndex: 10, x: 0, z: -30 },
	{ seatId: 'robin', houseIndex: 14, x: 0, z: 30 },
]);
assert.deepEqual(tie.map((site) => site.houseIndex), [2, 6], 'equal-distance pairs need stable house-index tie-breaking');
assert.equal(tie[0].distributionDistanceMeters, 60);

const filtered = selectVillageArchitectureLandmarks([
	{ seatId: 'doran', houseIndex: 1, x: Number.NaN, z: 0 },
	{ seatId: 'doran', houseIndex: 5, x: -25, z: 0 },
	{ seatId: 'doran', houseIndex: 9, x: 25, z: 0 },
]);
assert.deepEqual(filtered.map((site) => site.houseIndex), [5, 9], 'non-finite candidates must not poison a valid deterministic pair');

const duplicates = selectVillageArchitectureLandmarks([
	{ seatId: 'twin', houseIndex: 9, x: 40, z: 40 },
	{ seatId: 'twin', houseIndex: 9, x: 40, z: 40 },
	{ seatId: 'twin', houseIndex: 10, x: 80, z: 40 },
]);
assert.deepEqual(duplicates.map((site) => site.houseIndex), [9, 10], 'duplicate candidate records must not destabilize the farthest valid pair');

const deepAssetFit = fitArchitectureToProceduralFootprint(
	{ x: 2.22, z: 3.42 },
	{ targetWidthMeters: 7.9, targetDepthMeters: 5.1 },
);
assert.equal(deepAssetFit.quarterTurn, true, 'deep authored houses should quarter-turn when that fills the same parcel better');
assert(deepAssetFit.parcelCoverage > 0.98, `quarter-turned deep asset should fill its parcel, got ${deepAssetFit.parcelCoverage}`);
assert(deepAssetFit.fittedWidth <= deepAssetFit.targetWidth + 1e-9 && deepAssetFit.fittedDepth <= deepAssetFit.targetDepth + 1e-9, 'quarter-turn must never overflow the authored parcel');

const wideAssetFit = fitArchitectureToProceduralFootprint(
	{ x: 11.8, z: 6.64 },
	{ targetWidthMeters: 8.6, targetDepthMeters: 4.6 },
);
assert.equal(wideAssetFit.quarterTurn, false, 'already parcel-aligned wide houses must retain authored orientation');
assert(wideAssetFit.parcelCoverage > 0.94, `wide asset should preserve strong parcel coverage, got ${wideAssetFit.parcelCoverage}`);
assert.equal(fitArchitectureToProceduralFootprint({ x: 0, z: 4 }, { targetWidthMeters: 8, targetDepthMeters: 5 }), null, 'invalid source footprint must fail closed');

console.log('VILLAGE_ARCHITECTURE_DISTRIBUTION_PASS', JSON.stringify({
	selected: selected.map(({ houseIndex, assetIndex, distributionDistanceMeters }) => ({ houseIndex, assetIndex, distributionDistanceMeters })),
	noPair: noPair.map(({ houseIndex, assetIndex }) => ({ houseIndex, assetIndex })),
	tie: tie.map(({ houseIndex, assetIndex, distributionDistanceMeters }) => ({ houseIndex, assetIndex, distributionDistanceMeters })),
	filtered: filtered.map(({ houseIndex, assetIndex, distributionDistanceMeters }) => ({ houseIndex, assetIndex, distributionDistanceMeters })),
	duplicates: duplicates.map(({ houseIndex, assetIndex, distributionDistanceMeters }) => ({ houseIndex, assetIndex, distributionDistanceMeters })),
	parcelFit: { deepAssetFit, wideAssetFit },
}));