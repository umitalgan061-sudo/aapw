import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  G52_RELIEF_POLICY,
  sampleG52ReliefComponents,
  sampleG52ReliefHeight,
} from '../godot/terrain-authoring/geocells/ne/g52_relief.mjs';
import { sampleReferenceWaterMask } from '../src/3d/world/worldReferenceWaterMask.js';

const MASK_W = 96;
const MASK_H = 64;
const { normalizedBounds: B, sourceGridSize: GRID } = G52_RELIEF_POLICY;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalFingerprint() {
  let waterCells = 0;
  let landCells = 0;
  let boundaryEdges = 0;
  const cells = [];
  for (let my = 16; my <= 23; my += 1) {
    const row = [];
    for (let mx = 60; mx <= 71; mx += 1) {
      const nx = (mx + 0.5) / MASK_W;
      const ny = (my + 0.5) / MASK_H;
      const water = sampleReferenceWaterMask(nx, ny);
      row.push(water);
      if (water) waterCells += 1;
      else landCells += 1;
      if (mx < 71 && water !== sampleReferenceWaterMask((mx + 1.5) / MASK_W, ny)) boundaryEdges += 1;
      if (my < 23 && water !== sampleReferenceWaterMask(nx, (my + 1.5) / MASK_H)) boundaryEdges += 1;
    }
    cells.push(row);
  }
  return { waterCells, landCells, boundaryEdges, cells };
}

function fnv1a32(values) {
  let hash = 0x811c9dc5;
  for (const value of values) {
    const q = Math.round(value * 100);
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (q >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash >>> 0;
}

function sampleGrid() {
  const rows = [];
  const values = [];
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let maxAdjacentDelta = 0;
  let maxWaterHeight = -Infinity;
  let minLandHeight = Infinity;
  let fractionalCoastSamples = 0;
  let maxRidgeInfluence = 0;

  for (let gy = 0; gy < GRID; gy += 1) {
    const v = gy / (GRID - 1);
    const ny = B.yMin + (B.yMax - B.yMin) * v;
    const row = [];
    for (let gx = 0; gx < GRID; gx += 1) {
      const u = gx / (GRID - 1);
      const nx = B.xMin + (B.xMax - B.xMin) * u;
      const c = sampleG52ReliefComponents(nx, ny);
      const h = c.heightMeters;
      assert(Number.isFinite(h), `non-finite height at ${gx},${gy}`);
      row.push(h);
      values.push(h);
      minHeight = Math.min(minHeight, h);
      maxHeight = Math.max(maxHeight, h);
      maxRidgeInfluence = Math.max(maxRidgeInfluence, c.ridgeInfluence);
      if (c.waterConfidence > 0.001 && c.waterConfidence < 0.999) fractionalCoastSamples += 1;
      if (c.waterConfidence >= 0.999) maxWaterHeight = Math.max(maxWaterHeight, h);
      if (c.landConfidence >= 0.999) minLandHeight = Math.min(minLandHeight, h);
      if (gx > 0) maxAdjacentDelta = Math.max(maxAdjacentDelta, Math.abs(h - row[gx - 1]));
      if (gy > 0) maxAdjacentDelta = Math.max(maxAdjacentDelta, Math.abs(h - rows[gy - 1][gx]));
    }
    rows.push(row);
  }
  return {
    rows,
    values,
    minHeight,
    maxHeight,
    heightSpan: maxHeight - minHeight,
    maxAdjacentDelta,
    maxWaterHeight,
    minLandHeight,
    fractionalCoastSamples,
    maxRidgeInfluence,
    checksum: fnv1a32(values),
  };
}

function guardBandMetric() {
  const epsX = 1 / 1536;
  const epsY = 1 / 1024;
  let maxHeightDelta = 0;
  let samples = 0;
  for (let i = 0; i <= 128; i += 1) {
    const t = i / 128;
    const y = B.yMin + (B.yMax - B.yMin) * t;
    const x = B.xMin + (B.xMax - B.xMin) * t;
    for (const [ax, ay, bx, by] of [
      [B.xMin - epsX, y, B.xMin + epsX, y],
      [B.xMax - epsX, y, B.xMax + epsX, y],
      [x, B.yMin - epsY, x, B.yMin + epsY],
      [x, B.yMax - epsY, x, B.yMax + epsY],
    ]) {
      const delta = Math.abs(sampleG52ReliefHeight(ax, ay) - sampleG52ReliefHeight(bx, by));
      maxHeightDelta = Math.max(maxHeightDelta, delta);
      samples += 1;
    }
  }
  return { samples, maxHeightDelta };
}

const canonical = canonicalFingerprint();
assert(canonical.waterCells === 84, `G52 water fingerprint drifted: ${canonical.waterCells}`);
assert(canonical.landCells === 12, `G52 land fingerprint drifted: ${canonical.landCells}`);
assert(canonical.boundaryEdges === 14, `G52 boundary fingerprint drifted: ${canonical.boundaryEdges}`);

// Canonical mask centres must retain their semantic side of sea level after relief shaping.
let centreMismatches = 0;
for (let my = 16; my <= 23; my += 1) {
  for (let mx = 60; mx <= 71; mx += 1) {
    const nx = (mx + 0.5) / MASK_W;
    const ny = (my + 0.5) / MASK_H;
    const water = sampleReferenceWaterMask(nx, ny);
    const height = sampleG52ReliefHeight(nx, ny);
    if (water ? height >= -2.5 : height <= 0.35) centreMismatches += 1;
  }
}
assert(centreMismatches === 0, `canonical centre semantic mismatch: ${centreMismatches}`);

const grid = sampleGrid();
const guard = guardBandMetric();
assert(grid.maxHeight > 15, 'relief layer failed to create measurable upland character');
assert(grid.maxRidgeInfluence > 0.02, 'canonical Bone Mountains signal did not reach G52');
assert(grid.fractionalCoastSamples > 0, 'coastline transition was not continuously resampled');
assert(grid.maxAdjacentDelta < 36, `relief step too abrupt: ${grid.maxAdjacentDelta}`);
assert(guard.maxHeightDelta < 24, `guard-band height discontinuity too large: ${guard.maxHeightDelta}`);

const metrics = {
  policyId: G52_RELIEF_POLICY.id,
  sourceMapSha256: G52_RELIEF_POLICY.sourceMapSha256,
  canonical: {
    waterCells: canonical.waterCells,
    landCells: canonical.landCells,
    boundaryEdges: canonical.boundaryEdges,
    centreMismatches,
  },
  sourceGridSize: GRID,
  sampleCount: GRID * GRID,
  fractionalCoastSamples: grid.fractionalCoastSamples,
  minHeightMeters: Number(grid.minHeight.toFixed(6)),
  maxHeightMeters: Number(grid.maxHeight.toFixed(6)),
  heightSpanMeters: Number(grid.heightSpan.toFixed(6)),
  maxAdjacentDeltaMeters: Number(grid.maxAdjacentDelta.toFixed(6)),
  maxWaterHeightMeters: Number(grid.maxWaterHeight.toFixed(6)),
  minLandHeightMeters: Number(grid.minLandHeight.toFixed(6)),
  maxRidgeInfluence: Number(grid.maxRidgeInfluence.toFixed(8)),
  guardBandSamples: guard.samples,
  maxGuardBandHeightDeltaMeters: Number(guard.maxHeightDelta.toFixed(6)),
  heightChecksum: grid.checksum,
};

const outputArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (outputArg) {
  const output = outputArg.slice('--emit-probe='.length);
  fs.mkdirSync(new URL('.', `file://${process.cwd()}/${output}`).pathname, { recursive: true });
  const payload = {
    ...metrics,
    terrain3dRegionSize: G52_RELIEF_POLICY.terrain3dRegionSize,
    normalizedBounds: G52_RELIEF_POLICY.normalizedBounds,
    rows: grid.rows.map((row) => row.map((value) => Number(value.toFixed(6)))),
  };
  fs.writeFileSync(output, `${JSON.stringify(payload)}\n`);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  console.log(`G52_RELIEF_PROBE_SHA256=${digest}`);
}

console.log(`G52_RELIEF_METRICS=${JSON.stringify(metrics)}`);
console.log('NE_G52_RELIEF_VALIDATION_OK');
