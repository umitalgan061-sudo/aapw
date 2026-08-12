/**
 * Buzul Muhafızı / NW GeoCell G11 Rock/Snow surface authoring field.
 *
 * G11 bounds are execution addressing only. Surface weights are sampled from
 * the owner-map biome/hydrology contracts in global normalized map space so
 * the final field can cross GeoCell borders without exposing a square seam.
 */

import {
  REFERENCE_BIOME_ZONES,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import { classifyReferenceBaseSurface } from '../../../../src/3d/world/worldReferenceSurfacePindexes.js';
import { G11_HYDROLOGY_POLICY, measureG11Hydrology } from './g11_hydrology.mjs';

export const G11_ROCK_SNOW_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g11-terrain3d-rock-snow-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G11',
  gx: 1,
  gy: 1,
  layer: 'Rock/Snow',
  normalizedBounds: G11_HYDROLOGY_POLICY.normalizedBounds,
  terrain3dRegionSize: 256,
  sourceGridSize: 65,
  rockTextureId: 0,
  snowTextureId: 1,
  guardBandNormalized: 1 / 1536,
});

const SNOW_ZONE = REFERENCE_BIOME_ZONES.find((zone) => zone.id === 'lands-always-winter');
const NORTH_ZONE = REFERENCE_BIOME_ZONES.find((zone) => zone.id === 'north');
const ROCK_ZONES = REFERENCE_BIOME_ZONES.filter((zone) => zone.kind === 'mountain' || zone.kind === 'rocky-hills');

if (!SNOW_ZONE || !NORTH_ZONE) throw new Error('canonical north/snow biome zones are required');

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function isWater(surface) {
  return surface === 'sea' || surface === 'lake' ? 1 : 0;
}

function sampleWaterAtMaskCell(cellX, cellY) {
  const x = Math.max(0, Math.min(95, cellX));
  const y = Math.max(0, Math.min(63, cellY));
  return isWater(classifyReferenceBaseSurface((x + 0.5) / 96, (y + 0.5) / 64));
}

export function sampleGlobalWaterConfidence(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const nx = clamp(normalizedX);
  const ny = clamp(normalizedY);
  const gridX = nx * 96 - 0.5;
  const gridY = ny * 64 - 0.5;
  const x0 = Math.floor(gridX);
  const y0 = Math.floor(gridY);
  const tx = gridX - x0;
  const ty = gridY - y0;
  const w00 = sampleWaterAtMaskCell(x0, y0);
  const w10 = sampleWaterAtMaskCell(x0 + 1, y0);
  const w01 = sampleWaterAtMaskCell(x0, y0 + 1);
  const w11 = sampleWaterAtMaskCell(x0 + 1, y0 + 1);
  const top = w00 + (w10 - w00) * tx;
  const bottom = w01 + (w11 - w01) * tx;
  return clamp(top + (bottom - top) * ty);
}

function sampleElevationSignal(normalizedX, normalizedY) {
  let weighted = 0;
  let total = 0;
  for (const zone of REFERENCE_BIOME_ZONES) {
    const influence = sampleReferenceInfluence(normalizedX, normalizedY, zone);
    if (influence <= 0) continue;
    weighted += influence * Math.max(0, zone.elevationBias ?? 0);
    total += influence;
  }
  return total > 0 ? clamp(weighted / total) : 0;
}

function sampleExposure(normalizedX, normalizedY) {
  // Macro exposure is intentionally measured across four owner-map source pixels.
  // A one-pixel derivative reacted too sharply to biome-support boundaries and
  // produced a material seam that did not represent a real terrain feature.
  const dx = 4 / 1536;
  const dy = 4 / 1024;
  const left = sampleElevationSignal(clamp(normalizedX - dx), normalizedY);
  const right = sampleElevationSignal(clamp(normalizedX + dx), normalizedY);
  const up = sampleElevationSignal(normalizedX, clamp(normalizedY - dy));
  const down = sampleElevationSignal(normalizedX, clamp(normalizedY + dy));
  const gx = (right - left) / (2 * dx);
  const gy = (down - up) / (2 * dy);
  return clamp(Math.hypot(gx, gy) / 12);
}

function sampleRockClimate(normalizedX, normalizedY) {
  let strongest = 0;
  for (const zone of ROCK_ZONES) {
    strongest = Math.max(strongest, sampleReferenceInfluence(normalizedX, normalizedY, zone));
  }
  return strongest;
}

export function sampleG11RockSnow(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const water = sampleGlobalWaterConfidence(normalizedX, normalizedY);
  const landFactor = 1 - smoothstep(0.38, 0.62, water);
  const snowClimate = sampleReferenceInfluence(normalizedX, normalizedY, SNOW_ZONE);
  const coldClimate = sampleReferenceInfluence(normalizedX, normalizedY, NORTH_ZONE);
  const rockClimate = sampleRockClimate(normalizedX, normalizedY);
  const elevation = sampleElevationSignal(normalizedX, normalizedY);
  const exposure = sampleExposure(normalizedX, normalizedY);

  // Material choice is a broad owner-map climate preference, not a ratio of two
  // coverage values. Coverage fades independently through hydrology, preventing
  // a shoreline from turning into a rock/snow control-map discontinuity.
  const snowPreference = clamp(
    0.06
      + 0.74 * snowClimate
      + 0.20 * coldClimate
      + 0.10 * elevation
      - 0.08 * rockClimate
      - 0.06 * exposure,
  );
  const snowBlend = 0.08 + 0.84 * smoothstep(0.08, 0.86, snowPreference);
  const snowSignal = snowBlend;
  const rockSignal = 1 - snowBlend;
  const snowWeight = landFactor * snowSignal;
  const rockWeight = landFactor * rockSignal;

  return Object.freeze({
    waterConfidence: water,
    landFactor,
    rockWeight,
    snowWeight,
    snowBlend,
    snowSignal,
    rockSignal,
    elevation,
    exposure,
  });
}

function fnv1a(checksum, value) {
  checksum ^= value & 0xff;
  return Math.imul(checksum, 16777619) >>> 0;
}

export function measureG11RockSnow() {
  const hydrology = measureG11Hydrology();
  const { xMin, xMax, yMin, yMax } = G11_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G11_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  let maxAdjacentBlendStep = 0;
  let maxGuardBandBlendDelta = 0;
  let maxWaterSnowLeak = 0;
  let fractionalBlendSamples = 0;
  let snowDominantSamples = 0;
  let rockDominantSamples = 0;
  let checksum = 2166136261;

  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const sample = sampleG11RockSnow(nx, ny);
      if (sample.snowBlend > 0 && sample.snowBlend < 1) fractionalBlendSamples += 1;
      if (sample.snowSignal > sample.rockSignal) snowDominantSamples += 1;
      else if (sample.rockSignal > sample.snowSignal) rockDominantSamples += 1;
      checksum = fnv1a(checksum, Math.round(sample.rockWeight * 255));
      checksum = fnv1a(checksum, Math.round(sample.snowWeight * 255));
      checksum = fnv1a(checksum, Math.round(sample.snowBlend * 255));
      row.push(sample);
    }
    rows.push(row);
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const blend = rows[y][x].snowBlend;
      if (x + 1 < size) maxAdjacentBlendStep = Math.max(maxAdjacentBlendStep, Math.abs(blend - rows[y][x + 1].snowBlend));
      if (y + 1 < size) maxAdjacentBlendStep = Math.max(maxAdjacentBlendStep, Math.abs(blend - rows[y + 1][x].snowBlend));
    }
  }

  const guard = G11_ROCK_SNOW_POLICY.guardBandNormalized;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const nx = xMin + (xMax - xMin) * t;
    const ny = yMin + (yMax - yMin) * t;
    const northInside = sampleG11RockSnow(nx, yMin).snowBlend;
    const northOutside = sampleG11RockSnow(nx, yMin - guard).snowBlend;
    const southInside = sampleG11RockSnow(nx, yMax).snowBlend;
    const southOutside = sampleG11RockSnow(nx, yMax + guard).snowBlend;
    const westInside = sampleG11RockSnow(xMin, ny).snowBlend;
    const westOutside = sampleG11RockSnow(xMin - guard, ny).snowBlend;
    const eastInside = sampleG11RockSnow(xMax, ny).snowBlend;
    const eastOutside = sampleG11RockSnow(xMax + guard, ny).snowBlend;
    maxGuardBandBlendDelta = Math.max(
      maxGuardBandBlendDelta,
      Math.abs(northInside - northOutside),
      Math.abs(southInside - southOutside),
      Math.abs(westInside - westOutside),
      Math.abs(eastInside - eastOutside),
    );
  }

  const mask = G11_HYDROLOGY_POLICY.maskBounds;
  for (let maskY = mask.yMin; maskY <= mask.yMax; maskY += 1) {
    for (let maskX = mask.xMin; maskX <= mask.xMax; maskX += 1) {
      const nx = (maskX + 0.5) / 96;
      const ny = (maskY + 0.5) / 64;
      const canonicalWater = sampleWaterAtMaskCell(maskX, maskY);
      if (canonicalWater) maxWaterSnowLeak = Math.max(maxWaterSnowLeak, sampleG11RockSnow(nx, ny).snowWeight);
    }
  }

  return Object.freeze({
    policyId: G11_ROCK_SNOW_POLICY.id,
    sourceMapSha256: G11_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G11',
    layer: 'Rock/Snow',
    sourceGridSize: size,
    sourceSamples: size * size,
    terrain3dRegionSize: G11_ROCK_SNOW_POLICY.terrain3dRegionSize,
    hydrologyFingerprint: Object.freeze({
      waterCells: hydrology.waterCells,
      landCells: hydrology.landCells,
      boundaryEdges: hydrology.boundaryEdges,
      centreMismatches: hydrology.centreMismatches,
    }),
    fractionalBlendSamples,
    snowDominantSamples,
    rockDominantSamples,
    maxAdjacentBlendStep: Number(maxAdjacentBlendStep.toFixed(8)),
    maxGuardBandBlendDelta: Number(maxGuardBandBlendDelta.toFixed(8)),
    maxWaterSnowLeak: Number(maxWaterSnowLeak.toFixed(8)),
    surfaceChecksum: checksum,
  });
}

export function buildG11RockSnowProbe() {
  const { xMin, xMax, yMin, yMax } = G11_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G11_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const sample = sampleG11RockSnow(nx, ny);
      row.push([
        Number(sample.rockWeight.toFixed(8)),
        Number(sample.snowWeight.toFixed(8)),
        Number(sample.snowBlend.toFixed(8)),
        Number(sample.landFactor.toFixed(8)),
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    policyId: G11_ROCK_SNOW_POLICY.id,
    sourceMapSha256: G11_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G11',
    layer: 'Rock/Snow',
    sourceGridSize: size,
    terrain3dRegionSize: G11_ROCK_SNOW_POLICY.terrain3dRegionSize,
    rockTextureId: G11_ROCK_SNOW_POLICY.rockTextureId,
    snowTextureId: G11_ROCK_SNOW_POLICY.snowTextureId,
    rows,
  });
}
