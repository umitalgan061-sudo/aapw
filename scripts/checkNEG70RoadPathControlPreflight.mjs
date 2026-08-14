#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g70-road-path-probe.json');
assert.ok(fs.existsSync(file), 'G70 Road/Path probe missing');
const probe = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(probe.probeGridSize, 65); assert.equal(probe.terrain3dImportSize, 257); assert.equal(probe.terrain3dRegionSize, 256);
assert.equal(probe.crossingEdges.length, 0); assert.ok(probe.runtimeRoadReferenceEnvelope.maxX < 7 / 8);

function bilerp(channel, u, v) {
  const size = probe.probeGridSize;
  const gx = Math.max(0, Math.min(1, u)) * (size - 1), gy = Math.max(0, Math.min(1, v)) * (size - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(x0 + 1, size - 1), y1 = Math.min(y0 + 1, size - 1);
  const tx = gx - x0, ty = gy - y0;
  const top = probe.rows[y0][x0][channel] + (probe.rows[y0][x1][channel] - probe.rows[y0][x0][channel]) * tx;
  const bottom = probe.rows[y1][x0][channel] + (probe.rows[y1][x1][channel] - probe.rows[y1][x0][channel]) * tx;
  return top + (bottom - top) * ty;
}
let importSamples = 0, maxRoad = 0, maxPath = 0, maxControl = 0, minHeight = Infinity, maxHeight = -Infinity;
for (let z = 0; z < 257; z += 1) for (let x = 0; x < 257; x += 1) {
  const u = x / 256, v = z / 256;
  const h = bilerp(0, u, v); minHeight = Math.min(minHeight, h); maxHeight = Math.max(maxHeight, h);
  maxRoad = Math.max(maxRoad, Math.abs(bilerp(1, u, v))); maxPath = Math.max(maxPath, Math.abs(bilerp(2, u, v))); maxControl = Math.max(maxControl, Math.abs(bilerp(3, u, v))); importSamples += 1;
}
assert.equal(importSamples, 66049); assert.equal(maxRoad, 0); assert.equal(maxPath, 0); assert.equal(maxControl, 0);
assert.ok(maxHeight < 0 && maxHeight - minHeight <= 0.000001, 'filtered Road/Path import changed submerged Relief');
const seam = [254.75, 255, 255.25, 255.5, 255.75, 256];
let seamSamples = 0, maxSeamCoverage = 0, maxSeamHeightDelta = 0;
for (const edge of seam) for (const cross of [32.25, 96.5, 160.75, 224.5, 256]) {
  for (const [x, z] of [[edge, cross], [cross, edge]]) {
    const u = x / 256, v = z / 256;
    maxSeamCoverage = Math.max(maxSeamCoverage, Math.abs(bilerp(1,u,v)), Math.abs(bilerp(2,u,v)), Math.abs(bilerp(3,u,v)));
    maxSeamHeightDelta = Math.max(maxSeamHeightDelta, Math.abs(bilerp(0,u,v) - probe.rows[0][0][0])); seamSamples += 1;
  }
}
assert.equal(seamSamples, 60); assert.equal(maxSeamCoverage, 0); assert.ok(maxSeamHeightDelta <= 0.000001);
const metrics = { importSamples, seamSamples, minHeight, maxHeight, maxRoad, maxPath, maxControl, maxSeamCoverage, maxSeamHeightDelta };
console.log(`NE_G70_ROAD_PATH_CONTROL_PREFLIGHT=${JSON.stringify(metrics)}`); console.log('NE_G70_ROAD_PATH_CONTROL_PREFLIGHT_OK');
