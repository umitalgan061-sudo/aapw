import fs from 'node:fs';
import path from 'node:path';
import {
  buildG00ReliefProbe,
  G00_RELIEF_POLICY,
} from '../godot/terrain-authoring/geocells/nw/g00_relief.mjs';

const first = buildG00ReliefProbe();
const second = buildG00ReliefProbe();

if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G00 relief probe must be deterministic');
if (first.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') throw new Error('owner map SHA changed');
if (first.geoCell !== 'G00' || first.layer !== 'Relief/Height Character') throw new Error('unexpected NW relief contract');
if (first.canonicalWaterCells !== 60 || first.canonicalLandCells !== 36) throw new Error(`G00 hydrology regression: ${first.canonicalWaterCells}/${first.canonicalLandCells}`);
if (first.canonicalSignMismatches !== 0) throw new Error(`relief moved canonical water/land semantics at ${first.canonicalSignMismatches} centres`);
if (!(first.minHeight < 0 && first.maxHeight > 3 && first.heightSpan > 5)) throw new Error(`G00 relief lacks physical coast/land character: ${first.minHeight}..${first.maxHeight}`);
if (!(first.worldWidthMeters > 13000 && first.worldDepthMeters > 10000)) throw new Error(`G00 physical normal scale is not the canonical full-reference extent: ${first.worldWidthMeters}x${first.worldDepthMeters}`);
if (first.maxAdjacentHeightStep > 12) throw new Error(`G00 relief has excessive source-grid step: ${first.maxAdjacentHeightStep}`);
if (first.maxGuardHeightDelta > 8) throw new Error(`G00 guard-band height discontinuity too high: ${first.maxGuardHeightDelta}`);
if (first.maxGuardNormalDelta > 0.8) throw new Error(`G00 guard-band normal discontinuity too high: ${first.maxGuardNormalDelta}`);
if (first.rows.length !== G00_RELIEF_POLICY.sourceGridSize || first.rows.some((row) => row.length !== G00_RELIEF_POLICY.sourceGridSize)) throw new Error('unexpected G00 relief probe dimensions');

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
  reliefChecksum: first.reliefChecksum,
});

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = path.resolve(emitArg.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(first)}\n`, 'utf8');
  console.log(`NW_G00_RELIEF_PROBE=${output}`);
}

console.log(`NW_G00_RELIEF_METRICS=${JSON.stringify(metrics)}`);
console.log('NW_G00_RELIEF_VALIDATION_OK');
