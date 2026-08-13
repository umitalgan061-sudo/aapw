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
  buildG17HydrologyProbe,
  sampleG17WaterConfidence,
} from '../godot/terrain-authoring/geocells/sw/g17_hydrology.mjs';

const SOURCE_MAP_SHA256 = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out='));
const PROOF_PATH = path.resolve(OUT_ARG ? OUT_ARG.slice('--out='.length) : path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g17-hydrology-source.json'));
const EPSILON = 1e-12;

function fail(message) {
  console.error(`[checkSWG17Hydrology] FAIL: ${message}`);
  process.exit(1);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function rowBit(rowHex, x) {
  const nibble = Number.parseInt(rowHex[Math.floor(x / 4)], 16);
  return (nibble >> (3 - (x % 4))) & 1;
}

function waterAt(x, y) {
  return rowBit(WORLD_REFERENCE_WATER_MASK.rowsHex[y], x) === 1;
}

let water = 0;
let land = 0;
let sea = 0;
let lake = 0;
let boundaries = 0;
let centreMismatches = 0;
for (let y = G17.maskBounds.minY; y <= G17.maskBounds.maxY; y += 1) {
  for (let x = G17.maskBounds.minX; x <= G17.maskBounds.maxX; x += 1) {
    const isWater = waterAt(x, y);
    if (isWater) water += 1;
    else land += 1;
    const body = classifyReferenceWaterCell(x, y);
    if (body === 'sea') sea += 1;
    else if (body === 'lake') lake += 1;
    const confidence = sampleG17WaterConfidence((x + 0.5) / 96, (y + 0.5) / 64);
    if (Math.abs(confidence - (isWater ? 1 : 0)) > EPSILON) centreMismatches += 1;
    if (x < G17.maskBounds.maxX && isWater !== waterAt(x + 1, y)) boundaries += 1;
    if (y < G17.maskBounds.maxY && isWater !== waterAt(x, y + 1)) boundaries += 1;
  }
}

requireCondition(water === 96, `expected 96 canonical water cells, got ${water}`);
requireCondition(land === 0, `G17 invented/found ${land} land cells`);
requireCondition(sea === 96 && lake === 0, `expected 96 sea / 0 lake, got ${sea}/${lake}`);
requireCondition(boundaries === 0, `uniform G17 sea has ${boundaries} internal coastline boundaries`);
requireCondition(centreMismatches === 0, `canonical centre mismatches ${centreMismatches}`);

const guard = {
  minX: Math.max(0, G17.maskBounds.minX - 1),
  maxX: Math.min(WORLD_REFERENCE_WATER_MASK.width - 1, G17.maskBounds.maxX + 1),
  minY: Math.max(0, G17.maskBounds.minY - 1),
  maxY: Math.min(WORLD_REFERENCE_WATER_MASK.height - 1, G17.maskBounds.maxY + 1),
};
let guardSamples = 0;
let guardWater = 0;
let guardSea = 0;
for (let y = guard.minY; y <= guard.maxY; y += 1) {
  for (let x = guard.minX; x <= guard.maxX; x += 1) {
    guardSamples += 1;
    if (waterAt(x, y)) guardWater += 1;
    if (classifyReferenceWaterCell(x, y) === 'sea') guardSea += 1;
  }
}
requireCondition(guardSamples === 126, `expected 126 unique in-map guard samples, got ${guardSamples}`);
requireCondition(guardWater === guardSamples && guardSea === guardSamples, `guard band is not pure sea: water=${guardWater}, sea=${guardSea}/${guardSamples}`);

const probe = buildG17HydrologyProbe(65, 1);
const dense = buildG17HydrologyProbe(289, 1);
let maxAdjacentConfidenceStep = 0;
let fractionalSamples = 0;
let minConfidence = Infinity;
let maxConfidence = -Infinity;
let minHeight = Infinity;
let maxHeight = -Infinity;
for (let y = 0; y < dense.size; y += 1) {
  for (let x = 0; x < dense.size; x += 1) {
    const index = y * dense.size + x;
    const value = dense.confidence[index];
    const height = dense.heights[index];
    minConfidence = Math.min(minConfidence, value);
    maxConfidence = Math.max(maxConfidence, value);
    minHeight = Math.min(minHeight, height);
    maxHeight = Math.max(maxHeight, height);
    if (value > EPSILON && value < 1 - EPSILON) fractionalSamples += 1;
    if (x + 1 < dense.size) maxAdjacentConfidenceStep = Math.max(maxAdjacentConfidenceStep, Math.abs(value - dense.confidence[index + 1]));
    if (y + 1 < dense.size) maxAdjacentConfidenceStep = Math.max(maxAdjacentConfidenceStep, Math.abs(value - dense.confidence[index + dense.size]));
  }
}
requireCondition(Math.abs(minConfidence - 1) <= EPSILON && Math.abs(maxConfidence - 1) <= EPSILON, `G17/guard confidence drifted from pure sea: ${minConfidence}..${maxConfidence}`);
requireCondition(fractionalSamples === 0, `pure-sea G17 created ${fractionalSamples} fractional coastline samples`);
requireCondition(maxAdjacentConfidenceStep <= EPSILON, `pure-sea G17 confidence has step ${maxAdjacentConfidenceStep}`);
requireCondition(Math.abs(minHeight + 4) <= EPSILON && Math.abs(maxHeight + 4) <= EPSILON, `hydrology proof height is not constant -4m: ${minHeight}..${maxHeight}`);

const seamOffsetX = 1 / WORLD_REFERENCE_WATER_MASK.width;
const seamOffsetY = 1 / WORLD_REFERENCE_WATER_MASK.height;
let maxWestConfidenceDelta = 0;
let maxNorthConfidenceDelta = 0;
let maxEastConfidenceDelta = 0;
let maxWestHeightDelta = 0;
let maxNorthHeightDelta = 0;
let maxEastHeightDelta = 0;
for (let i = 0; i <= 128; i += 1) {
  const t = i / 128;
  const ny = G17.normalizedBounds.minY + (G17.normalizedBounds.maxY - G17.normalizedBounds.minY) * t;
  const nx = G17.normalizedBounds.minX + (G17.normalizedBounds.maxX - G17.normalizedBounds.minX) * t;
  const westIn = sampleG17WaterConfidence(G17.normalizedBounds.minX, ny);
  const westOut = sampleG17WaterConfidence(G17.normalizedBounds.minX - seamOffsetX, ny);
  const eastIn = sampleG17WaterConfidence(G17.normalizedBounds.maxX, ny);
  const eastOut = sampleG17WaterConfidence(G17.normalizedBounds.maxX + seamOffsetX, ny);
  const northIn = sampleG17WaterConfidence(nx, G17.normalizedBounds.minY);
  const northOut = sampleG17WaterConfidence(nx, G17.normalizedBounds.minY - seamOffsetY);
  maxWestConfidenceDelta = Math.max(maxWestConfidenceDelta, Math.abs(westIn - westOut));
  maxEastConfidenceDelta = Math.max(maxEastConfidenceDelta, Math.abs(eastIn - eastOut));
  maxNorthConfidenceDelta = Math.max(maxNorthConfidenceDelta, Math.abs(northIn - northOut));
  const toHeight = (confidence) => 0.75 - 4.75 * Math.max(0, Math.min(1, (confidence - 0.35) / 0.65)) ** 2 * (3 - 2 * Math.max(0, Math.min(1, (confidence - 0.35) / 0.65)));
  maxWestHeightDelta = Math.max(maxWestHeightDelta, Math.abs(toHeight(westIn) - toHeight(westOut)));
  maxEastHeightDelta = Math.max(maxEastHeightDelta, Math.abs(toHeight(eastIn) - toHeight(eastOut)));
  maxNorthHeightDelta = Math.max(maxNorthHeightDelta, Math.abs(toHeight(northIn) - toHeight(northOut)));
}
const maxGuardConfidenceDelta = Math.max(maxWestConfidenceDelta, maxNorthConfidenceDelta, maxEastConfidenceDelta);
const maxGuardHeightDelta = Math.max(maxWestHeightDelta, maxNorthHeightDelta, maxEastHeightDelta);
requireCondition(maxGuardConfidenceDelta <= EPSILON, `G17 guard confidence seam ${maxGuardConfidenceDelta}`);
requireCondition(maxGuardHeightDelta <= EPSILON, `G17 guard height seam ${maxGuardHeightDelta}`);

const proof = {
  schema: probe.schema,
  geoCell: G17.id,
  sourceMapSha256: SOURCE_MAP_SHA256,
  waterMaskSha256: WORLD_REFERENCE_WATER_MASK.maskSha256,
  size: probe.size,
  haloMaskCells: probe.haloMaskCells,
  bounds: probe.bounds,
  sourcePixels: G17.sourcePixels,
  canonical: {
    water,
    land,
    sea,
    lake,
    boundaries,
    centreMismatches,
  },
  guard: {
    ...guard,
    samples: guardSamples,
    water: guardWater,
    sea: guardSea,
  },
  metrics: {
    continuityProbeSize: dense.size,
    maxAdjacentConfidenceStep,
    fractionalSamples,
    minConfidence,
    maxConfidence,
    minHeight,
    maxHeight,
    maxGuardConfidenceDelta,
    maxGuardHeightDelta,
    coastlineContourSegments: 0,
  },
  heights: probe.heights,
};
fs.mkdirSync(path.dirname(PROOF_PATH), { recursive: true });
fs.writeFileSync(PROOF_PATH, `${JSON.stringify(proof)}\n`);
console.log(`SW_G17_HYDROLOGY_SOURCE_METRICS=${JSON.stringify({ water, land, sea, lake, boundaries, centreMismatches, guardSamples, guardWater, guardSea, maxAdjacentConfidenceStep, fractionalSamples, minHeight, maxHeight, maxGuardConfidenceDelta, maxGuardHeightDelta, coastlineContourSegments: 0 })}`);
console.log('SW_G17_HYDROLOGY_SOURCE_OK');
