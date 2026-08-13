import fs from 'node:fs';
import path from 'node:path';
import {
  buildG65RockSnowProbe,
  measureG65RockSnow,
} from '../godot/terrain-authoring/geocells/se/g65_rock_snow.mjs';

const first = measureG65RockSnow();
const second = measureG65RockSnow();
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G65 Rock/Snow metrics are not deterministic');
if (first.canonicalWaterCells !== 0 || first.canonicalLandCells !== 96) {
  throw new Error(`G65 canonical hydrology drifted: ${first.canonicalWaterCells} water / ${first.canonicalLandCells} land`);
}
if (first.sourceSamples !== 4225) throw new Error(`unexpected source sample count ${first.sourceSamples}`);
if (first.terrain3dImportSize !== 257) throw new Error(`G65 Rock/Snow must preserve 257 guard-backed import, got ${first.terrain3dImportSize}`);
if (first.fractionalRockSamples < 512) throw new Error('G65 rock field collapsed to a binary/block surface');
if (first.rockBlendSpan < 0.005) throw new Error(`G65 rock field has insufficient physical variation: ${first.rockBlendSpan}`);
if (first.maxAdjacentRockStep > 0.20) throw new Error(`adjacent G65 rock blend step too large: ${first.maxAdjacentRockStep}`);
if (first.maxGuardBandRockDelta > 0.20) throw new Error(`G65 guard-band rock seam too large: ${first.maxGuardBandRockDelta}`);
if (first.maxCanonicalWaterSurfaceLeak > 0.000001) {
  throw new Error(`G65 rock/snow leaked onto canonical water centres: ${first.maxCanonicalWaterSurfaceLeak}`);
}
if (first.maxSnowWeight > 0.05) {
  throw new Error(`G65 southeast snow became physically implausible: ${first.maxSnowWeight}`);
}

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = emitArg.slice('--emit-probe='.length);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(buildG65RockSnowProbe())}\n`);
}

console.log(`SE_G65_ROCK_SNOW_METRICS=${JSON.stringify(first)}`);
console.log('SE_G65_ROCK_SNOW_VALIDATION_OK');
