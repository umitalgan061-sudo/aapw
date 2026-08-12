#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  G00_HYDROLOGY_POLICY,
  isInsideG00,
  measureG00Hydrology,
  sampleG00WaterConfidence,
} from '../godot/terrain-authoring/geocells/nw/g00_hydrology.mjs';

assert.equal(G00_HYDROLOGY_POLICY.geoCell, 'G00');
assert.deepEqual(G00_HYDROLOGY_POLICY.pixelBounds, { xMin: 0, xMax: 192, yMin: 0, yMax: 128 });
assert.equal(isInsideG00(0, 0), true);
assert.equal(isInsideG00(0.125, 0.125), true);
assert.equal(isInsideG00(0.126, 0.1), false);
assert.equal(sampleG00WaterConfidence(0.2, 0.2), null);

const first = measureG00Hydrology();
const second = measureG00Hydrology();
assert.deepEqual(first, second, 'G00 refinement must be deterministic');
assert.equal(first.baseCells, 96, 'G00 must cover exactly 12x8 canonical mask cells');
assert.equal(first.refinedSamples, 1536, '4x sub-cell proof must cover 48x32 samples');
assert.equal(first.centreMismatches, 0, 'coarse interpolation must preserve every canonical mask-cell centre');
assert.equal(first.waterCells, 60);
assert.equal(first.landCells, 36);
assert.equal(first.boundaryEdges, 12);
assert.equal(first.confidenceChecksum, 2017237639);

let fractionalSamples = 0;
let previous = null;
let maxStep = 0;
for (let i = 0; i <= 512; i += 1) {
  const x = 0.125 * (i / 512);
  const confidence = sampleG00WaterConfidence(x, 0.0625);
  if (confidence > 0 && confidence < 1) fractionalSamples += 1;
  if (previous !== null) maxStep = Math.max(maxStep, Math.abs(confidence - previous));
  previous = confidence;
}
assert.equal(fractionalSamples, 85);
assert.equal(maxStep, 0.01171875);

// Source-resolution target extracted from the actual 192x128 G00 crop of the
// canonical map.png. Dark pixels are first separated with an integer-luminance
// Otsu threshold; only the 4-neighbour dark component connected to the crop
// boundary is accepted as sea. This deliberately rejects disconnected map text
// and decorative dark marks on land instead of baking labels into terrain.
const sourcePath = new URL('../godot/terrain-authoring/geocells/nw/g00_source_hydrology.json', import.meta.url);
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
assert.equal(source.id, 'buzul-muhafizi-g00-source-hydrology-2026-08-12-v1');
assert.equal(source.source_map_sha256, G00_HYDROLOGY_POLICY.sourceMapSha256);
assert.equal(source.geo_cell, 'G00');
assert.deepEqual(source.source_crop, { x: 0, y: 0, width: 192, height: 128 });
assert.deepEqual(source.extraction.luminance_integer_weights, [2126, 7152, 722]);
assert.equal(source.extraction.luminance_divisor, 10000);
assert.equal(source.extraction.threshold_method, 'otsu');
assert.equal(source.extraction.threshold, 148);
assert.equal(source.extraction.sea_component, '4-neighbor dark pixels connected to crop boundary');
assert.equal(source.extraction.land_encoding, 'x-end-exclusive spans by row');
assert.equal(source.land_spans_by_row.length, source.source_crop.height);

const width = source.source_crop.width;
const height = source.source_crop.height;
const sourceWaterMask = new Uint8Array(width * height);
sourceWaterMask.fill(1);
for (let y = 0; y < height; y += 1) {
  const spans = source.land_spans_by_row[y];
  assert.ok(Array.isArray(spans), `row ${y} spans must be an array`);
  let previousEnd = 0;
  for (const span of spans) {
    assert.ok(Array.isArray(span) && span.length === 2, `row ${y} contains malformed span`);
    const [xStart, xEnd] = span;
    assert.ok(Number.isInteger(xStart) && Number.isInteger(xEnd), `row ${y} span must use integer x coordinates`);
    assert.ok(xStart >= previousEnd && xStart >= 0 && xEnd > xStart && xEnd <= width, `row ${y} contains invalid/overlapping span ${span}`);
    sourceWaterMask.fill(0, y * width + xStart, y * width + xEnd);
    previousEnd = xEnd;
  }
}

function countBoundaryEdges(mask, maskWidth, maskHeight) {
  let edges = 0;
  for (let y = 0; y < maskHeight; y += 1) {
    for (let x = 0; x < maskWidth; x += 1) {
      const value = mask[y * maskWidth + x];
      if (x + 1 < maskWidth && value !== mask[y * maskWidth + x + 1]) edges += 1;
      if (y + 1 < maskHeight && value !== mask[(y + 1) * maskWidth + x]) edges += 1;
    }
  }
  return edges;
}

const sourceWaterPixels = sourceWaterMask.reduce((sum, value) => sum + value, 0);
const sourceLandPixels = sourceWaterMask.length - sourceWaterPixels;
const sourceBoundaryEdges = countBoundaryEdges(sourceWaterMask, width, height);
const sourceMaskSha = crypto.createHash('sha256').update(sourceWaterMask).digest('hex');
assert.equal(sourceWaterPixels, source.metrics.water_pixels);
assert.equal(sourceLandPixels, source.metrics.land_pixels);
assert.ok(Math.abs(sourceWaterPixels / sourceWaterMask.length - source.metrics.water_ratio) < 1e-12);
assert.equal(sourceBoundaryEdges, source.metrics.orthogonal_boundary_edges);
assert.equal(sourceMaskSha, source.metrics.mask_sha256_u8_water);
assert.equal(sourceWaterPixels, 14413);
assert.equal(sourceLandPixels, 10163);
assert.equal(sourceBoundaryEdges, 479);
assert.equal(sourceMaskSha, '26e724825eb103b65f432593d218b018f9171026134db789993168fe0c6dd61a');

// Quantify the fidelity ceiling of the old 16x16-pixel canonical cells against
// the new source-resolution target. This is evidence only; runtime behavior is
// still untouched in this PR.
const coarseCells = Array.from({ length: 8 }, (_, cellY) =>
  Array.from({ length: 12 }, (_, cellX) => {
    const confidence = sampleG00WaterConfidence((cellX + 0.5) / 96, (cellY + 0.5) / 64);
    assert.ok(confidence === 0 || confidence === 1, 'canonical cell centres must stay binary');
    return confidence;
  }),
);
const coarseWaterMask = new Uint8Array(width * height);
let coarseCellCentreMismatches = 0;
for (let cellY = 0; cellY < 8; cellY += 1) {
  for (let cellX = 0; cellX < 12; cellX += 1) {
    const coarse = coarseCells[cellY][cellX];
    const sourceAtCellCentre = sourceWaterMask[(cellY * 16 + 8) * width + (cellX * 16 + 8)];
    if (coarse !== sourceAtCellCentre) coarseCellCentreMismatches += 1;
    for (let py = cellY * 16; py < (cellY + 1) * 16; py += 1) {
      coarseWaterMask.fill(coarse, py * width + cellX * 16, py * width + (cellX + 1) * 16);
    }
  }
}

let coarseWaterPixels = 0;
let pixelMismatches = 0;
let waterIntersection = 0;
let waterUnion = 0;
for (let i = 0; i < sourceWaterMask.length; i += 1) {
  const coarse = coarseWaterMask[i];
  const target = sourceWaterMask[i];
  coarseWaterPixels += coarse;
  if (coarse !== target) pixelMismatches += 1;
  if (coarse && target) waterIntersection += 1;
  if (coarse || target) waterUnion += 1;
}
const coarseBoundaryEdges = countBoundaryEdges(coarseWaterMask, width, height);
const pixelMismatchRatio = pixelMismatches / sourceWaterMask.length;
const waterIoU = waterIntersection / waterUnion;
const baseline = source.metrics.coarse_16px_baseline;
assert.equal(coarseWaterPixels, baseline.water_pixels);
assert.equal(pixelMismatches, baseline.pixel_mismatches);
assert.ok(Math.abs(pixelMismatchRatio - baseline.pixel_mismatch_ratio) < 1e-12);
assert.ok(Math.abs(waterIoU - baseline.water_iou) < 1e-12);
assert.equal(coarseBoundaryEdges, baseline.boundary_edges);
assert.equal(coarseCellCentreMismatches, baseline.canonical_cell_centres_mismatching_source);
assert.equal(coarseWaterPixels, 15360);
assert.equal(pixelMismatches, 1311);
assert.equal(coarseBoundaryEdges, 192);
assert.equal(coarseCellCentreMismatches, 4);

console.log('NW_G00_HYDROLOGY_OK', JSON.stringify({
  ...first,
  fractionalSamples,
  maxStep,
  sourceResolution: {
    waterPixels: sourceWaterPixels,
    landPixels: sourceLandPixels,
    boundaryEdges: sourceBoundaryEdges,
    maskSha256: sourceMaskSha,
    coarsePixelMismatches: pixelMismatches,
    coarsePixelMismatchRatio: pixelMismatchRatio,
    coarseWaterIoU: waterIoU,
    coarseBoundaryEdges,
    coarseCellCentreMismatches,
  },
}));
