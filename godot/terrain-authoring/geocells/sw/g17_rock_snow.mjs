/**
 * Günbatımı Ustası / SW GeoCell G17 — Rock/Snow surface authoring.
 *
 * G17 is canonical open sea. GeoCell coordinates are addressing only. The
 * submerged substrate field is evaluated continuously in global owner-map
 * coordinates so no square-cell, nearest-neighbour or seam term reaches the
 * Terrain3D control map. Snow is intentionally impossible on this marine cell.
 */
import {
  REFERENCE_WATER_ZONES,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import { sampleG17WaterConfidence } from './g17_hydrology.mjs';
import {
  G17_RELIEF_POLICY,
  sampleG17SeabedHeight,
  sampleG17SeabedNormal,
} from './g17_relief.mjs';

export const G17_ROCK_SNOW_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g17-terrain3d-rock-snow-2026-08-13-v1',
  sourceMapSha256: G17_RELIEF_POLICY.sourceMapSha256,
  geoCell: 'G17',
  gx: 1,
  gy: 7,
  layer: 'Rock/Snow',
  normalizedBounds: G17_RELIEF_POLICY.normalizedBounds,
  sourceGridSize: 65,
  terrain3dRegionSize: 256,
  terrain3dImportSize: 257,
  seabedTextureId: 0,
  rockTextureId: 1,
  guardBandNormalized: 1 / 1536,
});

const SUNSET = REFERENCE_WATER_ZONES.find((zone) => zone.id === 'sunset-sea');
const SUMMER = REFERENCE_WATER_ZONES.find((zone) => zone.id === 'summer-sea');
if (!SUNSET || !SUMMER) throw new Error('sunset-sea and summer-sea reference zones are required');

const clamp01 = (value) => Math.max(0, Math.min(1, value));
function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function reliefSlope(normal) {
  return clamp01(Math.hypot(normal[0], normal[2]) / Math.max(0.000001, normal[1]));
}

export function sampleG17RockSnow(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const x = clamp01(normalizedX);
  const y = clamp01(normalizedY);
  const waterConfidence = sampleG17WaterConfidence(x, y);
  const relief = sampleG17SeabedHeight(x, y);
  const normal = sampleG17SeabedNormal(x, y);
  const slope = reliefSlope(normal);
  const sunset = sampleReferenceInfluence(x, y, SUNSET);
  const summer = sampleReferenceInfluence(x, y, SUMMER);

  const shelfExposure = clamp01(relief.shelf);
  const depthSignal = 1 - smoothstep(-8.95, -7.95, relief.height);
  const slopeSignal = smoothstep(0.00001, 0.00018, slope);
  const marineSignal = clamp01(0.64 * sunset + 0.16 * summer + 0.20 * shelfExposure);

  // Restrained submerged-rock eligibility. This is substrate character under
  // water, not invented dry land. The global terms continue through G07/G27.
  const rockBlend = clamp01(
    0.12
      + 0.30 * marineSignal
      + 0.24 * depthSignal
      + 0.18 * slopeSignal
      + 0.16 * shelfExposure,
  ) * smoothstep(0.55, 0.92, waterConfidence);

  return Object.freeze({
    waterConfidence,
    height: relief.height,
    slope,
    sunset,
    summer,
    shelfExposure,
    depthSignal,
    slopeSignal,
    rockBlend,
    seabedWeight: 1 - rockBlend,
    rockWeight: rockBlend,
    snowWeight: 0,
  });
}

function fnv1a(sum, value) {
  return Math.imul((sum ^ (value & 0xff)) >>> 0, 16777619) >>> 0;
}

export function measureG17RockSnow() {
  const bounds = G17_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G17_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  let minRockBlend = Infinity;
  let maxRockBlend = -Infinity;
  let maxAdjacentRockStep = 0;
  let fractionalRockSamples = 0;
  let maxSnowWeight = 0;
  let minWaterConfidence = Infinity;
  let checksum = 2166136261;

  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const sample = sampleG17RockSnow(nx, ny);
      minRockBlend = Math.min(minRockBlend, sample.rockBlend);
      maxRockBlend = Math.max(maxRockBlend, sample.rockBlend);
      minWaterConfidence = Math.min(minWaterConfidence, sample.waterConfidence);
      maxSnowWeight = Math.max(maxSnowWeight, sample.snowWeight);
      if (sample.rockBlend > 0.001 && sample.rockBlend < 0.999) fractionalRockSamples += 1;
      checksum = fnv1a(checksum, Math.round(sample.rockBlend * 255));
      row.push(sample.rockBlend);
    }
    rows.push(row);
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (x + 1 < size) maxAdjacentRockStep = Math.max(maxAdjacentRockStep, Math.abs(rows[y][x] - rows[y][x + 1]));
      if (y + 1 < size) maxAdjacentRockStep = Math.max(maxAdjacentRockStep, Math.abs(rows[y][x] - rows[y + 1][x]));
    }
  }

  const guard = G17_ROCK_SNOW_POLICY.guardBandNormalized;
  let maxGuardBandRockDelta = 0;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const x = bounds.xMin + (bounds.xMax - bounds.xMin) * t;
    const y = bounds.yMin + (bounds.yMax - bounds.yMin) * t;
    const pairs = [
      [bounds.xMin - guard, y, bounds.xMin, y],
      [bounds.xMax, y, bounds.xMax + guard, y],
      [x, bounds.yMin - guard, x, bounds.yMin],
    ];
    for (const [ax, ay, bx, by] of pairs) {
      maxGuardBandRockDelta = Math.max(
        maxGuardBandRockDelta,
        Math.abs(sampleG17RockSnow(ax, ay).rockBlend - sampleG17RockSnow(bx, by).rockBlend),
      );
    }
  }

  return Object.freeze({
    policyId: G17_ROCK_SNOW_POLICY.id,
    sourceMapSha256: G17_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G17',
    layer: G17_ROCK_SNOW_POLICY.layer,
    sourceSamples: size * size,
    canonicalWaterCells: 96,
    canonicalLandCells: 0,
    fractionalRockSamples,
    minWaterConfidence: Number(minWaterConfidence.toFixed(8)),
    minRockBlend: Number(minRockBlend.toFixed(8)),
    maxRockBlend: Number(maxRockBlend.toFixed(8)),
    rockBlendSpan: Number((maxRockBlend - minRockBlend).toFixed(8)),
    maxAdjacentRockStep: Number(maxAdjacentRockStep.toFixed(8)),
    maxGuardBandRockDelta: Number(maxGuardBandRockDelta.toFixed(8)),
    maxSnowWeight: Number(maxSnowWeight.toFixed(8)),
    surfaceChecksum: checksum,
  });
}

export function buildG17RockSnowProbe() {
  const bounds = G17_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G17_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const sample = sampleG17RockSnow(nx, ny);
      row.push([
        Number(sample.seabedWeight.toFixed(8)),
        Number(sample.rockWeight.toFixed(8)),
        0,
        Number(sample.rockBlend.toFixed(8)),
        Number(sample.height.toFixed(8)),
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    policyId: G17_ROCK_SNOW_POLICY.id,
    sourceMapSha256: G17_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G17',
    layer: G17_ROCK_SNOW_POLICY.layer,
    sourceGridSize: size,
    terrain3dRegionSize: G17_ROCK_SNOW_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G17_ROCK_SNOW_POLICY.terrain3dImportSize,
    seabedTextureId: G17_ROCK_SNOW_POLICY.seabedTextureId,
    rockTextureId: G17_ROCK_SNOW_POLICY.rockTextureId,
    rows,
  });
}
