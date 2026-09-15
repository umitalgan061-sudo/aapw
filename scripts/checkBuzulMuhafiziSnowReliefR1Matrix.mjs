#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY as POLICY,
  SNOW_RELIEF_FAMILIES,
  resolveTerrainWindSnowSurfaceFabric,
  terrainWindSnowSurfaceFabricDigest,
  resolveTerrainWindSnowContinuity,
  resolveTerrainWindSnowToneHints,
  sanitizeTerrainWindSnowSurfaceFabricInput,
  buildTerrainWindSnowSurfaceFamilyMatrix,
  buildTerrainWindSnowSurfaceProbeLadder,
} from '../src/3d/world/terrainWindSnowSurfaceFabric.js';

const ROOT = path.resolve('artifacts');
const FILES = [
  ['buzul-muhafizi-snow-relief-r1-matrix-01.txt', 256],
  ['buzul-muhafizi-snow-relief-r1-matrix-02.txt', 256],
  ['buzul-muhafizi-snow-relief-r1-matrix-03.txt', 256],
  ['buzul-muhafizi-snow-relief-r1-matrix-04.txt', 256],
  ['buzul-muhafizi-snow-relief-r1-matrix-05.txt', 256],
  ['buzul-muhafizi-snow-relief-r1-matrix-06.txt', 256],
  ['buzul-muhafizi-snow-relief-r1-matrix-07.txt', 256],
  ['buzul-muhafizi-snow-relief-r1-matrix-08.txt', 2048],
  ['buzul-muhafizi-snow-relief-r1-matrix-09.txt', 256],
];
const SLOPES = [0, 2.5, 6, 10, 16, 22, 28, 34, 40, 46, 54, 62, 70, 78, 88, 100];
const FOLDS = [0, 0.01, 0.025, 0.05, 0.09, 0.14, 0.20, 0.28];
const ASPECTS = [-1, -0.5, 0, 0.5];
const RETENTIONS = [0, 0.25, 0.5, 0.75, 1, 0.33, 0.67, 0.9];
const EXPECTED_ROWS = 4096;
const EPS = 1e-9;
const RESULT_KEYS = [
  'slope', 'steepness', 'cliff', 'directional', 'crosswindNeutrality',
  'foldStrength', 'ridgeShoulder', 'brokenRidge', 'shelteredPocket',
  'valleyContinuity', 'slopeTransition', 'windwardAlignment', 'leeAlignment',
  'leeRetention', 'windwardGain', 'leeGain', 'retention', 'ridgeCrust',
  'leePowder', 'continuity', 'materialTemperatureBias', 'materialBrightnessBias',
];

function readShard(file, expected) {
  const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, expected, `${file}: row count drift`);
  lines.forEach((value, index) => {
    assert.match(value, /^\d+$/, `${file}:${index + 1}: non-integer case id`);
    assert.equal(Number(value), index, `${file}:${index + 1}: shard ids must be contiguous`);
  });
  return lines.map(Number);
}

function scenarioForIndex(globalIndex) {
  const variant = Math.floor(globalIndex / 512);
  const local = globalIndex % 512;
  const slopeIndex = Math.floor(local / 32);
  const foldIndex = Math.floor((local % 32) / 4);
  const aspectIndex = local % 4;
  return {
    globalIndex,
    variant,
    slopeDegrees: SLOPES[slopeIndex],
    foldGradient: FOLDS[foldIndex],
    aspectDot: ASPECTS[aspectIndex],
    leeRetention: RETENTIONS[variant],
  };
}

function assertNormalizedNumber(value, label) {
  assert(Number.isFinite(value), `${label}: non-finite`);
  assert(value >= -EPS && value <= 1 + EPS, `${label}: out of normalized range`);
}

assert.equal(POLICY.renderOnly, true, 'surface fabric must remain render-only');
assert.equal(POLICY.deterministic, true, 'surface fabric must remain deterministic');
assert.equal(POLICY.chunkSeamSafe, true, 'surface fabric must remain chunk-seam safe');
assert.equal(POLICY.secondHeightAuthority, false, 'second height authority must stay disabled');
assert.equal(POLICY.worldGridOverlay, false, 'world-grid overlay must stay disabled');
assert.equal(POLICY.periodicStriping, false, 'periodic striping must stay disabled');
assert.equal(POLICY.binaryMasking, false, 'binary masking must stay disabled');
assert.equal(POLICY.minGain < POLICY.maxGain, true, 'gain envelope must be ordered');
assert(Object.isFrozen(POLICY), 'policy must remain frozen');
assert.equal(SNOW_RELIEF_FAMILIES.length, 8, 'relief family count drift');
assert(Object.isFrozen(SNOW_RELIEF_FAMILIES), 'relief families must remain frozen');

const allRows = [];
for (const [file, expected] of FILES) {
  const rows = readShard(file, expected);
  for (const localIndex of rows) allRows.push({ file, localIndex });
}
assert.equal(allRows.length, EXPECTED_ROWS, 'full snow-relief matrix count drift');

const seenSource = new Set();
const seenScenario = new Set();
for (let index = 0; index < allRows.length; index += 1) {
  const row = scenarioForIndex(index);
  const source = allRows[index];
  const sourceKey = `${source.file}:${source.localIndex}`;
  assert(!seenSource.has(sourceKey), `duplicate source row ${sourceKey}`);
  seenSource.add(sourceKey);

  const scenarioKey = `${row.variant}:${row.slopeDegrees}:${row.foldGradient}:${row.aspectDot}`;
  assert(!seenScenario.has(scenarioKey), `duplicate production scenario ${scenarioKey}`);
  seenScenario.add(scenarioKey);

  const input = {
    slopeDegrees: row.slopeDegrees,
    aspectDot: row.aspectDot,
    foldGradient: row.foldGradient,
    leeRetention: row.leeRetention,
  };
  const first = resolveTerrainWindSnowSurfaceFabric(input);
  const second = resolveTerrainWindSnowSurfaceFabric(input);
  assert.deepEqual(first, second, `resolver instability at case ${index}`);
  assert(Object.isFrozen(first), `resolver result must be frozen at case ${index}`);

  const sanitized = sanitizeTerrainWindSnowSurfaceFabricInput(input);
  assert.deepEqual(sanitized, {
    slopeDegrees: row.slopeDegrees,
    aspectDot: row.aspectDot,
    foldGradient: row.foldGradient,
    foldStrength: null,
    leeRetention: row.leeRetention,
  }, `sanitizer drift at case ${index}`);

  const digestA = terrainWindSnowSurfaceFabricDigest(first);
  const digestB = terrainWindSnowSurfaceFabricDigest(second);
  assert.equal(digestA, digestB, `digest instability at case ${index}`);
  assert.equal(digestA.split('|').length, RESULT_KEYS.length, `digest field count drift at case ${index}`);

  for (const key of RESULT_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(first, key), true, `${key} missing at case ${index}`);
    if (key === 'materialTemperatureBias' || key === 'materialBrightnessBias') {
      assert(Number.isFinite(first[key]), `${key} non-finite at case ${index}`);
      assert(first[key] >= -1 - EPS && first[key] <= 1 + EPS, `${key} out of signed range at case ${index}`);
    } else if (key === 'windwardGain' || key === 'leeGain') {
      assert(first[key] >= POLICY.minGain - EPS && first[key] <= POLICY.maxGain + EPS, `${key} outside gain envelope at case ${index}`);
    } else {
      assertNormalizedNumber(first[key], `${key} case ${index}`);
    }
  }

  const continuity = resolveTerrainWindSnowContinuity(input);
  assertNormalizedNumber(continuity, `continuity case ${index}`);
  const hints = resolveTerrainWindSnowToneHints(input);
  assert(Object.isFrozen(hints), `tone hints must be frozen at case ${index}`);
  for (const [key, value] of Object.entries(hints)) {
    assert(Number.isFinite(value), `tone hint ${key} non-finite at case ${index}`);
    assert(value >= -1 - EPS && value <= 1 + EPS, `tone hint ${key} out of range at case ${index}`);
  }
}

assert.equal(seenSource.size, EXPECTED_ROWS, 'source uniqueness drift');
assert.equal(seenScenario.size, EXPECTED_ROWS, 'scenario tuple uniqueness drift');

for (const fixture of [
  { slopeDegrees: 22, foldGradient: 0.14 },
  { slopeDegrees: 34, foldGradient: 0.20 },
  { slopeDegrees: 62, foldGradient: 0.12 },
  { slopeDegrees: 70, foldGradient: 0.28 },
]) {
  const positive = resolveTerrainWindSnowSurfaceFabric({ ...fixture, aspectDot: 0.5 });
  const negative = resolveTerrainWindSnowSurfaceFabric({ ...fixture, aspectDot: -0.5 });
  assert(Math.abs(positive.crosswindNeutrality - negative.crosswindNeutrality) <= EPS, `crosswind symmetry drift at slope ${fixture.slopeDegrees}`);
  assert(positive.ridgeCrust + EPS >= negative.ridgeCrust, `windward ridge crust regression at slope ${fixture.slopeDegrees}`);
  assert(negative.leePowder + EPS >= positive.leePowder, `lee powder regression at slope ${fixture.slopeDegrees}`);
}

for (const aspectDot of [-0.5, 0, 0.5]) {
  let previous = null;
  for (const foldGradient of FOLDS) {
    const current = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 22, foldGradient, aspectDot }).continuity;
    if (previous !== null) assert(current + EPS >= previous, `continuity regressed with stronger fold at aspect ${aspectDot}`);
    previous = current;
  }
}

const familyMatrix = buildTerrainWindSnowSurfaceFamilyMatrix({ directions: 8, aspectMagnitude: 0.82 });
assert.equal(familyMatrix.length, SNOW_RELIEF_FAMILIES.length * 8, 'family matrix cardinality drift');
assert(Object.isFrozen(familyMatrix), 'family matrix must be frozen');
assert.equal(new Set(familyMatrix.map((row) => row.family)).size, SNOW_RELIEF_FAMILIES.length, 'family coverage drift');
assert.deepEqual(familyMatrix, buildTerrainWindSnowSurfaceFamilyMatrix({ directions: 8, aspectMagnitude: 0.82 }), 'family matrix determinism drift');

const ladder = buildTerrainWindSnowSurfaceProbeLadder();
assert.equal(ladder.length, 12 * 8 * 11, 'probe ladder cardinality drift');
assert(Object.isFrozen(ladder), 'probe ladder must be frozen');
assert.deepEqual(ladder, buildTerrainWindSnowSurfaceProbeLadder(), 'probe ladder determinism drift');
for (const row of ladder) {
  assert(Number.isFinite(row.continuity), 'probe continuity non-finite');
  assert(Number.isFinite(row.windwardGain), 'probe windward gain non-finite');
  assert(Number.isFinite(row.leeGain), 'probe lee gain non-finite');
  assert(typeof row.digest === 'string' && row.digest.includes('ridgeCrust='), 'probe digest contract drift');
}

for (const candidate of [
  { slopeDegrees: NaN, aspectDot: Infinity, foldGradient: -Infinity, leeRetention: NaN },
  { slopeDegrees: -90, aspectDot: 4, foldGradient: -2, leeRetention: 3 },
  {},
  null,
]) {
  const safe = sanitizeTerrainWindSnowSurfaceFabricInput(candidate ?? {});
  const result = resolveTerrainWindSnowSurfaceFabric(safe);
  for (const key of RESULT_KEYS) assert(Number.isFinite(result[key]), `malformed result ${key} became non-finite`);
}

console.log(`Buzul Muhafızı R1 snow-relief matrix OK: ${allRows.length} production-derived cases, ${SNOW_RELIEF_FAMILIES.length} relief families, ${ladder.length} probe vectors`);
