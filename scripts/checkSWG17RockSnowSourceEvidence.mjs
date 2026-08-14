import fs from 'node:fs';
import path from 'node:path';
import { measureG17RockDistribution } from '../godot/terrain-authoring/geocells/sw/g17_rock_snow_distribution.mjs';
import { measureG17RockFullGrid } from '../godot/terrain-authoring/geocells/sw/g17_rock_snow_grid.mjs';
import { measureG17RockSourceLods } from '../godot/terrain-authoring/geocells/sw/g17_rock_snow_lod.mjs';
import { measureG17RockSnow } from '../godot/terrain-authoring/geocells/sw/g17_rock_snow_metrics.mjs';

function outputPath() {
  const arg = process.argv.find((candidate) => candidate.startsWith('--out='));
  return arg ? arg.slice('--out='.length) : null;
}

function snapshot() {
  return Object.freeze({
    schema: 'westeros-g17-rock-snow-source-evidence-v1',
    metrics: measureG17RockSnow(),
    distribution: measureG17RockDistribution(),
    fullGrid: measureG17RockFullGrid(),
    sourceLods: measureG17RockSourceLods(),
  });
}

const first = snapshot();
const second = snapshot();
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G17 Rock/Snow source evidence is not deterministic');
if (first.metrics.policyId !== 'gunbatimi-ustasi-g17-terrain3d-rock-snow-2026-08-13-v1') throw new Error('G17 Rock/Snow policy identity drifted');
if (first.metrics.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') throw new Error('G17 Rock/Snow owner-map SHA drifted');
if (first.metrics.canonicalWaterCells !== 96 || first.metrics.canonicalLandCells !== 0) throw new Error('G17 Rock/Snow canonical marine ownership drifted');
if (first.metrics.maxSnowWeight !== 0 || first.fullGrid.maxSnow !== 0) throw new Error('G17 Rock/Snow source evidence invented snow');
if (first.distribution.maxWeightSumError > 1e-10) throw new Error('G17 Rock/Snow material weights no longer sum to one');
if (first.fullGrid.samples !== 66049 || first.fullGrid.aligned !== 4225) throw new Error('G17 Rock/Snow full-grid evidence coverage drifted');
if (first.fullGrid.maxRockErr !== 0 || first.fullGrid.maxHeightErr !== 0) throw new Error('G17 Rock/Snow source-grid interpolation lost aligned parity');
if (first.fullGrid.maxStep > 0.006 || first.fullGrid.seamStep > 0.006) throw new Error('G17 Rock/Snow 257x257 source continuity regressed');
if (first.sourceLods.length !== 4) throw new Error('G17 Rock/Snow source LOD evidence count drifted');
for (let i = 1; i < first.sourceLods.length; i += 1) {
  if (first.sourceLods[i].samples >= first.sourceLods[i - 1].samples) throw new Error('G17 Rock/Snow source LOD sample counts do not decimate');
}

const out = outputPath();
if (out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(first, null, 2)}\n`);
}

console.log(`SW_G17_ROCK_SNOW_SOURCE_EVIDENCE=${JSON.stringify(first)}`);
console.log('SW_G17_ROCK_SNOW_SOURCE_EVIDENCE_OK');
