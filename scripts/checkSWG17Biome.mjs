#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WORLD_REFERENCE_WATER_MASK,
  classifyReferenceWaterCell,
} from '../src/3d/world/worldReferenceWaterMask.js';
import {
  G17,
  G17_BIOME_POLICY,
  buildG17BiomeSource,
  sampleG17Biome,
} from '../godot/terrain-authoring/geocells/sw/g17_biome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out='));
const PROOF_PATH = path.resolve(OUT_ARG ? OUT_ARG.slice('--out='.length) : path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g17-biome-source.json'));
const EPSILON = 1e-12;
const SOURCE_PIXEL_X = 1 / 1536;
const SOURCE_PIXEL_Y = 1 / 1024;

function fail(message) {
  console.error(`[checkSWG17Biome] FAIL: ${message}`);
  process.exit(1);
}
function requireCondition(condition, message) {
  if (!condition) fail(message);
}
function rowBit(rowHex, x) {
  const nibble = Number.parseInt(rowHex[Math.floor(x / 4)], 16);
  return (nibble >> (3 - (x % 4))) & 1;
}
function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function fnv1a(hash, value) {
  hash ^= value & 0xff;
  return Math.imul(hash, 16777619) >>> 0;
}

let canonicalWater = 0;
let canonicalLand = 0;
let canonicalSea = 0;
let canonicalLake = 0;
for (let y = G17.maskBounds.minY; y <= G17.maskBounds.maxY; y += 1) {
  for (let x = G17.maskBounds.minX; x <= G17.maskBounds.maxX; x += 1) {
    const water = rowBit(WORLD_REFERENCE_WATER_MASK.rowsHex[y], x) === 1;
    if (water) canonicalWater += 1;
    else canonicalLand += 1;
    const body = classifyReferenceWaterCell(x, y);
    if (body === 'sea') canonicalSea += 1;
    else if (body === 'lake') canonicalLake += 1;
  }
}
requireCondition(canonicalWater === 96 && canonicalLand === 0, `G17 hydrology regression ${canonicalWater}/${canonicalLand}`);
requireCondition(canonicalSea === 96 && canonicalLake === 0, `G17 water-body regression sea/lake=${canonicalSea}/${canonicalLake}`);

const source = buildG17BiomeSource();
const denseSize = 289;
let minHeight = Infinity;
let maxHeight = -Infinity;
let minRoughness = Infinity;
let maxRoughness = -Infinity;
let minMarineWeight = Infinity;
let maxLandWeight = -Infinity;
let maxAdjacentColorDelta = 0;
let maxAdjacentRoughnessDelta = 0;
let maxAdjacentMarineWeightDelta = 0;
let checksum = 2166136261;
const denseRows = [];
for (let y = 0; y < denseSize; y += 1) {
  const ny = G17.normalizedBounds.minY + (G17.normalizedBounds.maxY - G17.normalizedBounds.minY) * y / (denseSize - 1);
  const row = [];
  for (let x = 0; x < denseSize; x += 1) {
    const nx = G17.normalizedBounds.minX + (G17.normalizedBounds.maxX - G17.normalizedBounds.minX) * x / (denseSize - 1);
    const sample = sampleG17Biome(nx, ny);
    row.push(sample);
    minHeight = Math.min(minHeight, sample.height);
    maxHeight = Math.max(maxHeight, sample.height);
    minRoughness = Math.min(minRoughness, sample.roughness);
    maxRoughness = Math.max(maxRoughness, sample.roughness);
    minMarineWeight = Math.min(minMarineWeight, sample.marineWeight);
    maxLandWeight = Math.max(maxLandWeight, sample.landWeight);
  }
  denseRows.push(row);
}
for (let y = 0; y < denseSize; y += 1) {
  for (let x = 0; x < denseSize; x += 1) {
    const a = denseRows[y][x];
    for (const b of [x + 1 < denseSize ? denseRows[y][x + 1] : null, y + 1 < denseSize ? denseRows[y + 1][x] : null]) {
      if (!b) continue;
      maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(a.color, b.color));
      maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(a.roughness - b.roughness));
      maxAdjacentMarineWeightDelta = Math.max(maxAdjacentMarineWeightDelta, Math.abs(a.marineWeight - b.marineWeight));
    }
  }
}
for (const row of source.rows) {
  for (const sample of row) {
    checksum = fnv1a(checksum, Math.round((sample[0] + 8) * 32));
    checksum = fnv1a(checksum, Math.round(sample[1] * 255));
    checksum = fnv1a(checksum, Math.round(sample[2] * 255));
    checksum = fnv1a(checksum, Math.round(sample[3] * 255));
    checksum = fnv1a(checksum, Math.round(sample[4] * 255));
  }
}

let maxGuardColorDelta = 0;
let maxGuardRoughnessDelta = 0;
let maxGuardMarineWeightDelta = 0;
let maxGuardHeightDelta = 0;
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
    const a = sampleG17Biome(ax, ay);
    const b = sampleG17Biome(bx, by);
    maxGuardColorDelta = Math.max(maxGuardColorDelta, colorDistance(a.color, b.color));
    maxGuardRoughnessDelta = Math.max(maxGuardRoughnessDelta, Math.abs(a.roughness - b.roughness));
    maxGuardMarineWeightDelta = Math.max(maxGuardMarineWeightDelta, Math.abs(a.marineWeight - b.marineWeight));
    maxGuardHeightDelta = Math.max(maxGuardHeightDelta, Math.abs(a.height - b.height));
  }
}

requireCondition(Math.abs(minHeight + 4) <= EPSILON && Math.abs(maxHeight + 4) <= EPSILON, `Macro Biome changed merged hydrology height ${minHeight}..${maxHeight}`);
requireCondition(minMarineWeight >= 1 - EPSILON && maxLandWeight <= EPSILON, `Macro Biome leaked land surface marine=${minMarineWeight} land=${maxLandWeight}`);
requireCondition(maxAdjacentColorDelta <= 0.01, `adjacent marine color delta ${maxAdjacentColorDelta}`);
requireCondition(maxAdjacentRoughnessDelta <= 0.004, `adjacent roughness delta ${maxAdjacentRoughnessDelta}`);
requireCondition(maxAdjacentMarineWeightDelta <= EPSILON, `adjacent marine weight delta ${maxAdjacentMarineWeightDelta}`);
requireCondition(maxGuardColorDelta <= 0.01, `guard color delta ${maxGuardColorDelta}`);
requireCondition(maxGuardRoughnessDelta <= 0.004, `guard roughness delta ${maxGuardRoughnessDelta}`);
requireCondition(maxGuardMarineWeightDelta <= EPSILON, `guard marine-weight seam ${maxGuardMarineWeightDelta}`);
requireCondition(maxGuardHeightDelta <= EPSILON, `guard height seam ${maxGuardHeightDelta}`);

const metrics = {
  canonicalWater,
  canonicalLand,
  canonicalSea,
  canonicalLake,
  sourceSamples: source.sourceGridSize ** 2,
  continuityProbeSize: denseSize,
  minHeight,
  maxHeight,
  minRoughness,
  maxRoughness,
  minMarineWeight,
  maxLandWeight,
  maxAdjacentColorDelta,
  maxAdjacentRoughnessDelta,
  maxAdjacentMarineWeightDelta,
  maxGuardColorDelta,
  maxGuardRoughnessDelta,
  maxGuardMarineWeightDelta,
  maxGuardHeightDelta,
  checksum,
};
const proof = { ...source, metrics };
fs.mkdirSync(path.dirname(PROOF_PATH), { recursive: true });
fs.writeFileSync(PROOF_PATH, `${JSON.stringify(proof)}\n`);
console.log(`SW_G17_BIOME_SOURCE_METRICS=${JSON.stringify(metrics)}`);
console.log('SW_G17_BIOME_SOURCE_OK');
