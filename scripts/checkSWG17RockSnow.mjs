import fs from 'node:fs';
import path from 'node:path';
import {
  buildG17RockSnowProbe,
  measureG17RockSnow,
} from '../godot/terrain-authoring/geocells/sw/g17_rock_snow.mjs';

const first = measureG17RockSnow();
const second = measureG17RockSnow();

if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G17 Rock/Snow metrics are not deterministic');
if (first.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') throw new Error('owner-map SHA changed');
if (first.geoCell !== 'G17' || first.layer !== 'Rock/Snow') throw new Error('unexpected G17 Rock/Snow policy identity');
if (first.canonicalWaterCells !== 96 || first.canonicalLandCells !== 0) {
  throw new Error(`G17 must remain canonical open sea, got ${first.canonicalWaterCells} water / ${first.canonicalLandCells} land`);
}
if (first.sourceSamples !== 4225) throw new Error(`unexpected G17 Rock/Snow source sample count ${first.sourceSamples}`);
if (first.terrain3dRegionSize !== 256 || first.terrain3dImportSize !== 257) {
  throw new Error(`G17 Rock/Snow must preserve 257 import over region_size 256, got ${first.terrain3dImportSize}/${first.terrain3dRegionSize}`);
}
if (first.fractionalRockSamples !== first.sourceSamples) throw new Error('G17 seabed rock field collapsed to binary/clamped samples');
if (first.rockBlendSpan < 0.30) throw new Error(`G17 seabed rock field has insufficient variation: ${first.rockBlendSpan}`);
if (first.maxAdjacentRockStep > 0.05) throw new Error(`G17 adjacent rock blend step too large: ${first.maxAdjacentRockStep}`);
if (first.maxGuardBandRockDelta > 0.01) throw new Error(`G17 guard-band rock seam too large: ${first.maxGuardBandRockDelta}`);
if (first.maxSnowWeight !== 0) throw new Error(`G17 open sea invented snow: ${first.maxSnowWeight}`);
if (first.maxHeight >= -2.85) throw new Error(`G17 Rock/Snow source escaped qualified seabed ceiling: ${first.maxHeight}`);
if (first.minHeight < -9.5) throw new Error(`G17 Rock/Snow source escaped qualified deep seabed: ${first.minHeight}`);

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = emitArg.slice('--emit-probe='.length);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(buildG17RockSnowProbe())}\n`);
}

console.log(`SW_G17_ROCK_SNOW_METRICS=${JSON.stringify(first)}`);
console.log('SW_G17_ROCK_SNOW_VALIDATION_OK');
