import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveTerrainWindSnowSurfaceFabric } from '../src/3d/world/terrainWindSnowSurfaceFabric.js';
const file = 'artifacts/buzul-muhafizi-snow-relief-r2-matrix.jsonl';
assert.equal(fs.existsSync(file), true, 'R2 corpus must be materialized before contract check');
const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
assert.equal(lines.length, 4097, 'R2 corpus must have 4096 cases plus header');
const header = JSON.parse(lines[0]);
assert.equal(header.cases, 4096);
for (let i = 1; i < lines.length; i += 1) {
  const row = JSON.parse(lines[i]);
  const result = resolveTerrainWindSnowSurfaceFabric(row.inputs);
  assert.equal(typeof result.ridgeCrust, 'number');
  assert.equal(typeof result.leePowder, 'number');
}
console.log('Buzul Muhafızı R2 contract smoke check: 4096 cases');
