import fs from 'node:fs';
import path from 'node:path';
import {
  buildG01RockSnowProbe,
  measureG01RockSnow,
} from '../godot/terrain-authoring/geocells/nw/g01_rock_snow.mjs';

const first = measureG01RockSnow();
const second = measureG01RockSnow();
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G01 rock/snow metrics must be deterministic');

const fingerprint = first.hydrologyFingerprint;
if (fingerprint.waterCells !== 88 || fingerprint.landCells !== 8 || fingerprint.centreMismatches !== 0) {
  throw new Error(`G01 relief/hydrology fingerprint drifted: ${JSON.stringify(fingerprint)}`);
}
if (first.sourceSamples !== 4225) throw new Error(`unexpected G01 material sample count ${first.sourceSamples}`);
if (first.landWeightedSamples < 32) throw new Error(`G01 lacks enough land-weighted material samples: ${first.landWeightedSamples}`);
if (first.fractionalBlendSamples < 32) throw new Error(`G01 physical rock/snow field is not meaningfully blended: ${first.fractionalBlendSamples}`);
if (first.meaningfulRockSamples < 32 || first.meaningfulSnowSamples < 32) {
  throw new Error(`G01 material field lost a physical constituent: rock=${first.meaningfulRockSamples} snow=${first.meaningfulSnowSamples}`);
}
if (!(first.maxRockWeight > 0.02 && first.maxSnowWeight > 0.02)) {
  throw new Error(`G01 material field lacks non-trivial rock/snow mass: ${first.maxRockWeight}/${first.maxSnowWeight}`);
}
if (!(first.minLandSnowBlend >= 0.05 && first.maxLandSnowBlend <= 0.95)) {
  throw new Error(`G01 land blend escaped physical retention range: ${first.minLandSnowBlend}..${first.maxLandSnowBlend}`);
}
if (first.maxAdjacentSurfaceWeightStep > 0.24) throw new Error(`adjacent G01 snow-weight step too large: ${first.maxAdjacentSurfaceWeightStep}`);
if (first.maxGuardBandSurfaceWeightDelta > 0.24) throw new Error(`G01 guard-band snow-weight seam too large: ${first.maxGuardBandSurfaceWeightDelta}`);
if (first.maxWaterSnowLeak > 0.000001) throw new Error(`snow leaked onto canonical G01 water centres: ${first.maxWaterSnowLeak}`);
if (first.maxMaterialMassError > 0.0000001) throw new Error(`G01 rock/snow material mass does not conserve land factor: ${first.maxMaterialMassError}`);
for (const [name, value] of Object.entries({
  rockWeight: first.maxG00SharedSeamRockWeightDelta,
  snowWeight: first.maxG00SharedSeamSnowWeightDelta,
  snowBlend: first.maxG00SharedSeamSnowBlendDelta,
  landFactor: first.maxG00SharedSeamLandFactorDelta,
})) {
  if (value > 0.000001) throw new Error(`G00/G01 shared ${name} seam drift: ${value}`);
}

const probeA = buildG01RockSnowProbe();
const probeB = buildG01RockSnowProbe();
if (JSON.stringify(probeA) !== JSON.stringify(probeB)) throw new Error('G01 rock/snow probe must be deterministic');
if (probeA.maxG00SharedSeamRockWeightDelta > 0.000001 || probeA.maxG00SharedSeamSnowWeightDelta > 0.000001) {
  throw new Error('G01 exported probe lost G00 shared material seam parity');
}

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = path.resolve(emitArg.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(probeA)}\n`, 'utf8');
  console.log(`NW_G01_ROCK_SNOW_PROBE=${output}`);
}
console.log(`NW_G01_ROCK_SNOW_METRICS=${JSON.stringify(first)}`);
console.log('NW_G01_ROCK_SNOW_VALIDATION_OK');
