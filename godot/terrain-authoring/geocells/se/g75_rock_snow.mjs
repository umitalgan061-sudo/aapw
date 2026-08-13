/**
 * Kızıl Ufuk / SE GeoCell G75 — Rock/Snow surface authoring.
 *
 * GeoCell bounds are execution addressing only. Surface weights are sampled in
 * global owner-map space and from the merged physical G75 relief field so no
 * square-cell term can appear at the final Terrain3D surface boundary.
 */
import {
  REFERENCE_BIOME_ZONES,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import {
  G75_RELIEF_POLICY,
  sampleCanonicalWaterConfidence,
  sampleG75ReliefHeight,
  sampleG75ReliefNormal,
} from './g75_relief.mjs';

export const G75_ROCK_SNOW_POLICY = Object.freeze({
  id: 'kizil-ufuk-g75-terrain3d-rock-snow-2026-08-13-v1',
  sourceMapSha256: G75_RELIEF_POLICY.sourceMapSha256,
  geoCell: 'G75',
  gx: 7,
  gy: 5,
  layer: 'Rock/Snow',
  normalizedBounds: G75_RELIEF_POLICY.normalizedBounds,
  maskBounds: G75_RELIEF_POLICY.maskBounds,
  terrain3dRegionSize: 256,
  sourceGridSize: 65,
  groundTextureId: 0,
  rockTextureId: 1,
  guardBandNormalized: 1 / 1536,
});

const ROCK_ZONES = REFERENCE_BIOME_ZONES.filter((zone) =>
  zone.kind === 'mountain' || zone.kind === 'rocky-hills' || zone.kind === 'desert' || zone.kind === 'arid',
);
const COLD_ZONES = REFERENCE_BIOME_ZONES.filter((zone) =>
  zone.id === 'lands-always-winter' || zone.id === 'north' || zone.kind === 'snow' || zone.kind === 'tundra',
);

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
function smoothstep(a, b, v) {
  if (b <= a) return v >= b ? 1 : 0;
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function strongestInfluence(zones, nx, ny) {
  let strongest = 0;
  for (const zone of zones) {
    strongest = Math.max(strongest, sampleReferenceInfluence(nx, ny, zone));
  }
  return strongest;
}

function reliefSlope(normal) {
  return clamp(Math.hypot(normal.x, normal.z) / Math.max(0.000001, normal.y));
}

export function sampleG75RockSnow(nx, ny) {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new TypeError('normalized coordinates must be finite');
  const water = sampleCanonicalWaterConfidence(nx, ny);
  const landFactor = 1 - smoothstep(0.38, 0.62, water);
  const height = sampleG75ReliefHeight(nx, ny);
  const normal = sampleG75ReliefNormal(nx, ny);
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

  const snowWeight = landFactor
    * smoothstep(0.28, 0.82, coldClimate)
    * smoothstep(24, 74, height)
    * (0.65 + 0.35 * smoothstep(0.02, 0.20, slope));

  const rockWeight = rockBlend * (1 - snowWeight);
  const groundWeight = landFactor * (1 - rockBlend) * (1 - snowWeight);

  return Object.freeze({
    waterConfidence: water,
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

export function measureG75RockSnow() {
  const bounds = G75_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G75_ROCK_SNOW_POLICY.sourceGridSize;
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
      const sample = sampleG75RockSnow(nx, ny);
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

  const g = G75_ROCK_SNOW_POLICY.guardBandNormalized;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * t;
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * t;
    const pairs = [
      [nx, bounds.yMin, nx, bounds.yMin - g],
      [nx, bounds.yMax, nx, bounds.yMax + g],
      [bounds.xMin, ny, bounds.xMin - g, ny],
      [bounds.xMax, ny, bounds.xMax + g, ny],
    ];
    for (const [ax, ay, bx, by] of pairs) {
      maxGuardBandRockDelta = Math.max(
        maxGuardBandRockDelta,
        Math.abs(sampleG75RockSnow(ax, ay).rockBlend - sampleG75RockSnow(bx, by).rockBlend),
      );
    }
  }

  let canonicalWaterCells = 0;
  let canonicalLandCells = 0;
  let maxCanonicalWaterSurfaceLeak = 0;
  const m = G75_ROCK_SNOW_POLICY.maskBounds;
  for (let y = m.yMin; y <= m.yMax; y += 1) {
    for (let x = m.xMin; x <= m.xMax; x += 1) {
      const nx = (x + 0.5) / 96;
      const ny = (y + 0.5) / 64;
      const sample = sampleG75RockSnow(nx, ny);
      if (sample.waterConfidence >= 0.5) {
        canonicalWaterCells += 1;
        maxCanonicalWaterSurfaceLeak = Math.max(maxCanonicalWaterSurfaceLeak, sample.rockWeight + sample.snowWeight);
      } else canonicalLandCells += 1;
    }
  }

  return Object.freeze({
    policyId: G75_ROCK_SNOW_POLICY.id,
    sourceMapSha256: G75_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G75',
    layer: G75_ROCK_SNOW_POLICY.layer,
    sourceGridSize: size,
    sourceSamples: size * size,
    terrain3dRegionSize: G75_ROCK_SNOW_POLICY.terrain3dRegionSize,
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

export function buildG75RockSnowProbe() {
  const bounds = G75_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G75_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const s = sampleG75RockSnow(nx, ny);
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
    policyId: G75_ROCK_SNOW_POLICY.id,
    sourceMapSha256: G75_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G75',
    layer: G75_ROCK_SNOW_POLICY.layer,
    sourceGridSize: size,
    terrain3dRegionSize: G75_ROCK_SNOW_POLICY.terrain3dRegionSize,
    groundTextureId: G75_ROCK_SNOW_POLICY.groundTextureId,
    rockTextureId: G75_ROCK_SNOW_POLICY.rockTextureId,
    rows,
  });
}
