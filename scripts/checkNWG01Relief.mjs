import fs from 'node:fs';
import path from 'node:path';
import {
  buildG01ReliefProbe,
  G01_RELIEF_POLICY,
} from '../godot/terrain-authoring/geocells/nw/g01_relief.mjs';

const first = buildG01ReliefProbe();
const second = buildG01ReliefProbe();

if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G01 relief probe must be deterministic');
if (first.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') throw new Error('owner map SHA changed');
if (first.geoCell !== 'G01' || first.layer !== 'Relief/Height Character') throw new Error('unexpected NW G01 relief contract');
if (first.canonicalWaterCells !== 88 || first.canonicalLandCells !== 8) throw new Error(`G01 hydrology regression: ${first.canonicalWaterCells}/${first.canonicalLandCells}`);
if (first.canonicalSignMismatches !== 0) throw new Error(`relief moved canonical G01 water/land semantics at ${first.canonicalSignMismatches} centres`);
if (!(first.minHeight < 0 && first.maxHeight > 3 && first.heightSpan > 5)) throw new Error(`G01 relief lacks physical coast/land character: ${first.minHeight}..${first.maxHeight}`);
if (!(first.worldWidthMeters > 13000 && first.worldDepthMeters > 10000)) throw new Error(`G01 physical normal scale is not the canonical full-reference extent: ${first.worldWidthMeters}x${first.worldDepthMeters}`);
if (first.maxAdjacentHeightStep > 12) throw new Error(`G01 relief has excessive source-grid step: ${first.maxAdjacentHeightStep}`);
if (first.maxGuardHeightDelta > 8) throw new Error(`G01 guard-band height discontinuity too high: ${first.maxGuardHeightDelta}`);
if (first.maxGuardNormalDelta > 0.8) throw new Error(`G01 guard-band normal discontinuity too high: ${first.maxGuardNormalDelta}`);
if (first.maxG00SharedSeamHeightDelta > 0.000001) throw new Error(`G00/G01 shared height seam drift: ${first.maxG00SharedSeamHeightDelta}`);
if (first.maxG00SharedSeamNormalDelta > 0.000001) throw new Error(`G00/G01 shared normal seam drift: ${first.maxG00SharedSeamNormalDelta}`);
if (first.rows.length !== G01_RELIEF_POLICY.sourceGridSize || first.rows.some((row) => row.length !== G01_RELIEF_POLICY.sourceGridSize)) throw new Error('unexpected G01 relief probe dimensions');

const metrics = Object.freeze({
  policyId: first.policyId,
  sourceMapSha256: first.sourceMapSha256,
  geoCell: first.geoCell,
  layer: first.layer,
  canonicalWaterCells: first.canonicalWaterCells,
  canonicalLandCells: first.canonicalLandCells,
  canonicalSignMismatches: first.canonicalSignMismatches,
  worldWidthMeters: first.worldWidthMeters,
  worldDepthMeters: first.worldDepthMeters,
  minHeight: first.minHeight,
  maxHeight: first.maxHeight,
  heightSpan: first.heightSpan,
  maxAdjacentHeightStep: first.maxAdjacentHeightStep,
  maxGuardHeightDelta: first.maxGuardHeightDelta,
  maxGuardNormalDelta: first.maxGuardNormalDelta,
  maxG00SharedSeamHeightDelta: first.maxG00SharedSeamHeightDelta,
  maxG00SharedSeamNormalDelta: first.maxG00SharedSeamNormalDelta,
  reliefChecksum: first.reliefChecksum,
});

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = path.resolve(emitArg.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(first)}\n`, 'utf8');
  console.log(`NW_G01_RELIEF_PROBE=${output}`);
}

console.log(`NW_G01_RELIEF_METRICS=${JSON.stringify(metrics)}`);
console.log('NW_G01_RELIEF_VALIDATION_OK');
