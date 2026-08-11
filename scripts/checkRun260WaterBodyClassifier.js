import {
	WATER_BODY_KIND,
	WORLD_REFERENCE_WATER_BODY_STATS,
	sampleReferenceLakeMask,
	sampleReferenceSeaMask,
	sampleReferenceWaterBodyKind,
} from '../src/3d/world/waterBodyClassifier.js';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const center = (cell, size) => (cell + 0.5) / size;
const { width, height } = WORLD_REFERENCE_WATER_BODY_STATS;

assert(WORLD_REFERENCE_WATER_BODY_STATS.seaCellCount === 4046, 'sea cell count drifted');
assert(WORLD_REFERENCE_WATER_BODY_STATS.lakeCellCount === 6, 'lake cell count drifted');
assert(WORLD_REFERENCE_WATER_BODY_STATS.landCellCount === 2092, 'land cell count drifted');
assert(
	WORLD_REFERENCE_WATER_BODY_STATS.seaCellCount +
		WORLD_REFERENCE_WATER_BODY_STATS.lakeCellCount +
		WORLD_REFERENCE_WATER_BODY_STATS.landCellCount === width * height,
	'water-body classification must cover every reference cell exactly once',
);

const isolatedLake = [center(16, width), center(12, height)];
const clusteredLake = [center(68, width), center(29, height)];
const knownSea = [center(0, width), center(0, height)];
const knownLand = [center(40, width), center(35, height)];

assert(sampleReferenceLakeMask(...isolatedLake), 'isolated enclosed water cell must classify as lake');
assert(sampleReferenceLakeMask(...clusteredLake), 'enclosed five-cell water body must classify as lake');
assert(sampleReferenceSeaMask(...knownSea), 'border-connected water must classify as sea');
assert(sampleReferenceWaterBodyKind(...knownLand) === WATER_BODY_KIND.LAND, 'known land cell must remain land');
assert(sampleReferenceWaterBodyKind(-1, -1) === WATER_BODY_KIND.SEA, 'normalized coordinates clamp deterministically');
assert(sampleReferenceWaterBodyKind(2, 2) === WATER_BODY_KIND.LAND, 'upper normalized coordinates clamp deterministically');

console.log(
	`[checkRun260WaterBodyClassifier] PASS: ${WORLD_REFERENCE_WATER_BODY_STATS.seaCellCount} sea / ` +
		`${WORLD_REFERENCE_WATER_BODY_STATS.lakeCellCount} lake / ${WORLD_REFERENCE_WATER_BODY_STATS.landCellCount} land cells.`,
);
