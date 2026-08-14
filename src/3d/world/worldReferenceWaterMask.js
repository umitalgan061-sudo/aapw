/**
 * Deterministic coarse coastline/water mask extracted from the owner-supplied 2D world map.
 *
 * Normalized coordinates are in [0,1], x west->east and y north->south. The mask is 96x64 and
 * stores one bit per sample cell (`1 = water`, `0 = land`) as 24-hex-character rows. It is a
 * repo-persisted deterministic derivative of the reference image, so production does not decode
 * or inspect the image at runtime.
 * @module world/worldReferenceWaterMask
 */

export const WORLD_REFERENCE_WATER_MASK = Object.freeze({
	id: 'owner-world-map-water-mask-2026-08-08',
	sourceMapId: 'owner-world-map-2026-08-08',
	width: 96,
	height: 64,
	waterCellCount: 4052,
	landCellCount: 2092,
	maskSha256: '2ca2bed8d8a137ba532a56e10b079fa845b0f7214e24f955388c8dd0a4517f27',
	rowsHex: Object.freeze([
		'f80007ffffffffffffffffff','fe000fffff7fffffffffffff','fe01bfffffffffffffffffff','fe073fffffffffffffffffff',
		'ff03ffffffffffffffffffff','ff03bfffffffffffffffffff','ff80ffffffffffffffffffff','ff81ffffffffffffffffffff',
		'ff805fffffffffffffffffff','ffc45fffffffffffffffffff','ffee0dffffffffffffffffff','fffe0fffffffffffffffffff',
		'fffe87ffffffffffffffffff','fffc00ffffffffffffffffff','fff001ffffffffffffffffff','ffc003fffffffffeffffffff',
		'ffc007fffffffff8ffffffff','ff8007ffffffffe0ffffffff','ff0003ffffffffe1ffffffff','ff8007ffffffffe7ffffffff',
		'ff800fffffffffffefffffff','ffc07fffffffffffffffffff','ff807fffffffffffffffffff','ff1063ffffffffffffffffff',
		'fff801f7fffffff8ffffffff','fff800f3fff7ff600fffffff','fffc01f11fc3bf0001b9fff8','fff801f007831400007cfff0',
		'ffe003e00400000008787fe0','ffc001e0000000000c183e00','ff8003c0000000000c001e00','ffc007c00000000000000000',
		'ff800fe00000000000000000','ff8003f00000000000000000','ff8001f00000000000000000','ff8003e00000000000000000',
		'ffc007f00000000000000000','ffc001fc0000000000000000','ff803bc00000000000000000','ff007fc00000000000000000',
		'ff800ff00000700000000000','ff8000f80003e00000000000','fff001ff800fe00000000000','ffffffffef1fe00000000000',
		'ffffffffff0f000000000000','ffffffffff0f800000000000','ffffffffff0fc00000000000','ffffffffff8fc06e06000000',
		'ffffffffffffe1ffcf000000','ffffffffffbff9ff87804000','ffffffffffffffff87c1f000','ffffffffffffffff87e53800',
		'ffffffbfffffffff87ff3c00','ffffffffffffffffc7ffbe00','ffffffffffffffffc7ff3e00','fffffffffffffffee7fffe06',
		'fffffffffffffff7e7fffe1f','ffffffffffffbfe3fffffe3d','fffffff9ffff8003fffffc7f','ffffffc1fffb0004fffffdf8',
		'ffffffcefff0000ffffffff0','ffffffcffff8000ffffffc00','ffffffdffff80007fffff800','fffffffffffc0007ffffe000',
	]),
});

function clamp01(value) {
	if (!Number.isFinite(value)) throw new TypeError('normalized coordinate must be finite');
	return Math.min(1, Math.max(0, value));
}

function maskIndexFromNormalized(normalizedX, normalizedY) {
	const x = Math.min(WORLD_REFERENCE_WATER_MASK.width - 1, Math.floor(clamp01(normalizedX) * WORLD_REFERENCE_WATER_MASK.width));
	const y = Math.min(WORLD_REFERENCE_WATER_MASK.height - 1, Math.floor(clamp01(normalizedY) * WORLD_REFERENCE_WATER_MASK.height));
	return { x, y };
}

function rowBit(rowHex, x) {
	const nibble = Number.parseInt(rowHex[Math.floor(x / 4)], 16);
	return (nibble >> (3 - (x % 4))) & 1;
}

export function sampleReferenceWaterMask(normalizedX, normalizedY) {
	const { x, y } = maskIndexFromNormalized(normalizedX, normalizedY);
	return rowBit(WORLD_REFERENCE_WATER_MASK.rowsHex[y], x) === 1;
}

export function sampleReferenceLandMask(normalizedX, normalizedY) {
	return !sampleReferenceWaterMask(normalizedX, normalizedY);
}

export function sampleReferenceCoastBlend(normalizedX, normalizedY) {
	const { x, y } = maskIndexFromNormalized(normalizedX, normalizedY);
	let waterNeighbors = 0;
	let totalNeighbors = 0;
	for (let dy = -1; dy <= 1; dy += 1) {
		for (let dx = -1; dx <= 1; dx += 1) {
			const sx = x + dx;
			const sy = y + dy;
			if (sx < 0 || sx >= WORLD_REFERENCE_WATER_MASK.width || sy < 0 || sy >= WORLD_REFERENCE_WATER_MASK.height) continue;
			totalNeighbors += 1;
			waterNeighbors += rowBit(WORLD_REFERENCE_WATER_MASK.rowsHex[sy], sx);
		}
	}
	return waterNeighbors / totalNeighbors;
}

/**
 * Run263 additive semantic extension for the owner-requested distinct lake/sea surfaces.
 * Border-connected water is sea; enclosed water is lake. Four-neighbour flood fill is deliberate:
 * diagonal corner contact alone does not create a navigable opening between two water bodies.
 * Rendering remains unchanged until a later, separately validated consumer opts into this contract.
 */
function buildReferenceSeaCellSet() {
	const { width, height, rowsHex } = WORLD_REFERENCE_WATER_MASK;
	const sea = new Uint8Array(width * height);
	const queueX = new Int16Array(width * height);
	const queueY = new Int16Array(width * height);
	let head = 0;
	let tail = 0;

	function enqueue(x, y) {
		if (x < 0 || x >= width || y < 0 || y >= height) return;
		if (rowBit(rowsHex[y], x) !== 1) return;
		const index = y * width + x;
		if (sea[index] === 1) return;
		sea[index] = 1;
		queueX[tail] = x;
		queueY[tail] = y;
		tail += 1;
	}

	for (let x = 0; x < width; x += 1) {
		enqueue(x, 0);
		enqueue(x, height - 1);
	}
	for (let y = 0; y < height; y += 1) {
		enqueue(0, y);
		enqueue(width - 1, y);
	}

	while (head < tail) {
		const x = queueX[head];
		const y = queueY[head];
		head += 1;
		enqueue(x + 1, y);
		enqueue(x - 1, y);
		enqueue(x, y + 1);
		enqueue(x, y - 1);
	}
	return sea;
}

const REFERENCE_SEA_CELLS = buildReferenceSeaCellSet();

/** @returns {'land'|'sea'|'lake'} */
export function classifyReferenceWaterCell(x, y) {
	const { width, height, rowsHex } = WORLD_REFERENCE_WATER_MASK;
	if (!Number.isInteger(x) || !Number.isInteger(y)) throw new TypeError('water-mask cell coordinates must be integers');
	if (x < 0 || x >= width || y < 0 || y >= height) throw new RangeError('water-mask cell outside mask bounds');
	if (rowBit(rowsHex[y], x) !== 1) return 'land';
	return REFERENCE_SEA_CELLS[y * width + x] === 1 ? 'sea' : 'lake';
}

/** @returns {'land'|'sea'|'lake'} */
export function classifyReferenceWaterBody(normalizedX, normalizedY) {
	const { x, y } = maskIndexFromNormalized(normalizedX, normalizedY);
	return classifyReferenceWaterCell(x, y);
}

export const WORLD_REFERENCE_WATER_BODY_STATS = Object.freeze((() => {
	const { width, height, rowsHex, id } = WORLD_REFERENCE_WATER_MASK;
	let seaCellCount = 0;
	let lakeCellCount = 0;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			if (rowBit(rowsHex[y], x) !== 1) continue;
			if (REFERENCE_SEA_CELLS[y * width + x] === 1) seaCellCount += 1;
			else lakeCellCount += 1;
		}
	}
	return Object.freeze({ maskId: id, seaCellCount, lakeCellCount, waterCellCount: seaCellCount + lakeCellCount });
})());
