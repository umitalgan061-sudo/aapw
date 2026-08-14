import { buildG17RockSnowControlProbe } from '../godot/terrain-authoring/geocells/sw/g17_rock_snow_control_probe.mjs';

const first = buildG17RockSnowControlProbe();
const second = buildG17RockSnowControlProbe();
if (first.schema !== 'westeros-g17-rock-snow-terrain3d-control-probe-v1') throw new Error('G17 control probe schema drifted');
if (first.policyId !== 'gunbatimi-ustasi-g17-terrain3d-rock-snow-2026-08-13-v1') throw new Error('G17 control probe policy drifted');
if (first.sourceMapSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') throw new Error('G17 control probe owner-map SHA drifted');
if (first.regionSize !== 256 || first.importSize !== 257 || first.expectedMinimumRegions !== 4) throw new Error('G17 control probe Terrain3D geometry drifted');
if (first.samples !== 66049) throw new Error(`G17 control probe sample count drifted: ${first.samples}`);
if (first.baseTextureId !== 0 || first.overlayTextureId !== 1) throw new Error('G17 control probe texture intent drifted');
if (first.maxSnowWeight !== 0) throw new Error(`G17 control probe invented snow: ${first.maxSnowWeight}`);
if (first.distinctBlendLevels < 64) throw new Error(`G17 control probe quantization collapsed: ${first.distinctBlendLevels}`);
if (first.maxBlendU8 - first.minBlendU8 < 76) throw new Error('G17 control probe blend span collapsed');
if (first.maxQuantizationError > 1 / 510 + 1e-10) throw new Error(`G17 control probe quantization error too large: ${first.maxQuantizationError}`);
if (first.checksum !== second.checksum) throw new Error('G17 control probe checksum is not deterministic');
if (JSON.stringify(first.channels) !== JSON.stringify(['baseTextureId', 'overlayTextureId', 'blendU8', 'heightMeters'])) throw new Error('G17 control probe channel contract drifted');
if (!Array.isArray(first.rows) || first.rows.length !== 257) throw new Error('G17 control probe row count drifted');

let visited = 0;
let minHeight = Infinity;
let maxHeight = -Infinity;
let malformed = 0;
for (const row of first.rows) {
  if (!Array.isArray(row) || row.length !== 257) throw new Error('G17 control probe row width drifted');
  for (const sample of row) {
    if (!Array.isArray(sample) || sample.length !== 4) { malformed += 1; continue; }
    const [base, overlay, blendU8, height] = sample;
    if (base !== 0 || overlay !== 1) throw new Error('G17 control probe per-sample texture IDs drifted');
    if (!Number.isInteger(blendU8) || blendU8 < 0 || blendU8 > 255) throw new Error('G17 control probe blend byte is invalid');
    if (!Number.isFinite(height)) throw new Error('G17 control probe height is non-finite');
    minHeight = Math.min(minHeight, height);
    maxHeight = Math.max(maxHeight, height);
    visited += 1;
  }
}
if (malformed !== 0 || visited !== 66049) throw new Error(`G17 control probe shape malformed: ${malformed}/${visited}`);
if (maxHeight >= -2.85 || minHeight < -9.5) throw new Error(`G17 control probe escaped marine relief: ${minHeight}/${maxHeight}`);

const metrics = {
  samples: first.samples,
  expectedMinimumRegions: first.expectedMinimumRegions,
  minBlendU8: first.minBlendU8,
  maxBlendU8: first.maxBlendU8,
  distinctBlendLevels: first.distinctBlendLevels,
  maxQuantizationError: first.maxQuantizationError,
  minHeight,
  maxHeight,
  checksum: first.checksum,
};
console.log(`SW_G17_ROCK_SNOW_CONTROL_PROBE=${JSON.stringify(metrics)}`);
console.log('SW_G17_ROCK_SNOW_CONTROL_PROBE_OK');
