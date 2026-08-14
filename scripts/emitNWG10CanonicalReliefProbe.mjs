#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sampleReferenceWaterMask } from '../src/3d/world/worldReferenceWaterMask.js';
import { WORLD_REFERENCE_RELIEF_POLICY, sampleWorldReferenceRelief } from '../godot/terrain-authoring/lib/worldReferenceReliefField.mjs';

const G10 = Object.freeze({ xMin: 1 / 8, xMax: 2 / 8, yMin: 0, yMax: 1 / 8 });
const SIZE = 65;
const outputArg = process.argv.find((arg) => arg.startsWith('--out='));
if (!outputArg) throw new Error('usage: emitNWG10CanonicalReliefProbe.mjs --out=<path>');
const output = outputArg.slice('--out='.length);

const rows = [];
let waterSamples = 0;
let landSamples = 0;
let maxHeight = -Infinity;
let minHeight = Infinity;
let waterMaxAbs = 0;

for (let row = 0; row < SIZE; row += 1) {
	const y = G10.yMin + (G10.yMax - G10.yMin) * row / (SIZE - 1);
	const values = [];
	for (let col = 0; col < SIZE; col += 1) {
		const x = G10.xMin + (G10.xMax - G10.xMin) * col / (SIZE - 1);
		const water = sampleReferenceWaterMask(x, y);
		const relief = sampleWorldReferenceRelief(x, y, { water, protectedLand: false });
		const height = Number(relief.heightDeltaMeters.toFixed(6));
		values.push(height);
		if (water) {
			waterSamples += 1;
			waterMaxAbs = Math.max(waterMaxAbs, Math.abs(height));
		} else {
			landSamples += 1;
			minHeight = Math.min(minHeight, height);
			maxHeight = Math.max(maxHeight, height);
		}
	}
	rows.push(values);
}

if (waterMaxAbs > 1e-12) throw new Error(`canonical water relief is non-zero: ${waterMaxAbs}`);
if (!(maxHeight >= WORLD_REFERENCE_RELIEF_POLICY.minimumG10LandPeakMeters)) {
	throw new Error(`G10 peak ${maxHeight} below ${WORLD_REFERENCE_RELIEF_POLICY.minimumG10LandPeakMeters}`);
}

const payload = {
	schema: 'nw-g10-canonical-relief-probe-v1',
	policyId: WORLD_REFERENCE_RELIEF_POLICY.id,
	mapSha256: WORLD_REFERENCE_RELIEF_POLICY.mapSha256,
	geoCell: 'G10',
	layer: 'Relief/Height Character refinement',
	sourceGridSize: SIZE,
	bounds: G10,
	waterSamples,
	landSamples,
	waterMaxAbs,
	minHeight,
	maxHeight,
	rows,
};
payload.sha256 = crypto.createHash('sha256').update(JSON.stringify(payload.rows)).digest('hex');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(payload)}\n`);
console.log(`NW_G10_CANONICAL_RELIEF_PROBE_OK ${output} ${payload.sha256}`);
