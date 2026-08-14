#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proofDir = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const visualDir = path.join(ROOT, 'artifacts/ne-g70-rock-snow-visual');
const files = {
  probe: path.join(proofDir, 'g70-rock-snow-probe.json'),
  bake: path.join(proofDir, 'g70-rock-snow-bake.json'),
  imported: path.join(proofDir, 'g70-rock-snow-imported-topdown.png'),
  near: path.join(visualDir, 'g70-rock-snow-near.png'),
  far: path.join(visualDir, 'g70-rock-snow-far.png'),
  fullWorld: path.join(visualDir, 'g70-rock-snow-full-world.png'),
  visualMetrics: path.join(visualDir, 'g70-rock-snow-visual-metrics.json'),
};
for (const [name, file] of Object.entries(files)) {
  assert.ok(fs.existsSync(file), `${name} proof file missing: ${file}`);
  assert.ok(fs.statSync(file).size > (name.includes('Metrics') || name === 'probe' || name === 'bake' ? 10 : 1024), `${name} proof file too small`);
}
const probe = JSON.parse(fs.readFileSync(files.probe, 'utf8'));
const bake = JSON.parse(fs.readFileSync(files.bake, 'utf8'));
const visual = JSON.parse(fs.readFileSync(files.visualMetrics, 'utf8'));
assert.equal(probe.geoCell, 'G70');
assert.equal(probe.layer, 'Rock/Snow');
assert.equal(probe.sourceGridSize, 65);
assert.equal(probe.terrain3dImportSize, 257);
assert.equal(probe.terrain3dRegionSize, 256);
assert.ok(probe.rows.flat().every((s) => s[0] === 0 && s[1] === 0 && s[2] === 0 && s[4] === 0), 'probe contains terrestrial material');
assert.ok(probe.rows.flat().every((s) => s[3] < 0), 'probe contains non-submerged height');
assert.ok(String(bake.terrain3dVersion).startsWith('1.0.2'), 'unexpected Terrain3D version');
assert.equal(bake.regionSize, 256);
assert.ok(bake.regionCount >= 4, 'real Terrain3D regions missing');
assert.equal(bake.alignedSamples, 4225);
assert.ok(bake.seamSamples >= 60, 'insufficient 255/256 seam evidence');
assert.ok(bake.maxHeightError <= 0.001, 'height roundtrip error too high');
assert.ok(bake.maxSeamHeightError <= 0.001, 'seam height error too high');
assert.ok(bake.maxBlendError <= 0.000001, 'control blend roundtrip error too high');
assert.ok(bake.maxActualBlend <= 0.000001, 'imported sea contains terrestrial control blend');
assert.ok(bake.maxSeamBlend <= 0.000001, 'region seam contains terrestrial material');
assert.ok(bake.bakedSurfaces >= 1 && bake.bakedVertices > 0, 'LOD0 bake evidence missing');
assert.ok(bake.savedRegionFiles >= 4 && bake.savedRegionBytes > 0, 'Terrain3D persistence evidence missing');
assert.equal(visual.surfaceMetrics.canonicalWater, 96);
assert.equal(visual.surfaceMetrics.canonicalLand, 0);
assert.equal(visual.surfaceMetrics.maxRockWeight, 0);
assert.equal(visual.surfaceMetrics.maxSnowWeight, 0);
assert.equal(visual.surfaceMetrics.maxTerrestrialSurfaceMass, 0);
assert.equal(visual.perspective.maxOverlay, 0);
assert.equal(visual.topdown.g70PatchApplied, false);
assert.equal(visual.topdown.g70PatchAlpha, 0);
assert.equal(visual.topdown.gridOverlay, false);

const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sha256 = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, digest(file)]));
for (const value of Object.values(sha256)) assert.match(value, /^[0-9a-f]{64}$/);
assert.equal(sha256.near, visual.sha256.near, 'near evidence hash drifted');
assert.equal(sha256.far, visual.sha256.far, 'far evidence hash drifted');
assert.equal(sha256.fullWorld, visual.sha256.fullWorld, 'full-world evidence hash drifted');
const manifest = {
  schema: 'ne-g70-rock-snow-evidence-bundle-v1',
  geoCell: 'G70', layer: 'Rock/Snow',
  terrain3dVersion: bake.terrain3dVersion,
  regionCount: bake.regionCount,
  bakedVertices: bake.bakedVertices,
  maxActualBlend: bake.maxActualBlend,
  patchAlpha: visual.topdown.g70PatchAlpha,
  sha256,
};
fs.writeFileSync(path.join(visualDir, 'g70-rock-snow-evidence-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`NE_G70_ROCK_SNOW_EVIDENCE_BUNDLE=${JSON.stringify(manifest)}`);
console.log('NE_G70_ROCK_SNOW_EVIDENCE_BUNDLE_OK');
