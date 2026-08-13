import fs from 'node:fs';
import path from 'node:path';
import { buildG00RockSnowProbe, measureG00RockSnow } from '../godot/terrain-authoring/geocells/nw/g00_rock_snow.mjs';

const first = measureG00RockSnow();
const second = measureG00RockSnow();
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G00 rock/snow metrics must be deterministic');

const fingerprint = first.hydrologyFingerprint;
if (fingerprint.waterCells !== 60 || fingerprint.landCells !== 36 || fingerprint.centreMismatches !== 0) throw new Error(`G00 relief/hydrology fingerprint drifted: ${JSON.stringify(fingerprint)}`);
if (first.sourceSamples !== 4225) throw new Error(`unexpected G00 material sample count ${first.sourceSamples}`);
if (first.fractionalBlendSamples < 128) throw new Error(`G00 physical rock/snow field is not meaningfully blended: ${first.fractionalBlendSamples}`);
if (first.snowDominantLandSamples < 32) throw new Error(`G00 lacks snow-dominant land character: ${first.snowDominantLandSamples}`);
if (first.rockDominantLandSamples < 32) throw new Error(`G00 lacks exposed-rock land character: ${first.rockDominantLandSamples}`);
if (first.maxAdjacentSurfaceWeightStep > 0.24) throw new Error(`adjacent physical snow-weight step too large: ${first.maxAdjacentSurfaceWeightStep}`);
if (first.maxGuardBandSurfaceWeightDelta > 0.24) throw new Error(`G00 guard-band physical snow-weight seam too large: ${first.maxGuardBandSurfaceWeightDelta}`);
if (first.maxWaterSnowLeak > 0.000001) throw new Error(`snow leaked onto canonical water centres: ${first.maxWaterSnowLeak}`);
if (first.maxMaterialMassError > 0.0000001) throw new Error(`rock/snow material mass does not conserve land factor: ${first.maxMaterialMassError}`);

const probeA = buildG00RockSnowProbe();
const probeB = buildG00RockSnowProbe();
if (JSON.stringify(probeA) !== JSON.stringify(probeB)) throw new Error('G00 rock/snow probe must be deterministic');

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = path.resolve(emitArg.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(probeA)}\n`, 'utf8');
  console.log(`NW_G00_ROCK_SNOW_PROBE=${output}`);
}
console.log(`NW_G00_ROCK_SNOW_METRICS=${JSON.stringify(first)}`);
console.log('NW_G00_ROCK_SNOW_VALIDATION_OK');
