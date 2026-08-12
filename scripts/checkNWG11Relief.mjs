import fs from 'node:fs';
import path from 'node:path';
import { buildG11ReliefProbe, G11_RELIEF_POLICY } from '../godot/terrain-authoring/geocells/nw/g11_relief.mjs';

const probe = buildG11ReliefProbe();
const hydrology = probe.hydrology;

if (probe.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') {
  throw new Error('owner map SHA changed');
}
if (probe.geoCell !== 'G11' || probe.layer !== 'Relief/Height Character') {
  throw new Error('unexpected NW relief contract');
}
if (hydrology.baseCells !== 96 || hydrology.waterCells !== 38 || hydrology.landCells !== 58 || hydrology.boundaryEdges !== 39) {
  throw new Error(`G11 Coast/Hydrology regression: ${JSON.stringify(hydrology)}`);
}
if (hydrology.centreMismatches !== 0 || hydrology.maxAdjacentStep > 0.25000001) {
  throw new Error('accepted G11 hydrology continuity regressed');
}
if (probe.canonicalSignMismatches !== 0) {
  throw new Error(`relief moved canonical land/water semantics at ${probe.canonicalSignMismatches} centres`);
}
if (!(probe.minHeight < -2 && probe.maxHeight > 8 && probe.heightSpan > 12)) {
  throw new Error(`G11 relief lacks physical height character: ${probe.minHeight}..${probe.maxHeight}`);
}
if (probe.maxAdjacentHeightStep > 8) {
  throw new Error(`G11 relief has an excessive source-grid step: ${probe.maxAdjacentHeightStep}`);
}
if (probe.maxGuardHeightDelta > 8) {
  throw new Error(`G11 guard-band height discontinuity too high: ${probe.maxGuardHeightDelta}`);
}
if (probe.maxGuardNormalDelta > 0.8) {
  throw new Error(`G11 guard-band normal discontinuity too high: ${probe.maxGuardNormalDelta}`);
}
if (probe.rows.length !== G11_RELIEF_POLICY.sourceGridSize || probe.rows.some((row) => row.length !== G11_RELIEF_POLICY.sourceGridSize)) {
  throw new Error('unexpected G11 relief probe dimensions');
}

const metrics = Object.freeze({
  policyId: probe.policyId,
  sourceMapSha256: probe.sourceMapSha256,
  geoCell: probe.geoCell,
  layer: probe.layer,
  canonicalWaterCells: hydrology.waterCells,
  canonicalLandCells: hydrology.landCells,
  canonicalBoundaryEdges: hydrology.boundaryEdges,
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

console.log(`NW_G11_RELIEF_METRICS=${JSON.stringify(metrics)}`);
console.log('NW_G11_RELIEF_VALIDATION_OK');
