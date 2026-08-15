#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PROOF = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const VISUAL = path.join(ROOT, 'artifacts/ne-g60-rock-snow-visual');
const probePath = path.join(PROOF, 'g60-rock-snow-probe.json');
const bakePath = path.join(PROOF, 'g60-rock-snow-bake.json');
const visualPath = path.join(VISUAL, 'g60-rock-snow-visual-metrics.json');
for (const file of [probePath, bakePath, visualPath]) assert.ok(fs.statSync(file).size > 0, `missing evidence ${file}`);
const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
const bake = JSON.parse(fs.readFileSync(bakePath, 'utf8'));
const visual = JSON.parse(fs.readFileSync(visualPath, 'utf8'));
const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const POLICY = 'safak-kartali-g60-terrain3d-rock-snow-2026-08-15-v1';
assert.equal(probe.policyId, POLICY);
assert.equal(probe.sourceMapSha256, MAP_SHA);
assert.equal(visual.sourceMapSha256, MAP_SHA);
assert.equal(probe.geoCell, 'G60');
assert.equal(probe.layer, 'Rock/Snow');
assert.equal(probe.rows.length, 65);
assert.equal(bake.regionCount >= 4, true);
assert.equal(bake.alignedSamples, 4225);
assert.equal(bake.seamSamples, 60);
assert.equal(bake.maxActualBlend, 0);
assert.ok(bake.maxHeightError <= 0.001 && bake.maxSeamHeightError <= 0.001);
assert.ok(bake.maxColorError <= 0.006 && bake.maxRoughnessError <= 0.006 && bake.maxSeamMaterialError <= 0.006);
assert.equal(visual.surfaceMetrics.maxRockWeight, 0);
assert.equal(visual.surfaceMetrics.maxSnowWeight, 0);
assert.equal(visual.local.minHeight, -8);
assert.equal(visual.local.maxHeight, -8);
assert.equal(visual.topdown.g60PatchAlpha, 0);
assert.equal(visual.topdown.gridOverlay, false);
assert.ok(visual.topdown.maxAdjacentChannelDelta <= 16);
const pngs = ['near', 'far', 'fullWorld'];
for (const key of pngs) assert.match(visual.sha256[key], /^[0-9a-f]{64}$/);
assert.equal(new Set(pngs.map((key) => visual.sha256[key])).size, 3);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(visual.sha256.near, sha256(path.join(VISUAL, 'g60-rock-snow-near.png')));
assert.equal(visual.sha256.far, sha256(path.join(VISUAL, 'g60-rock-snow-far.png')));
assert.equal(visual.sha256.fullWorld, sha256(path.join(VISUAL, 'g60-rock-snow-full-world.png')));
const manifest = {
  schema: 'westeros-g60-rock-snow-evidence-v1', policyId: POLICY, sourceMapSha256: MAP_SHA,
  probeSha256: sha256(probePath), bakeSha256: sha256(bakePath), visualMetricsSha256: sha256(visualPath),
  regionCount: bake.regionCount, alignedSamples: bake.alignedSamples, seamSamples: bake.seamSamples,
  bakedVertices: bake.bakedVertices, maxAdjacentChannelDelta: visual.topdown.maxAdjacentChannelDelta,
  imageSha256: visual.sha256,
};
fs.writeFileSync(path.join(PROOF, 'g60-rock-snow-evidence.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`NE_G60_ROCK_SNOW_EVIDENCE=${JSON.stringify(manifest)}`);
console.log('NE_G60_ROCK_SNOW_EVIDENCE_BUNDLE_OK');
