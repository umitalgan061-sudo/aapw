/**
 * Deterministic sea/lake classification layered on the immutable owner reference-water mask.
 *
 * Water cells connected to any outer map edge through 4-neighbor water are classified as `sea`.
 * Any remaining enclosed water component is classified as `lake`. Land remains `land`.
 * This module is intentionally a pure reference contract: it does not alter the current runtime
 * water shader or terrain ownership. A later visual integration can consume the classification
 * without re-deriving topology or guessing which texture belongs to a body of water.
 * @module world/waterBodyClassification
 */

import { WORLD_REFERENCE_WATER_MASK, sampleReferenceWaterMask } from './worldReferenceWaterMask.js';

export const WATER_BODY_CLASS = Object.freeze({
	LAND: 'land',
	SEA: 'sea',
	LAKE: 'lake',
});

const CARDINAL_OFFSETS = Object.freeze([
	Object.freeze([1, 0]),
	Object.freeze([-1, 0]),
	Object.freeze([0, 1]),
	Object.freeze([0, -1]),
]);

function assertNormalized(value, label) {
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`${label} must be finite and in [0,1]`);
	}
}

function cellCenterNormalized(index, size) {
	return (index + 0.5) / size;
}

function maskCellIsWater(x, y) {
	return sampleReferenceWaterMask(
		cellCenterNormalized(x, WORLD_REFERENCE_WATER_MASK.width),
		cellCenterNormalized(y, WORLD_REFERENCE_WATER_MASK.height),
	);
}

function cellIndex(x, y) {
	return y * WORLD_REFERENCE_WATER_MASK.width + x;
}

function buildSeaConnectivity() {
	const width = WORLD_REFERENCE_WATER_MASK.width;
	const height = WORLD_REFERENCE_WATER_MASK.height;
	const sea = new Uint8Array(width * height);
	const queueX = new Int16Array(width * height);
	const queueY = new Int16Array(width * height);
	let head = 0;
	let tail = 0;

	const enqueueIfWater = (x, y) => {
		const index = cellIndex(x, y);
		if (sea[index] || !maskCellIsWater(x, y)) return;
		sea[index] = 1;
		queueX[tail] = x;
		queueY[tail] = y;
		tail += 1;
	};

	for (let x = 0; x < width; x += 1) {
		enqueueIfWater(x, 0);
		enqueueIfWater(x, height - 1);
	}
	for (let y = 0; y < height; y += 1) {
		enqueueIfWater(0, y);
		enqueueIfWater(width - 1, y);
	}

	while (head < tail) {
		const x = queueX[head];
		const y = queueY[head];
		head += 1;
		for (const [dx, dy] of CARDINAL_OFFSETS) {
			const nextX = x + dx;
			const nextY = y + dy;
			if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
			enqueueIfWater(nextX, nextY);
		}
	}

	return sea;
}

const SEA_CONNECTIVITY = buildSeaConnectivity();

export function classifyReferenceWaterCell(x, y) {
	if (!Number.isInteger(x) || x < 0 || x >= WORLD_REFERENCE_WATER_MASK.width) {
		throw new RangeError('x must be an in-range integer water-mask cell coordinate');
	}
	if (!Number.isInteger(y) || y < 0 || y >= WORLD_REFERENCE_WATER_MASK.height) {
		throw new RangeError('y must be an in-range integer water-mask cell coordinate');
	}
	if (!maskCellIsWater(x, y)) return WATER_BODY_CLASS.LAND;
	return SEA_CONNECTIVITY[cellIndex(x, y)] ? WATER_BODY_CLASS.SEA : WATER_BODY_CLASS.LAKE;
}

export function sampleReferenceWaterBodyClass(normalizedX, normalizedY) {
	assertNormalized(normalizedX, 'normalizedX');
	assertNormalized(normalizedY, 'normalizedY');
	const x = Math.min(
		WORLD_REFERENCE_WATER_MASK.width - 1,
		Math.floor(normalizedX * WORLD_REFERENCE_WATER_MASK.width),
	);
	const y = Math.min(
		WORLD_REFERENCE_WATER_MASK.height - 1,
		Math.floor(normalizedY * WORLD_REFERENCE_WATER_MASK.height),
	);
	return classifyReferenceWaterCell(x, y);
}

export function summarizeReferenceWaterBodies() {
	let seaCellCount = 0;
	let lakeCellCount = 0;
	let landCellCount = 0;
	for (let y = 0; y < WORLD_REFERENCE_WATER_MASK.height; y += 1) {
		for (let x = 0; x < WORLD_REFERENCE_WATER_MASK.width; x += 1) {
			const classification = classifyReferenceWaterCell(x, y);
			if (classification === WATER_BODY_CLASS.SEA) seaCellCount += 1;
			else if (classification === WATER_BODY_CLASS.LAKE) lakeCellCount += 1;
			else landCellCount += 1;
		}
	}
	return Object.freeze({
		seaCellCount,
		lakeCellCount,
		landCellCount,
		waterCellCount: seaCellCount + lakeCellCount,
	});
}
