import fs from 'node:fs';
import path from 'node:path';
import { G00_BIOME_POLICY, measureG00Biome, sampleG00BiomeColor } from '../godot/terrain-authoring/geocells/nw/g00_biome.mjs';

function assert(condition, message) { if (!condition) throw new Error(message); }
function parseProbePath() {
  const arg = process.argv.find((value) => value.startsWith('--emit-probe='));
  return arg ? arg.slice('--emit-probe='.length) : null;
}

const first = measureG00Biome();
const second = measureG00Biome();
assert(JSON.stringify(first) === JSON.stringify(second), 'G00 biome measurement must be deterministic');
assert(first.policyId === G00_BIOME_POLICY.id, 'policy id drift');
assert(first.samples === 4225, `unexpected sample count ${first.samples}`);
assert(first.colorChecksum > 0, 'color checksum missing');
assert(first.maxAdjacentColorDelta > 0 && first.maxAdjacentColorDelta < 0.18, `adjacent color step invalid: ${first.maxAdjacentColorDelta}`);
assert(first.maxGuardBandDelta < 0.30, `guard-band color discontinuity too large: ${first.maxGuardBandDelta}`);
assert(Object.keys(first.dominantCounts).length >= 2, 'G00 must contain both water and land/biome influence');

const bounds = G00_BIOME_POLICY.normalizedBounds;
assert(sampleG00BiomeColor(bounds.xMax + G00_BIOME_POLICY.guardBandNormalized, bounds.yMax).color.every(Number.isFinite), 'east guard sample non-finite');
assert(sampleG00BiomeColor(bounds.xMax, bounds.yMax + G00_BIOME_POLICY.guardBandNormalized).color.every(Number.isFinite), 'south guard sample non-finite');

const probePath = parseProbePath();
if (probePath) {
  const size = 65;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      row.push(sampleG00BiomeColor(nx, ny).color.map((value) => Number(value.toFixed(8))));
    }
    rows.push(row);
  }
  const payload = {
    policyId: G00_BIOME_POLICY.id,
    sourceMapSha256: G00_BIOME_POLICY.sourceMapSha256,
    geoCell: 'G00',
    layer: G00_BIOME_POLICY.layer,
    terrain3dRegionSize: G00_BIOME_POLICY.terrain3dRegionSize,
    normalizedBounds: bounds,
    sourceGridSize: size,
    colorChecksum: first.colorChecksum,
    maxAdjacentColorDelta: first.maxAdjacentColorDelta,
    maxGuardBandDelta: first.maxGuardBandDelta,
    rows,
  };
  fs.mkdirSync(path.dirname(probePath), { recursive: true });
  fs.writeFileSync(probePath, `${JSON.stringify(payload)}\n`);
  console.log(`NW_G00_BIOME_PROBE=${probePath}`);
}
console.log(`NW_G00_BIOME_METRICS=${JSON.stringify(first)}`);
console.log('NW_G00_BIOME_VALIDATION_OK');
