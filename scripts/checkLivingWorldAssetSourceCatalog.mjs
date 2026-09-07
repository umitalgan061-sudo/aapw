import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const geographyPath = path.join(root, 'src/3d/gameplay/livingWorldGeographyAdapter.js');
const source = fs.readFileSync(geographyPath, 'utf8');
const references = [...source.matchAll(/assets\/models\/(?:characters|animals|creatures|dragons|fbx)\/[A-Za-z0-9_./-]+\.(?:fbx|glb|blend)/g)].map((match) => match[0]);
const unique = [...new Set(references)].sort();
assert.ok(unique.length >= 15, `expected authored living-world asset references, got ${unique.length}`);

const report = [];
const missing = [];
const pointerOnly = [];
const materializable = [];
for (const relative of unique) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    missing.push(relative);
    continue;
  }
  const stat = fs.statSync(absolute);
  assert.ok(stat.isFile(), `${relative} must resolve to a file`);
  const head = fs.readFileSync(absolute, { encoding: 'utf8', flag: 'r' }).slice(0, 120);
  const isPointer = head.startsWith('version https://git-lfs.github.com/spec/v1');
  if (isPointer) pointerOnly.push(relative); else if (stat.size > 0) materializable.push(relative);
  report.push({ path: relative, bytes: stat.size, state: isPointer ? 'lfs-pointer' : 'materialized' });
}

assert.equal(missing.length, 0, `missing authored asset references:\n${missing.join('\n')}`);
assert.equal(report.length, unique.length);
assert.equal(new Set(report.map((entry) => entry.path)).size, unique.length);
assert.ok(pointerOnly.length + materializable.length === unique.length);

const catalogText = report.map((entry) => `${entry.path}:${entry.state}:${entry.bytes}`).join('|');
let hash = 2166136261;
for (const char of catalogText) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619) >>> 0; }
const digest = (hash >>> 0).toString(16).padStart(8, '0');

console.log(JSON.stringify({
  ok: true,
  source: 'livingWorldGeographyAdapter.js',
  referencedAssetCount: unique.length,
  lfsPointerCount: pointerOnly.length,
  materializedCount: materializable.length,
  missingCount: missing.length,
  digest,
}));
console.log('LIVING_WORLD_ASSET_SOURCE_CATALOG_PASS');
