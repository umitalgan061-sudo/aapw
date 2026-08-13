import fs from 'node:fs';
import path from 'node:path';
import { G01_BIOME_POLICY, measureG01Biome, sampleG01BiomeColor } from '../godot/terrain-authoring/geocells/nw/g01_biome.mjs';

function assert(condition, message) { if (!condition) throw new Error(message); }
const probeArg = process.argv.find((value) => value.startsWith('--emit-probe='));
const first = measureG01Biome();
const second = measureG01Biome();
assert(JSON.stringify(first) === JSON.stringify(second), 'G01 biome measurement must be deterministic');
assert(first.samples === 4225, 'unexpected sample count');
assert(first.colorChecksum > 0, 'color checksum missing');
assert(first.maxAdjacentColorDelta > 0 && first.maxAdjacentColorDelta < 0.18, 'adjacent color step invalid');
assert(first.maxGuardBandDelta < 0.30, 'guard-band color discontinuity too large');
assert(first.fractionalWaterSamples > 0, 'filtered coastline transition missing');
assert((first.dominantCounts.water ?? 0) > 0, 'canonical water influence missing');
assert(Object.keys(first.dominantCounts).length >= 2, 'mixed biome influence missing');

const bounds = G01_BIOME_POLICY.normalizedBounds;
assert(sampleG01BiomeColor(bounds.xMax + G01_BIOME_POLICY.guardBandNormalized, bounds.yMin).color.every(Number.isFinite), 'east guard sample non-finite');
assert(sampleG01BiomeColor(bounds.xMax, bounds.yMax + G01_BIOME_POLICY.guardBandNormalized).color.every(Number.isFinite), 'south guard sample non-finite');
assert(sampleG01BiomeColor(bounds.xMin, bounds.yMin - G01_BIOME_POLICY.guardBandNormalized).color.every(Number.isFinite), 'north guard sample non-finite');

if (probeArg) {
  const probePath = probeArg.slice('--emit-probe='.length);
  const size = 65;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * y / (size - 1);
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * x / (size - 1);
      row.push(sampleG01BiomeColor(nx, ny).color.map((value) => Number(value.toFixed(8))));
    }
    rows.push(row);
  }
  const payload = { policyId: G01_BIOME_POLICY.id, sourceMapSha256: G01_BIOME_POLICY.sourceMapSha256, geoCell: 'G01', layer: G01_BIOME_POLICY.layer, terrain3dRegionSize: G01_BIOME_POLICY.terrain3dRegionSize, normalizedBounds: bounds, sourceGridSize: size, hydrologyFingerprint: '88 water / 8 land / 9 internal boundary edges / 0 centre mismatches', colorChecksum: first.colorChecksum, maxAdjacentColorDelta: first.maxAdjacentColorDelta, maxGuardBandDelta: first.maxGuardBandDelta, rows };
  fs.mkdirSync(path.dirname(probePath), { recursive: true });
  fs.writeFileSync(probePath, `${JSON.stringify(payload)}\n`);
  console.log(`NW_G01_BIOME_PROBE=${probePath}`);
}
console.log(`NW_G01_BIOME_METRICS=${JSON.stringify(first)}`);
console.log('NW_G01_BIOME_VALIDATION_OK');
