#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY as POLICY,
  resolveTerrainWindSnowSurfaceFabric,
  resolveTerrainWindSnowContinuity,
  resolveTerrainWindSnowToneHints,
  terrainWindSnowSurfaceFabricDigest,
} from '../src/3d/world/terrainWindSnowSurfaceFabric.js';

const SLOPES = [0, 2.5, 6, 10, 16, 22, 28, 34];
const FOLDS = [0, 0.01, 0.025, 0.05, 0.09, 0.14, 0.20, 0.28];
const ASPECTS = [-1, -0.82, -0.58, -0.30, 0, 0.30, 0.58, 0.82];
const RETENTIONS = [0, 0.14, 0.28, 0.42, 0.56, 0.70, 0.84, 1];
const corpusFiles = fs.readdirSync('artifacts')
  .filter((name) => /^buzul-muhafizi-snow-relief-r2-corpus-\d+\.jsonl$/.test(name))
  .sort();
assert.equal(corpusFiles.length, 10, 'R2 corpus must contain ten deterministic shards');

const rows = corpusFiles.flatMap((name) => fs.readFileSync(`artifacts/${name}`, 'utf8')
  .split(/\r?\n/).filter(Boolean).map((line) => ({ name, ...JSON.parse(line) })));
assert.equal(rows.length, 4096, 'R2 corpus must contain exactly 4096 indexed cases');
assert.equal(POLICY.deterministic, true, 'production policy must remain deterministic');
assert.equal(POLICY.renderOnly, true, 'snow relief must remain render-only');
assert.equal(POLICY.secondHeightAuthority, false, 'second height authority must remain disabled');
assert.equal(POLICY.worldGridOverlay, false, 'world-grid overlay must remain disabled');
assert.equal(POLICY.periodicStriping, false, 'periodic striping must remain disabled');
assert.equal(POLICY.binaryMasking, false, 'binary masking must remain disabled');

const indexes = new Set();
const dimensions = new Set();
const digestSet = new Set();
const counts = { slope: new Map(), fold: new Map(), aspect: new Map(), retention: new Map() };
const expectedDigest = (input) => terrainWindSnowSurfaceFabricDigest(resolveTerrainWindSnowSurfaceFabric(input));
function addCount(map, key) { map.set(key, (map.get(key) ?? 0) + 1); }

for (const row of rows) {
  assert(Number.isInteger(row.index) && row.index >= 0 && row.index < 4096, `${row.name}: invalid index`);
  assert(!indexes.has(row.index), `duplicate corpus index ${row.index}`);
  indexes.add(row.index);
  const retentionIndex = Math.floor(row.index / 512);
  const withinRetention = row.index % 512;
  const slopeIndex = Math.floor(withinRetention / 64);
  const withinSlope = withinRetention % 64;
  const foldIndex = Math.floor(withinSlope / 8);
  const aspectIndex = withinSlope % 8;
  const input = {
    slopeDegrees: SLOPES[slopeIndex],
    foldGradient: FOLDS[foldIndex],
    aspectDot: ASPECTS[aspectIndex],
    leeRetention: RETENTIONS[retentionIndex],
  };
  const dimensionKey = Object.values(input).join(':');
  assert(!dimensions.has(dimensionKey), `duplicate production dimension tuple ${dimensionKey}`);
  dimensions.add(dimensionKey);
  addCount(counts.slope, input.slopeDegrees);
  addCount(counts.fold, input.foldGradient);
  addCount(counts.aspect, input.aspectDot);
  addCount(counts.retention, input.leeRetention);

  const first = resolveTerrainWindSnowSurfaceFabric(input);
  const second = resolveTerrainWindSnowSurfaceFabric(input);
  assert.deepEqual(first, second, `non-deterministic resolver at ${row.index}`);
  assert.equal(expectedDigest(input), first ? terrainWindSnowSurfaceFabricDigest(first) : '', `digest resolution failure at ${row.index}`);
  digestSet.add(terrainWindSnowSurfaceFabricDigest(first));
  assert(Number.isFinite(resolveTerrainWindSnowContinuity(input)), `continuity failure at ${row.index}`);
  assert(Object.values(resolveTerrainWindSnowToneHints(input)).every(Number.isFinite), `tone failure at ${row.index}`);
}

assert.equal(indexes.size, 4096, 'index coverage drift');
assert.equal(dimensions.size, 4096, 'dimension coverage drift');
assert.equal(digestSet.size > 256, true, 'corpus does not exercise sufficient resolver diversity');
for (const map of Object.values(counts)) for (const count of map.values()) assert.equal(count, 512, 'dimension cardinality drift');

const baseline = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 22, foldGradient: 0.14, aspectDot: 0, leeRetention: 0 });
const lee = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 22, foldGradient: 0.14, aspectDot: -0.82, leeRetention: 1 });
const windward = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 22, foldGradient: 0.14, aspectDot: 0.82, leeRetention: 0 });
assert(lee.leePowder >= baseline.leePowder, 'lee alignment regressed accumulation');
assert(windward.ridgeCrust >= baseline.ridgeCrust, 'windward alignment regressed crust');

console.log(`Buzul Muhafızı R2 corpus validation OK: ${rows.length} deterministic cases across ${corpusFiles.length} shards`);
