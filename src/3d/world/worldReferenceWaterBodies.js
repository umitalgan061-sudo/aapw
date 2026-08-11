/**
 * Deterministic semantic classification for the canonical world-reference water mask.
 *
 * Water cells connected to any mask border through four-neighbour adjacency are classified as
 * sea. Water cells enclosed by land are classified as lake. This is intentionally derived only
 * from the persisted mask, never from runtime image decoding, so desktop/mobile/PWA builds agree.
 *
 * This module is additive groundwork for owner-requested distinct lake/sea surface materials. It
 * does not change rendering by itself; consumers may opt in after texture assets are repo-local.
 * @module world/worldReferenceWaterBodies
 */

import { WORLD_REFERENCE_WATER_MASK } from './worldReferenceWaterMask.js';

const { width: MASK_WIDTH, height: MASK_HEIGHT, rowsHex: MASK_ROWS } = WORLD_REFERENCE_WATER_MASK;

function rowBit(rowHex, x) {
	const nibble = Number.parseInt(rowHex[Math.floor(x / 4)], 16);
	return (nibble >> (3 - (x % 4))) & 1;
}

function isWaterCell(x, y) {
	return x >= 0 && x < MASK_WIDTH && y >= 0 && y < MASK_HEIGHT && rowBit(MASK_ROWS[y], x) === 1;
}

function cellIndex(x, y) {
	return y * MASK_WIDTH + x;
}

function buildSeaCellSet() {
	const sea = new Uint8Array(MASK_WIDTH * MASK_HEIGHT);
	const queueX = new Int16Array(MASK_WIDTH * MASK_HEIGHT);
	const queueY = new Int16Array(MASK_WIDTH * MASK_HEIGHT);
	let head = 0;
	let tail = 0;

	function enqueue(x, y) {
		if (!isWaterCell(x, y)) return;
		const index = cellIndex(x, y);
		if (sea[index] === 1) return;
		sea[index] = 1;
		queueX[tail] = x;
		queueY[tail] = y;
		tail += 1;
	}

	for (let x = 0; x < MASK_WIDTH; x += 1) {
		enqueue(x, 0);
		enqueue(x, MASK_HEIGHT - 1);
	}
	for (let y = 0; y < MASK_HEIGHT; y += 1) {
		enqueue(0, y);
		enqueue(MASK_WIDTH - 1, y);
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

const SEA_CELLS = buildSeaCellSet();

function clamp01(value) {
	if (!Number.isFinite(value)) throw new TypeError('normalized coordinate must be finite');
	return Math.min(1, Math.max(0, value));
}

function maskIndexFromNormalized(normalizedX, normalizedY) {
	return {
		x: Math.min(MASK_WIDTH - 1, Math.floor(clamp01(normalizedX) * MASK_WIDTH)),
		y: Math.min(MASK_HEIGHT - 1, Math.floor(clamp01(normalizedY) * MASK_HEIGHT)),
	};
}

/** @returns {'land'|'sea'|'lake'} */
export function classifyReferenceWaterCell(x, y) {
	if (!Number.isInteger(x) || !Number.isInteger(y)) throw new TypeError('water-mask cell coordinates must be integers');
	if (x < 0 || x >= MASK_WIDTH || y < 0 || y >= MASK_HEIGHT) throw new RangeError('water-mask cell outside mask bounds');
	if (!isWaterCell(x, y)) return 'land';
	return SEA_CELLS[cellIndex(x, y)] === 1 ? 'sea' : 'lake';
}

/** @returns {'land'|'sea'|'lake'} */
export function classifyReferenceWaterBody(normalizedX, normalizedY) {
	const { x, y } = maskIndexFromNormalized(normalizedX, normalizedY);
	return classifyReferenceWaterCell(x, y);
}

export const WORLD_REFERENCE_WATER_BODY_STATS = Object.freeze((() => {
	let seaCellCount = 0;
	let lakeCellCount = 0;
	for (let y = 0; y < MASK_HEIGHT; y += 1) {
		for (let x = 0; x < MASK_WIDTH; x += 1) {
			if (!isWaterCell(x, y)) continue;
			if (SEA_CELLS[cellIndex(x, y)] === 1) seaCellCount += 1;
			else lakeCellCount += 1;
		}
	}
	return {
		maskId: WORLD_REFERENCE_WATER_MASK.id,
		seaCellCount,
		lakeCellCount,
		waterCellCount: seaCellCount + lakeCellCount,
	};
})());
