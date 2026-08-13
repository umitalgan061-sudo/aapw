/**
 * Buzul Muhafızı / NW GeoCell G00 Macro Albedo/Biome authoring field.
 * GeoCell coordinates are addressing only; all semantic fields are sampled in
 * global owner-map space so the final field remains continuous across G00 edges.
 */

import {
  REFERENCE_BIOME_ZONES,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import { classifyReferenceBaseSurface } from '../../../../src/3d/world/worldReferenceSurfacePindexes.js';

export const G00_BIOME_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g00-terrain3d-biome-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G00',
  gx: 0,
  gy: 0,
  layer: 'Macro Albedo/Biome',
  pixelBounds: Object.freeze({ xMin: 0, xMax: 192, yMin: 0, yMax: 128 }),
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 0.125, yMin: 0, yMax: 0.125 }),
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function clamp01(value) {
  return clamp(value, 0, 1);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function mixColor(a, b, t) {
  return Object.freeze([
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ]);
}
function zoneColor(zone) {
  return PALETTE[zone.id] ?? FALLBACK_LAND;
}
function isWater(surface) {
  return surface === 'sea' || surface === 'lake' ? 1 : 0;
}
function sampleWaterAtMaskCell(cellX, cellY) {
  const x = clamp(cellX, 0, G00_BIOME_POLICY.baseMaskWidth - 1);
  const y = clamp(cellY, 0, G00_BIOME_POLICY.baseMaskHeight - 1);
  return isWater(classifyReferenceBaseSurface(
    (x + 0.5) / G00_BIOME_POLICY.baseMaskWidth,
    (y + 0.5) / G00_BIOME_POLICY.baseMaskHeight,
  ));
}

export function sampleG00GlobalWaterConfidence(normalizedX, normalizedY) {
  const nx = clamp01(normalizedX);
  const ny = clamp01(normalizedY);
  const gridX = nx * G00_BIOME_POLICY.baseMaskWidth - 0.5;
  const gridY = ny * G00_BIOME_POLICY.baseMaskHeight - 0.5;
  const x0 = Math.floor(gridX);
  const y0 = Math.floor(gridY);
  const tx = gridX - x0;
  const ty = gridY - y0;
  const w00 = sampleWaterAtMaskCell(x0, y0);
  const w10 = sampleWaterAtMaskCell(x0 + 1, y0);
  const w01 = sampleWaterAtMaskCell(x0, y0 + 1);
  const w11 = sampleWaterAtMaskCell(x0 + 1, y0 + 1);
  return clamp01(lerp(lerp(w00, w10, tx), lerp(w01, w11, tx), ty));
}

export function sampleG00LandBiome(normalizedX, normalizedY) {
  let totalWeight = 0.12;
  let r = FALLBACK_LAND[0] * totalWeight;
  let g = FALLBACK_LAND[1] * totalWeight;
  let b = FALLBACK_LAND[2] * totalWeight;
  let dominantId = 'fallback-land';
  let dominantWeight = 0;
  for (const zone of REFERENCE_BIOME_ZONES) {
    const influence = sampleReferenceInfluence(normalizedX, normalizedY, zone);
    if (influence <= 0) continue;
    const color = zoneColor(zone);
    r += color[0] * influence;
    g += color[1] * influence;
    b += color[2] * influence;
    totalWeight += influence;
    if (influence > dominantWeight) {
      dominantWeight = influence;
      dominantId = zone.id;
    }
  }
  return Object.freeze({
    color: Object.freeze([r / totalWeight, g / totalWeight, b / totalWeight]),
    dominantId,
    dominantWeight,
  });
}

export function sampleG00BiomeColor(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const land = sampleG00LandBiome(normalizedX, normalizedY);
  const waterConfidence = sampleG00GlobalWaterConfidence(normalizedX, normalizedY);
  return Object.freeze({
    color: mixColor(land.color, SEA, waterConfidence),
    dominantId: waterConfidence >= 0.5 ? 'water' : land.dominantId,
    waterConfidence,
  });
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function measureG00Biome() {
  const bounds = G00_BIOME_POLICY.normalizedBounds;
  const samples = 64;
  let checksum = 2166136261;
  let maxAdjacentColorDelta = 0;
  let fractionalWaterSamples = 0;
  const dominantCounts = {};
  const rows = [];
  for (let sy = 0; sy <= samples; sy += 1) {
    const row = [];
    const ny = lerp(bounds.yMin, bounds.yMax, sy / samples);
    for (let sx = 0; sx <= samples; sx += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, sx / samples);
      const sample = sampleG00BiomeColor(nx, ny);
      if (sample.waterConfidence > 0 && sample.waterConfidence < 1) fractionalWaterSamples += 1;
      dominantCounts[sample.dominantId] = (dominantCounts[sample.dominantId] ?? 0) + 1;
      for (const component of sample.color) {
        const quantized = Math.round(clamp01(component) * 255);
        checksum ^= quantized;
        checksum = Math.imul(checksum, 16777619) >>> 0;
      }
      row.push(sample.color);
    }
    rows.push(row);
  }
  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if (x + 1 < rows[y].length) maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(rows[y][x], rows[y][x + 1]));
      if (y + 1 < rows.length) maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(rows[y][x], rows[y + 1][x]));
    }
  }
  // The full guard band remains one owner-mask cell for neighboring authoring context.
  // Seam continuity is measured much closer to the literal GeoCell edge so a legitimate
  // natural gradient across that guard band is not misclassified as a square-cell seam.
  const seamProbe = G00_BIOME_POLICY.seamProbeNormalized;
  let maxGuardBandDelta = 0;
  const guardSamples = 33;
  for (let i = 0; i < guardSamples; i += 1) {
    const t = i / (guardSamples - 1);
    const x = lerp(bounds.xMin, bounds.xMax, t);
    const y = lerp(bounds.yMin, bounds.yMax, t);
    maxGuardBandDelta = Math.max(
      maxGuardBandDelta,
      colorDistance(sampleG00BiomeColor(bounds.xMin - seamProbe, y).color, sampleG00BiomeColor(bounds.xMin, y).color),
      colorDistance(sampleG00BiomeColor(bounds.xMax, y).color, sampleG00BiomeColor(bounds.xMax + seamProbe, y).color),
      colorDistance(sampleG00BiomeColor(x, bounds.yMin - seamProbe).color, sampleG00BiomeColor(x, bounds.yMin).color),
      colorDistance(sampleG00BiomeColor(x, bounds.yMax).color, sampleG00BiomeColor(x, bounds.yMax + seamProbe).color),
    );
  }
  return Object.freeze({
    policyId: G00_BIOME_POLICY.id,
    geoCell: 'G00',
    layer: G00_BIOME_POLICY.layer,
    samples: (samples + 1) * (samples + 1),
    fractionalWaterSamples,
    dominantCounts: Object.freeze({ ...dominantCounts }),
    maxAdjacentColorDelta: Number(maxAdjacentColorDelta.toFixed(8)),
    maxGuardBandDelta: Number(maxGuardBandDelta.toFixed(8)),
    colorChecksum: checksum,
  });
}
