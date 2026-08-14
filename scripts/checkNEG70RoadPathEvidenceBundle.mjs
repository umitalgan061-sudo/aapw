#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proofDir = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const visualDir = path.join(ROOT, 'artifacts/ne-g70-road-path-visual');
const files = {
  probe: path.join(proofDir, 'g70-road-path-probe.json'),
  bake: path.join(proofDir, 'g70-road-path-bake.json'),
  imported: path.join(proofDir, 'g70-road-path-imported-topdown.png'),
  near: path.join(visualDir, 'g70-road-path-near.png'),
  far: path.join(visualDir, 'g70-road-path-far.png'),
  fullWorld: path.join(visualDir, 'g70-road-path-full-world.png'),
  visualMetrics: path.join(visualDir, 'g70-road-path-visual-metrics.json'),
};
for (const [name, file] of Object.entries(files)) {
  assert.ok(fs.existsSync(file), `${name} proof missing`);
  assert.ok(fs.statSync(file).size > 10, `${name} proof truncated`);
}
function assertPng(file, width, height, label) {
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.length >= 24, `${label} PNG header truncated`);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${label} PNG signature changed`);
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR', `${label} PNG lacks IHDR`);
  assert.equal(bytes.readUInt32BE(16), width, `${label} width changed`);
  assert.equal(bytes.readUInt32BE(20), height, `${label} height changed`);
}
assertPng(files.imported, 256, 256, 'imported');
assertPng(files.near, 960, 640, 'near'); assertPng(files.far, 960, 640, 'far'); assertPng(files.fullWorld, 1200, 800, 'full-world');
const probe = JSON.parse(fs.readFileSync(files.probe, 'utf8'));
const bake = JSON.parse(fs.readFileSync(files.bake, 'utf8'));
const visual = JSON.parse(fs.readFileSync(files.visualMetrics, 'utf8'));
assert.equal(probe.geoCell, 'G70'); assert.equal(probe.layer, 'Road/Path');
assert.equal(probe.crossingEdges.length, 0, 'runtime road crossing entered G70');
assert.ok(probe.runtimeRoadReferenceEnvelope.maxX < 7 / 8, 'runtime road envelope reaches G70');
assert.ok(probe.canonicalRoadExclusionMarginMeters > 100, 'road exclusion margin collapsed');
assert.ok(probe.rows.flat().every((s) => s[0] < 0 && s[1] === 0 && s[2] === 0 && s[3] === 0 && s[4] === 0), 'probe contains road/path paint');
assert.ok(String(bake.terrain3dVersion).startsWith('1.0.2')); assert.equal(bake.regionSize, 256); assert.ok(bake.regionCount >= 4);
assert.equal(bake.alignedSamples, 4225); assert.ok(bake.seamSamples >= 60); assert.ok(bake.maxHeightError <= 0.001); assert.ok(bake.maxSeamHeightError <= 0.001);
assert.ok(bake.maxActualBlend <= 0.000001); assert.ok(bake.maxSeamBlend <= 0.000001);
assert.ok(bake.bakedSurfaces >= 1 && bake.bakedVertices > 0); assert.ok(bake.savedRegionFiles >= 4 && bake.savedRegionBytes > 0);
assert.equal(visual.crossingEdges, 0); assert.ok(visual.roadEnvelope.maxX < 7 / 8);
assert.equal(visual.perspective.maxRoad, 0); assert.equal(visual.perspective.maxPath, 0); assert.equal(visual.perspective.maxControl, 0);
assert.equal(visual.topdown.g70RoadPatchApplied, false); assert.equal(visual.topdown.g70RoadPatchAlpha, 0); assert.equal(visual.topdown.gridOverlay, false);
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sha256 = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, digest(file)]));
assert.equal(sha256.near, visual.sha256.near); assert.equal(sha256.far, visual.sha256.far); assert.equal(sha256.fullWorld, visual.sha256.fullWorld);
const manifest = { schema:'ne-g70-road-path-evidence-bundle-v1', geoCell:'G70', layer:'Road/Path', terrain3dVersion:bake.terrain3dVersion, regionCount:bake.regionCount, bakedVertices:bake.bakedVertices, crossingEdges:probe.crossingEdges.length, roadEnvelopeMaxX:probe.runtimeRoadReferenceEnvelope.maxX, maxActualBlend:bake.maxActualBlend, patchAlpha:visual.topdown.g70RoadPatchAlpha, sha256 };
fs.writeFileSync(path.join(visualDir, 'g70-road-path-evidence-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`NE_G70_ROAD_PATH_EVIDENCE_BUNDLE=${JSON.stringify(manifest)}`); console.log('NE_G70_ROAD_PATH_EVIDENCE_BUNDLE_OK');
