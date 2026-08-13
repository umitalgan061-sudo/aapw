import fs from 'node:fs';
import path from 'node:path';
import {
  buildG75RockSnowProbe,
  measureG75RockSnow,
} from '../godot/terrain-authoring/geocells/se/g75_rock_snow.mjs';

const metrics = measureG75RockSnow();

if (metrics.canonicalWaterCells !== 0 || metrics.canonicalLandCells !== 96) {
  throw new Error(`G75 canonical hydrology drifted: ${metrics.canonicalWaterCells} water / ${metrics.canonicalLandCells} land`);
}
if (metrics.sourceSamples !== 4225) throw new Error(`unexpected source sample count ${metrics.sourceSamples}`);
if (metrics.fractionalRockSamples < 512) throw new Error('G75 rock field collapsed to a binary/block surface');
if (metrics.rockBlendSpan < 0.01) throw new Error(`G75 rock field has insufficient physical variation: ${metrics.rockBlendSpan}`);
if (metrics.maxAdjacentRockStep > 0.20) throw new Error(`adjacent G75 rock blend step too large: ${metrics.maxAdjacentRockStep}`);
if (metrics.maxGuardBandRockDelta > 0.20) throw new Error(`G75 guard-band rock seam too large: ${metrics.maxGuardBandRockDelta}`);
if (metrics.maxCanonicalWaterSurfaceLeak > 0.000001) {
  throw new Error(`G75 rock/snow leaked onto canonical water centres: ${metrics.maxCanonicalWaterSurfaceLeak}`);
}
if (metrics.maxSnowWeight > 0.35) {
  throw new Error(`G75 southeast snow coverage became physically implausible: ${metrics.maxSnowWeight}`);
}

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = emitArg.slice('--emit-probe='.length);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(buildG75RockSnowProbe())}\n`);
}

console.log(`SE_G75_ROCK_SNOW_METRICS=${JSON.stringify(metrics)}`);
console.log('SE_G75_ROCK_SNOW_VALIDATION_OK');
