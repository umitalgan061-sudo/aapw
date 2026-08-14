import fs from 'node:fs';
import path from 'node:path';
import { buildG77RockSnowProbe, measureG77RockSnow } from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';
const metrics = measureG77RockSnow();
if (metrics.canonicalWaterCells !== 44 || metrics.canonicalLandCells !== 52) throw new Error(`G77 canonical hydrology drifted: ${metrics.canonicalWaterCells} water / ${metrics.canonicalLandCells} land`);
if (metrics.sourceSamples !== 4225) throw new Error(`unexpected source sample count ${metrics.sourceSamples}`);
if (metrics.fractionalRockSamples < 512) throw new Error('G77 rock field collapsed to binary/block output');
if (metrics.rockBlendSpan < 0.01) throw new Error(`G77 rock field has insufficient physical variation: ${metrics.rockBlendSpan}`);
if (metrics.maxAdjacentRockStep > 0.20) throw new Error(`adjacent G77 rock blend step too large: ${metrics.maxAdjacentRockStep}`);
if (metrics.maxGuardBandRockDelta > 0.20) throw new Error(`G77 guard-band rock seam too large: ${metrics.maxGuardBandRockDelta}`);
if (metrics.maxGuardBandSnowDelta > 0.10) throw new Error(`G77 guard-band snow seam too large: ${metrics.maxGuardBandSnowDelta}`);
if (metrics.maxCanonicalWaterSurfaceLeak > 0.000001) throw new Error(`G77 rock/snow leaked onto canonical water: ${metrics.maxCanonicalWaterSurfaceLeak}`);
if (metrics.maxSnowWeight > 0.35) throw new Error(`G77 southeast snow became implausible: ${metrics.maxSnowWeight}`);
const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) { const output = emitArg.slice('--emit-probe='.length); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(buildG77RockSnowProbe())}\n`); }
console.log(`SE_G77_ROCK_SNOW_METRICS=${JSON.stringify(metrics)}`);
console.log('SE_G77_ROCK_SNOW_VALIDATION_OK');
