#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	TERRAIN_GEOMORPHOLOGY_POLICY,
	terrainGeomorphologyMeters,
} from '../src/3d/world/terrainGeomorphology.js';

const sampleField = (heightAboveSeaMeters) => {
	const values = [];
	for (let y = 1; y < 32; y += 1) {
		for (let x = 1; x < 48; x += 1) {
			values.push(terrainGeomorphologyMeters(x / 48, y / 32, {
				heightAboveSeaMeters,
				waterWeight: 0,
				reliefInfluence: 0.35,
				rockWeight: 0.25,
			}));
		}
	}
	return values;
};

const highlandA = sampleField(180);
const highlandB = sampleField(180);
assert.deepEqual(highlandA, highlandB, 'geomorphology must be bit-deterministic');
assert(highlandA.every(Number.isFinite), 'all geomorphology samples must be finite');

const minimum = Math.min(...highlandA);
const maximum = Math.max(...highlandA);
assert(minimum < -0.25, `high ground must contain incised valleys, got min=${minimum}`);
assert(maximum > 2, `high ground must contain interfluve ridges, got max=${maximum}`);
assert(minimum >= -TERRAIN_GEOMORPHOLOGY_POLICY.maximumCarveMeters - 1e-9, 'carving exceeded policy ceiling');
assert(maximum <= TERRAIN_GEOMORPHOLOGY_POLICY.maximumRaiseMeters + 1e-9, 'ridge boost exceeded policy ceiling');

for (let index = 0; index < 32; index += 1) {
	const x = (index + 0.5) / 32;
	const water = terrainGeomorphologyMeters(x, 0.5, {
		heightAboveSeaMeters: 300,
		waterWeight: 1,
		reliefInfluence: 1,
		rockWeight: 1,
	});
	assert.equal(water, 0, 'open water must receive zero geomorphology');
	const coastal = terrainGeomorphologyMeters(x, 0.5, {
		heightAboveSeaMeters: 5,
		waterWeight: 0,
		reliefInfluence: 0,
		rockWeight: 0,
	});
	assert(coastal >= -1e-9, `low coastal ground must not be incised below its base, got ${coastal}`);
}

assert.throws(() => terrainGeomorphologyMeters(-0.01, 0.5, { heightAboveSeaMeters: 100, waterWeight: 0 }), RangeError);
assert.throws(() => terrainGeomorphologyMeters(Number.NaN, 0.5, { heightAboveSeaMeters: 100, waterWeight: 0 }), TypeError);

console.log(`PASS terrain geomorphology: min=${minimum.toFixed(3)}m max=${maximum.toFixed(3)}m samples=${highlandA.length}`);
