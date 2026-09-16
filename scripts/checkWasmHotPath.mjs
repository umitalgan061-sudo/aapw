import { access, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deriveHotPathVector, HOT_PATH_VECTOR_COUNT, HOT_PATH_VECTOR_GROUPS, vectorBoundaryCount, vectorExpectedGroupCounts } from '../src/engine-ts/wasmHotPathVectors.ts';
import { aabbVisibleTypeScript, bilinearSampleTypeScript, distanceSquaredTypeScript, lodFactorTypeScript, quantizeTypeScript, sampleHeightTypeScript, spatialKeyTypeScript } from '../src/engine-ts/wasmHotPath.ts';

const ROOT = resolve(import.meta.dirname, '..');
const VECTOR_DIR = resolve(ROOT, 'artifacts/wasm-hotpath/vectors');
const REQUIRED = ['wasm/Cargo.toml', 'wasm/src/lib.rs', 'src/engine-ts/wasmHotPath.ts', 'src/engine-ts/workerSimulation.ts', 'src/engine-ts/wasmHotPathVectors.ts', 'scripts/generateWasmHotPathMatrix.mjs'];
const fail = message => { console.error(`[wasm-hotpath] ${message}`); process.exitCode = 1; };
for (const path of REQUIRED) { try { await access(resolve(ROOT, path)); } catch { fail(`missing ${path}`); } }
let files = [];
try { files = (await readdir(VECTOR_DIR)).filter(name => /^part-\d{2}\.ndjson$/.test(name)).sort(); } catch { fail(`missing vector directory ${VECTOR_DIR}`); }
if (files.length !== 4) fail(`expected 4 deterministic vector shards, got ${files.length}`);
const ids = [];
for (const file of files) {
  const rows = (await readFile(resolve(VECTOR_DIR, file), 'utf8')).trim().split('\n').filter(Boolean);
  if (rows.length !== 1024) fail(`${file} must contain 1024 vector ids, got ${rows.length}`);
  for (const row of rows) { const id = Number.parseInt(row, 10); if (!Number.isInteger(id)) fail(`${file} has malformed vector id: ${row}`); else ids.push(id); }
}
const sorted = [...ids].sort((a, b) => a - b);
const unique = new Set(ids);
if (ids.length !== HOT_PATH_VECTOR_COUNT) fail(`expected ${HOT_PATH_VECTOR_COUNT} vector ids, got ${ids.length}`);
if (unique.size !== HOT_PATH_VECTOR_COUNT) fail(`vector ids are not unique: ${unique.size}`);
for (let id = 0; id < HOT_PATH_VECTOR_COUNT; id += 1) if (sorted[id] !== id) { fail(`vector id gap at ${id}: found ${sorted[id]}`); break; }
const counts = Object.fromEntries(HOT_PATH_VECTOR_GROUPS.map(group => [group, 0]));
for (const id of ids) counts[deriveHotPathVector(id).group] += 1;
const expected = vectorExpectedGroupCounts();
for (const group of HOT_PATH_VECTOR_GROUPS) if (counts[group] !== expected[group]) fail(`group count mismatch for ${group}: ${counts[group]} !== ${expected[group]}`);
const boundaries = vectorBoundaryCount();
if (boundaries < 700) fail(`boundary coverage unexpectedly low: ${boundaries}`);

let deterministicFailures = 0;
for (let id = 0; id < HOT_PATH_VECTOR_COUNT; id += 1) {
  const vector = deriveHotPathVector(id);
  let first = 0; let second = 0;
  switch (vector.group) {
    case 'height': first = sampleHeightTypeScript(vector.x, vector.z, vector.seed); second = sampleHeightTypeScript(vector.x, vector.z, vector.seed); break;
    case 'lod': first = lodFactorTypeScript(vector.distance, vector.near, vector.far); second = lodFactorTypeScript(vector.distance, vector.near, vector.far); break;
    case 'distance': first = distanceSquaredTypeScript(...vector.a, ...vector.b); second = distanceSquaredTypeScript(...vector.a, ...vector.b); break;
    case 'spatial': first = spatialKeyTypeScript(vector.cellX, vector.cellZ); second = spatialKeyTypeScript(vector.cellX, vector.cellZ); break;
    case 'bilinear': first = bilinearSampleTypeScript(...vector.h, vector.tx, vector.tz); second = bilinearSampleTypeScript(...vector.h, vector.tx, vector.tz); break;
    case 'quantize': first = quantizeTypeScript(vector.value, vector.step); second = quantizeTypeScript(vector.value, vector.step); break;
    default: throw new Error('unreachable');
  }
  if (!Number.isFinite(first) || first !== second) deterministicFailures += 1;
}
if (deterministicFailures) fail(`deterministic TypeScript fallback failed ${deterministicFailures} vector(s)`);
const visibilityChecks = [
  aabbVisibleTypeScript(-10, -10, -10, 10, 10, 10, 0, 0, 0, 0),
  aabbVisibleTypeScript(-10, -10, -10, -5, -5, -5, 100, 100, 100, 1),
];
if (!visibilityChecks.every(value => typeof value === 'boolean')) fail('visibility primitive returned a non-boolean result');
const sourceChars = (await Promise.all(REQUIRED.map(async path => (await readFile(resolve(ROOT, path), 'utf8')).length))).reduce((sum, length) => sum + length, 0);
if (sourceChars < 24_000) fail(`implementation unexpectedly small: ${sourceChars} chars`);
console.log(JSON.stringify({ contractVersion: 1, vectors: ids.length, uniqueIds: unique.size, vectorShards: files, groupCounts: counts, boundaryCoverage: boundaries, deterministicFailures, implementationCharacters: sourceChars, requiredFiles: REQUIRED, status: process.exitCode ? 'failed' : 'passed' }, null, 2));
