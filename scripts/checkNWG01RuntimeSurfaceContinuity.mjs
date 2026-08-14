#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WORLD_SCALE } from '../src/3d/config.js';
import {
  G01_TERRAIN3D_RUNTIME_PARITY,
  createG01Terrain3DSurfaceSampler,
  createG01Terrain3DWorldSurfaceSampler,
} from '../src/3d/world/g01Terrain3dRuntimeAdapter.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';

const ROOT = process.cwd();
const BAKE_PATH = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g01-runtime-bake.json');
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out='));
const OUT_PATH = path.resolve(OUT_ARG ? OUT_ARG.slice('--out='.length) : 'artifacts/nw-g01-runtime-visual/g01-runtime-surface-continuity.json');
const EXPECTED_MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const DENSE_SIZE = 257;
const WORLD_PARITY_SIZE = 33;
const SOURCE_SIZE = G01_TERRAIN3D_RUNTIME_PARITY.sourceSize;
const SOURCE_INTERVALS = SOURCE_SIZE - 1;
const DENSE_INTERVALS = DENSE_SIZE - 1;
const DENSE_PER_SOURCE = DENSE_INTERVALS / SOURCE_INTERVALS;

function fail(message) {
  console.error(`[checkNWG01RuntimeSurfaceContinuity] FAIL: ${message}`);
  process.exit(1);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function finite(value, label) {
  requireCondition(Number.isFinite(value), `${label} must be finite`);
  return value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function angleDegrees(a, b) {
  const dot = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  return Math.acos(dot) * 180 / Math.PI;
}

function channelDelta(a, b) {
  return {
    height: Math.abs(a.heightMeters - b.heightMeters),
    snow: Math.abs(a.snowWeight - b.snowWeight),
    tint: Math.max(
      Math.abs(a.tintR - b.tintR),
      Math.abs(a.tintG - b.tintG),
      Math.abs(a.tintB - b.tintB),
    ),
    roughness: Math.abs(a.roughness - b.roughness),
    normalDegrees: angleDegrees(a.normal, b.normal),
    slopeDegrees: Math.abs(a.slopeDegrees - b.slopeDegrees),
  };
}

function maxInto(target, delta) {
  for (const key of Object.keys(target)) target[key] = Math.max(target[key], delta[key]);
}

function addInto(target, delta) {
  for (const key of Object.keys(target)) target[key] += delta[key];
}

function divideMetrics(metrics, count) {
  return Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, count ? value / count : 0]));
}

function zeroDelta() {
  return { height: 0, snow: 0, tint: 0, roughness: 0, normalDegrees: 0, slopeDegrees: 0 };
}

function mixChecksum(hash, values) {
  const buffer = Buffer.allocUnsafe(values.length * 8);
  values.forEach((value, index) => buffer.writeDoubleLE(value, index * 8));
  hash.update(buffer);
}

requireCondition(fs.existsSync(BAKE_PATH), 'real Terrain3D G01 bake proof is missing');
const bake = JSON.parse(fs.readFileSync(BAKE_PATH, 'utf8'));
requireCondition(bake.schema === 'westeros-g01-terrain3d-bake-v1', `unexpected bake schema ${bake.schema}`);
requireCondition(bake.sourceMapSha256 === EXPECTED_MAP_SHA, 'map.png provenance drifted');
requireCondition(bake.width === SOURCE_SIZE && bake.height === SOURCE_SIZE, `unexpected bake size ${bake.width}x${bake.height}`);
requireCondition(bake.regionCount >= 4 && bake.savedRegionFiles >= 4, 'continuity proof requires persisted multi-region Terrain3D data');
requireCondition(bake.bakedVertices > 0, 'continuity proof requires a non-empty Terrain3D LOD0 bake');
requireCondition(Number.isInteger(DENSE_PER_SOURCE), 'dense grid must align exactly with the Terrain3D runtime source intervals');

const scaleOptions = {
  mapBounds: WORLD_SCALE.MAP_BOUNDS,
  metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
  derivativeRadiusCells: 0.5,
};
const sampleSurface = createG01Terrain3DSurfaceSampler(bake, scaleOptions);
const sampleWorldSurface = createG01Terrain3DWorldSurfaceSampler(bake, scaleOptions);
const bounds = G01_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
const spanX = bounds.xMax - bounds.xMin;
const spanY = bounds.yMax - bounds.yMin;
const sourceStepX = spanX / SOURCE_INTERVALS;
const sourceStepY = spanY / SOURCE_INTERVALS;
const seamEpsilonX = sourceStepX / 4096;
const seamEpsilonY = sourceStepY / 4096;
const dense = Array.from({ length: DENSE_SIZE }, () => Array(DENSE_SIZE));
const checksum = crypto.createHash('sha256');
let minHeight = Infinity;
let maxHeight = -Infinity;
let maxSlopeDegrees = 0;
let maxGradientMagnitude = 0;
let denseSampleCount = 0;

for (let row = 0; row < DENSE_SIZE; row += 1) {
  const ny = bounds.yMin + spanY * row / DENSE_INTERVALS;
  for (let col = 0; col < DENSE_SIZE; col += 1) {
    const nx = bounds.xMin + spanX * col / DENSE_INTERVALS;
    const sample = sampleSurface(nx, ny);
    dense[row][col] = sample;
    minHeight = Math.min(minHeight, sample.heightMeters);
    maxHeight = Math.max(maxHeight, sample.heightMeters);
    maxSlopeDegrees = Math.max(maxSlopeDegrees, sample.slopeDegrees);
    maxGradientMagnitude = Math.max(maxGradientMagnitude, Math.hypot(sample.dHeightDx, sample.dHeightDz));
    requireCondition(Math.abs(Math.hypot(sample.normal.x, sample.normal.y, sample.normal.z) - 1) <= 1e-12, 'runtime surface normal lost unit length');
    requireCondition(sample.normal.y > 0, 'runtime surface normal flipped below the terrain');
    requireCondition(sample.slopeDegrees >= 0 && sample.slopeDegrees < 89.9, `invalid slope ${sample.slopeDegrees}`);
    mixChecksum(checksum, [nx, ny, sample.heightMeters, sample.snowWeight, sample.tintR, sample.tintG, sample.tintB, sample.roughness, sample.normal.x, sample.normal.y, sample.normal.z]);
    denseSampleCount += 1;
  }
}

const denseNeighborMax = zeroDelta();
const denseNeighborSum = zeroDelta();
let denseNeighborPairs = 0;
let alignedNormalAngleSum = 0;
let alignedNormalAngleMax = 0;
let alignedNormalPairs = 0;
let interiorNormalAngleSum = 0;
let interiorNormalAngleMax = 0;
let interiorNormalPairs = 0;

function recordNeighbor(a, b, aligned) {
  const delta = channelDelta(a, b);
  maxInto(denseNeighborMax, delta);
  addInto(denseNeighborSum, delta);
  denseNeighborPairs += 1;
  if (aligned) {
    alignedNormalAngleSum += delta.normalDegrees;
    alignedNormalAngleMax = Math.max(alignedNormalAngleMax, delta.normalDegrees);
    alignedNormalPairs += 1;
  } else {
    interiorNormalAngleSum += delta.normalDegrees;
    interiorNormalAngleMax = Math.max(interiorNormalAngleMax, delta.normalDegrees);
    interiorNormalPairs += 1;
  }
}

for (let row = 0; row < DENSE_SIZE; row += 1) {
  for (let col = 0; col < DENSE_SIZE; col += 1) {
    if (col + 1 < DENSE_SIZE) {
      const crossesSourceLine = (col + 1) % DENSE_PER_SOURCE === 0;
      recordNeighbor(dense[row][col], dense[row][col + 1], crossesSourceLine);
    }
    if (row + 1 < DENSE_SIZE) {
      const crossesSourceLine = (row + 1) % DENSE_PER_SOURCE === 0;
      recordNeighbor(dense[row][col], dense[row + 1][col], crossesSourceLine);
    }
  }
}

const sourceSeamMax = zeroDelta();
const sourceSeamSum = zeroDelta();
let sourceSeamPairs = 0;
for (let source = 1; source < SOURCE_INTERVALS; source += 1) {
  const seamX = bounds.xMin + sourceStepX * source;
  const seamY = bounds.yMin + sourceStepY * source;
  for (let cross = 0; cross < DENSE_SIZE; cross += 1) {
    const t = cross / DENSE_INTERVALS;
    const ny = bounds.yMin + spanY * t;
    const nx = bounds.xMin + spanX * t;
    const horizontal = channelDelta(
      sampleSurface(seamX - seamEpsilonX, ny),
      sampleSurface(seamX + seamEpsilonX, ny),
    );
    const vertical = channelDelta(
      sampleSurface(nx, seamY - seamEpsilonY),
      sampleSurface(nx, seamY + seamEpsilonY),
    );
    maxInto(sourceSeamMax, horizontal);
    maxInto(sourceSeamMax, vertical);
    addInto(sourceSeamSum, horizontal);
    addInto(sourceSeamSum, vertical);
    sourceSeamPairs += 2;
  }
}

const externalEdgeMax = zeroDelta();
const edgeEpsilonX = sourceStepX / 1024;
const edgeEpsilonY = sourceStepY / 1024;
let externalEdgePairs = 0;
for (let i = 0; i < DENSE_SIZE; i += 1) {
  const t = i / DENSE_INTERVALS;
  const nx = bounds.xMin + spanX * t;
  const ny = bounds.yMin + spanY * t;
  const pairs = [
    [sampleSurface(bounds.xMin, ny), sampleSurface(bounds.xMin + edgeEpsilonX, ny)],
    [sampleSurface(bounds.xMax, ny), sampleSurface(bounds.xMax - edgeEpsilonX, ny)],
    [sampleSurface(nx, bounds.yMin), sampleSurface(nx, bounds.yMin + edgeEpsilonY)],
    [sampleSurface(nx, bounds.yMax), sampleSurface(nx, bounds.yMax - edgeEpsilonY)],
  ];
  for (const [a, b] of pairs) {
    maxInto(externalEdgeMax, channelDelta(a, b));
    externalEdgePairs += 1;
  }
}

const worldParityMax = {
  height: 0,
  snow: 0,
  tint: 0,
  roughness: 0,
  normal: 0,
  slope: 0,
};
let worldParitySamples = 0;
for (let row = 0; row < WORLD_PARITY_SIZE; row += 1) {
  const v = (row + 0.37) / WORLD_PARITY_SIZE;
  const ny = bounds.yMin + spanY * v;
  for (let col = 0; col < WORLD_PARITY_SIZE; col += 1) {
    const u = (col + 0.61) / WORLD_PARITY_SIZE;
    const nx = bounds.xMin + spanX * u;
    const world = normalizedReferenceToWorldXZ(nx, ny, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
    const normalizedSample = sampleSurface(nx, ny);
    const worldSample = sampleWorldSurface(world.x, world.z);
    worldParityMax.height = Math.max(worldParityMax.height, Math.abs(normalizedSample.heightMeters - worldSample.heightMeters));
    worldParityMax.snow = Math.max(worldParityMax.snow, Math.abs(normalizedSample.snowWeight - worldSample.snowWeight));
    worldParityMax.tint = Math.max(worldParityMax.tint, Math.abs(normalizedSample.tintR - worldSample.tintR), Math.abs(normalizedSample.tintG - worldSample.tintG), Math.abs(normalizedSample.tintB - worldSample.tintB));
    worldParityMax.roughness = Math.max(worldParityMax.roughness, Math.abs(normalizedSample.roughness - worldSample.roughness));
    worldParityMax.normal = Math.max(worldParityMax.normal, angleDegrees(normalizedSample.normal, worldSample.normal));
    worldParityMax.slope = Math.max(worldParityMax.slope, Math.abs(normalizedSample.slopeDegrees - worldSample.slopeDegrees));
    worldParitySamples += 1;
  }
}

const alignedNormalMean = alignedNormalPairs ? alignedNormalAngleSum / alignedNormalPairs : 0;
const interiorNormalMean = interiorNormalPairs ? interiorNormalAngleSum / interiorNormalPairs : 0;
const gridNormalImprintRatio = alignedNormalMean / Math.max(interiorNormalMean, 1e-9);
const seamLimits = {
  height: Math.max(0.002, denseNeighborMax.height / 128),
  snow: Math.max(0.00002, denseNeighborMax.snow / 128),
  tint: Math.max(0.00002, denseNeighborMax.tint / 128),
  roughness: Math.max(0.00002, denseNeighborMax.roughness / 128),
  normalDegrees: Math.max(0.08, denseNeighborMax.normalDegrees / 64),
  slopeDegrees: Math.max(0.08, denseNeighborMax.slopeDegrees / 64),
};

for (const key of Object.keys(seamLimits)) {
  requireCondition(sourceSeamMax[key] <= seamLimits[key], `internal source-grid ${key} seam ${sourceSeamMax[key]} exceeds ${seamLimits[key]}`);
}
requireCondition(gridNormalImprintRatio <= 5, `source-grid normal imprint ratio ${gridNormalImprintRatio} exceeds 5`);
requireCondition(worldParityMax.height <= 1e-7, `world/normalized surface height parity ${worldParityMax.height}`);
requireCondition(worldParityMax.snow <= 1e-7, `world/normalized snow parity ${worldParityMax.snow}`);
requireCondition(worldParityMax.tint <= 1e-7, `world/normalized tint parity ${worldParityMax.tint}`);
requireCondition(worldParityMax.roughness <= 1e-7, `world/normalized roughness parity ${worldParityMax.roughness}`);
requireCondition(worldParityMax.normal <= 1e-5, `world/normalized normal parity ${worldParityMax.normal}`);
requireCondition(worldParityMax.slope <= 1e-7, `world/normalized slope parity ${worldParityMax.slope}`);
requireCondition(maxHeight > minHeight, 'dense surface lost all relief variation');

const metrics = {
  schema: 'westeros-g01-runtime-surface-continuity-v1',
  geoCell: 'G01',
  layer: 'Terrain3D Bake/Three.js runtime parity',
  sourceMapSha256: EXPECTED_MAP_SHA,
  terrain3dVersion: G01_TERRAIN3D_RUNTIME_PARITY.terrain3dVersion,
  terrain3dRegionCount: bake.regionCount,
  savedRegionFiles: bake.savedRegionFiles,
  bakedVertices: bake.bakedVertices,
  sourceSize: SOURCE_SIZE,
  denseSize: DENSE_SIZE,
  denseSampleCount,
  denseNeighborPairs,
  sourceSeamPairs,
  externalEdgePairs,
  worldParitySamples,
  derivativeRadiusCells: scaleOptions.derivativeRadiusCells,
  minHeight,
  maxHeight,
  maxSlopeDegrees,
  maxGradientMagnitude,
  denseNeighborMax,
  denseNeighborMean: divideMetrics(denseNeighborSum, denseNeighborPairs),
  internalSourceSeamMax: sourceSeamMax,
  internalSourceSeamMean: divideMetrics(sourceSeamSum, sourceSeamPairs),
  internalSourceSeamLimits: seamLimits,
  externalEdgeMax,
  alignedNormalMean,
  alignedNormalAngleMax,
  interiorNormalMean,
  interiorNormalAngleMax,
  gridNormalImprintRatio,
  worldParityMax,
  checksumSha256: checksum.digest('hex'),
  gridPolicy: '65x65 source and 257x257 import grids are measurement/addressing structures only; dense sampling and smoothed physical normals must not expose grid-aligned seams.',
  guardPolicy: 'External-edge differential probes are one-sided inside G01; cross-cell G00/G01 seam authority remains checkNWG01NearDetail.mjs.',
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, `${JSON.stringify(metrics, null, 2)}\n`);
console.log(`NW_G01_RUNTIME_SURFACE_CONTINUITY_METRICS=${JSON.stringify(metrics)}`);
console.log('NW_G01_RUNTIME_SURFACE_CONTINUITY_OK');
