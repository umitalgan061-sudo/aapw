import fs from 'node:fs';
import path from 'node:path';
import { buildG11RockSnowProbe, measureG11RockSnow } from '../godot/terrain-authoring/geocells/nw/g11_rock_snow.mjs';

const metrics = measureG11RockSnow();
const fingerprint = metrics.hydrologyFingerprint;

if (fingerprint.waterCells !== 38 || fingerprint.landCells !== 58 || fingerprint.boundaryEdges !== 39 || fingerprint.centreMismatches !== 0) {
  throw new Error(`G11 hydrology fingerprint drifted: ${JSON.stringify(fingerprint)}`);
}
if (metrics.sourceSamples !== 4225) throw new Error(`unexpected source sample count ${metrics.sourceSamples}`);
if (metrics.fractionalBlendSamples < 64) throw new Error('rock/snow field is not meaningfully blended');
if (metrics.snowDominantSamples < 64) throw new Error('canonical northern snow signal disappeared');
if (metrics.rockDominantSamples < 32) throw new Error('terrain exposure no longer produces rock coverage');
if (metrics.maxAdjacentBlendStep > 0.18) throw new Error(`adjacent rock/snow blend step too large: ${metrics.maxAdjacentBlendStep}`);
if (metrics.maxGuardBandBlendDelta > 0.22) throw new Error(`G11 guard-band blend seam too large: ${metrics.maxGuardBandBlendDelta}`);
if (metrics.maxWaterSnowLeak > 0.000001) throw new Error(`snow leaked onto canonical water centres: ${metrics.maxWaterSnowLeak}`);

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = emitArg.slice('--emit-probe='.length);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(buildG11RockSnowProbe())}\n`);
}

console.log(`NW_G11_ROCK_SNOW_METRICS=${JSON.stringify(metrics)}`);
console.log('NW_G11_ROCK_SNOW_VALIDATION_OK');
