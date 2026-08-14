import { G17_ROCK_SNOW_POLICY, sampleG17RockSnow } from './g17_rock_snow_field.mjs';

export function buildG17RockSnowControlProbe() {
  const bounds = G17_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G17_ROCK_SNOW_POLICY.terrain3dImportSize;
  const rows = [];
  let minBlendU8 = 255;
  let maxBlendU8 = 0;
  let maxQuantizationError = 0;
  let maxSnowWeight = 0;
  let checksum = 2166136261;
  const blendLevels = new Set();

  for (let z = 0; z < size; z += 1) {
    const normalizedY = bounds.yMin + (bounds.yMax - bounds.yMin) * (z / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const normalizedX = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const sample = sampleG17RockSnow(normalizedX, normalizedY);
      const blendU8 = Math.round(Math.max(0, Math.min(1, sample.rockBlend)) * 255);
      const decodedBlend = blendU8 / 255;
      minBlendU8 = Math.min(minBlendU8, blendU8);
      maxBlendU8 = Math.max(maxBlendU8, blendU8);
      maxQuantizationError = Math.max(maxQuantizationError, Math.abs(decodedBlend - sample.rockBlend));
      maxSnowWeight = Math.max(maxSnowWeight, sample.snowWeight);
      blendLevels.add(blendU8);
      checksum = Math.imul((checksum ^ blendU8) >>> 0, 16777619) >>> 0;
      checksum = Math.imul((checksum ^ Math.round((sample.height + 16) * 32)) >>> 0, 16777619) >>> 0;
      row.push([
        G17_ROCK_SNOW_POLICY.groundTextureId,
        G17_ROCK_SNOW_POLICY.rockTextureId,
        blendU8,
        Number(sample.height.toFixed(8)),
      ]);
    }
    rows.push(row);
  }

  return Object.freeze({
    schema: 'westeros-g17-rock-snow-terrain3d-control-probe-v1',
    policyId: G17_ROCK_SNOW_POLICY.id,
    sourceMapSha256: G17_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: G17_ROCK_SNOW_POLICY.geoCell,
    regionSize: G17_ROCK_SNOW_POLICY.terrain3dRegionSize,
    importSize: size,
    expectedMinimumRegions: 4,
    baseTextureId: G17_ROCK_SNOW_POLICY.groundTextureId,
    overlayTextureId: G17_ROCK_SNOW_POLICY.rockTextureId,
    samples: size * size,
    minBlendU8,
    maxBlendU8,
    distinctBlendLevels: blendLevels.size,
    maxQuantizationError: Number(maxQuantizationError.toFixed(10)),
    maxSnowWeight: Number(maxSnowWeight.toFixed(8)),
    checksum,
    channels: Object.freeze(['baseTextureId', 'overlayTextureId', 'blendU8', 'heightMeters']),
    rows,
  });
}
