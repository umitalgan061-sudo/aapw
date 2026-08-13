#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildG65ReliefProbe, G65_RELIEF_POLICY } from '../godot/terrain-authoring/geocells/se/g65_relief.mjs';

const first = buildG65ReliefProbe();
const second = buildG65ReliefProbe();
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G65 relief probe is not deterministic');
if (first.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') throw new Error('owner map SHA changed');
if (first.geoCell !== 'G65' || first.layer !== 'Relief/Height Character') throw new Error('unexpected G65 relief contract');
if (first.canonicalWaterCells !== 0 || first.canonicalLandCells !== 96) throw new Error(`G65 dry hydrology regression: ${first.canonicalWaterCells}/${first.canonicalLandCells}`);
if (first.canonicalSignMismatches !== 0) throw new Error(`relief moved canonical land semantics at ${first.canonicalSignMismatches} centres`);
if (!(first.minCanonicalLandHeight > 0)) throw new Error(`G65 canonical land dropped to/below sea level: ${first.minCanonicalLandHeight}`);
if (!(first.heightSpan > 0.05 && first.maxHeight > first.minHeight)) throw new Error(`G65 relief lacks physical height character: ${first.minHeight}..${first.maxHeight}`);
if (!(first.worldWidthMeters > 13000 && first.worldDepthMeters > 10000)) throw new Error(`G65 physical normal scale is not the canonical full-reference extent: ${first.worldWidthMeters}x${first.worldDepthMeters}`);
if (first.maxAdjacentHeightStep > 8) throw new Error(`G65 relief has excessive source-grid step: ${first.maxAdjacentHeightStep}`);
if (first.maxGuardHeightDelta > 8) throw new Error(`G65 guard-band height discontinuity too high: ${first.maxGuardHeightDelta}`);
if (first.maxGuardNormalDelta > 0.8) throw new Error(`G65 guard-band normal discontinuity too high: ${first.maxGuardNormalDelta}`);
if (first.rows.length !== G65_RELIEF_POLICY.sourceGridSize || first.rows.some((row) => row.length !== G65_RELIEF_POLICY.sourceGridSize)) throw new Error('unexpected G65 relief probe dimensions');
if (first.terrain3dRegionSize !== 256 || first.terrain3dImportSize !== 257) throw new Error('G65 Terrain3D relief proof must use 257 import over region_size 256');

const metrics = Object.freeze({
  policyId: first.policyId,
  sourceMapSha256: first.sourceMapSha256,
  geoCell: first.geoCell,
  layer: first.layer,
  canonicalWaterCells: first.canonicalWaterCells,
  canonicalLandCells: first.canonicalLandCells,
  canonicalSignMismatches: first.canonicalSignMismatches,
  minCanonicalLandHeight: first.minCanonicalLandHeight,
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
}
console.log(`SE_G65_RELIEF_METRICS=${JSON.stringify(metrics)}`);
console.log('SE_G65_RELIEF_VALIDATION_OK');
