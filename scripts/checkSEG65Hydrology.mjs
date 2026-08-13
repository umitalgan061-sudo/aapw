import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_REFERENCE_WATER_MASK } from '../src/3d/world/worldReferenceWaterMask.js';
import { G65, buildG65HydrologyProbe, sampleG65WaterConfidence } from '../godot/terrain-authoring/geocells/se/g65_hydrology.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROOF_DIR = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof');
const SOURCE_PATH = path.join(PROOF_DIR, 'g65-hydrology-source.json');

function rowBit(rowHex, x) {
  const nibble = Number.parseInt(rowHex[Math.floor(x / 4)], 16);
  return (nibble >> (3 - (x % 4))) & 1;
}

let water = 0;
let land = 0;
let boundaries = 0;
for (let y = G65.maskBounds.minY; y <= G65.maskBounds.maxY; y += 1) {
  for (let x = G65.maskBounds.minX; x <= G65.maskBounds.maxX; x += 1) {
    const isWater = rowBit(WORLD_REFERENCE_WATER_MASK.rowsHex[y], x) === 1;
    if (isWater) water += 1; else land += 1;
    if (x < G65.maskBounds.maxX && isWater !== (rowBit(WORLD_REFERENCE_WATER_MASK.rowsHex[y], x + 1) === 1)) boundaries += 1;
    if (y < G65.maskBounds.maxY && isWater !== (rowBit(WORLD_REFERENCE_WATER_MASK.rowsHex[y + 1], x) === 1)) boundaries += 1;
  }
}
if (water !== 0 || land !== 96 || boundaries !== 0) throw new Error(`G65 canonical fingerprint changed: water=${water} land=${land} boundaries=${boundaries}`);

let guardWater = 0;
let guardSamples = 0;
for (let y = G65.maskBounds.minY - 1; y <= G65.maskBounds.maxY + 1; y += 1) {
  for (let x = G65.maskBounds.minX - 1; x <= G65.maskBounds.maxX + 1; x += 1) {
    guardSamples += 1;
    guardWater += rowBit(WORLD_REFERENCE_WATER_MASK.rowsHex[y], x);
  }
}
if (guardWater !== 1 || guardSamples !== 140) throw new Error(`G65 guard fingerprint changed: water=${guardWater}/${guardSamples}`);

let centreMismatches = 0;
for (let y = G65.maskBounds.minY; y <= G65.maskBounds.maxY; y += 1) {
  for (let x = G65.maskBounds.minX; x <= G65.maskBounds.maxX; x += 1) {
    const nx = (x + 0.5) / WORLD_REFERENCE_WATER_MASK.width;
    const ny = (y + 0.5) / WORLD_REFERENCE_WATER_MASK.height;
    if (sampleG65WaterConfidence(nx, ny) >= 0.5) centreMismatches += 1;
  }
}
if (centreMismatches !== 0) throw new Error(`G65 centre mismatches=${centreMismatches}`);

const probe = buildG65HydrologyProbe(65, 1);
let maxStep = 0;
let fractional = 0;
for (let y = 0; y < probe.size; y += 1) {
  for (let x = 0; x < probe.size; x += 1) {
    const index = y * probe.size + x;
    const value = probe.confidence[index];
    if (value > 0 && value < 1) fractional += 1;
    if (x + 1 < probe.size) maxStep = Math.max(maxStep, Math.abs(value - probe.confidence[index + 1]));
    if (y + 1 < probe.size) maxStep = Math.max(maxStep, Math.abs(value - probe.confidence[index + probe.size]));
  }
}
if (maxStep > 0.08) throw new Error(`G65 filtered confidence step too large: ${maxStep}`);
if (fractional < 1) throw new Error('G65 guard probe did not expose adjacent continuous coastal transition');

const payload = {
  schema: probe.schema,
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  maskSha256: WORLD_REFERENCE_WATER_MASK.maskSha256,
  cell: G65.id,
  bounds: probe.bounds,
  size: probe.size,
  haloMaskCells: probe.haloMaskCells,
  canonical: { water, land, boundaries, centreMismatches },
  guard: { water: guardWater, samples: guardSamples },
  metrics: { fractionalSamples: fractional, maxAdjacentConfidenceStep: maxStep },
  confidence: probe.confidence,
  heights: probe.heights,
};
fs.mkdirSync(PROOF_DIR, { recursive: true });
fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(payload)}\n`);
console.log(JSON.stringify({ cell: G65.id, canonical: payload.canonical, guard: payload.guard, metrics: payload.metrics }));
console.log('SE_G65_HYDROLOGY_SOURCE_OK');
