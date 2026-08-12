/**
 * Günbatımı Ustası / SW GeoCell G07 Relief/Height Character.
 *
 * G07 is canonical open sea. This layer therefore adds only continuous,
 * source-derived seabed character. It never lifts the parcel above water and it
 * never uses GeoCell edges, Pindex coordinates or nearest-neighbour blocks as a
 * visual term. Adjacent cells sampling the same normalized map coordinate receive
 * the same height/normal field.
 */

import {
  REFERENCE_WATER_ZONES,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import { sampleReferenceWaterMask } from '../../../../src/3d/world/worldReferenceWaterMask.js';

export const G07_RELIEF_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g07-terrain3d-relief-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G07',
  gx: 0,
  gy: 7,
  layer: 'Relief/Height Character',
  pixelBounds: Object.freeze({ xMin: 0, xMax: 192, yMin: 896, yMax: 1024 }),
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 0.125, yMin: 0.875, yMax: 1 }),
  terrain3dRegionSize: 256,
  guardBandNormalized: 1 / 96,
  referenceWorldMeters: Object.freeze({ x: 13296.079, z: 10341.395 }),
  waterCeilingMeters: -2.5,
  deepSeabedMeters: -9.0,
  shelfRiseMeters: 4.25,
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function waterZoneInfluence(normalizedX, normalizedY, id) {
  const zone = REFERENCE_WATER_ZONES.find((candidate) => candidate.id === id);
  return zone ? sampleReferenceInfluence(normalizedX, normalizedY, zone) : 0;
}

/**
 * Continuous marine bathymetry using only global owner-map coordinates and the
 * canonical Sunset Sea influence. The global south/west shelf terms deliberately
 * continue through the GeoCell boundary, preventing a square G07 relief stamp.
 */
export function sampleG07SeabedHeight(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const x = clamp01(normalizedX);
  const y = clamp01(normalizedY);
  const sunset = waterZoneInfluence(x, y, 'sunset-sea');
  const southShelf = smoothstep(0.82, 1.0, y);
  const westShelf = 1 - smoothstep(0.0, 0.18, x);
  const shelf = clamp01(0.55 * sunset + 0.25 * southShelf + 0.20 * westShelf);
  const height = G07_RELIEF_POLICY.deepSeabedMeters + G07_RELIEF_POLICY.shelfRiseMeters * shelf;
  return Object.freeze({ height, shelf, sunsetInfluence: sunset });
}

/**
 * Finite-difference world-space normal, sampled from the same continuous global
 * height field. The epsilon is one source-image pixel in normalized X.
 */
export function sampleG07SeabedNormal(normalizedX, normalizedY) {
  const epsilon = 1 / 1536;
  const left = sampleG07SeabedHeight(normalizedX - epsilon, normalizedY).height;
  const right = sampleG07SeabedHeight(normalizedX + epsilon, normalizedY).height;
  const down = sampleG07SeabedHeight(normalizedX, normalizedY - epsilon).height;
  const up = sampleG07SeabedHeight(normalizedX, normalizedY + epsilon).height;
  const dxMeters = 2 * epsilon * G07_RELIEF_POLICY.referenceWorldMeters.x;
  const dzMeters = 2 * epsilon * G07_RELIEF_POLICY.referenceWorldMeters.z;
  let nx = -(right - left) / dxMeters;
  let ny = 1;
  let nz = -(up - down) / dzMeters;
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length;
  ny /= length;
  nz /= length;
  return Object.freeze([nx, ny, nz]);
}

function normalDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function measureG07Relief() {
  const bounds = G07_RELIEF_POLICY.normalizedBounds;
  const subdivisions = 64;
  const rows = [];
  let canonicalWater = 0;
  let canonicalLand = 0;
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let maxAdjacentHeightDelta = 0;
  let checksum = 2166136261;

  for (let cy = 0; cy < 8; cy += 1) {
    const ny = (56 + cy + 0.5) / 64;
    for (let cx = 0; cx < 12; cx += 1) {
      const nx = (cx + 0.5) / 96;
      if (sampleReferenceWaterMask(nx, ny)) canonicalWater += 1;
      else canonicalLand += 1;
    }
  }

  for (let sy = 0; sy <= subdivisions; sy += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (sy / subdivisions);
    const row = [];
    for (let sx = 0; sx <= subdivisions; sx += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (sx / subdivisions);
      const height = sampleG07SeabedHeight(nx, ny).height;
      row.push(height);
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
      const quantized = Math.round((height + 16) * 100000);
      checksum ^= quantized;
      checksum = Math.imul(checksum, 16777619) >>> 0;
    }
    rows.push(row);
  }

  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if (x + 1 < rows[y].length) maxAdjacentHeightDelta = Math.max(maxAdjacentHeightDelta, Math.abs(rows[y][x + 1] - rows[y][x]));
      if (y + 1 < rows.length) maxAdjacentHeightDelta = Math.max(maxAdjacentHeightDelta, Math.abs(rows[y + 1][x] - rows[y][x]));
    }
  }

  const guard = G07_RELIEF_POLICY.guardBandNormalized;
  let maxGuardBandHeightDelta = 0;
  let maxGuardBandNormalDelta = 0;
  for (let i = 0; i <= 32; i += 1) {
    const t = i / 32;
    const x = bounds.xMin + (bounds.xMax - bounds.xMin) * t;
    const y = bounds.yMin + (bounds.yMax - bounds.yMin) * t;
    maxGuardBandHeightDelta = Math.max(
      maxGuardBandHeightDelta,
      Math.abs(sampleG07SeabedHeight(bounds.xMax, y).height - sampleG07SeabedHeight(bounds.xMax + guard, y).height),
      Math.abs(sampleG07SeabedHeight(x, bounds.yMin - guard).height - sampleG07SeabedHeight(x, bounds.yMin).height),
    );
    maxGuardBandNormalDelta = Math.max(
      maxGuardBandNormalDelta,
      normalDistance(sampleG07SeabedNormal(bounds.xMax, y), sampleG07SeabedNormal(bounds.xMax + guard, y)),
      normalDistance(sampleG07SeabedNormal(x, bounds.yMin - guard), sampleG07SeabedNormal(x, bounds.yMin)),
    );
  }

  return Object.freeze({
    policyId: G07_RELIEF_POLICY.id,
    sourceMapSha256: G07_RELIEF_POLICY.sourceMapSha256,
    geoCell: G07_RELIEF_POLICY.geoCell,
    layer: G07_RELIEF_POLICY.layer,
    samples: (subdivisions + 1) * (subdivisions + 1),
    canonicalWater,
    canonicalLand,
    minHeight: Number(minHeight.toFixed(8)),
    maxHeight: Number(maxHeight.toFixed(8)),
    heightSpan: Number((maxHeight - minHeight).toFixed(8)),
    maxAdjacentHeightDelta: Number(maxAdjacentHeightDelta.toFixed(8)),
    maxGuardBandHeightDelta: Number(maxGuardBandHeightDelta.toFixed(8)),
    maxGuardBandNormalDelta: Number(maxGuardBandNormalDelta.toFixed(8)),
    heightChecksum: checksum,
  });
}

export function buildG07ReliefProbe(gridSize = 65) {
  if (!Number.isInteger(gridSize) || gridSize < 2) throw new RangeError('gridSize must be an integer >= 2');
  const bounds = G07_RELIEF_POLICY.normalizedBounds;
  const rows = [];
  for (let y = 0; y < gridSize; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (gridSize - 1));
    const row = [];
    for (let x = 0; x < gridSize; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (gridSize - 1));
      row.push(Number(sampleG07SeabedHeight(nx, ny).height.toFixed(8)));
    }
    rows.push(row);
  }
  return Object.freeze({
    policyId: G07_RELIEF_POLICY.id,
    sourceMapSha256: G07_RELIEF_POLICY.sourceMapSha256,
    terrain3dRegionSize: G07_RELIEF_POLICY.terrain3dRegionSize,
    sourceGridSize: gridSize,
    normalizedBounds: G07_RELIEF_POLICY.normalizedBounds,
    waterCeilingMeters: G07_RELIEF_POLICY.waterCeilingMeters,
    rows,
  });
}
