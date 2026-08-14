import fs from 'node:fs';
import path from 'node:path';
import { G77_ROCK_SNOW_POLICY, buildG77RockSnowProbe, measureG77RockSnow, sampleG77RockSnow } from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';

const metrics = measureG77RockSnow();
const probeA = buildG77RockSnowProbe();
const probeB = buildG77RockSnowProbe();
const jsonA = JSON.stringify(probeA);
const jsonB = JSON.stringify(probeB);

if (jsonA !== jsonB) throw new Error('G77 Rock/Snow probe is not deterministic');
if (probeA.policyId !== G77_ROCK_SNOW_POLICY.id) throw new Error('probe policy mismatch');
if (probeA.sourceMapSha256 !== G77_ROCK_SNOW_POLICY.sourceMapSha256) throw new Error('map.png provenance mismatch');
if (JSON.stringify(probeA.sourceMapSize) !== '[1536,1024]' || probeA.sourceMapVersion !== 'map.png-r1') throw new Error('map.png size/version provenance mismatch');
if (probeA.geoCell !== 'G77' || probeA.layer !== 'Rock/Snow') throw new Error('G77 layer identity mismatch');
if (probeA.sourceGridSize !== 65 || probeA.terrain3dRegionSize !== 256 || probeA.terrain3dImportSize !== 257) throw new Error('Terrain3D source/import contract drifted');
if (probeA.groundTextureId !== 0 || probeA.rockTextureId !== 1 || probeA.snowTextureId !== 2) throw new Error('texture ID contract drifted');
if (probeA.slopeFilterTaps !== 9 || probeA.slopeFilterRadiusNormalized !== 1 / 1024) throw new Error('slope filter contract drifted');
if (metrics.canonicalWaterCells !== 44 || metrics.canonicalLandCells !== 52) throw new Error(`canonical hydrology drifted: ${metrics.canonicalWaterCells}/${metrics.canonicalLandCells}`);
if (metrics.sourceSamples !== 4225) throw new Error(`unexpected source sample count ${metrics.sourceSamples}`);
if (metrics.fractionalRockSamples < 512) throw new Error(`Rock/Snow collapsed toward binary blocks: ${metrics.fractionalRockSamples}`);
if (metrics.rockBlendSpan < 0.01) throw new Error(`Rock/Snow variation collapsed: ${metrics.rockBlendSpan}`);
if (metrics.shorelineSamples < 64 || metrics.deepLandSamples < 64) throw new Error('shore/deep-land coverage is insufficient');
if (metrics.maxCanonicalWaterLeak > 1e-6) throw new Error(`Rock/Snow leaked onto canonical water: ${metrics.maxCanonicalWaterLeak}`);
if (metrics.maxSnowWeight > 0.35) throw new Error(`southeast snow became implausible: ${metrics.maxSnowWeight}`);
if (metrics.maxAdjacentRockStep > 0.20) throw new Error(`adjacent rock step too large: ${metrics.maxAdjacentRockStep}`);
if (metrics.maxAdjacentSnowStep > 0.10) throw new Error(`adjacent snow step too large: ${metrics.maxAdjacentSnowStep}`);
if (metrics.maxGuardRockDelta > 0.20) throw new Error(`west/north rock guard seam too large: ${metrics.maxGuardRockDelta}`);
if (metrics.maxGuardSnowDelta > 0.10) throw new Error(`west/north snow guard seam too large: ${metrics.maxGuardSnowDelta}`);
if (metrics.maxAdjacentFilteredSlopeStep > metrics.maxAdjacentRawSlopeStep + 1e-9) throw new Error('3x3 slope filter increased the worst derivative');

for (const [nx, ny] of [[0.875, 0.875], [0.9375, 0.9375], [1, 1], [0.9, 0.99]]) {
  const s = sampleG77RockSnow(nx, ny);
  for (const key of ['waterConfidence', 'landFactor', 'height', 'rawSlope', 'slope', 'rockWeight', 'snowWeight', 'groundWeight', 'materialWeight']) {
    if (!Number.isFinite(s[key])) throw new Error(`non-finite ${key} at ${nx},${ny}`);
  }
  if (s.rockWeight < -1e-9 || s.snowWeight < -1e-9 || s.groundWeight < -1e-9) throw new Error('negative material weight');
  if (s.waterConfidence >= 0.5 && s.rockWeight + s.snowWeight > 1e-6) throw new Error('canonical-water material leak');
}

const emit = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emit) {
  const output = emit.slice('--emit-probe='.length);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${jsonA}\n`);
}

console.log(`SE_G77_ROCK_SNOW_METRICS=${JSON.stringify(metrics)}`);
console.log('SE_G77_ROCK_SNOW_VALIDATION_OK');
