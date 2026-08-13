/**
 * Kızıl Ufuk / SE GeoCell G65 — Rock/Snow surface authoring.
 *
 * GeoCell bounds are execution addressing only. Surface weights are evaluated
 * continuously in global owner-map space and inherit the merged physical G65
 * relief field, so no square-cell term enters the Terrain3D material result.
 */
import {
  REFERENCE_BIOME_ZONES,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import { sampleG65WaterConfidence } from './g65_hydrology.mjs';
import {
  G65_RELIEF_POLICY,
  sampleG65ReliefHeight,
  sampleG65ReliefNormal,
} from './g65_relief.mjs';

export const G65_ROCK_SNOW_POLICY = Object.freeze({
  id: 'kizil-ufuk-g65-terrain3d-rock-snow-2026-08-13-v1',
  sourceMapSha256: G65_RELIEF_POLICY.sourceMapSha256,
  geoCell: 'G65',
  gx: 6,
  gy: 5,
  layer: 'Rock/Snow',
  normalizedBounds: G65_RELIEF_POLICY.normalizedBounds,
  maskBounds: G65_RELIEF_POLICY.maskBounds,
  sourceGridSize: 65,
  terrain3dRegionSize: 256,
  terrain3dImportSize: 257,
  groundTextureId: 0,
  rockTextureId: 1,
  guardBandNormalized: 1 / 1536,
});

const ROCK_ZONES = REFERENCE_BIOME_ZONES.filter((zone) =>
  zone.kind === 'mountain'
    || zone.kind === 'rocky-hills'
    || zone.kind === 'desert'
    || zone.kind === 'arid',
);
const COLD_ZONES = REFERENCE_BIOME_ZONES.filter((zone) =>
  zone.id === 'lands-always-winter'
    || zone.id === 'north'
    || zone.kind === 'snow'
    || zone.kind === 'tundra',
);

const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function strongestInfluence(zones, nx, ny) {
  let strongest = 0;
  for (const zone of zones) strongest = Math.max(strongest, sampleReferenceInfluence(nx, ny, zone));
  return strongest;
}
function reliefSlope(normal) {
  return clamp(Math.hypot(normal.x, normal.z) / Math.max(0.000001, normal.y));
}

export function sampleG65RockSnow(nx, ny) {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new TypeError('normalized coordinates must be finite');
  const waterConfidence = sampleG65WaterConfidence(nx, ny);
  const landFactor = 1 - smoothstep(0.38, 0.62, waterConfidence);
  const height = sampleG65ReliefHeight(nx, ny);
  const normal = sampleG65ReliefNormal(nx, ny);
  const slope = reliefSlope(normal);
  const rockClimate = strongestInfluence(ROCK_ZONES, nx, ny);
  const coldClimate = strongestInfluence(COLD_ZONES, nx, ny);
  const elevationSignal = smoothstep(8, 62, height);
  const slopeSignal = smoothstep(0.035, 0.28, slope);

  const rockBlend = landFactor * clamp(
    0.10
      + 0.48 * rockClimate
      + 0.24 * slopeSignal
      + 0.18 * elevationSignal,
  );

  // Southeast G65 may expose rock, but elevation alone must never invent snow.
  // Snow requires both canonical cold-climate support and sufficient elevation.
  const snowWeight = landFactor
    * smoothstep(0.28, 0.82, coldClimate)
    * smoothstep(24, 74, height)
    * (0.65 + 0.35 * smoothstep(0.02, 0.20, slope));

  const rockWeight = rockBlend * (1 - snowWeight);
  const groundWeight = landFactor * (1 - rockBlend) * (1 - snowWeight);

  return Object.freeze({
    waterConfidence,
    landFactor,
    height,
    slope,
    rockClimate,
    coldClimate,
    elevationSignal,
    slopeSignal,
    rockBlend,
    rockWeight,
    snowWeight,
    groundWeight,
  });
}

function fnv1a(sum, value) {
  return Math.imul((sum ^ (value & 0xff)) >>> 0, 16777619) >>> 0;
}

export function measureG65RockSnow() {
  const bounds = G65_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G65_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  let minRockBlend = Infinity;
  let maxRockBlend = -Infinity;
  let maxSnowWeight = 0;
  let fractionalRockSamples = 0;
  let rockDominantSamples = 0;
  let maxAdjacentRockStep = 0;
  let maxGuardBandRockDelta = 0;
  let checksum = 2166136261;

  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const sample = sampleG65RockSnow(nx, ny);
      minRockBlend = Math.min(minRockBlend, sample.rockBlend);
      maxRockBlend = Math.max(maxRockBlend, sample.rockBlend);
      maxSnowWeight = Math.max(maxSnowWeight, sample.snowWeight);
      if (sample.rockBlend > 0.001 && sample.rockBlend < 0.999) fractionalRockSamples += 1;
      if (sample.rockWeight > sample.groundWeight) rockDominantSamples += 1;
      checksum = fnv1a(checksum, Math.round(sample.rockBlend * 255));
      checksum = fnv1a(checksum, Math.round(sample.snowWeight * 255));
      row.push(sample);
    }
    rows.push(row);
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const blend = rows[y][x].rockBlend;
      if (x + 1 < size) maxAdjacentRockStep = Math.max(maxAdjacentRockStep, Math.abs(blend - rows[y][x + 1].rockBlend));
      if (y + 1 < size) maxAdjacentRockStep = Math.max(maxAdjacentRockStep, Math.abs(blend - rows[y + 1][x].rockBlend));
    }
  }

  const guard = G65_ROCK_SNOW_POLICY.guardBandNormalized;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * t;
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * t;
    const pairs = [
      [nx, bounds.yMin, nx, bounds.yMin - guard],
      [nx, bounds.yMax, nx, bounds.yMax + guard],
      [bounds.xMin, ny, bounds.xMin - guard, ny],
      [bounds.xMax, ny, bounds.xMax + guard, ny],
    ];
    for (const [ax, ay, bx, by] of pairs) {
      maxGuardBandRockDelta = Math.max(
        maxGuardBandRockDelta,
        Math.abs(sampleG65RockSnow(ax, ay).rockBlend - sampleG65RockSnow(bx, by).rockBlend),
      );
    }
  }

  let canonicalWaterCells = 0;
  let canonicalLandCells = 0;
  let maxCanonicalWaterSurfaceLeak = 0;
  const mask = G65_ROCK_SNOW_POLICY.maskBounds;
  for (let y = mask.yMin; y <= mask.yMax; y += 1) {
    for (let x = mask.xMin; x <= mask.xMax; x += 1) {
      const nx = (x + 0.5) / 96;
      const ny = (y + 0.5) / 64;
      const sample = sampleG65RockSnow(nx, ny);
      if (sample.waterConfidence >= 0.5) {
        canonicalWaterCells += 1;
        maxCanonicalWaterSurfaceLeak = Math.max(maxCanonicalWaterSurfaceLeak, sample.rockWeight + sample.snowWeight);
      } else canonicalLandCells += 1;
    }
  }

  return Object.freeze({
    policyId: G65_ROCK_SNOW_POLICY.id,
    sourceMapSha256: G65_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G65',
    layer: G65_ROCK_SNOW_POLICY.layer,
    sourceGridSize: size,
    sourceSamples: size * size,
    terrain3dRegionSize: G65_ROCK_SNOW_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G65_ROCK_SNOW_POLICY.terrain3dImportSize,
    canonicalWaterCells,
    canonicalLandCells,
    fractionalRockSamples,
    rockDominantSamples,
    minRockBlend: Number(minRockBlend.toFixed(8)),
    maxRockBlend: Number(maxRockBlend.toFixed(8)),
    rockBlendSpan: Number((maxRockBlend - minRockBlend).toFixed(8)),
    maxSnowWeight: Number(maxSnowWeight.toFixed(8)),
    maxAdjacentRockStep: Number(maxAdjacentRockStep.toFixed(8)),
    maxGuardBandRockDelta: Number(maxGuardBandRockDelta.toFixed(8)),
    maxCanonicalWaterSurfaceLeak: Number(maxCanonicalWaterSurfaceLeak.toFixed(8)),
    surfaceChecksum: checksum,
  });
}

export function buildG65RockSnowProbe() {
  const bounds = G65_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G65_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const s = sampleG65RockSnow(nx, ny);
      row.push([
        Number(s.groundWeight.toFixed(8)),
        Number(s.rockWeight.toFixed(8)),
        Number(s.snowWeight.toFixed(8)),
        Number(s.rockBlend.toFixed(8)),
        Number(s.height.toFixed(6)),
        Number(s.slope.toFixed(8)),
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    policyId: G65_ROCK_SNOW_POLICY.id,
    sourceMapSha256: G65_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G65',
    layer: G65_ROCK_SNOW_POLICY.layer,
    sourceGridSize: size,
    terrain3dRegionSize: G65_ROCK_SNOW_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G65_ROCK_SNOW_POLICY.terrain3dImportSize,
    groundTextureId: G65_ROCK_SNOW_POLICY.groundTextureId,
    rockTextureId: G65_ROCK_SNOW_POLICY.rockTextureId,
    rows,
  });
}
