import fs from 'node:fs';
import path from 'node:path';
import { G10_BIOME_POLICY, buildG10BiomeProbe, measureG10Biome, sampleG10GlobalWaterConfidence } from '../godot/terrain-authoring/geocells/nw/g10_biome.mjs';
import { measureG10Hydrology, sampleG10WaterConfidence } from '../godot/terrain-authoring/geocells/nw/g10_hydrology.mjs';

function assert(condition, message) { if (!condition) throw new Error(message); }
const emitArg = process.argv.find((value) => value.startsWith('--emit-probe='));

const hydrology = measureG10Hydrology();
assert(hydrology.waterCells === 60 && hydrology.landCells === 36, `G10 hydrology inventory drifted: ${JSON.stringify(hydrology)}`);
assert(hydrology.boundaryEdges === 30 && hydrology.centreMismatches === 0, 'G10 coastline topology drifted');

const first = measureG10Biome();
const second = measureG10Biome();
assert(JSON.stringify(first) === JSON.stringify(second), 'G10 biome measurement must be deterministic');
assert(first.policyId === G10_BIOME_POLICY.id, 'G10 biome policy drift');
assert(first.samples === 4225, `unexpected G10 biome sample count: ${first.samples}`);
assert(first.colorChecksum > 0, 'G10 biome checksum missing');
assert(first.fractionalWaterSamples > 0, 'G10 filtered coastline transition missing');
assert((first.dominantCounts.water ?? 0) > 0, 'G10 water influence missing');
assert(Object.keys(first.dominantCounts).length >= 2, 'G10 must preserve mixed water/land biome influence');
assert(first.maxAdjacentColorDelta > 0 && first.maxAdjacentColorDelta < 0.18, `G10 adjacent color step invalid: ${first.maxAdjacentColorDelta}`);
assert(first.maxAdjacentWaterDelta <= 0.25, `G10 water-confidence step regressed: ${first.maxAdjacentWaterDelta}`);
assert(first.maxGuardBandColorDelta < 0.30, `G10 biome guard-band color seam: ${first.maxGuardBandColorDelta}`);
assert(first.maxGuardBandWaterDelta <= 0.25, `G10 hydrology guard-band seam: ${first.maxGuardBandWaterDelta}`);

for (let my = G10_BIOME_POLICY.maskBounds.yMin; my <= G10_BIOME_POLICY.maskBounds.yMax; my += 1) {
  for (let mx = G10_BIOME_POLICY.maskBounds.xMin; mx <= G10_BIOME_POLICY.maskBounds.xMax; mx += 1) {
    const nx = (mx + 0.5) / G10_BIOME_POLICY.baseMaskWidth;
    const ny = (my + 0.5) / G10_BIOME_POLICY.baseMaskHeight;
    const prior = sampleG10WaterConfidence(nx, ny);
    const biome = sampleG10GlobalWaterConfidence(nx, ny);
    assert(prior !== null && Math.abs(prior - biome) <= 1e-12, `G10 biome changed canonical hydrology at ${mx}/${my}`);
  }
}

const bounds = G10_BIOME_POLICY.normalizedBounds;
for (const [x, y] of [
  [bounds.xMin - G10_BIOME_POLICY.guardBandNormalized, bounds.yMax],
  [bounds.xMax + G10_BIOME_POLICY.guardBandNormalized, bounds.yMax],
  [bounds.xMax, bounds.yMax + G10_BIOME_POLICY.guardBandNormalized],
]) {
  assert(Number.isFinite(sampleG10GlobalWaterConfidence(x, y)), `G10 guard hydrology sample is non-finite at ${x}/${y}`);
}

if (emitArg) {
  const output = emitArg.slice('--emit-probe='.length);
  const probe = buildG10BiomeProbe();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(probe)}\n`);
  console.log(`NW_G10_BIOME_PROBE=${output}`);
}

console.log(`NW_G10_BIOME_METRICS=${JSON.stringify(first)}`);
console.log('NW_G10_BIOME_VALIDATION_OK');
