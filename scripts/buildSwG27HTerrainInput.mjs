import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G27_SOURCE_COAST_POLICY,
  isG27SourceLandPixel,
  measureG27SourceMask,
} from '../godot/terrain-authoring/geocells/sw/g27_source_mask.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '../godot/terrain-authoring');
const outputPath = path.join(projectDirectory, '.g27_source_landmask.raw');
const sourceMetrics = measureG27SourceMask();
const rawMask = Buffer.alloc(G27_SOURCE_COAST_POLICY.width * G27_SOURCE_COAST_POLICY.height);

let landPixels = 0;
let waterPixels = 0;
for (let y = 0; y < G27_SOURCE_COAST_POLICY.height; y += 1) {
  for (let x = 0; x < G27_SOURCE_COAST_POLICY.width; x += 1) {
    const index = y * G27_SOURCE_COAST_POLICY.width + x;
    const land = isG27SourceLandPixel(x, y);
    rawMask[index] = land ? 255 : 0;
    if (land) landPixels += 1;
    else waterPixels += 1;
  }
}

assert.equal(rawMask.byteLength, 24576);
assert.equal(landPixels, sourceMetrics.landPixels);
assert.equal(waterPixels, sourceMetrics.waterPixels);
assert.equal(landPixels, G27_SOURCE_COAST_POLICY.landPixels);
assert.equal(waterPixels, G27_SOURCE_COAST_POLICY.waterPixels);

fs.writeFileSync(outputPath, rawMask);
const rawSha256 = crypto.createHash('sha256').update(rawMask).digest('hex');
const persisted = fs.readFileSync(outputPath);
assert.equal(persisted.byteLength, rawMask.byteLength);
assert.equal(crypto.createHash('sha256').update(persisted).digest('hex'), rawSha256);

console.log(JSON.stringify({
  geoCell: G27_SOURCE_COAST_POLICY.geoCell,
  width: G27_SOURCE_COAST_POLICY.width,
  height: G27_SOURCE_COAST_POLICY.height,
  sourcePixels: rawMask.byteLength,
  landPixels,
  waterPixels,
  rawSha256,
  output: path.relative(path.resolve(scriptDirectory, '..'), outputPath),
}, null, 2));
console.log('SW_G27_HTERRAIN_INPUT_OK');
