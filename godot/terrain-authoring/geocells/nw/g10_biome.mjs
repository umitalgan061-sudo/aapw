/**
 * Buzul Muhafızı / NW GeoCell G10 — Macro Albedo/Biome.
 *
 * GeoCell coordinates are work addressing only. The biome field is evaluated
 * in global owner-map space from canonical biome influences and the immutable
 * surface mask, so no square G10 boundary participates in the authored color.
 */
import { REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from '../../../../src/3d/world/worldReferenceMap.js';
import { classifyReferenceBaseSurface } from '../../../../src/3d/world/worldReferenceSurfacePindexes.js';

export const G10_BIOME_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g10-terrain3d-biome-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G10', gx: 1, gy: 0, layer: 'Macro Albedo/Biome',
  pixelBounds: Object.freeze({ xMin: 192, xMax: 384, yMin: 0, yMax: 128 }),
  normalizedBounds: Object.freeze({ xMin: 0.125, xMax: 0.25, yMin: 0, yMax: 0.125 }),
  maskBounds: Object.freeze({ xMin: 12, xMax: 23, yMin: 0, yMax: 7 }),
  baseMaskWidth: 96,
  baseMaskHeight: 64,
  sourceGridSize: 65,
  terrain3dRegionSize: 256,
  guardBandNormalized: 1 / 96,
  seamProbeNormalized: 1 / (96 * 4),
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
const colorDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const isWater = (surface) => surface === 'sea' || surface === 'lake' ? 1 : 0;

function sampleWaterAtMaskCell(cellX, cellY) {
  const x = clamp(cellX, 0, G10_BIOME_POLICY.baseMaskWidth - 1);
  const y = clamp(cellY, 0, G10_BIOME_POLICY.baseMaskHeight - 1);
  return isWater(classifyReferenceBaseSurface(
    (x + 0.5) / G10_BIOME_POLICY.baseMaskWidth,
    (y + 0.5) / G10_BIOME_POLICY.baseMaskHeight,
  ));
}

export function sampleG10GlobalWaterConfidence(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
  const nx = clamp01(normalizedX), ny = clamp01(normalizedY);
  const gridX = nx * G10_BIOME_POLICY.baseMaskWidth - 0.5;
  const gridY = ny * G10_BIOME_POLICY.baseMaskHeight - 0.5;
  const x0 = Math.floor(gridX), y0 = Math.floor(gridY);
  const tx = gridX - x0, ty = gridY - y0;
  const top = lerp(sampleWaterAtMaskCell(x0, y0), sampleWaterAtMaskCell(x0 + 1, y0), tx);
  const bottom = lerp(sampleWaterAtMaskCell(x0, y0 + 1), sampleWaterAtMaskCell(x0 + 1, y0 + 1), tx);
  return clamp01(lerp(top, bottom, ty));
}

export function sampleG10LandBiome(normalizedX, normalizedY) {
  let totalWeight = 0.12;
  let r = FALLBACK_LAND[0] * totalWeight, g = FALLBACK_LAND[1] * totalWeight, b = FALLBACK_LAND[2] * totalWeight;
  let dominantId = 'fallback-land', dominantWeight = 0;
  for (const zone of REFERENCE_BIOME_ZONES) {
    const influence = sampleReferenceInfluence(normalizedX, normalizedY, zone);
    if (influence <= 0) continue;
    const color = zoneColor(zone);
    r += color[0] * influence;
    g += color[1] * influence;
    b += color[2] * influence;
    totalWeight += influence;
    if (influence > dominantWeight) { dominantWeight = influence; dominantId = zone.id; }
  }
  return Object.freeze({
    color: Object.freeze([r / totalWeight, g / totalWeight, b / totalWeight]),
    dominantId,
    dominantWeight,
  });
}

export function sampleG10Biome(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
  const land = sampleG10LandBiome(normalizedX, normalizedY);
  const waterConfidence = sampleG10GlobalWaterConfidence(normalizedX, normalizedY);
  return Object.freeze({
    color: mixColor(land.color, SEA, waterConfidence),
    waterConfidence,
    dominantId: waterConfidence >= 0.5 ? 'water' : land.dominantId,
  });
}

export function measureG10Biome() {
  const bounds = G10_BIOME_POLICY.normalizedBounds;
  const samples = 64;
  const rows = [];
  const dominantCounts = {};
  let colorChecksum = 2166136261;
  let maxAdjacentColorDelta = 0;
  let maxAdjacentWaterDelta = 0;
  let maxGuardBandColorDelta = 0;
  let maxGuardBandWaterDelta = 0;
  let fractionalWaterSamples = 0;

  for (let sy = 0; sy <= samples; sy += 1) {
    const ny = lerp(bounds.yMin, bounds.yMax, sy / samples);
    const row = [];
    for (let sx = 0; sx <= samples; sx += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, sx / samples);
      const sample = sampleG10Biome(nx, ny);
      if (sample.waterConfidence > 0 && sample.waterConfidence < 1) fractionalWaterSamples += 1;
      dominantCounts[sample.dominantId] = (dominantCounts[sample.dominantId] ?? 0) + 1;
      for (const component of [...sample.color, sample.waterConfidence]) {
        colorChecksum ^= Math.round(clamp01(component) * 255);
        colorChecksum = Math.imul(colorChecksum, 16777619) >>> 0;
      }
      row.push(sample);
    }
    rows.push(row);
  }

  for (let y = 0; y < rows.length; y += 1) for (let x = 0; x < rows[y].length; x += 1) {
    if (x + 1 < rows[y].length) {
      maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(rows[y][x].color, rows[y][x + 1].color));
      maxAdjacentWaterDelta = Math.max(maxAdjacentWaterDelta, Math.abs(rows[y][x].waterConfidence - rows[y][x + 1].waterConfidence));
    }
    if (y + 1 < rows.length) {
      maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(rows[y][x].color, rows[y + 1][x].color));
      maxAdjacentWaterDelta = Math.max(maxAdjacentWaterDelta, Math.abs(rows[y][x].waterConfidence - rows[y + 1][x].waterConfidence));
    }
  }

  const seam = G10_BIOME_POLICY.seamProbeNormalized;
  for (let i = 0; i < 33; i += 1) {
    const t = i / 32;
    const x = lerp(bounds.xMin, bounds.xMax, t);
    const y = lerp(bounds.yMin, bounds.yMax, t);
    const pairs = [
      [sampleG10Biome(bounds.xMin - seam, y), sampleG10Biome(bounds.xMin, y)],
      [sampleG10Biome(bounds.xMax, y), sampleG10Biome(bounds.xMax + seam, y)],
      [sampleG10Biome(x, bounds.yMin - seam), sampleG10Biome(x, bounds.yMin)],
      [sampleG10Biome(x, bounds.yMax), sampleG10Biome(x, bounds.yMax + seam)],
    ];
    for (const [a, b] of pairs) {
      maxGuardBandColorDelta = Math.max(maxGuardBandColorDelta, colorDistance(a.color, b.color));
      maxGuardBandWaterDelta = Math.max(maxGuardBandWaterDelta, Math.abs(a.waterConfidence - b.waterConfidence));
    }
  }

  return Object.freeze({
    policyId: G10_BIOME_POLICY.id,
    geoCell: 'G10',
    layer: G10_BIOME_POLICY.layer,
    samples: 4225,
    fractionalWaterSamples,
    dominantCounts: Object.freeze({ ...dominantCounts }),
    maxAdjacentColorDelta: Number(maxAdjacentColorDelta.toFixed(8)),
    maxAdjacentWaterDelta: Number(maxAdjacentWaterDelta.toFixed(8)),
    maxGuardBandColorDelta: Number(maxGuardBandColorDelta.toFixed(8)),
    maxGuardBandWaterDelta: Number(maxGuardBandWaterDelta.toFixed(8)),
    colorChecksum,
  });
}

export function buildG10BiomeProbe() {
  const metrics = measureG10Biome();
  const bounds = G10_BIOME_POLICY.normalizedBounds;
  const size = G10_BIOME_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = lerp(bounds.yMin, bounds.yMax, y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, x / (size - 1));
      const sample = sampleG10Biome(nx, ny);
      row.push([
        Number(sample.color[0].toFixed(8)),
        Number(sample.color[1].toFixed(8)),
        Number(sample.color[2].toFixed(8)),
        Number(sample.waterConfidence.toFixed(8)),
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    ...metrics,
    sourceMapSha256: G10_BIOME_POLICY.sourceMapSha256,
    terrain3dRegionSize: G10_BIOME_POLICY.terrain3dRegionSize,
    sourceGridSize: size,
    normalizedBounds: bounds,
    hydrologyFingerprint: '60 water / 36 land / 30 internal boundary edges / 0 centre mismatches',
    rows,
  });
}
