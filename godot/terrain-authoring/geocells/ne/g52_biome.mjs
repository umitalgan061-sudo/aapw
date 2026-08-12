/**
 * Şafak Kartalı / NE GeoCell G52 Macro Albedo/Biome authoring field.
 *
 * GeoCell bounds are work partitions only. Sampling is continuous across the
 * G52 boundary so the final Terrain3D surface cannot expose a square cell seam.
 */

import {
  REFERENCE_BIOME_ZONES,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import { WORLD_REFERENCE_WATER_MASK } from '../../../../src/3d/world/worldReferenceWaterMask.js';

export const G52_BIOME_POLICY = Object.freeze({
  id: 'safak-kartali-g52-terrain3d-biome-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G52',
  gx: 5,
  gy: 2,
  layer: 'Macro Albedo/Biome',
  pixelBounds: Object.freeze({ xMin: 960, xMax: 1152, yMin: 256, yMax: 384 }),
  normalizedBounds: Object.freeze({ xMin: 0.625, xMax: 0.75, yMin: 0.25, yMax: 0.375 }),
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

const FALLBACK_LAND = Object.freeze([0.36, 0.39, 0.27]);
const SEA = Object.freeze([0.15, 0.30, 0.37]);

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

function rowBit(rowHex, x) {
  const nibble = Number.parseInt(rowHex[Math.floor(x / 4)], 16);
  return (nibble >> (3 - (x % 4))) & 1;
}

function waterCell(x, y) {
  const mx = Math.max(0, Math.min(WORLD_REFERENCE_WATER_MASK.width - 1, x));
  const my = Math.max(0, Math.min(WORLD_REFERENCE_WATER_MASK.height - 1, y));
  return rowBit(WORLD_REFERENCE_WATER_MASK.rowsHex[my], mx);
}

export function sampleG52WaterConfidence(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const fx = clamp01(normalizedX) * WORLD_REFERENCE_WATER_MASK.width - 0.5;
  const fy = clamp01(normalizedY) * WORLD_REFERENCE_WATER_MASK.height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = waterCell(x0, y0);
  const b = waterCell(x0 + 1, y0);
  const c = waterCell(x0, y0 + 1);
  const d = waterCell(x0 + 1, y0 + 1);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function zoneColor(zone) {
  return PALETTE[zone.id] ?? FALLBACK_LAND;
}

export function sampleG52LandBiome(normalizedX, normalizedY) {
  let totalWeight = 0.12;
  let r = FALLBACK_LAND[0] * 0.12;
  let g = FALLBACK_LAND[1] * 0.12;
  let b = FALLBACK_LAND[2] * 0.12;
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

export function sampleG52BiomeColor(normalizedX, normalizedY) {
  const land = sampleG52LandBiome(normalizedX, normalizedY);
  const waterConfidence = sampleG52WaterConfidence(normalizedX, normalizedY);
  return Object.freeze({
    color: mixColor(land.color, SEA, waterConfidence),
    dominantId: waterConfidence >= 0.5 ? 'water' : land.dominantId,
    waterConfidence,
  });
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function canonicalInventory() {
  let waterCells = 0;
  let landCells = 0;
  let boundaryEdges = 0;
  for (let y = 16; y <= 23; y += 1) {
    for (let x = 60; x <= 71; x += 1) {
      const water = waterCell(x, y);
      if (water) waterCells += 1;
      else landCells += 1;
      if (x < 71 && water !== waterCell(x + 1, y)) boundaryEdges += 1;
      if (y < 23 && water !== waterCell(x, y + 1)) boundaryEdges += 1;
    }
  }
  return { waterCells, landCells, boundaryEdges };
}

export function measureG52Biome() {
  const bounds = G52_BIOME_POLICY.normalizedBounds;
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
      const sample = sampleG52BiomeColor(nx, ny);
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

  const guard = G52_BIOME_POLICY.guardBandNormalized;
  let maxGuardBandDelta = 0;
  const guardSamples = 33;
  for (let i = 0; i < guardSamples; i += 1) {
    const t = i / (guardSamples - 1);
    const x = lerp(bounds.xMin, bounds.xMax, t);
    const y = lerp(bounds.yMin, bounds.yMax, t);
    maxGuardBandDelta = Math.max(
      maxGuardBandDelta,
      colorDistance(sampleG52BiomeColor(bounds.xMin - guard, y).color, sampleG52BiomeColor(bounds.xMin, y).color),
      colorDistance(sampleG52BiomeColor(bounds.xMax, y).color, sampleG52BiomeColor(bounds.xMax + guard, y).color),
      colorDistance(sampleG52BiomeColor(x, bounds.yMin - guard).color, sampleG52BiomeColor(x, bounds.yMin).color),
      colorDistance(sampleG52BiomeColor(x, bounds.yMax).color, sampleG52BiomeColor(x, bounds.yMax + guard).color),
    );
  }

  return Object.freeze({
    policyId: G52_BIOME_POLICY.id,
    geoCell: 'G52',
    layer: G52_BIOME_POLICY.layer,
    samples: (samples + 1) * (samples + 1),
    fractionalWaterSamples,
    dominantCounts: Object.freeze({ ...dominantCounts }),
    maxAdjacentColorDelta: Number(maxAdjacentColorDelta.toFixed(8)),
    maxGuardBandDelta: Number(maxGuardBandDelta.toFixed(8)),
    colorChecksum: checksum,
    canonical: Object.freeze(canonicalInventory()),
  });
}
