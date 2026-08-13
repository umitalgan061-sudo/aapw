/**
 * Buzul Muhafızı / NW GeoCell G01 Macro Albedo/Biome authoring field.
 * GeoCell coordinates are addressing only. All semantic fields are sampled in
 * global owner-map space so G01 does not acquire a visible square boundary.
 */
import { REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from '../../../../src/3d/world/worldReferenceMap.js';
import { classifyReferenceBaseSurface } from '../../../../src/3d/world/worldReferenceSurfacePindexes.js';

export const G01_BIOME_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g01-terrain3d-biome-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G01', gx: 0, gy: 1, layer: 'Macro Albedo/Biome',
  pixelBounds: Object.freeze({ xMin: 0, xMax: 192, yMin: 128, yMax: 256 }),
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 0.125, yMin: 0.125, yMax: 0.25 }),
  terrain3dRegionSize: 256,
  guardBandNormalized: 1 / 96,
  seamProbeNormalized: 1 / (96 * 4),
  baseMaskWidth: 96,
  baseMaskHeight: 64,
});

const PALETTE = Object.freeze({
  'lands-always-winter': Object.freeze([0.72, 0.78, 0.79]),
  north: Object.freeze([0.26, 0.34, 0.22]),
  neck: Object.freeze([0.29, 0.36, 0.25]),
  'vale-mountains': Object.freeze([0.43, 0.42, 0.38]),
  westerlands: Object.freeze([0.42, 0.40, 0.34]),
  reach: Object.freeze([0.34, 0.43, 0.24]),
  dorne: Object.freeze([0.55, 0.43, 0.28]),
  'dorne-mountains': Object.freeze([0.44, 0.38, 0.31]),
  'braavos-coast': Object.freeze([0.34, 0.42, 0.36]),
  'dothraki-sea': Object.freeze([0.43, 0.45, 0.25]),
  'bone-mountains': Object.freeze([0.42, 0.39, 0.35]),
  'red-waste': Object.freeze([0.52, 0.35, 0.24]),
  'yi-ti': Object.freeze([0.31, 0.43, 0.24]),
  'jogos-nhai': Object.freeze([0.42, 0.43, 0.25]),
  'grey-waste': Object.freeze([0.47, 0.42, 0.33]),
  sothoryos: Object.freeze([0.20, 0.34, 0.20]),
  ulthos: Object.freeze([0.22, 0.35, 0.21]),
});
const FALLBACK_LAND = Object.freeze([0.34, 0.39, 0.26]);
const SEA = Object.freeze([0.16, 0.30, 0.36]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clamp01 = (value) => clamp(value, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const mixColor = (a, b, t) => Object.freeze([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
const zoneColor = (zone) => PALETTE[zone.id] ?? FALLBACK_LAND;
const isWater = (surface) => surface === 'sea' || surface === 'lake' ? 1 : 0;

function sampleWaterAtMaskCell(cellX, cellY) {
  const x = clamp(cellX, 0, G01_BIOME_POLICY.baseMaskWidth - 1);
  const y = clamp(cellY, 0, G01_BIOME_POLICY.baseMaskHeight - 1);
  return isWater(classifyReferenceBaseSurface((x + 0.5) / 96, (y + 0.5) / 64));
}

export function sampleG01GlobalWaterConfidence(normalizedX, normalizedY) {
  const nx = clamp01(normalizedX), ny = clamp01(normalizedY);
  const gridX = nx * 96 - 0.5, gridY = ny * 64 - 0.5;
  const x0 = Math.floor(gridX), y0 = Math.floor(gridY), tx = gridX - x0, ty = gridY - y0;
  const top = lerp(sampleWaterAtMaskCell(x0, y0), sampleWaterAtMaskCell(x0 + 1, y0), tx);
  const bottom = lerp(sampleWaterAtMaskCell(x0, y0 + 1), sampleWaterAtMaskCell(x0 + 1, y0 + 1), tx);
  return clamp01(lerp(top, bottom, ty));
}

export function sampleG01LandBiome(normalizedX, normalizedY) {
  let totalWeight = 0.12;
  let r = FALLBACK_LAND[0] * totalWeight, g = FALLBACK_LAND[1] * totalWeight, b = FALLBACK_LAND[2] * totalWeight;
  let dominantId = 'fallback-land', dominantWeight = 0;
  for (const zone of REFERENCE_BIOME_ZONES) {
    const influence = sampleReferenceInfluence(normalizedX, normalizedY, zone);
    if (influence <= 0) continue;
    const color = zoneColor(zone);
    r += color[0] * influence; g += color[1] * influence; b += color[2] * influence; totalWeight += influence;
    if (influence > dominantWeight) { dominantWeight = influence; dominantId = zone.id; }
  }
  return Object.freeze({ color: Object.freeze([r / totalWeight, g / totalWeight, b / totalWeight]), dominantId, dominantWeight });
}

export function sampleG01BiomeColor(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
  const land = sampleG01LandBiome(normalizedX, normalizedY);
  const waterConfidence = sampleG01GlobalWaterConfidence(normalizedX, normalizedY);
  return Object.freeze({ color: mixColor(land.color, SEA, waterConfidence), dominantId: waterConfidence >= 0.5 ? 'water' : land.dominantId, waterConfidence });
}

const colorDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function measureG01Biome() {
  const bounds = G01_BIOME_POLICY.normalizedBounds, samples = 64, rows = [], dominantCounts = {};
  let checksum = 2166136261, maxAdjacentColorDelta = 0, fractionalWaterSamples = 0;
  for (let sy = 0; sy <= samples; sy += 1) {
    const row = [], ny = lerp(bounds.yMin, bounds.yMax, sy / samples);
    for (let sx = 0; sx <= samples; sx += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, sx / samples), sample = sampleG01BiomeColor(nx, ny);
      if (sample.waterConfidence > 0 && sample.waterConfidence < 1) fractionalWaterSamples += 1;
      dominantCounts[sample.dominantId] = (dominantCounts[sample.dominantId] ?? 0) + 1;
      for (const component of sample.color) { checksum ^= Math.round(clamp01(component) * 255); checksum = Math.imul(checksum, 16777619) >>> 0; }
      row.push(sample.color);
    }
    rows.push(row);
  }
  for (let y = 0; y < rows.length; y += 1) for (let x = 0; x < rows[y].length; x += 1) {
    if (x + 1 < rows[y].length) maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(rows[y][x], rows[y][x + 1]));
    if (y + 1 < rows.length) maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(rows[y][x], rows[y + 1][x]));
  }
  let maxGuardBandDelta = 0;
  const seamProbe = G01_BIOME_POLICY.seamProbeNormalized;
  for (let i = 0; i < 33; i += 1) {
    const t = i / 32, x = lerp(bounds.xMin, bounds.xMax, t), y = lerp(bounds.yMin, bounds.yMax, t);
    maxGuardBandDelta = Math.max(maxGuardBandDelta,
      colorDistance(sampleG01BiomeColor(bounds.xMin - seamProbe, y).color, sampleG01BiomeColor(bounds.xMin, y).color),
      colorDistance(sampleG01BiomeColor(bounds.xMax, y).color, sampleG01BiomeColor(bounds.xMax + seamProbe, y).color),
      colorDistance(sampleG01BiomeColor(x, bounds.yMin - seamProbe).color, sampleG01BiomeColor(x, bounds.yMin).color),
      colorDistance(sampleG01BiomeColor(x, bounds.yMax).color, sampleG01BiomeColor(x, bounds.yMax + seamProbe).color));
  }
  return Object.freeze({ policyId: G01_BIOME_POLICY.id, geoCell: 'G01', layer: G01_BIOME_POLICY.layer, samples: 4225,
    fractionalWaterSamples, dominantCounts: Object.freeze({ ...dominantCounts }),
    maxAdjacentColorDelta: Number(maxAdjacentColorDelta.toFixed(8)), maxGuardBandDelta: Number(maxGuardBandDelta.toFixed(8)), colorChecksum: checksum });
}
