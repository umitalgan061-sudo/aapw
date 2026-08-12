import fs from 'node:fs';
import path from 'node:path';
import { buildG07ReliefProbe, measureG07Relief, G07_RELIEF_POLICY } from '../godot/terrain-authoring/geocells/sw/g07_relief.mjs';

const EXPECTED_CHECKSUM = 2836825146;
const metrics = measureG07Relief();

if (metrics.canonicalWater !== 96 || metrics.canonicalLand !== 0) throw new Error(`G07 hydrology regression: ${metrics.canonicalWater} water / ${metrics.canonicalLand} land`);
if (metrics.heightChecksum !== EXPECTED_CHECKSUM) throw new Error(`G07 relief checksum drift: ${metrics.heightChecksum}`);
if (!(metrics.heightSpan > 0.5 && metrics.heightSpan < 3.0)) throw new Error(`G07 relief span is not a bounded real improvement: ${metrics.heightSpan}`);
if (metrics.maxHeight >= G07_RELIEF_POLICY.waterCeilingMeters) throw new Error(`G07 relief rose above marine safety ceiling: ${metrics.maxHeight}`);
if (metrics.maxAdjacentHeightDelta > 0.08) throw new Error(`G07 relief local step too large: ${metrics.maxAdjacentHeightDelta}`);
if (metrics.maxGuardBandHeightDelta > 0.15) throw new Error(`G07 relief guard-band height discontinuity: ${metrics.maxGuardBandHeightDelta}`);
if (metrics.maxGuardBandNormalDelta > 0.005) throw new Error(`G07 relief guard-band normal discontinuity: ${metrics.maxGuardBandNormalDelta}`);

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = emitArg.slice('--emit-probe='.length);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(buildG07ReliefProbe(), null, 2)}\n`);
}

console.log(`G07_RELIEF_METRICS=${JSON.stringify(metrics)}`);
console.log('SW_G07_RELIEF_VALIDATION_OK');
