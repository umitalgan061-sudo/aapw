import fs from 'node:fs';
import path from 'node:path';
import { buildG52RockSnowProbe, measureG52RockSnow } from '../godot/terrain-authoring/geocells/ne/g52_rock_snow.mjs';

const metrics = measureG52RockSnow();
const fingerprint = metrics.hydrologyFingerprint;

if (fingerprint.waterCells !== 84 || fingerprint.landCells !== 12 || fingerprint.boundaryEdges !== 14 || fingerprint.centreMismatches !== 0) throw new Error(`G52 hydrology fingerprint drifted: ${JSON.stringify(fingerprint)}`);
if (metrics.sourceSamples !== 4225) throw new Error(`unexpected source sample count ${metrics.sourceSamples}`);
if (metrics.fractionalBlendSamples < 256) throw new Error('G52 physical rock/snow field is not meaningfully blended');
if (metrics.maxAdjacentSurfaceWeightStep > 0.2) throw new Error(`adjacent physical snow-weight step too large: ${metrics.maxAdjacentSurfaceWeightStep}`);
if (metrics.maxGuardBandSurfaceWeightDelta > 0.22) throw new Error(`G52 guard-band physical snow-weight seam too large: ${metrics.maxGuardBandSurfaceWeightDelta}`);
if (metrics.maxWaterSnowLeak > 0.000001) throw new Error(`snow leaked onto canonical water centres: ${metrics.maxWaterSnowLeak}`);
if (metrics.rockDominantSamples + metrics.snowDominantSamples !== metrics.sourceSamples) throw new Error('dominance accounting drifted');

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = emitArg.slice('--emit-probe='.length);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(buildG52RockSnowProbe())}\n`);
}
console.log(`NE_G52_ROCK_SNOW_METRICS=${JSON.stringify(metrics)}`);
console.log('NE_G52_ROCK_SNOW_VALIDATION_OK');
