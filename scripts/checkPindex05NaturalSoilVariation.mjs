#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PINDEX05_DETAIL_POLICY,
  resolvePindex05NaturalSoilSignals,
} from '../src/3d/world/worldReferencePindex05Detail.js';
import { referencePindexFromNormalizedX } from '../src/3d/world/worldReferenceSurfacePindexes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, '../src/3d/world/worldReferencePindex05Detail.js'), 'utf8');

assert.equal(PINDEX05_DETAIL_POLICY.pindex, 5);
assert.equal(PINDEX05_DETAIL_POLICY.naturalSoilFabric, true);
assert.equal(PINDEX05_DETAIL_POLICY.worldSpaceNormalWeathering, true);
assert.equal(PINDEX05_DETAIL_POLICY.normalStrengthBySurface.sea, 0);
assert.equal(PINDEX05_DETAIL_POLICY.normalStrengthBySurface.lake, 0);
assert.equal(referencePindexFromNormalizedX(0.45), 5);
assert.equal(PINDEX05_DETAIL_POLICY.pindexStartX, 0.4);
assert.equal(PINDEX05_DETAIL_POLICY.pindexEndX, 0.5);

const westEdge = resolvePindex05NaturalSoilSignals(0.4, 0.52);
const eastEdge = resolvePindex05NaturalSoilSignals(0.5, 0.52);
const interior = resolvePindex05NaturalSoilSignals(0.45, 0.52);
assert.equal(westEdge.edgeMask, 0, 'west Pindex boundary must feather to zero');
assert.equal(eastEdge.edgeMask, 0, 'east Pindex boundary must feather to zero');
assert.ok(interior.edgeMask > 0.99, 'Pindex interior must retain full natural soil fabric');
assert.deepEqual(interior, resolvePindex05NaturalSoilSignals(0.45, 0.52), 'soil fabric must be deterministic');

const samples = [];
for (let iy = 0; iy < 13; iy += 1) {
  for (let ix = 0; ix < 13; ix += 1) {
    const nx = 0.414 + (ix / 12) * 0.072;
    const ny = 0.08 + (iy / 12) * 0.84;
    samples.push(resolvePindex05NaturalSoilSignals(nx, ny));
  }
}
const range = (key) => {
  const values = samples.map((sample) => sample[key]);
  return Math.max(...values) - Math.min(...values);
};
assert.ok(range('moisture') > 0.32, `macro moisture range too flat: ${range('moisture')}`);
assert.ok(range('mineralDry') > 0.28, `mineral/dry range too flat: ${range('mineralDry')}`);
assert.ok(range('luminance') > 0.55, `multi-scale luminance range too flat: ${range('luminance')}`);
assert.ok(samples.every((sample) => sample.edgeMask >= 0 && sample.edgeMask <= 1));
assert.ok(samples.every((sample) => sample.moisture >= 0 && sample.moisture <= 1));
assert.ok(samples.every((sample) => sample.mineralDry >= 0 && sample.mineralDry <= 1));

assert.match(SOURCE, /if \(c\.surface === 'soil'\)/);
assert.match(SOURCE, /scratch\.lerp\(WET_SOIL, wetWeight\)/);
assert.match(SOURCE, /scratch\.lerp\(DRY_HEATH, dryWeight\)/);
assert.match(SOURCE, /getAttribute\?\.\('normal'\)/);
assert.match(SOURCE, /applyPindex05WeatheredNormal\(/);
assert.match(SOURCE, /normal\.setXYZ\(/);
assert.doesNotMatch(SOURCE, /position\.set[XYZ]\(/);
assert.doesNotMatch(SOURCE, /geometry\.setAttribute\(['"]position['"]/);
assert.doesNotMatch(SOURCE, /createHeightSampler|waterDepth|collider|hydrology/i);

console.log('[checkPindex05NaturalSoilVariation] PASS', JSON.stringify({
  policyId: PINDEX05_DETAIL_POLICY.id,
  sampleCount: samples.length,
  moistureRange: Number(range('moisture').toFixed(4)),
  mineralDryRange: Number(range('mineralDry').toFixed(4)),
  luminanceRange: Number(range('luminance').toFixed(4)),
}));