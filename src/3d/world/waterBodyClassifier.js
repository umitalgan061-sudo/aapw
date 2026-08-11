/**
 * Deterministically classifies cells in the canonical world-reference water mask as land, sea,
 * or enclosed lake. Border-connected water is sea; every remaining water component is a lake.
 * This is intentionally visual-side-effect free so texture/material work can consume it later
 * without changing the current water renderer until the owner-supplied assets are repo-local.
 * @module world/waterBodyClassifier
 */

import { WORLD_REFERENCE_WATER_MASK } from './worldReferenceWaterMask.js';

export const WATER_BODY_KIND = Object.freeze({ LAND: 'land', SEA: 'sea', LAKE: 'lake' });

const { width: WIDTH, height: HEIGHT, rowsHex: ROWS } = WORLD_REFERENCE_WATER_MASK;
const CELL_COUNT = WIDTH * HEIGHT;

function rowBit(rowHex, x) {
	const nibble = Number.parseInt(rowHex[Math.floor(x / 4)], 16);
	return (nibble >> (3 - (x % 4))) & 1;
}

function isWaterCell(x, y) {
	return rowBit(ROWS[y], x) === 1;
}

function cellIndex(x, y) {
	return y * WIDTH + x;
}

function clamp01(value) {
	if (!Number.isFinite(value)) throw new TypeError('normalized coordinate must be finite');
	return Math.min(1, Math.max(0, value));
}

function normalizedToCell(normalizedX, normalizedY) {
	const x = Math.min(WIDTH - 1, Math.floor(clamp01(normalizedX) * WIDTH));
	const y = Math.min(HEIGHT - 1, Math.floor(clamp01(normalizedY) * HEIGHT));
	return { x, y };
}

function buildSeaMask() {
	const sea = new Uint8Array(CELL_COUNT);
	const queueX = new Int16Array(CELL_COUNT);
	const queueY = new Int16Array(CELL_COUNT);
	let head = 0;
	let tail = 0;

	function enqueue(x, y) {
		const index = cellIndex(x, y);
		if (sea[index] || !isWaterCell(x, y)) return;
		sea[index] = 1;
		queueX[tail] = x;
		queueY[tail] = y;
		tail += 1;
	}

	for (let x = 0; x < WIDTH; x += 1) {
		enqueue(x, 0);
		enqueue(x, HEIGHT - 1);
	}
	for (let y = 1; y < HEIGHT - 1; y += 1) {
		enqueue(0, y);
		enqueue(WIDTH - 1, y);
	}

	while (head < tail) {
		const x = queueX[head];
		const y = queueY[head];
		head += 1;
		if (x > 0) enqueue(x - 1, y);
		if (x + 1 < WIDTH) enqueue(x + 1, y);
		if (y > 0) enqueue(x, y - 1);
		if (y + 1 < HEIGHT) enqueue(x, y + 1);
	}
	return sea;
}

const SEA_MASK = buildSeaMask();

let seaCellCount = 0;
let lakeCellCount = 0;
for (let y = 0; y < HEIGHT; y += 1) {
	for (let x = 0; x < WIDTH; x += 1) {
		if (!isWaterCell(x, y)) continue;
		if (SEA_MASK[cellIndex(x, y)]) seaCellCount += 1;
		else lakeCellCount += 1;
	}
}

export const WORLD_REFERENCE_WATER_BODY_STATS = Object.freeze({
	width: WIDTH,
	height: HEIGHT,
	seaCellCount,
	lakeCellCount,
	landCellCount: WORLD_REFERENCE_WATER_MASK.landCellCount,
});

export function sampleReferenceWaterBodyKind(normalizedX, normalizedY) {
	const { x, y } = normalizedToCell(normalizedX, normalizedY);
	if (!isWaterCell(x, y)) return WATER_BODY_KIND.LAND;
	return SEA_MASK[cellIndex(x, y)] ? WATER_BODY_KIND.SEA : WATER_BODY_KIND.LAKE;
}

export function sampleReferenceSeaMask(normalizedX, normalizedY) {
	return sampleReferenceWaterBodyKind(normalizedX, normalizedY) === WATER_BODY_KIND.SEA;
}

export function sampleReferenceLakeMask(normalizedX, normalizedY) {
	return sampleReferenceWaterBodyKind(normalizedX, normalizedY) === WATER_BODY_KIND.LAKE;
}
