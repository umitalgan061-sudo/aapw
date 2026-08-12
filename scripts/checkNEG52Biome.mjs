#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  G52_BIOME_POLICY,
  measureG52Biome,
  sampleG52BiomeColor,
} from '../godot/terrain-authoring/geocells/ne/g52_biome.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseProbePath() {
  const arg = process.argv.find((value) => value.startsWith('--emit-probe='));
  return arg ? arg.slice('--emit-probe='.length) : null;
}

const first = measureG52Biome();
const second = measureG52Biome();
assert(JSON.stringify(first) === JSON.stringify(second), 'G52 biome measurement must be deterministic');
assert(first.policyId === G52_BIOME_POLICY.id, 'policy id drift');
assert(first.samples === 4225, `unexpected sample count ${first.samples}`);
assert(first.canonical.waterCells === 84, `expected 84 canonical water cells, got ${first.canonical.waterCells}`);
assert(first.canonical.landCells === 12, `expected 12 canonical land cells, got ${first.canonical.landCells}`);
assert(first.canonical.boundaryEdges === 14, `expected 14 canonical boundary edges, got ${first.canonical.boundaryEdges}`);
assert(first.fractionalWaterSamples > 0, 'mixed G52 coastline must produce fractional water samples');
assert(first.colorChecksum > 0, 'color checksum missing');
assert(first.maxAdjacentColorDelta > 0, 'biome field did not vary');
assert(first.maxAdjacentColorDelta < 0.18, `adjacent color step too large: ${first.maxAdjacentColorDelta}`);
assert(first.maxGuardBandDelta < 0.75, `guard-band discontinuity is unbounded: ${first.maxGuardBandDelta}`);
assert(Object.keys(first.dominantCounts).length >= 2, 'G52 must contain water plus at least one land macro semantic');

const bounds = G52_BIOME_POLICY.normalizedBounds;
const cornerA = sampleG52BiomeColor(bounds.xMin, bounds.yMin).color;
const cornerB = sampleG52BiomeColor(bounds.xMax, bounds.yMax).color;
assert(cornerA.every(Number.isFinite) && cornerB.every(Number.isFinite), 'non-finite biome color');

const probePath = parseProbePath();
if (probePath) {
  const size = 65;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      row.push(sampleG52BiomeColor(nx, ny).color.map((value) => Number(value.toFixed(8))));
    }
    rows.push(row);
  }
  const payload = {
    policyId: G52_BIOME_POLICY.id,
    sourceMapSha256: G52_BIOME_POLICY.sourceMapSha256,
    geoCell: 'G52',
    layer: G52_BIOME_POLICY.layer,
    terrain3dRegionSize: G52_BIOME_POLICY.terrain3dRegionSize,
    normalizedBounds: bounds,
    sourceGridSize: size,
    colorChecksum: first.colorChecksum,
    maxAdjacentColorDelta: first.maxAdjacentColorDelta,
    maxGuardBandDelta: first.maxGuardBandDelta,
    canonical: first.canonical,
    rows,
  };
  fs.mkdirSync(path.dirname(probePath), { recursive: true });
  fs.writeFileSync(probePath, `${JSON.stringify(payload)}\n`);
  console.log(`NE_G52_BIOME_PROBE=${probePath}`);
}

console.log(`NE_G52_BIOME_METRICS=${JSON.stringify(first)}`);
console.log('NE_G52_BIOME_VALIDATION_OK');
