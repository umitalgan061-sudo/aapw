#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVillages, disposeVillages, selectVillageArchitectureLandmarks } from '../src/3d/world/villages.js';

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

function mulberry32(seed) {
	let state = seed >>> 0;
	return () => {
		state |= 0;
		state = (state + 0x6D2B79F5) | 0;
		let value = Math.imul(state ^ (state >>> 15), 1 | state);
		value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

const generatedArgs = {
	sampleHeightMeters: (x, z) => 40 + Math.sin(x * 0.004) * 1.5 + Math.cos(z * 0.004) * 1.5,
	seaLevelMeters: 0,
	seed: 1337,
	seats: [{ id: 'stannis', x: 0, z: 0 }],
	roadEdges: [],
	radiusMeters: 1800,
	mulberry32,
	housesPerVillage: 12,
};
const generated = createVillages(generatedArgs);
const generatedReplay = createVillages({ ...generatedArgs });
try {
	assert(generated.houseCount >= 8, `canonical proof hamlet placed too few houses: ${generated.houseCount}`);
	assert.equal(generated.landmarkSites.length, 2, 'canonical stannis hamlet must expose two real-asset upgrade sites');
	assert.deepEqual(generatedReplay.landmarkSites, generated.landmarkSites, 'generated landmark selection must replay exactly for the same seed');
	assert.deepEqual(generated.landmarkSites.map((site) => site.assetIndex), [0, 1]);
	assert(generated.landmarkSites.every((site) => site.seatId === 'stannis'), 'generated landmarks must stay attached to the canonical settlement owner');
	const [primary, secondary] = generated.landmarkSites;
	const generatedDistance = Math.hypot(primary.x - secondary.x, primary.z - secondary.z);
	assert(generatedDistance >= 22 - 1e-9, `generated real silhouettes are clustered only ${generatedDistance.toFixed(2)}m apart`);
	assert(Math.abs(primary.distributionDistanceMeters - generatedDistance) <= 1e-9, 'primary distribution evidence must match generated world coordinates');
	assert(Math.abs(secondary.distributionDistanceMeters - generatedDistance) <= 1e-9, 'secondary distribution evidence must match generated world coordinates');
	assert.notEqual(primary.houseIndex, secondary.houseIndex, 'generated real silhouettes must replace distinct procedural houses');

	console.log('VILLAGE_ARCHITECTURE_DISTRIBUTION_PASS', JSON.stringify({
		selected: selected.map(({ houseIndex, assetIndex, distributionDistanceMeters }) => ({ houseIndex, assetIndex, distributionDistanceMeters })),
		noPair: noPair.map(({ houseIndex, assetIndex }) => ({ houseIndex, assetIndex })),
		tie: tie.map(({ houseIndex, assetIndex, distributionDistanceMeters }) => ({ houseIndex, assetIndex, distributionDistanceMeters })),
		generated: {
			houseCount: generated.houseCount,
			landmarkHouseIndices: generated.landmarkSites.map((site) => site.houseIndex),
			distanceMeters: Number(generatedDistance.toFixed(3)),
		},
	}));
} finally {
	disposeVillages(generated.group);
	disposeVillages(generatedReplay.group);
}
