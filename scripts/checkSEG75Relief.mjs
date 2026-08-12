import fs from 'node:fs';
import path from 'node:path';
import { buildG75ReliefProbe, G75_RELIEF_POLICY } from '../godot/terrain-authoring/geocells/se/g75_relief.mjs';

const probe = buildG75ReliefProbe();
if (probe.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') throw new Error('owner map SHA changed');
if (probe.geoCell !== 'G75' || probe.layer !== 'Relief/Height Character') throw new Error('unexpected SE relief contract');
if (probe.canonicalWaterCells !== 0 || probe.canonicalLandCells !== 96) throw new Error(`G75 dry hydrology regression: ${probe.canonicalWaterCells}/${probe.canonicalLandCells}`);
if (probe.canonicalSignMismatches !== 0) throw new Error(`relief moved canonical land semantics at ${probe.canonicalSignMismatches} centres`);
if (!(probe.minHeight > 0 && probe.heightSpan > 0.05)) throw new Error(`G75 relief lacks physical dry-land character: ${probe.minHeight}..${probe.maxHeight}`);
if (probe.maxAdjacentHeightStep > 8) throw new Error(`G75 relief has excessive source-grid step: ${probe.maxAdjacentHeightStep}`);
if (probe.maxGuardHeightDelta > 8) throw new Error(`G75 guard-band height discontinuity too high: ${probe.maxGuardHeightDelta}`);
if (probe.maxGuardNormalDelta > 0.8) throw new Error(`G75 guard-band normal discontinuity too high: ${probe.maxGuardNormalDelta}`);
if (probe.rows.length !== G75_RELIEF_POLICY.sourceGridSize || probe.rows.some((row) => row.length !== G75_RELIEF_POLICY.sourceGridSize)) throw new Error('unexpected G75 relief probe dimensions');
const metrics = Object.freeze({
  policyId: probe.policyId,
  sourceMapSha256: probe.sourceMapSha256,
  geoCell: probe.geoCell,
  layer: probe.layer,
  canonicalWaterCells: probe.canonicalWaterCells,
  canonicalLandCells: probe.canonicalLandCells,
  canonicalSignMismatches: probe.canonicalSignMismatches,
  minHeight: probe.minHeight,
  maxHeight: probe.maxHeight,
  heightSpan: probe.heightSpan,
  maxAdjacentHeightStep: probe.maxAdjacentHeightStep,
  maxGuardHeightDelta: probe.maxGuardHeightDelta,
  maxGuardNormalDelta: probe.maxGuardNormalDelta,
  reliefChecksum: probe.reliefChecksum,
});
const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = path.resolve(emitArg.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(probe)}\n`, 'utf8');
}
console.log(`SE_G75_RELIEF_METRICS=${JSON.stringify(metrics)}`);
console.log('SE_G75_RELIEF_VALIDATION_OK');
