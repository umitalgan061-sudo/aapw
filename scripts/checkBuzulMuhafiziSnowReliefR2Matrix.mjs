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

const FILE = 'artifacts/buzul-muhafizi-snow-relief-r2-matrix.jsonl';
const expectedCases = 4096;
const expectedDimensions = { slopes: 8, folds: 8, aspects: 8, retentions: 8 };
const lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/).filter(Boolean);
assert.equal(lines.length, expectedCases + 1, 'R2 corpus must contain one header plus 4096 cases');

const header = JSON.parse(lines[0]);
assert.deepEqual(header.dimensions, expectedDimensions, 'dimension contract drift');
assert.equal(header.cases, expectedCases, 'case-count contract drift');
assert.equal(header.deterministic, true, 'determinism contract drift');
assert.equal(header.renderOnly, true, 'render-only contract drift');
assert.equal(POLICY.secondHeightAuthority, false, 'second height authority must remain disabled');
assert.equal(POLICY.worldGridOverlay, false, 'world-grid overlay must remain disabled');
assert.equal(POLICY.periodicStriping, false, 'periodic striping must remain disabled');
assert.equal(POLICY.binaryMasking, false, 'binary masking must remain disabled');

const ids = new Set();
const dimensionKeys = new Set();
const tolerance = 1e-8;
function approx(actual, expected, label) {
  assert(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
}
function checkBounded(value, label) {
  assert(Number.isFinite(value), `${label}: non-finite`);
  assert(value >= -1 - tolerance && value <= 1 + tolerance, `${label}: out of safe range`);
}

for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
  const row = JSON.parse(lines[lineIndex]);
  assert.equal(row.index, lineIndex - 1, `case index drift at ${lineIndex}`);
  assert.match(row.caseId, /^r2-\d{4}$/);
  assert.equal(row.caseId, `r2-${String(row.index).padStart(4, '0')}`);
  assert(!ids.has(row.caseId), `duplicate case id ${row.caseId}`);
  ids.add(row.caseId);

  const { slopeDegrees, foldGradient, aspectDot, leeRetention } = row.inputs;
  assert(Number.isFinite(slopeDegrees), `invalid slope at ${row.caseId}`);
  assert(Number.isFinite(foldGradient), `invalid fold at ${row.caseId}`);
  assert(Number.isFinite(aspectDot), `invalid aspect at ${row.caseId}`);
  assert(Number.isFinite(leeRetention), `invalid retention at ${row.caseId}`);
  const dimensionKey = [slopeDegrees, foldGradient, aspectDot, leeRetention].join(':');
  assert(!dimensionKeys.has(dimensionKey), `duplicate dimension tuple ${dimensionKey}`);
  dimensionKeys.add(dimensionKey);

  const first = resolveTerrainWindSnowSurfaceFabric(row.inputs);
  const second = resolveTerrainWindSnowSurfaceFabric(row.inputs);
  assert.deepEqual(first, second, `${row.caseId}: resolver is not deterministic`);
  assert.equal(terrainWindSnowSurfaceFabricDigest(first), row.expected.digest, `${row.caseId}: digest drift`);
  approx(resolveTerrainWindSnowContinuity(row.inputs), row.expected.continuity, `${row.caseId}: continuity`);
  approx(first.ridgeCrust, row.expected.ridgeCrust, `${row.caseId}: ridgeCrust`);
  approx(first.leePowder, row.expected.leePowder, `${row.caseId}: leePowder`);
  approx(first.windwardGain, row.expected.windwardGain, `${row.caseId}: windwardGain`);
  approx(first.leeGain, row.expected.leeGain, `${row.caseId}: leeGain`);

  const tone = resolveTerrainWindSnowToneHints(row.inputs);
  for (const [key, expected] of Object.entries(row.expected.tone)) approx(tone[key], expected, `${row.caseId}: tone.${key}`);
  for (const [key, value] of Object.entries(first)) checkBounded(value, `${row.caseId}: ${key}`);
}

assert.equal(ids.size, expectedCases, 'case identity coverage drift');
assert.equal(dimensionKeys.size, expectedCases, 'production dimension coverage drift');

const baseline = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 22, foldGradient: 0.14, aspectDot: 0, leeRetention: 0 });
const lee = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 22, foldGradient: 0.14, aspectDot: -0.82, leeRetention: 1 });
const windward = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 22, foldGradient: 0.14, aspectDot: 0.82, leeRetention: 0 });
assert(lee.leePowder >= baseline.leePowder, 'lee alignment must not reduce powder accumulation');
assert(windward.ridgeCrust >= baseline.ridgeCrust, 'windward alignment must not reduce ridge crust');
assert(lee.leeGain + tolerance >= baseline.leeGain, 'lee retention gain must not regress baseline');

const malformed = [
  { slopeDegrees: NaN, aspectDot: Infinity, foldGradient: -Infinity, leeRetention: NaN },
  { slopeDegrees: -50, aspectDot: 9, foldGradient: -2, leeRetention: 9 },
  {},
];
for (const input of malformed) {
  const result = resolveTerrainWindSnowSurfaceFabric(input);
  for (const [key, value] of Object.entries(result)) checkBounded(value, `malformed ${key}`);
}

console.log(`Buzul Muhafızı R2 snow-relief validation OK: ${ids.size} deterministic production-derived cases`);
