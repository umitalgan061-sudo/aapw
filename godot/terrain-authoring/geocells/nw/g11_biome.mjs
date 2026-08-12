/**
 * Buzul Muhafızı / NW GeoCell G11 Macro Albedo/Biome authoring field.
 *
 * GeoCell bounds are work-partition coordinates only. This module deliberately
 * samples the canonical biome influence functions continuously across and beyond
 * G11 so no visible GeoCell seam or pixel staircase is introduced.
 */

import {
  REFERENCE_BIOME_ZONES,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import { sampleG11WaterConfidence } from './g11_hydrology.mjs';

export const G11_BIOME_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g11-terrain3d-biome-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G11',
  gx: 1,
  gy: 1,
  layer: 'Macro Albedo/Biome',
  pixelBounds: Object.freeze({ xMin: 192, xMax: 384, yMin: 128, yMax: 256 }),
  normalizedBounds: Object.freeze({ xMin: 0.125, xMax: 0.25, yMin: 0.125, yMax: 0.25 }),
  terrain3dRegionSize: 256,
  guardBandNormalized: 1 / 96,
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

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
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

export function sampleG11LandBiome(normalizedX, normalizedY) {
  let totalWeight = 0;
  let r = FALLBACK_LAND[0] * 0.12;
  let g = FALLBACK_LAND[1] * 0.12;
  let b = FALLBACK_LAND[2] * 0.12;
  totalWeight += 0.12;
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

export function sampleG11BiomeColor(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const land = sampleG11LandBiome(normalizedX, normalizedY);
  const waterConfidence = sampleG11WaterConfidence(
    clamp01(normalizedX),
    clamp01(normalizedY),
  );
  const water = waterConfidence == null ? 0 : waterConfidence;
  return Object.freeze({
    color: mixColor(land.color, SEA, water),
    dominantId: water >= 0.5 ? 'water' : land.dominantId,
    waterConfidence: water,
  });
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function measureG11Biome() {
  const bounds = G11_BIOME_POLICY.normalizedBounds;
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
      const sample = sampleG11BiomeColor(nx, ny);
      const color = sample.color;
      if (sample.waterConfidence > 0 && sample.waterConfidence < 1) fractionalWaterSamples += 1;
      dominantCounts[sample.dominantId] = (dominantCounts[sample.dominantId] ?? 0) + 1;
      for (const component of color) {
        const quantized = Math.round(clamp01(component) * 255);
        checksum ^= quantized;
        checksum = Math.imul(checksum, 16777619) >>> 0;
      }
      row.push(color);
    }
    rows.push(row);
  }

  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if (x + 1 < rows[y].length) {
        maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(rows[y][x], rows[y][x + 1]));
      }
      if (y + 1 < rows.length) {
        maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(rows[y][x], rows[y + 1][x]));
      }
    }
  }

  const guard = G11_BIOME_POLICY.guardBandNormalized;
  let maxGuardBandDelta = 0;
  const guardSamples = 33;
  for (let i = 0; i < guardSamples; i += 1) {
    const t = i / (guardSamples - 1);
    const x = lerp(bounds.xMin, bounds.xMax, t);
    const y = lerp(bounds.yMin, bounds.yMax, t);
    maxGuardBandDelta = Math.max(
      maxGuardBandDelta,
      colorDistance(sampleG11BiomeColor(bounds.xMin - guard, y).color, sampleG11BiomeColor(bounds.xMin, y).color),
      colorDistance(sampleG11BiomeColor(bounds.xMax, y).color, sampleG11BiomeColor(bounds.xMax + guard, y).color),
      colorDistance(sampleG11BiomeColor(x, bounds.yMin - guard).color, sampleG11BiomeColor(x, bounds.yMin).color),
      colorDistance(sampleG11BiomeColor(x, bounds.yMax).color, sampleG11BiomeColor(x, bounds.yMax + guard).color),
    );
  }

  return Object.freeze({
    policyId: G11_BIOME_POLICY.id,
    geoCell: 'G11',
    layer: G11_BIOME_POLICY.layer,
    samples: (samples + 1) * (samples + 1),
    fractionalWaterSamples,
    dominantCounts: Object.freeze({ ...dominantCounts }),
    maxAdjacentColorDelta: Number(maxAdjacentColorDelta.toFixed(8)),
    maxGuardBandDelta: Number(maxGuardBandDelta.toFixed(8)),
    colorChecksum: checksum,
  });
}
