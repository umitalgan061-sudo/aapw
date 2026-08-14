import { G17_ROCK_SNOW_POLICY, sampleG17RockSnow } from './g17_rock_snow_field.mjs';

export function buildG17RockSnowProbe() {
  const b = G17_ROCK_SNOW_POLICY.normalizedBounds;
  const n = G17_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < n; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (n - 1), row = [];
    for (let x = 0; x < n; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (n - 1);
      const s = sampleG17RockSnow(nx, ny);
      row.push([
        +s.groundWeight.toFixed(8), +s.rockWeight.toFixed(8), +s.snowWeight.toFixed(8),
        +s.rockBlend.toFixed(8), +s.height.toFixed(8), +s.shelf.toFixed(8),
        +s.waterConfidence.toFixed(8), +s.slope.toFixed(10),
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    policyId: G17_ROCK_SNOW_POLICY.id,
    sourceMapSha256: G17_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G17',
    layer: G17_ROCK_SNOW_POLICY.layer,
    sourceGridSize: n,
    terrain3dRegionSize: G17_ROCK_SNOW_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G17_ROCK_SNOW_POLICY.terrain3dImportSize,
    groundTextureId: G17_ROCK_SNOW_POLICY.groundTextureId,
    rockTextureId: G17_ROCK_SNOW_POLICY.rockTextureId,
    rows,
  });
}
