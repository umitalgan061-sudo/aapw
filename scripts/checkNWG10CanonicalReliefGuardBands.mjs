#!/usr/bin/env node

import assert from 'node:assert/strict';
import { sampleReferenceWaterMask } from '../src/3d/world/worldReferenceWaterMask.js';
import { sampleWorldReferenceRelief } from '../src/3d/world/worldReferenceReliefField.js';

const CELL = Object.freeze({ xMin: 1 / 8, xMax: 2 / 8, yMin: 0, yMax: 1 / 8 });
const STEP = 1 / 16384;
const SAMPLE_COUNT = 97;

function hydro(x, y) {
	const water = sampleReferenceWaterMask(x, y);
	return { water, protectedLand: false };
}

function relief(x, y) {
	return sampleWorldReferenceRelief(x, y, hydro(x, y)).heightDeltaMeters;
}

function derivativeStencilKeepsHydrologyClass(x, y) {
	const center = hydro(x, y).water;
	return [
		[Math.max(0, x - STEP), y],
		[Math.min(1, x + STEP), y],
		[x, Math.max(0, y - STEP)],
		[x, Math.min(1, y + STEP)],
	].every(([sx, sy]) => hydro(sx, sy).water === center);
}

function normalAt(x, y) {
	const hx0 = relief(Math.max(0, x - STEP), y);
	const hx1 = relief(Math.min(1, x + STEP), y);
	const hy0 = relief(x, Math.max(0, y - STEP));
	const hy1 = relief(x, Math.min(1, y + STEP));
	const dx = (hx1 - hx0) / (2 * STEP);
	const dy = (hy1 - hy0) / (2 * STEP);
	const inv = 1 / Math.hypot(dx, 1, dy);
	return { x: -dx * inv, y: inv, z: -dy * inv };
}

function normalDelta(a, b) {
	return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function auditEdge(name, axis, boundary, from, to, inwardSign) {
	let sameClassPairs = 0;
	let normalPairs = 0;
	let coastDerivativeSkips = 0;
	let maxHeightJump = 0;
	let maxNormalJump = 0;
	let classTransitions = 0;
	for (let index = 0; index < SAMPLE_COUNT; index += 1) {
		const t = index / (SAMPLE_COUNT - 1);
		const along = from + (to - from) * t;
		const a = axis === 'x'
			? { x: boundary - STEP * inwardSign, y: along }
			: { x: along, y: boundary - STEP * inwardSign };
		const b = axis === 'x'
			? { x: boundary + STEP * inwardSign, y: along }
			: { x: along, y: boundary + STEP * inwardSign };
		if (a.x < 0 || a.x > 1 || a.y < 0 || a.y > 1 || b.x < 0 || b.x > 1 || b.y < 0 || b.y > 1) continue;
		const ha = hydro(a.x, a.y);
		const hb = hydro(b.x, b.y);
		if (ha.water !== hb.water) {
			classTransitions += 1;
			continue;
		}
		sameClassPairs += 1;
		maxHeightJump = Math.max(maxHeightJump, Math.abs(relief(a.x, a.y) - relief(b.x, b.y)));
		if (!derivativeStencilKeepsHydrologyClass(a.x, a.y) || !derivativeStencilKeepsHydrologyClass(b.x, b.y)) {
			coastDerivativeSkips += 1;
			continue;
		}
		normalPairs += 1;
		maxNormalJump = Math.max(maxNormalJump, normalDelta(normalAt(a.x, a.y), normalAt(b.x, b.y)));
	}
	assert.ok(sameClassPairs >= 40, `${name}: insufficient same-class guard pairs ${sameClassPairs}`);
	assert.ok(normalPairs >= 32, `${name}: insufficient coast-stable normal guard pairs ${normalPairs}`);
	assert.ok(maxHeightJump <= 1.5, `${name}: relief height guard jump ${maxHeightJump.toFixed(6)}m`);
	assert.ok(maxNormalJump <= 0.45, `${name}: relief normal guard jump ${maxNormalJump.toFixed(6)}`);
	return { name, sameClassPairs, normalPairs, coastDerivativeSkips, classTransitions, maxHeightJump, maxNormalJump };
}

const edges = [
	auditEdge('west-G00/G10', 'x', CELL.xMin, CELL.yMin, CELL.yMax, 1),
	auditEdge('east-G10/G20', 'x', CELL.xMax, CELL.yMin, CELL.yMax, 1),
	auditEdge('south-G10/G11', 'y', CELL.yMax, CELL.xMin, CELL.xMax, 1),
];

// The north edge lies on the outer reference boundary; prove it remains finite and continuous
// one-sided rather than sampling outside the canonical map.
let northMaxStep = 0;
for (let index = 0; index < SAMPLE_COUNT; index += 1) {
	const x = CELL.xMin + (CELL.xMax - CELL.xMin) * index / (SAMPLE_COUNT - 1);
	const a = relief(x, CELL.yMin);
	const b = relief(x, CELL.yMin + STEP);
	northMaxStep = Math.max(northMaxStep, Math.abs(a - b));
}
assert.ok(northMaxStep <= 1.5, `north outer boundary one-sided jump ${northMaxStep.toFixed(6)}m`);

console.log(JSON.stringify({ status: 'PASS', geoCell: 'G10', edges, northMaxStep }, null, 2));
