#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G65_TERRAIN3D_RUNTIME_GRID,
  getG65Terrain3dRuntimeGridForVerification,
  sampleG65Terrain3dRuntimeGridNormalized,
} from './runtime/g65Terrain3dRuntimeGrid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BAKE_ARG = process.argv.find((arg) => arg.startsWith('--bake='));
const BAKE_PATH = path.resolve(BAKE_ARG ? BAKE_ARG.slice('--bake='.length) : path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g65-runtime-bake.json'));
const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };

function bilerp(values, size, u, v) {
  const gx = Math.min(1, Math.max(0, u)) * (size - 1);
  const gy = Math.min(1, Math.max(0, v)) * (size - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, size - 1), y1 = Math.min(y0 + 1, size - 1);
  const tx = gx - x0, ty = gy - y0;
  const a = values[y0 * size + x0], b = values[y0 * size + x1];
  const c = values[y1 * size + x0], d = values[y1 * size + x1];
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

requireCondition(fs.existsSync(BAKE_PATH), `G65 Terrain3D bake missing: ${BAKE_PATH}`);
const bake = JSON.parse(fs.readFileSync(BAKE_PATH, 'utf8'));
const meta = G65_TERRAIN3D_RUNTIME_GRID;
requireCondition(bake.schema === 'westeros-g65-terrain3d-bake-v1', `unexpected schema ${bake.schema}`);
requireCondition(bake.policyId === meta.parityPolicyId, `unexpected parity policy ${bake.policyId}`);
requireCondition(bake.sourceMapSha256 === meta.sourceMapSha256, 'map.png provenance mismatch');
requireCondition(String(bake.terrain3dVersion).startsWith(meta.terrain3dVersion), `unexpected Terrain3D version ${bake.terrain3dVersion}`);
requireCondition(bake.width === meta.gridSize && bake.height === meta.gridSize, 'G65 runtime grid dimensions changed');
requireCondition(bake.regionCount >= meta.terrain3dRegionCount && bake.savedRegionFiles >= meta.terrain3dSavedRegionFiles, 'real Terrain3D region persistence regressed');
requireCondition(bake.bakedVertices === meta.terrain3dBakedVertices, `unexpected LOD0 vertex count ${bake.bakedVertices}`);

const grid = getG65Terrain3dRuntimeGridForVerification();
const channels = ['heights', 'rockBlend', 'tintR', 'tintG', 'tintB', 'roughness'];
for (const channel of channels) requireCondition(grid[channel].length === meta.gridSize ** 2, `runtime grid channel ${channel} has wrong length`);
let maxNodeHeightError = 0;
let maxNodeUnitError = 0;
for (let index = 0; index < meta.gridSize ** 2; index += 1) {
  maxNodeHeightError = Math.max(maxNodeHeightError, Math.abs(grid.heights[index] - bake.heights[index]));
  for (const channel of ['rockBlend', 'tintR', 'tintG', 'tintB', 'roughness']) {
    maxNodeUnitError = Math.max(maxNodeUnitError, Math.abs(grid[channel][index] - bake[channel][index]));
  }
}
requireCondition(maxNodeHeightError <= meta.maxNodeHeightErrorMeters, `node height parity error ${maxNodeHeightError}`);
requireCondition(maxNodeUnitError <= meta.maxNodeUnitError, `node material parity error ${maxNodeUnitError}`);

const bounds = meta.normalizedBounds;
let maxSampleHeightError = 0;
let maxSampleUnitError = 0;
let samples = 0;
for (let y = 0; y < 257; y += 1) {
  const v = y / 256;
  const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * v;
  for (let x = 0; x < 257; x += 1) {
    const u = x / 256;
    const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * u;
    const sampled = sampleG65Terrain3dRuntimeGridNormalized(nx, ny);
    requireCondition(sampled && Number.isFinite(sampled.height), `non-finite runtime sample at ${x},${y}`);
    const expectedHeight = bilerp(bake.heights, 129, u, v);
    const expectedRock = bilerp(bake.rockBlend, 129, u, v);
    const expectedColor = ['tintR', 'tintG', 'tintB'].map((channel) => bilerp(bake[channel], 129, u, v));
    const expectedRoughness = bilerp(bake.roughness, 129, u, v);
    maxSampleHeightError = Math.max(maxSampleHeightError, Math.abs(sampled.height - expectedHeight));
    maxSampleUnitError = Math.max(maxSampleUnitError, Math.abs(sampled.rockBlend - expectedRock), Math.abs(sampled.roughness - expectedRoughness));
    for (let channel = 0; channel < 3; channel += 1) maxSampleUnitError = Math.max(maxSampleUnitError, Math.abs(sampled.color[channel] - expectedColor[channel]));
    requireCondition(sampled.roadBlend === 0 && sampled.pathBlend === 0 && sampled.snowBlend === 0, 'runtime grid developed phantom road/path/snow');
    samples += 1;
  }
}
requireCondition(maxSampleHeightError <= meta.maxNodeHeightErrorMeters, `interpolated height parity error ${maxSampleHeightError}`);
requireCondition(maxSampleUnitError <= meta.maxNodeUnitError, `interpolated material parity error ${maxSampleUnitError}`);

console.log(`SE_G65_RUNTIME_GRID_METRICS=${JSON.stringify({ artifactRunId: meta.artifactRunId, artifactId: meta.artifactId, samples, maxNodeHeightError, maxNodeUnitError, maxSampleHeightError, maxSampleUnitError })}`);
console.log('SE_G65_TERRAIN3D_RUNTIME_GRID_OK');
