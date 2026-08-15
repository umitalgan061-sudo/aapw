#!/usr/bin/env node

import assert from 'node:assert/strict';
import { sampleReferenceWaterMask } from '../src/3d/world/worldReferenceWaterMask.js';
import { sampleWorldReferenceRelief } from '../godot/terrain-authoring/lib/worldReferenceReliefField.mjs';

const SIZE = 513;
const CELL_STEP = 1 / 8;
const EPS = 1 / 65536;

function height(x, y) {
	const water = sampleReferenceWaterMask(x, y);
	return sampleWorldReferenceRelief(x, y, { water, protectedLand: false }).heightDeltaMeters;
}

function sameClass(x0, y0, x1, y1) {
	return sampleReferenceWaterMask(x0, y0) === sampleReferenceWaterMask(x1, y1);
}

function derivativeX(x, y) {
	if (!sameClass(x - EPS, y, x + EPS, y)) return null;
	return (height(x + EPS, y) - height(x - EPS, y)) / (2 * EPS);
}

function derivativeY(x, y) {
	if (!sameClass(x, y - EPS, x, y + EPS)) return null;
	return (height(x, y + EPS) - height(x, y - EPS)) / (2 * EPS);
}

let gridEnergy = 0;
let gridCount = 0;
let offsetEnergy = 0;
let offsetCount = 0;
let maxGridJump = 0;

// Compare derivative discontinuity energy exactly on every internal 1/8 GeoCell line against
// nearby non-grid control lines. A work-grid-driven height term would create a strong energy spike.
for (let cell = 1; cell < 8; cell += 1) {
	const boundary = cell * CELL_STEP;
	const offset = boundary + CELL_STEP * 0.173;
	for (let index = 2; index < SIZE - 2; index += 1) {
		const t = index / (SIZE - 1);
		for (const [x, y, axis, isGrid] of [
			[boundary, t, 'x', true], [offset, t, 'x', false],
			[t, boundary, 'y', true], [t, offset, 'y', false],
		]) {
			if (x <= 2 * EPS || x >= 1 - 2 * EPS || y <= 2 * EPS || y >= 1 - 2 * EPS) continue;
			const before = axis === 'x' ? derivativeX(x - EPS, y) : derivativeY(x, y - EPS);
			const after = axis === 'x' ? derivativeX(x + EPS, y) : derivativeY(x, y + EPS);
			if (before == null || after == null) continue;
			const jump = Math.abs(after - before);
			if (isGrid) {
				gridEnergy += jump;
				gridCount += 1;
				maxGridJump = Math.max(maxGridJump, jump);
			} else {
				offsetEnergy += jump;
				offsetCount += 1;
			}
		}
	}
}

assert.ok(gridCount > 1000 && offsetCount > 1000, 'insufficient no-grid samples');
const gridMean = gridEnergy / gridCount;
const offsetMean = offsetEnergy / offsetCount;
const ratio = gridMean / Math.max(offsetMean, 1e-9);
assert.ok(ratio <= 1.65, `GeoCell-aligned derivative energy ratio ${ratio.toFixed(4)} suggests grid imprint`);
assert.ok(maxGridJump < 8000, `maximum GeoCell derivative jump ${maxGridJump.toFixed(2)} is excessive`);

console.log(JSON.stringify({
	status: 'PASS',
	gridCount,
	offsetCount,
	gridMean,
	offsetMean,
	ratio,
	maxGridJump,
}, null, 2));
