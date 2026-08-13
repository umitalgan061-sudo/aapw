import fs from 'node:fs';
import path from 'node:path';
import { buildG17ReliefProbe, measureG17Relief, G17_RELIEF_POLICY } from '../godot/terrain-authoring/geocells/sw/g17_relief.mjs';

const first = measureG17Relief();
const second = measureG17Relief();
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('G17 relief is not deterministic');
if (first.canonicalWater !== 96 || first.canonicalLand !== 0) throw new Error('G17 hydrology regression');
if (!(first.maxHeight < G17_RELIEF_POLICY.waterCeilingMeters)) throw new Error('G17 relief crossed marine ceiling');
if (!(first.heightSpan > 0.45)) throw new Error('G17 relief is too flat');
if (!(first.maxAdjacentHeightDelta <= 0.12)) throw new Error('G17 local height step too large');
if (!(first.maxGuardBandHeightDelta <= 0.40)) throw new Error('G17 guard-band height discontinuity too large');
if (!(first.maxGuardBandNormalDelta <= 0.012)) throw new Error('G17 guard-band normal discontinuity too large');

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const outputPath = emitArg.slice('--emit-probe='.length);
  if (!outputPath) throw new Error('--emit-probe requires a path');
  const source = buildG17ReliefProbe(65);
  const probe = {
    ...source,
    worldWidthMeters: G17_RELIEF_POLICY.referenceWorldMeters.x,
    worldDepthMeters: G17_RELIEF_POLICY.referenceWorldMeters.z,
    canonicalWaterCells: first.canonicalWater,
    canonicalLandCells: first.canonicalLand,
    minHeight: first.minHeight,
    maxHeight: first.maxHeight,
    heightSpan: first.heightSpan,
    maxAdjacentHeightDelta: first.maxAdjacentHeightDelta,
    maxGuardBandHeightDelta: first.maxGuardBandHeightDelta,
    maxGuardBandNormalDelta: first.maxGuardBandNormalDelta,
    heightChecksum: first.heightChecksum,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(probe, null, 2)}\n`, 'utf8');
  console.log(`SW_G17_RELIEF_PROBE=${outputPath}`);
}

console.log('SW_G17_RELIEF_METRICS=' + JSON.stringify(first));
console.log('SW_G17_RELIEF_OK');
console.log('SW_G17_RELIEF_VALIDATION_OK');
