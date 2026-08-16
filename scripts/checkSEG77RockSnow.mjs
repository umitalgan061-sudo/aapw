import fs from 'node:fs';
import path from 'node:path';
import { G77_ROCK_SNOW_POLICY, buildG77RockSnowProbe, measureG77RockSnow, sampleG77RockSnow } from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';

const SOURCE_PROVENANCE = Object.freeze({ mode: 'merged-sha-bound-derived-inputs', canonicalSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1', decodedSize: [1536, 1024], historicalFilename: 'map.png', verifiedOwnerByteEncoding: 'jpeg', rawPixelEvidenceClaimed: false });
const metrics = measureG77RockSnow();
const probeA = { ...buildG77RockSnowProbe(), sourceProvenance: SOURCE_PROVENANCE };
const probeB = { ...buildG77RockSnowProbe(), sourceProvenance: SOURCE_PROVENANCE };
const jsonA = JSON.stringify(probeA), jsonB = JSON.stringify(probeB);

if (jsonA !== jsonB) throw new Error('G77 Rock/Snow probe is not deterministic');
if (probeA.policyId !== G77_ROCK_SNOW_POLICY.id || probeA.sourceMapSha256 !== SOURCE_PROVENANCE.canonicalSha256) throw new Error('policy/source provenance mismatch');
if (JSON.stringify(probeA.sourceMapSize) !== '[1536,1024]' || probeA.sourceMapVersion !== 'map.png-r1' || probeA.sourceProvenance.rawPixelEvidenceClaimed !== false) throw new Error('canonical source contract drifted');
if (probeA.geoCell !== 'G77' || probeA.layer !== 'Rock/Snow') throw new Error('G77 layer identity mismatch');
if (probeA.sourceGridSize !== 65 || probeA.terrain3dRegionSize !== 256 || probeA.terrain3dImportSize !== 257) throw new Error('Terrain3D source/import contract drifted');
if (probeA.groundTextureId !== 0 || probeA.rockTextureId !== 1 || probeA.snowTextureId !== 2 || probeA.slopeFilterTaps !== 9) throw new Error('Terrain3D material/slope contract drifted');
if (metrics.canonicalWaterCells !== 44 || metrics.canonicalLandCells !== 52 || metrics.sourceSamples !== 4225) throw new Error('merged G77 geography drifted');
if (metrics.fractionalRockSamples < 512 || metrics.rockBlendSpan < 0.01 || metrics.shorelineSamples < 64 || metrics.deepLandSamples < 64) throw new Error('Rock/Snow continuous coverage collapsed');
if (metrics.maxCanonicalWaterLeak > 1e-6) throw new Error(`Rock/Snow leaked onto canonical water: ${metrics.maxCanonicalWaterLeak}`);
if (metrics.maxSnowWeight > 0.35 || metrics.maxAdjacentRockStep > 0.20 || metrics.maxAdjacentSnowStep > 0.10) throw new Error('Rock/Snow material envelope exceeded');
if (metrics.maxGuardRockDelta > 0.20 || metrics.maxGuardSnowDelta > 0.10) throw new Error('Rock/Snow guard seam exceeded');
if (metrics.maxAdjacentFilteredSlopeStep > metrics.maxAdjacentRawSlopeStep + 1e-9) throw new Error('3x3 slope filter increased worst derivative');

for (const [nx, ny] of [[0.875, 0.875], [0.9375, 0.9375], [1, 1], [0.9, 0.99]]) {
  const s = sampleG77RockSnow(nx, ny);
  for (const key of ['waterConfidence','landFactor','height','rawSlope','slope','rockWeight','snowWeight','groundWeight','materialWeight']) if (!Number.isFinite(s[key])) throw new Error(`non-finite ${key} at ${nx},${ny}`);
  if (s.rockWeight < -1e-9 || s.snowWeight < -1e-9 || s.groundWeight < -1e-9) throw new Error('negative material weight');
  if (s.waterConfidence >= 0.5 && s.rockWeight + s.snowWeight > 1e-6) throw new Error('canonical-water material leak');
}

const emit = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emit) { const output = emit.slice('--emit-probe='.length); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${jsonA}\n`); }
console.log(`SE_G77_ROCK_SNOW_SOURCE_PROVENANCE=${JSON.stringify(SOURCE_PROVENANCE)}`);
console.log(`SE_G77_ROCK_SNOW_METRICS=${JSON.stringify(metrics)}`);
console.log('SE_G77_ROCK_SNOW_VALIDATION_OK');
