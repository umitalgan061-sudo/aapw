/**
 * Kızıl Ufuk / SE GeoCell G75 Macro Albedo/Biome authoring field.
 * GeoCell bounds are work addressing only; all sampling is continuous in owner-map space.
 */
import { REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from '../../../../src/3d/world/worldReferenceMap.js';
import { sampleReferenceWaterMask } from '../../../../src/3d/world/worldReferenceWaterMask.js';

export const G75_BIOME_POLICY = Object.freeze({
  id: 'kizil-ufuk-g75-terrain3d-biome-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G75', gx: 7, gy: 5, layer: 'Macro Albedo/Biome',
  pixelBounds: Object.freeze({ xMin: 1344, xMax: 1536, yMin: 640, yMax: 768 }),
  normalizedBounds: Object.freeze({ xMin: 0.875, xMax: 1, yMin: 0.625, yMax: 0.75 }),
  terrain3dRegionSize: 256,
  guardBandNormalized: 1 / 96,
});

const PALETTE = Object.freeze({
  'lands-always-winter': [0.72, 0.78, 0.79], north: [0.26, 0.34, 0.22], neck: [0.29, 0.36, 0.25],
  'vale-mountains': [0.43, 0.42, 0.38], westerlands: [0.42, 0.40, 0.34], reach: [0.34, 0.43, 0.24],
  dorne: [0.55, 0.43, 0.28], 'dorne-mountains': [0.44, 0.38, 0.31], 'braavos-coast': [0.34, 0.42, 0.36],
  'dothraki-sea': [0.43, 0.45, 0.25], 'bone-mountains': [0.42, 0.39, 0.35], 'red-waste': [0.52, 0.35, 0.24],
  'yi-ti': [0.31, 0.43, 0.24], 'jogos-nhai': [0.42, 0.43, 0.25], 'grey-waste': [0.47, 0.42, 0.33],
  sothoryos: [0.20, 0.34, 0.20], ulthos: [0.22, 0.35, 0.21],
});
const FALLBACK = Object.freeze([0.38, 0.40, 0.27]);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function sampleG75BiomeColor(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
  const x = clamp01(normalizedX); const y = clamp01(normalizedY);
  let total = 0.10; let r = FALLBACK[0] * total; let g = FALLBACK[1] * total; let b = FALLBACK[2] * total;
  let dominantId = 'fallback-land'; let dominantWeight = 0;
  for (const zone of REFERENCE_BIOME_ZONES) {
    const weight = sampleReferenceInfluence(x, y, zone);
    if (weight <= 0) continue;
    const color = PALETTE[zone.id] ?? FALLBACK;
    r += color[0] * weight; g += color[1] * weight; b += color[2] * weight; total += weight;
    if (weight > dominantWeight) { dominantWeight = weight; dominantId = zone.id; }
  }
  return Object.freeze({ color: Object.freeze([r / total, g / total, b / total]), dominantId, dominantWeight });
}

const colorDistance = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);

export function measureG75Biome() {
  const bounds = G75_BIOME_POLICY.normalizedBounds;
  let canonicalWater = 0; let canonicalLand = 0;
  for (let cy = 0; cy < 8; cy += 1) for (let cx = 0; cx < 12; cx += 1) {
    const nx = (84 + cx + 0.5) / 96; const ny = (40 + cy + 0.5) / 64;
    if (sampleReferenceWaterMask(nx, ny)) canonicalWater += 1; else canonicalLand += 1;
  }
  const samples = 64; const rows = []; const dominantCounts = {}; let checksum = 2166136261;
  let maxAdjacentColorDelta = 0;
  for (let sy = 0; sy <= samples; sy += 1) {
    const row = []; const ny = lerp(bounds.yMin, bounds.yMax, sy / samples);
    for (let sx = 0; sx <= samples; sx += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, sx / samples); const sample = sampleG75BiomeColor(nx, ny);
      dominantCounts[sample.dominantId] = (dominantCounts[sample.dominantId] ?? 0) + 1;
      for (const c of sample.color) { const q = Math.round(clamp01(c) * 255); checksum ^= q; checksum = Math.imul(checksum, 16777619) >>> 0; }
      row.push(sample.color);
    }
    rows.push(row);
  }
  for (let y = 0; y < rows.length; y += 1) for (let x = 0; x < rows[y].length; x += 1) {
    if (x + 1 < rows[y].length) maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(rows[y][x], rows[y][x+1]));
    if (y + 1 < rows.length) maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(rows[y][x], rows[y+1][x]));
  }
  const guard = G75_BIOME_POLICY.guardBandNormalized; let maxGuardBandDelta = 0;
  for (let i = 0; i <= 32; i += 1) {
    const t = i / 32; const x = lerp(bounds.xMin, bounds.xMax, t); const y = lerp(bounds.yMin, bounds.yMax, t);
    maxGuardBandDelta = Math.max(maxGuardBandDelta,
      colorDistance(sampleG75BiomeColor(bounds.xMin-guard,y).color, sampleG75BiomeColor(bounds.xMin,y).color),
      colorDistance(sampleG75BiomeColor(bounds.xMax,y).color, sampleG75BiomeColor(bounds.xMax+guard,y).color),
      colorDistance(sampleG75BiomeColor(x,bounds.yMin-guard).color, sampleG75BiomeColor(x,bounds.yMin).color),
      colorDistance(sampleG75BiomeColor(x,bounds.yMax).color, sampleG75BiomeColor(x,bounds.yMax+guard).color));
  }
  return Object.freeze({ policyId:G75_BIOME_POLICY.id, sourceMapSha256:G75_BIOME_POLICY.sourceMapSha256, geoCell:'G75', layer:G75_BIOME_POLICY.layer,
    samples:(samples+1)*(samples+1), canonicalWater, canonicalLand, dominantCounts:Object.freeze({...dominantCounts}),
    maxAdjacentColorDelta:Number(maxAdjacentColorDelta.toFixed(8)), maxGuardBandDelta:Number(maxGuardBandDelta.toFixed(8)), colorChecksum:checksum });
}

export function buildG75BiomeProbe(gridSize = 65) {
  if (!Number.isInteger(gridSize) || gridSize < 2) throw new RangeError('gridSize must be an integer >= 2');
  const b = G75_BIOME_POLICY.normalizedBounds; const rows = [];
  for (let y = 0; y < gridSize; y += 1) { const row=[]; const ny=lerp(b.yMin,b.yMax,y/(gridSize-1));
    for (let x = 0; x < gridSize; x += 1) { const nx=lerp(b.xMin,b.xMax,x/(gridSize-1)); row.push(sampleG75BiomeColor(nx,ny).color.map(v=>Number(v.toFixed(8)))); }
    rows.push(row); }
  return Object.freeze({ policyId:G75_BIOME_POLICY.id, sourceMapSha256:G75_BIOME_POLICY.sourceMapSha256, terrain3dRegionSize:256, sourceGridSize:gridSize, rows });
}
