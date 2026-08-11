import assert from 'node:assert/strict';
import {
	WORLD_REFERENCE_WATER_MASK,
	classifyReferenceWaterBody,
	classifyReferenceWaterCell,
	WORLD_REFERENCE_WATER_BODY_STATS,
} from '../src/3d/world/worldReferenceWaterMask.js';

assert.equal(WORLD_REFERENCE_WATER_BODY_STATS.maskId, WORLD_REFERENCE_WATER_MASK.id);
assert.equal(WORLD_REFERENCE_WATER_BODY_STATS.waterCellCount, WORLD_REFERENCE_WATER_MASK.waterCellCount);
assert.equal(WORLD_REFERENCE_WATER_BODY_STATS.seaCellCount, 4046);
assert.equal(WORLD_REFERENCE_WATER_BODY_STATS.lakeCellCount, 6);

const expectedLakeCells = new Set(['16,12', '68,28', '68,29', '69,29', '68,30', '69,30']);
let observedWater = 0;
let observedLake = 0;
let observedSea = 0;

for (let y = 0; y < WORLD_REFERENCE_WATER_MASK.height; y += 1) {
	for (let x = 0; x < WORLD_REFERENCE_WATER_MASK.width; x += 1) {
		const kind = classifyReferenceWaterCell(x, y);
		if (kind === 'land') continue;
		observedWater += 1;
		if (kind === 'lake') {
			observedLake += 1;
			assert(expectedLakeCells.has(`${x},${y}`), `unexpected enclosed lake cell ${x},${y}`);
		} else {
			observedSea += 1;
		}
	}
}

assert.equal(observedWater, WORLD_REFERENCE_WATER_MASK.waterCellCount);
assert.equal(observedSea, 4046);
assert.equal(observedLake, expectedLakeCells.size);

for (const key of expectedLakeCells) {
	const [x, y] = key.split(',').map(Number);
	assert.equal(classifyReferenceWaterCell(x, y), 'lake');
}

for (let x = 0; x < WORLD_REFERENCE_WATER_MASK.width; x += 1) {
	for (const y of [0, WORLD_REFERENCE_WATER_MASK.height - 1]) {
		assert.notEqual(classifyReferenceWaterCell(x, y), 'lake', `border cell ${x},${y} must never classify as lake`);
	}
}
for (let y = 0; y < WORLD_REFERENCE_WATER_MASK.height; y += 1) {
	for (const x of [0, WORLD_REFERENCE_WATER_MASK.width - 1]) {
		assert.notEqual(classifyReferenceWaterCell(x, y), 'lake', `border cell ${x},${y} must never classify as lake`);
	}
}

assert.equal(classifyReferenceWaterBody((16 + 0.5) / 96, (12 + 0.5) / 64), 'lake');
assert.equal(classifyReferenceWaterBody(0, 0), classifyReferenceWaterCell(0, 0));
assert.throws(() => classifyReferenceWaterBody(Number.NaN, 0), TypeError);
assert.throws(() => classifyReferenceWaterCell(-1, 0), RangeError);
assert.throws(() => classifyReferenceWaterCell(1.5, 0), TypeError);

console.log('[checkRun263LakeSeaWaterClassifier] PASS: 4046 sea + 6 lake cells classify deterministically from the canonical 96x64 mask.');
