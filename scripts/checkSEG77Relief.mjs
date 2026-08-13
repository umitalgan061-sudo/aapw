import fs from 'node:fs';
import path from 'node:path';
import { buildG77ReliefProbe, G77_RELIEF_POLICY } from '../godot/terrain-authoring/geocells/se/g77_relief.mjs';

const probe = buildG77ReliefProbe();
if (probe.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') throw new Error('owner map SHA changed');
if (probe.geoCell !== 'G77' || probe.layer !== 'Relief/Height Character') throw new Error('unexpected G77 relief contract');
if (probe.canonicalWater !== 44 || probe.canonicalLand !== 52) throw new Error(`G77 hydrology regression: ${probe.canonicalWater}/${probe.canonicalLand}`);
if (probe.canonicalSignMismatches !== 0) throw new Error(`relief moved canonical coastline semantics at ${probe.canonicalSignMismatches} centres`);
if (!(probe.minHeight < -1 && probe.maxHeight > 0.25 && probe.heightSpan > 2)) throw new Error(`G77 relief lacks mixed coast character: ${probe.minHeight}..${probe.maxHeight}`);
if (!(probe.worldWidthMeters > 13000 && probe.worldDepthMeters > 10000)) throw new Error(`physical normal scale is not canonical full-reference extent: ${probe.worldWidthMeters}x${probe.worldDepthMeters}`);
if (probe.maxAdjacentHeightStep > 8) throw new Error(`G77 relief source-grid step too high: ${probe.maxAdjacentHeightStep}`);
if (probe.maxGuardHeightDelta > 2) throw new Error(`G77 guard-band height discontinuity too high: ${probe.maxGuardHeightDelta}`);
if (probe.maxGuardNormalDelta > 0.25) throw new Error(`G77 guard-band normal discontinuity too high: ${probe.maxGuardNormalDelta}`);
if (probe.maxBiomeHeightDrift > 1e-8) throw new Error(`G77 relief input mutated merged biome/hydrology height: ${probe.maxBiomeHeightDrift}`);
if (probe.rows.length !== G77_RELIEF_POLICY.sourceGridSize || probe.rows.some((row) => row.length !== G77_RELIEF_POLICY.sourceGridSize)) throw new Error('unexpected G77 relief probe dimensions');

const metrics = Object.freeze({
  policyId: probe.policyId, sourceMapSha256: probe.sourceMapSha256, geoCell: probe.geoCell, layer: probe.layer,
  canonicalWater: probe.canonicalWater, canonicalLand: probe.canonicalLand, canonicalSignMismatches: probe.canonicalSignMismatches,
  worldWidthMeters: probe.worldWidthMeters, worldDepthMeters: probe.worldDepthMeters,
  minHeight: probe.minHeight, maxHeight: probe.maxHeight, heightSpan: probe.heightSpan,
  maxAdjacentHeightStep: probe.maxAdjacentHeightStep, maxGuardHeightDelta: probe.maxGuardHeightDelta,
  maxGuardNormalDelta: probe.maxGuardNormalDelta, maxBiomeHeightDrift: probe.maxBiomeHeightDrift,
  reliefChecksum: probe.reliefChecksum,
});
const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = path.resolve(emitArg.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(probe)}\n`, 'utf8');
}
console.log(`SE_G77_RELIEF_METRICS=${JSON.stringify(metrics)}`);
console.log('SE_G77_RELIEF_VALIDATION_OK');
