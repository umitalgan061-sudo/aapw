import {
	WORLD_REFERENCE_WATER_MASK,
	sampleReferenceWaterMask,
	sampleReferenceLandMask,
	sampleReferenceCoastBlend,
} from '../src/3d/world/worldReferenceWaterMask.js';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

assert(WORLD_REFERENCE_WATER_MASK.width === 96, 'mask width drifted');
assert(WORLD_REFERENCE_WATER_MASK.height === 64, 'mask height drifted');
assert(WORLD_REFERENCE_WATER_MASK.rowsHex.length === 64, 'mask row count mismatch');
assert(WORLD_REFERENCE_WATER_MASK.rowsHex.every((row) => /^[0-9a-f]{24}$/.test(row)), 'mask rows must encode exactly 96 bits');
assert(WORLD_REFERENCE_WATER_MASK.waterCellCount + WORLD_REFERENCE_WATER_MASK.landCellCount === 6144, 'mask cell counts drifted');
assert(WORLD_REFERENCE_WATER_MASK.maskSha256 === '2ca2bed8d8a137ba532a56e10b079fa845b0f7214e24f955388c8dd0a4517f27', 'mask checksum drifted');

const waterSamples = [[0.055,0.690],[0.280,0.430],[0.475,0.230],[0.805,0.295],[0.535,0.835]];
for (const [x, y] of waterSamples) assert(sampleReferenceWaterMask(x, y), `expected water at ${x},${y}`);
const landSamples = [[0.175,0.285],[0.155,0.585],[0.545,0.535],[0.660,0.680],[0.790,0.705]];
for (const [x, y] of landSamples) assert(sampleReferenceLandMask(x, y), `expected land at ${x},${y}`);
assert(sampleReferenceCoastBlend(0.280, 0.430) > 0.6, 'narrow-sea corridor should remain strongly water');
assert(sampleReferenceCoastBlend(0.160, 0.585) < 0.5, 'reach interior should remain majority land');

console.log(`[checkWorldReferenceWaterMask] PASS: ${WORLD_REFERENCE_WATER_MASK.width}x${WORLD_REFERENCE_WATER_MASK.height}, ${WORLD_REFERENCE_WATER_MASK.waterCellCount} water / ${WORLD_REFERENCE_WATER_MASK.landCellCount} land cells, checksum ${WORLD_REFERENCE_WATER_MASK.maskSha256.slice(0, 12)}…`);
