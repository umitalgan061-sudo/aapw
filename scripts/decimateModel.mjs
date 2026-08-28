#!/usr/bin/env node
/**
 * Thins a `.glb` down to something a rigger will accept — `scripts/lib/glbDecimate.mjs` plus
 * `scripts/lib/glbWrite.mjs`, wired to the command line.
 *
 * Usage: node scripts/decimateModel.mjs <input.glb> <output.glb> [targetTriangles]
 *
 * `targetTriangles` defaults to 40,000: comfortably inside Mixamo's limits and inside this project's
 * own per-model budgets, while keeping a silhouette. The grid resolution that hits it is found by
 * bisection rather than guessed, because the relationship between cell size and triangle count depends
 * entirely on how the sculpt fills its bounding box.
 */
import fs from 'node:fs';
import { parseGlb, flattenToSingleMesh, decimateByGrid } from './lib/glbDecimate.mjs';
import { writeSingleMeshGlb } from './lib/glbWrite.mjs';

const [input, output, target = '40000'] = process.argv.slice(2);
if (!input || !output) {
	console.error('usage: node scripts/decimateModel.mjs <input.glb> <output.glb> [targetTriangles]');
	process.exit(2);
}
const targetTriangles = Number(target);

const source = parseGlb(fs.readFileSync(input));
const flat = flattenToSingleMesh(source);
const sourceTriangles = flat.indices.length / 3;
console.log(`[decimate] ${input}: ${sourceTriangles.toLocaleString()} triangles, ${flat.positions.length / 3} vertices`);

// Bisect the grid resolution. The count rises monotonically with resolution, so this converges.
let low = 8;
let high = 512;
let best = null;
for (let step = 0; step < 12; step += 1) {
	const middle = Math.round((low + high) / 2);
	const candidate = decimateByGrid(flat, middle);
	const triangles = candidate.indices.length / 3;
	if (triangles <= targetTriangles) { best = { grid: middle, mesh: candidate, triangles }; low = middle; }
	else high = middle;
	if (high - low <= 1) break;
}
if (!best) best = { grid: 8, mesh: decimateByGrid(flat, 8), triangles: 0 };

const bytes = writeSingleMeshGlb(best.mesh, source);
fs.writeFileSync(output, bytes);
const reduction = (100 * (1 - best.triangles / sourceTriangles)).toFixed(1);
console.log(
	`[decimate] ${output}: ${best.triangles.toLocaleString()} triangles `
	+ `(${reduction}% fewer, grid ${best.grid}), ${(bytes.length / (1024 * 1024)).toFixed(1)} MB `
	+ `from ${(fs.statSync(input).size / (1024 * 1024)).toFixed(1)} MB`,
);
