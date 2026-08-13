#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_REFERENCE_WATER_MASK } from '../src/3d/world/worldReferenceWaterMask.js';
import { sampleG17Biome } from '../godot/terrain-authoring/geocells/sw/g17_biome.mjs';
import {
  G17,
  G17_RELIEF_POLICY,
  buildG17ReliefSource,
  sampleG17Relief,
  sampleG17ReliefNormal,
  sampleG17WestG07Parity,
  sampleG17BaselineWestG07Mismatch,
} from '../godot/terrain-authoring/geocells/sw/g17_relief.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out='));
const PROOF_PATH = path.resolve(OUT_ARG ? OUT_ARG.slice('--out='.length) : path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g17-relief-source.json'));
const EPSILON = 1e-12;
const SOURCE_PIXEL_X = 1 / 1536;
const SOURCE_PIXEL_Y = 1 / 1024;

function fail(message) { console.error(`[checkSWG17Relief] FAIL: ${message}`); process.exit(1); }
function requireCondition(condition, message) { if (!condition) fail(message); }
function rowBit(rowHex, x) {
  const nibble = Number.parseInt(rowHex[Math.floor(x / 4)], 16);
  return (nibble >> (3 - (x % 4))) & 1;
}
function colorDistance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function normalDistance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function fnv1a(hash, value) { hash ^= value & 0xff; return Math.imul(hash, 16777619) >>> 0; }

let canonicalWater = 0;
let canonicalLand = 0;
for (let y = G17.maskBounds.minY; y <= G17.maskBounds.maxY; y += 1) {
  for (let x = G17.maskBounds.minX; x <= G17.maskBounds.maxX; x += 1) {
    if (rowBit(WORLD_REFERENCE_WATER_MASK.rowsHex[y], x) === 1) canonicalWater += 1;
    else canonicalLand += 1;
  }
}
requireCondition(canonicalWater === 96 && canonicalLand === 0, `canonical G17 hydrology changed ${canonicalWater}/${canonicalLand}`);

const source = buildG17ReliefSource();
const denseSize = 289;
const denseRows = [];
let minHeight = Infinity;
let maxHeight = -Infinity;
let minNormalY = Infinity;
let maxAdjacentHeightDelta = 0;
let maxAdjacentNormalDelta = 0;
let maxBiomeColorDrift = 0;
let maxBiomeRoughnessDrift = 0;
let maxBiomeMarineWeightDrift = 0;
let checksum = 2166136261;

for (let y = 0; y < denseSize; y += 1) {
  const ny = G17.normalizedBounds.minY + (G17.normalizedBounds.maxY - G17.normalizedBounds.minY) * y / (denseSize - 1);
  const row = [];
  for (let x = 0; x < denseSize; x += 1) {
    const nx = G17.normalizedBounds.minX + (G17.normalizedBounds.maxX - G17.normalizedBounds.minX) * x / (denseSize - 1);
    const sample = sampleG17Relief(nx, ny);
    const normal = sampleG17ReliefNormal(nx, ny);
    const biome = sampleG17Biome(nx, ny);
    requireCondition(sample.waterConfidence >= 1 - EPSILON, `relief leaked non-water confidence at ${nx},${ny}`);
    requireCondition(sample.marineWeight >= 1 - EPSILON && sample.landWeight <= EPSILON, `relief invented terrestrial surface at ${nx},${ny}`);
    minHeight = Math.min(minHeight, sample.height);
    maxHeight = Math.max(maxHeight, sample.height);
    minNormalY = Math.min(minNormalY, normal[1]);
    maxBiomeColorDrift = Math.max(maxBiomeColorDrift, colorDistance(sample.color, biome.color));
    maxBiomeRoughnessDrift = Math.max(maxBiomeRoughnessDrift, Math.abs(sample.roughness - biome.roughness));
    maxBiomeMarineWeightDrift = Math.max(maxBiomeMarineWeightDrift, Math.abs(sample.marineWeight - biome.marineWeight));
    row.push({ sample, normal });
  }
  denseRows.push(row);
}

for (let y = 0; y < denseSize; y += 1) {
  for (let x = 0; x < denseSize; x += 1) {
    const current = denseRows[y][x];
    for (const neighbor of [x + 1 < denseSize ? denseRows[y][x + 1] : null, y + 1 < denseSize ? denseRows[y + 1][x] : null]) {
      if (!neighbor) continue;
      maxAdjacentHeightDelta = Math.max(maxAdjacentHeightDelta, Math.abs(current.sample.height - neighbor.sample.height));
      maxAdjacentNormalDelta = Math.max(maxAdjacentNormalDelta, normalDistance(current.normal, neighbor.normal));
    }
  }
}

for (const row of source.rows) {
  for (const sample of row) {
    checksum = fnv1a(checksum, Math.round((sample[0] + 16) * 100));
    checksum = fnv1a(checksum, Math.round(sample[1] * 255));
    checksum = fnv1a(checksum, Math.round(sample[2] * 255));
    checksum = fnv1a(checksum, Math.round(sample[3] * 255));
    checksum = fnv1a(checksum, Math.round(sample[4] * 255));
  }
}

let maxGuardHeightDelta = 0;
let maxGuardNormalDelta = 0;
let maxGuardColorDelta = 0;
let maxGuardRoughnessDelta = 0;
let maxWestG07HeightDelta = 0;
let maxWestG07NormalDelta = 0;
let baselineMaxWestG07HeightDelta = 0;
let baselineMaxWestG07NormalDelta = 0;
let baselineWestHeightDeltaSum = 0;
for (let i = 0; i <= 128; i += 1) {
  const t = i / 128;
  const nx = G17.normalizedBounds.minX + (G17.normalizedBounds.maxX - G17.normalizedBounds.minX) * t;
  const ny = G17.normalizedBounds.minY + (G17.normalizedBounds.maxY - G17.normalizedBounds.minY) * t;
  for (const [ax, ay, bx, by] of [
    [G17.normalizedBounds.minX, ny, G17.normalizedBounds.minX - SOURCE_PIXEL_X, ny],
    [G17.normalizedBounds.maxX, ny, G17.normalizedBounds.maxX + SOURCE_PIXEL_X, ny],
    [nx, G17.normalizedBounds.minY, nx, G17.normalizedBounds.minY - SOURCE_PIXEL_Y],
    [nx, G17.normalizedBounds.maxY - SOURCE_PIXEL_Y, nx, G17.normalizedBounds.maxY],
  ]) {
    const a = sampleG17Relief(ax, ay);
    const b = sampleG17Relief(bx, by);
    maxGuardHeightDelta = Math.max(maxGuardHeightDelta, Math.abs(a.height - b.height));
    maxGuardNormalDelta = Math.max(maxGuardNormalDelta, normalDistance(sampleG17ReliefNormal(ax, ay), sampleG17ReliefNormal(bx, by)));
    maxGuardColorDelta = Math.max(maxGuardColorDelta, colorDistance(a.color, b.color));
    maxGuardRoughnessDelta = Math.max(maxGuardRoughnessDelta, Math.abs(a.roughness - b.roughness));
  }
  const parity = sampleG17WestG07Parity(ny);
  const baseline = sampleG17BaselineWestG07Mismatch(ny);
  maxWestG07HeightDelta = Math.max(maxWestG07HeightDelta, parity.heightDelta);
  maxWestG07NormalDelta = Math.max(maxWestG07NormalDelta, parity.normalDelta);
  baselineMaxWestG07HeightDelta = Math.max(baselineMaxWestG07HeightDelta, baseline.heightDelta);
  baselineMaxWestG07NormalDelta = Math.max(baselineMaxWestG07NormalDelta, baseline.normalDelta);
  baselineWestHeightDeltaSum += baseline.heightDelta;
}

const heightSpan = maxHeight - minHeight;
const baselineMeanWestG07HeightDelta = baselineWestHeightDeltaSum / 129;
requireCondition(maxHeight < G17_RELIEF_POLICY.waterCeilingMeters, `relief rose above marine ceiling ${maxHeight}`);
requireCondition(heightSpan >= 0.5, `relief remained too flat span=${heightSpan}`);
requireCondition(maxAdjacentHeightDelta <= 0.01, `adjacent relief step ${maxAdjacentHeightDelta}`);
requireCondition(maxAdjacentNormalDelta <= 0.0001, `adjacent normal step ${maxAdjacentNormalDelta}`);
requireCondition(maxGuardHeightDelta <= 0.02, `guard height seam ${maxGuardHeightDelta}`);
requireCondition(maxGuardNormalDelta <= 0.0001, `guard normal seam ${maxGuardNormalDelta}`);
requireCondition(maxGuardColorDelta <= 0.01, `guard biome color seam ${maxGuardColorDelta}`);
requireCondition(maxGuardRoughnessDelta <= 0.004, `guard biome roughness seam ${maxGuardRoughnessDelta}`);
requireCondition(baselineMaxWestG07HeightDelta >= 0.10, `merged baseline mismatch unexpectedly absent ${baselineMaxWestG07HeightDelta}`);
requireCondition(maxWestG07HeightDelta <= EPSILON, `G07/G17 west height parity drift ${maxWestG07HeightDelta}`);
requireCondition(maxWestG07NormalDelta <= EPSILON, `G07/G17 west normal parity drift ${maxWestG07NormalDelta}`);
requireCondition(maxBiomeColorDrift <= EPSILON, `relief changed qualified biome color ${maxBiomeColorDrift}`);
requireCondition(maxBiomeRoughnessDrift <= EPSILON, `relief changed qualified biome roughness ${maxBiomeRoughnessDrift}`);
requireCondition(maxBiomeMarineWeightDrift <= EPSILON, `relief changed qualified marine weight ${maxBiomeMarineWeightDrift}`);
requireCondition(minNormalY > 0.999, `subsea relief became implausibly steep normalY=${minNormalY}`);

const metrics = {
  policyId: G17_RELIEF_POLICY.id,
  baselinePolicyId: G17_RELIEF_POLICY.baselinePolicyId,
  canonicalWater,
  canonicalLand,
  sourceSamples: source.sourceGridSize ** 2,
  continuityProbeSize: denseSize,
  minHeight,
  maxHeight,
  heightSpan,
  minNormalY,
  maxAdjacentHeightDelta,
  maxAdjacentNormalDelta,
  maxGuardHeightDelta,
  maxGuardNormalDelta,
  maxGuardColorDelta,
  maxGuardRoughnessDelta,
  baselineMaxWestG07HeightDelta,
  baselineMeanWestG07HeightDelta,
  baselineMaxWestG07NormalDelta,
  maxWestG07HeightDelta,
  maxWestG07NormalDelta,
  maxBiomeColorDrift,
  maxBiomeRoughnessDrift,
  maxBiomeMarineWeightDrift,
  checksum,
};
const proof = { ...source, metrics };
fs.mkdirSync(path.dirname(PROOF_PATH), { recursive: true });
fs.writeFileSync(PROOF_PATH, `${JSON.stringify(proof)}\n`);
console.log(`SW_G17_RELIEF_SOURCE_METRICS=${JSON.stringify(metrics)}`);
console.log('SW_G17_RELIEF_SOURCE_OK');
