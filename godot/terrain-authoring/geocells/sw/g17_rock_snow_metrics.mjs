import { sampleReferenceWaterMask } from '../../../../src/3d/world/worldReferenceWaterMask.js';
import { G17_ROCK_SNOW_POLICY, sampleG17RockSnow } from './g17_rock_snow_field.mjs';

const fnv = (sum, value) => Math.imul((sum ^ (value & 255)) >>> 0, 16777619) >>> 0;

export function measureG17RockSnow() {
  const b = G17_ROCK_SNOW_POLICY.normalizedBounds;
  const n = G17_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  let water = 0, land = 0, minRock = Infinity, maxRock = -Infinity;
  let snow = 0, fractional = 0, adjacent = 0, guardDelta = 0;
  let minHeight = Infinity, maxHeight = -Infinity, checksum = 2166136261;
  for (let cy = 0; cy < 8; cy += 1) for (let cx = 0; cx < 12; cx += 1) {
    const nx = (12 + cx + 0.5) / 96, ny = (56 + cy + 0.5) / 64;
    if (sampleReferenceWaterMask(nx, ny)) water += 1; else land += 1;
  }
  for (let y = 0; y < n; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (n - 1), row = [];
    for (let x = 0; x < n; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (n - 1);
      const s = sampleG17RockSnow(nx, ny);
      minRock = Math.min(minRock, s.rockBlend); maxRock = Math.max(maxRock, s.rockBlend);
      snow = Math.max(snow, s.snowWeight); minHeight = Math.min(minHeight, s.height);
      maxHeight = Math.max(maxHeight, s.height);
      if (s.rockBlend > 0.001 && s.rockBlend < 0.999) fractional += 1;
      checksum = fnv(checksum, Math.round(s.rockBlend * 255));
      checksum = fnv(checksum, Math.round((s.height + 16) * 32));
      row.push(s);
    }
    rows.push(row);
  }
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
    const r = rows[y][x].rockBlend;
    if (x + 1 < n) adjacent = Math.max(adjacent, Math.abs(r - rows[y][x + 1].rockBlend));
    if (y + 1 < n) adjacent = Math.max(adjacent, Math.abs(r - rows[y + 1][x].rockBlend));
  }
  const g = G17_ROCK_SNOW_POLICY.guardBandNormalized;
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1), x = b.xMin + (b.xMax - b.xMin) * t, y = b.yMin + (b.yMax - b.yMin) * t;
    for (const [ax, ay, bx, by] of [[x,b.yMin,x,b.yMin-g],[x,b.yMax,x,b.yMax+g],[b.xMin,y,b.xMin-g,y],[b.xMax,y,b.xMax+g,y]]) {
      guardDelta = Math.max(guardDelta, Math.abs(sampleG17RockSnow(ax, ay).rockBlend - sampleG17RockSnow(bx, by).rockBlend));
    }
  }
  return Object.freeze({
    policyId: G17_ROCK_SNOW_POLICY.id, sourceMapSha256: G17_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G17', layer: G17_ROCK_SNOW_POLICY.layer, sourceGridSize: n, sourceSamples: n * n,
    terrain3dRegionSize: 256, terrain3dImportSize: 257, canonicalWaterCells: water, canonicalLandCells: land,
    fractionalRockSamples: fractional, minRockBlend: +minRock.toFixed(8), maxRockBlend: +maxRock.toFixed(8),
    rockBlendSpan: +(maxRock-minRock).toFixed(8), maxSnowWeight: +snow.toFixed(8),
    maxAdjacentRockStep: +adjacent.toFixed(8), maxGuardBandRockDelta: +guardDelta.toFixed(8),
    minHeight: +minHeight.toFixed(8), maxHeight: +maxHeight.toFixed(8), surfaceChecksum: checksum,
  });
}
