/** Kızıl Ufuk / SE G77 Macro Albedo/Biome; bounds are addressing only. */
import { sampleG65BiomeColor } from './g65_biome.mjs';
import { sampleG77WaterConfidence, sampleG77HydrologyHeight } from './g77_hydrology.mjs';

export const G77_BIOME_POLICY = Object.freeze({
  id: 'kizil-ufuk-g77-terrain3d-biome-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G77', gx: 7, gy: 7, layer: 'Macro Albedo/Biome',
  pixelBounds: Object.freeze({ xMin: 1344, xMax: 1536, yMin: 896, yMax: 1024 }),
  normalizedBounds: Object.freeze({ xMin: 0.875, xMax: 1, yMin: 0.875, yMax: 1 }),
  sourceGridSize: 65, terrain3dRegionSize: 256, terrain3dImportSize: 257,
  guardBandNormalized: 1 / 96, seamProbeNormalized: 1e-6,
});

const BEACH = Object.freeze([0.52, 0.44, 0.30]);
const SEABED = Object.freeze([0.18, 0.27, 0.30]);
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => { const t = clamp01((value - a) / (b - a)); return t * t * (3 - 2 * t); };
const colorDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function sampleG77BiomeSurface(normalizedX, normalizedY) {
  const x = clamp01(normalizedX), y = clamp01(normalizedY);
  const water = sampleG77WaterConfidence(x, y);
  const land = sampleG65BiomeColor(x, y);
  const shore = 4 * water * (1 - water);
  const waterBlend = smoothstep(0.20, 0.80, water);
  const coastal = land.color.map((v, i) => lerp(v, BEACH[i], 0.30 * shore));
  const color = coastal.map((v, i) => lerp(v, SEABED[i], waterBlend));
  const dryRoughness = lerp(0.86, 0.92, 0.35 * shore);
  return Object.freeze({
    water,
    height: sampleG77HydrologyHeight(x, y),
    color: Object.freeze(color),
    roughness: lerp(dryRoughness, 0.72, waterBlend),
    dominantId: water >= 0.5 ? 'water' : land.dominantId,
  });
}

export function measureG77Biome() {
  const b = G77_BIOME_POLICY.normalizedBounds, rows = [], dominantCounts = {};
  let canonicalWater = 0, canonicalLand = 0, checksum = 2166136261;
  let maxAdjacentColorDelta = 0, maxAdjacentRoughnessDelta = 0, maxGuardBandColorDelta = 0, maxBoundaryEpsilonDelta = 0;
  for (let cy = 0; cy < 8; cy += 1) for (let cx = 0; cx < 12; cx += 1) {
    if (sampleG77WaterConfidence((84 + cx + 0.5) / 96, (56 + cy + 0.5) / 64) >= 0.5) canonicalWater += 1; else canonicalLand += 1;
  }
  for (let y = 0; y <= 64; y += 1) {
    const row = [];
    for (let x = 0; x <= 64; x += 1) {
      const sample = sampleG77BiomeSurface(lerp(b.xMin, b.xMax, x / 64), lerp(b.yMin, b.yMax, y / 64));
      dominantCounts[sample.dominantId] = (dominantCounts[sample.dominantId] ?? 0) + 1;
      for (const v of [...sample.color, sample.roughness]) { checksum ^= Math.round(clamp01(v) * 255); checksum = Math.imul(checksum, 16777619) >>> 0; }
      row.push(sample);
    }
    rows.push(row);
  }
  for (let y = 0; y < 65; y += 1) for (let x = 0; x < 65; x += 1) for (const [dx, dy] of [[1, 0], [0, 1]]) {
    if (x + dx >= 65 || y + dy >= 65) continue;
    const a = rows[y][x], c = rows[y + dy][x + dx];
    maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(a.color, c.color));
    maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(a.roughness - c.roughness));
  }
  const guard = G77_BIOME_POLICY.guardBandNormalized, eps = G77_BIOME_POLICY.seamProbeNormalized;
  for (let i = 0; i <= 64; i += 1) {
    const t = i / 64, x = lerp(b.xMin, b.xMax, t), y = lerp(b.yMin, b.yMax, t);
    for (const [p, q] of [[[b.xMin - guard, y], [b.xMin, y]], [[x, b.yMin - guard], [x, b.yMin]]]) maxGuardBandColorDelta = Math.max(maxGuardBandColorDelta, colorDistance(sampleG77BiomeSurface(...p).color, sampleG77BiomeSurface(...q).color));
    for (const [p, q] of [[[b.xMin - eps, y], [b.xMin + eps, y]], [[b.xMax - eps, y], [b.xMax + eps, y]], [[x, b.yMin - eps], [x, b.yMin + eps]], [[x, b.yMax - eps], [x, b.yMax + eps]]]) maxBoundaryEpsilonDelta = Math.max(maxBoundaryEpsilonDelta, colorDistance(sampleG77BiomeSurface(...p).color, sampleG77BiomeSurface(...q).color));
  }
  return Object.freeze({ policyId: G77_BIOME_POLICY.id, samples: 4225, canonicalWater, canonicalLand, dominantCounts: Object.freeze({ ...dominantCounts }), maxAdjacentColorDelta: Number(maxAdjacentColorDelta.toFixed(8)), maxAdjacentRoughnessDelta: Number(maxAdjacentRoughnessDelta.toFixed(8)), maxGuardBandColorDelta: Number(maxGuardBandColorDelta.toFixed(8)), maxBoundaryEpsilonDelta: Number(maxBoundaryEpsilonDelta.toFixed(8)), colorRoughnessChecksum: checksum });
}

export function buildG77BiomeProbe() {
  const b = G77_BIOME_POLICY.normalizedBounds, rows = [];
  for (let y = 0; y < 65; y += 1) {
    const row = [];
    for (let x = 0; x < 65; x += 1) {
      const s = sampleG77BiomeSurface(lerp(b.xMin, b.xMax, x / 64), lerp(b.yMin, b.yMax, y / 64));
      row.push([s.water, s.height, ...s.color, s.roughness].map((v) => Number(v.toFixed(8))));
    }
    rows.push(row);
  }
  return Object.freeze({ ...measureG77Biome(), sourceMapSha256: G77_BIOME_POLICY.sourceMapSha256, sourceGridSize: 65, terrain3dRegionSize: 256, terrain3dImportSize: 257, landTextureId: 0, coastTextureId: 1, rows });
}
