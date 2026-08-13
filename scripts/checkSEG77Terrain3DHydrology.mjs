import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_REFERENCE_WATER_MASK as MASK } from '../src/3d/world/worldReferenceWaterMask.js';
import { G77, buildG77HydrologyProbe, sampleG77WaterConfidence, sampleG77HydrologyHeight } from '../godot/terrain-authoring/geocells/se/g77_hydrology.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proofPath = path.join(root, 'godot/terrain-authoring/.terrain3d-proof/g77-hydrology-source.json');
function cell(row, x) { const n = Number.parseInt(row[Math.floor(x / 4)], 16); return (n >> (3 - (x % 4))) & 1; }

let water = 0, land = 0, boundaries = 0;
for (let y = 56; y <= 63; y += 1) for (let x = 84; x <= 95; x += 1) {
  const value = cell(MASK.rowsHex[y], x); water += value; land += 1 - value;
  if (x < 95 && value !== cell(MASK.rowsHex[y], x + 1)) boundaries += 1;
  if (y < 63 && value !== cell(MASK.rowsHex[y + 1], x)) boundaries += 1;
}
if (water !== 44 || land !== 52 || boundaries !== 34) throw new Error(`canonical fingerprint ${water}/${land}/${boundaries}`);

let centreMismatches = 0, maxCentreHeightError = 0;
for (let y = 56; y <= 63; y += 1) for (let x = 84; x <= 95; x += 1) {
  const expectedWater = cell(MASK.rowsHex[y], x) === 1;
  const nx = (x + 0.5) / 96, ny = (y + 0.5) / 64;
  if ((sampleG77WaterConfidence(nx, ny) >= 0.5) !== expectedWater) centreMismatches += 1;
  maxCentreHeightError = Math.max(maxCentreHeightError, Math.abs(sampleG77HydrologyHeight(nx, ny) - (expectedWater ? -6 : 0.75)));
}
if (centreMismatches || maxCentreHeightError > 1e-12) throw new Error(`centre regression ${centreMismatches}/${maxCentreHeightError}`);

let guardWater = 0, guardSamples = 0;
for (let y = 55; y <= 63; y += 1) for (let x = 83; x <= 95; x += 1) { guardWater += cell(MASK.rowsHex[y], x); guardSamples += 1; }
if (guardWater !== 57 || guardSamples !== 117) throw new Error(`guard fingerprint ${guardWater}/${guardSamples}`);

const dense = buildG77HydrologyProbe(513);
let fractionalSamples = 0, contourEdges = 0, maxConfidenceStep = 0, maxHeightStep = 0;
for (let y = 0; y < 513; y += 1) for (let x = 0; x < 513; x += 1) {
  const sample = dense.rows[y][x]; if (sample[0] > 0 && sample[0] < 1) fractionalSamples += 1;
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    if (x + dx >= 513 || y + dy >= 513) continue;
    const next = dense.rows[y + dy][x + dx];
    maxConfidenceStep = Math.max(maxConfidenceStep, Math.abs(sample[0] - next[0]));
    maxHeightStep = Math.max(maxHeightStep, Math.abs(sample[1] - next[1]));
    if ((sample[0] >= 0.5) !== (next[0] >= 0.5)) contourEdges += 1;
  }
}
if (fractionalSamples < 50000 || contourEdges < 500) throw new Error(`continuous contour sparse ${fractionalSamples}/${contourEdges}`);
if (maxConfidenceStep > 0.05 || maxHeightStep > 0.35) throw new Error(`stepped coast ${maxConfidenceStep}/${maxHeightStep}`);

const source = buildG77HydrologyProbe(65);
const proof = { ...source, canonical: { water, land, boundaries, centreMismatches, maxCentreHeightError }, guard: { water: guardWater, samples: guardSamples }, continuity: { probeSize: 513, fractionalSamples, contourEdges, maxConfidenceStep, maxHeightStep } };
fs.mkdirSync(path.dirname(proofPath), { recursive: true });
fs.writeFileSync(proofPath, `${JSON.stringify(proof)}\n`);
console.log(JSON.stringify(proof.continuity));
console.log('SE_G77_TERRAIN3D_HYDROLOGY_SOURCE_OK');
