/**
 * Günbatımı Ustası / SW GeoCell G07 Macro Albedo/Biome authoring field.
 *
 * G07 is canonical open sea. GeoCell bounds are work-partition coordinates only;
 * the final terrain must not expose a square boundary. This field derives a
 * continuous marine macro-color from the owner-map water-zone influences while
 * asserting that all canonical G07 centres remain water.
 */

import {
  REFERENCE_WATER_ZONES,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import { sampleReferenceWaterMask } from '../../../../src/3d/world/worldReferenceWaterMask.js';

export const G07_BIOME_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g07-terrain3d-marine-biome-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G07',
  gx: 0,
  gy: 7,
  layer: 'Macro Albedo/Biome',
  pixelBounds: Object.freeze({ xMin: 0, xMax: 192, yMin: 896, yMax: 1024 }),
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 0.125, yMin: 0.875, yMax: 1 }),
  terrain3dRegionSize: 256,
  guardBandNormalized: 1 / 96,
});

const DEEP_SEA = Object.freeze([0.075, 0.165, 0.215]);
const SHELF_SEA = Object.freeze([0.16, 0.30, 0.34]);
const SUNSET_SEA = Object.freeze([0.12, 0.255, 0.31]);
const SUMMER_SEA = Object.freeze([0.14, 0.29, 0.33]);

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

function waterZoneInfluence(normalizedX, normalizedY, id) {
  const zone = REFERENCE_WATER_ZONES.find((candidate) => candidate.id === id);
  return zone ? sampleReferenceInfluence(normalizedX, normalizedY, zone) : 0;
}

/**
 * Continuous marine macro-color. No random noise and no GeoCell-edge term is used,
 * so adjacent cells sampling the same normalized coordinate receive the same color.
 */
export function sampleG07MarineColor(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const x = clamp01(normalizedX);
  const y = clamp01(normalizedY);
  const sunset = waterZoneInfluence(x, y, 'sunset-sea');
  const summer = waterZoneInfluence(x, y, 'summer-sea');
  const southShelf = clamp01((y - 0.80) / 0.20);
  const westShelf = clamp01((0.16 - x) / 0.16);
  const shelf = clamp01(0.42 * southShelf + 0.22 * westShelf + 0.36 * Math.max(sunset, summer));
  let color = mixColor(DEEP_SEA, SHELF_SEA, shelf);
  color = mixColor(color, SUNSET_SEA, 0.55 * sunset);
  color = mixColor(color, SUMMER_SEA, 0.35 * summer);
  return Object.freeze({ color, sunsetInfluence: sunset, summerInfluence: summer, shelf });
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function measureG07Biome() {
  const bounds = G07_BIOME_POLICY.normalizedBounds;
  const samples = 64;
  const rows = [];
  let checksum = 2166136261;
  let maxAdjacentColorDelta = 0;
  let canonicalWater = 0;
  let canonicalLand = 0;

  // Preserve the prior Coast/Hydrology semantic contract independently of an unmerged PR.
  for (let cy = 0; cy < 8; cy += 1) {
    const ny = (56 + cy + 0.5) / 64;
    for (let cx = 0; cx < 12; cx += 1) {
      const nx = (cx + 0.5) / 96;
      if (sampleReferenceWaterMask(nx, ny)) canonicalWater += 1;
      else canonicalLand += 1;
    }
  }

  for (let sy = 0; sy <= samples; sy += 1) {
    const row = [];
    const ny = lerp(bounds.yMin, bounds.yMax, sy / samples);
    for (let sx = 0; sx <= samples; sx += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, sx / samples);
      const sample = sampleG07MarineColor(nx, ny);
      row.push(sample.color);
      for (const component of sample.color) {
        const quantized = Math.round(clamp01(component) * 255);
        checksum ^= quantized;
        checksum = Math.imul(checksum, 16777619) >>> 0;
      }
    }
    rows.push(row);
  }

  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if (x + 1 < rows[y].length) maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(rows[y][x], rows[y][x + 1]));
      if (y + 1 < rows.length) maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(rows[y][x], rows[y + 1][x]));
    }
  }

  const guard = G07_BIOME_POLICY.guardBandNormalized;
  let maxGuardBandDelta = 0;
  for (let i = 0; i <= 32; i += 1) {
    const t = i / 32;
    const x = lerp(bounds.xMin, bounds.xMax, t);
    const y = lerp(bounds.yMin, bounds.yMax, t);
    maxGuardBandDelta = Math.max(
      maxGuardBandDelta,
      colorDistance(sampleG07MarineColor(bounds.xMax, y).color, sampleG07MarineColor(bounds.xMax + guard, y).color),
      colorDistance(sampleG07MarineColor(x, bounds.yMin - guard).color, sampleG07MarineColor(x, bounds.yMin).color),
    );
  }

  return Object.freeze({
    policyId: G07_BIOME_POLICY.id,
    sourceMapSha256: G07_BIOME_POLICY.sourceMapSha256,
    geoCell: 'G07',
    layer: G07_BIOME_POLICY.layer,
    samples: (samples + 1) * (samples + 1),
    canonicalWater,
    canonicalLand,
    maxAdjacentColorDelta: Number(maxAdjacentColorDelta.toFixed(8)),
    maxGuardBandDelta: Number(maxGuardBandDelta.toFixed(8)),
    colorChecksum: checksum,
  });
}

export function buildG07BiomeProbe(gridSize = 65) {
  if (!Number.isInteger(gridSize) || gridSize < 2) throw new RangeError('gridSize must be an integer >= 2');
  const bounds = G07_BIOME_POLICY.normalizedBounds;
  const rows = [];
  for (let y = 0; y < gridSize; y += 1) {
    const ny = lerp(bounds.yMin, bounds.yMax, y / (gridSize - 1));
    const row = [];
    for (let x = 0; x < gridSize; x += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, x / (gridSize - 1));
      row.push(sampleG07MarineColor(nx, ny).color.map((value) => Number(value.toFixed(8))));
    }
    rows.push(row);
  }
  return Object.freeze({
    policyId: G07_BIOME_POLICY.id,
    sourceMapSha256: G07_BIOME_POLICY.sourceMapSha256,
    terrain3dRegionSize: G07_BIOME_POLICY.terrain3dRegionSize,
    sourceGridSize: gridSize,
    rows,
  });
}
