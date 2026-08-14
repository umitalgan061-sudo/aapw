/**
 * Buzul Muhafızı / NW GeoCell G01 — Near Detail.
 *
 * Near Detail lives only in Terrain3D Color/Roughness. Merged Relief height and
 * Rock/Snow control weights stay unchanged. GeoCell coordinates are traversal
 * addresses only; the detail field inherits G00's qualified global-metre phase
 * so the shared G00/G01 boundary cannot reveal a cell seam.
 */
import { g00NearDetailSignal } from './g00_near_detail.mjs';
import { sampleG00RockSnow } from './g00_rock_snow.mjs';
import {
  G01_ROCK_SNOW_POLICY,
  sampleG01RockSnow,
} from './g01_rock_snow.mjs';

export const G01_NEAR_DETAIL_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g01-terrain3d-near-detail-2026-08-14-v1',
  sourceMapSha256: G01_ROCK_SNOW_POLICY.sourceMapSha256,
  geoCell: 'G01',
  gx: 0,
  gy: 1,
  layer: 'Near Detail',
  normalizedBounds: G01_ROCK_SNOW_POLICY.normalizedBounds,
  maskBounds: G01_ROCK_SNOW_POLICY.maskBounds,
  sourceGridSize: 129,
  terrain3dRegionSize: 256,
  terrain3dImportSize: 257,
  rockTextureId: G01_ROCK_SNOW_POLICY.rockTextureId,
  snowTextureId: G01_ROCK_SNOW_POLICY.snowTextureId,
  roadTextureId: 2,
  pathTextureId: 3,
  guardBandNormalized: 1 / 1536,
  detailWavelengthMeters: Object.freeze([53, 79, 97, 61, 149]),
  tintFloor: 0.90,
  tintCeiling: 1.0,
  roughnessFloor: 0.68,
  roughnessCeiling: 0.94,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const round8 = (value) => Number(value.toFixed(8));

/**
 * Reuse the qualified G00 physical-metre phase instead of restarting a per-cell
 * procedural field. G00's checker already forbids grid/Pindex terms here.
 */
export function g01NearDetailSignal(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  return g00NearDetailSignal(normalizedX, normalizedY);
}

/** G00-compatible no-road surface equation used on the shared NW field. */
function surfaceDetail(substrate, detailSignal) {
  const land = clamp01(substrate.landFactor);
  const mass = Math.max(1e-9, substrate.rockWeight + substrate.snowWeight);
  const rockRatio = land > 1e-9 ? clamp01(substrate.rockWeight / mass) : 0;
  const snowRatio = land > 1e-9 ? clamp01(substrate.snowWeight / mass) : 0;
  const tintAmplitude = land * (0.010 + 0.010 * rockRatio + 0.004 * (1 - snowRatio));
  const authoredR = clamp01(0.973 + tintAmplitude * detailSignal + 0.004 * rockRatio - 0.004 * snowRatio);
  const authoredG = clamp01(0.968 + tintAmplitude * detailSignal + 0.002 * rockRatio);
  const authoredB = clamp01(0.962 + tintAmplitude * detailSignal - 0.004 * rockRatio + 0.007 * snowRatio);
  const tintR = 1 - land * (1 - authoredR);
  const tintG = 1 - land * (1 - authoredG);
  const tintB = 1 - land * (1 - authoredB);
  const landRoughness = clamp01(0.842 + 0.045 * (1 - rockRatio) - 0.025 * snowRatio + 0.030 * detailSignal);
  const roughness = 0.90 + land * (landRoughness - 0.90);
  return Object.freeze({
    tintR: clamp01(tintR),
    tintG: clamp01(tintG),
    tintB: clamp01(tintB),
    roughness: clamp01(roughness),
  });
}

export function sampleG01NearDetail(normalizedX, normalizedY) {
  const base = sampleG01RockSnow(normalizedX, normalizedY);
  const detailSignal = g01NearDetailSignal(normalizedX, normalizedY);
  return Object.freeze({
    ...base,
    detailSignal,
    ...surfaceDetail(base, detailSignal),
  });
}

function fnv1a(checksum, value) {
  checksum ^= value & 0xff;
  return Math.imul(checksum, 16777619) >>> 0;
}

function maxTintDelta(a, b) {
  return Math.max(
    Math.abs(a.tintR - b.tintR),
    Math.abs(a.tintG - b.tintG),
    Math.abs(a.tintB - b.tintB),
  );
}

function measureSharedG00Seam() {
  const { xMin, xMax, yMin } = G01_NEAR_DETAIL_POLICY.normalizedBounds;
  let maxTintDeltaValue = 0;
  let maxRoughnessDelta = 0;
  for (let i = 0; i < 129; i += 1) {
    const nx = xMin + (xMax - xMin) * (i / 128);
    const signal = g01NearDetailSignal(nx, yMin);
    const g01 = surfaceDetail(sampleG01RockSnow(nx, yMin), signal);
    const g00 = surfaceDetail(sampleG00RockSnow(nx, yMin), signal);
    maxTintDeltaValue = Math.max(maxTintDeltaValue, maxTintDelta(g01, g00));
    maxRoughnessDelta = Math.max(maxRoughnessDelta, Math.abs(g01.roughness - g00.roughness));
  }
  return Object.freeze({
    maxTintDelta: round8(maxTintDeltaValue),
    maxRoughnessDelta: round8(maxRoughnessDelta),
  });
}

export function measureG01NearDetail() {
  const { xMin, xMax, yMin, yMax } = G01_NEAR_DETAIL_POLICY.normalizedBounds;
  const size = G01_NEAR_DETAIL_POLICY.sourceGridSize;
  const guard = G01_NEAR_DETAIL_POLICY.guardBandNormalized;
  let minTint = 1;
  let maxTint = 0;
  let minRoughness = 1;
  let maxRoughness = 0;
  let maxAdjacentTintDelta = 0;
  let maxAdjacentRoughnessDelta = 0;
  let maxGuardBandTintDelta = 0;
  let maxGuardBandRoughnessDelta = 0;
  let maxHeightDeltaMeters = 0;
  let maxControlDelta = 0;
  let maxCanonicalWaterTintDelta = 0;
  let maxCanonicalWaterRoughnessDelta = 0;
  let landDetailSamples = 0;
  let canonicalWaterCells = 0;
  let canonicalLandCells = 0;
  let checksum = 2166136261;
  let previousRow = null;

  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const before = sampleG01RockSnow(nx, ny);
      const sample = sampleG01NearDetail(nx, ny);
      minTint = Math.min(minTint, sample.tintR, sample.tintG, sample.tintB);
      maxTint = Math.max(maxTint, sample.tintR, sample.tintG, sample.tintB);
      minRoughness = Math.min(minRoughness, sample.roughness);
      maxRoughness = Math.max(maxRoughness, sample.roughness);
      maxHeightDeltaMeters = Math.max(maxHeightDeltaMeters, Math.abs(sample.heightMeters - before.heightMeters));
      maxControlDelta = Math.max(
        maxControlDelta,
        Math.abs(sample.rockWeight - before.rockWeight),
        Math.abs(sample.snowWeight - before.snowWeight),
        Math.abs(sample.snowBlend - before.snowBlend),
        Math.abs(sample.landFactor - before.landFactor),
        Math.abs(sample.waterConfidence - before.waterConfidence),
      );
      if (sample.landFactor > 0.05 && maxTintDelta(sample, { tintR: 1, tintG: 1, tintB: 1 }) > 0.0001) {
        landDetailSamples += 1;
      }
      if (x > 0) {
        maxAdjacentTintDelta = Math.max(maxAdjacentTintDelta, maxTintDelta(sample, row[x - 1]));
        maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(sample.roughness - row[x - 1].roughness));
      }
      if (previousRow) {
        maxAdjacentTintDelta = Math.max(maxAdjacentTintDelta, maxTintDelta(sample, previousRow[x]));
        maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(sample.roughness - previousRow[x].roughness));
      }
      for (const value of [sample.tintR, sample.tintG, sample.tintB, sample.roughness]) {
        checksum = fnv1a(checksum, Math.round(value * 255));
      }
      row.push(sample);
    }
    previousRow = row;
  }

  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const nx = xMin + (xMax - xMin) * t;
    const ny = yMin + (yMax - yMin) * t;
    const pairs = [
      [sampleG01NearDetail(nx, yMin), sampleG01NearDetail(nx, yMin - guard)],
      [sampleG01NearDetail(nx, yMax), sampleG01NearDetail(nx, yMax + guard)],
      [sampleG01NearDetail(xMin, ny), sampleG01NearDetail(xMin - guard, ny)],
      [sampleG01NearDetail(xMax, ny), sampleG01NearDetail(xMax + guard, ny)],
    ];
    for (const [a, b] of pairs) {
      maxGuardBandTintDelta = Math.max(maxGuardBandTintDelta, maxTintDelta(a, b));
      maxGuardBandRoughnessDelta = Math.max(maxGuardBandRoughnessDelta, Math.abs(a.roughness - b.roughness));
    }
  }

  const mask = G01_NEAR_DETAIL_POLICY.maskBounds;
  for (let y = mask.yMin; y <= mask.yMax; y += 1) {
    for (let x = mask.xMin; x <= mask.xMax; x += 1) {
      const sample = sampleG01NearDetail((x + 0.5) / 96, (y + 0.5) / 64);
      if (sample.waterConfidence >= 0.5) canonicalWaterCells += 1;
      else canonicalLandCells += 1;
      if (sample.waterConfidence < 0.999999) continue;
      maxCanonicalWaterTintDelta = Math.max(
        maxCanonicalWaterTintDelta,
        Math.abs(sample.tintR - 1), Math.abs(sample.tintG - 1), Math.abs(sample.tintB - 1),
      );
      maxCanonicalWaterRoughnessDelta = Math.max(maxCanonicalWaterRoughnessDelta, Math.abs(sample.roughness - 0.90));
    }
  }

  const sharedG00Seam = measureSharedG00Seam();
  return Object.freeze({
    policyId: G01_NEAR_DETAIL_POLICY.id,
    sourceMapSha256: G01_NEAR_DETAIL_POLICY.sourceMapSha256,
    geoCell: G01_NEAR_DETAIL_POLICY.geoCell,
    layer: G01_NEAR_DETAIL_POLICY.layer,
    sourceGridSize: size,
    sourceSamples: size * size,
    terrain3dRegionSize: G01_NEAR_DETAIL_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G01_NEAR_DETAIL_POLICY.terrain3dImportSize,
    canonicalWaterCells,
    canonicalLandCells,
    landDetailSamples,
    minTint: round8(minTint),
    maxTint: round8(maxTint),
    minRoughness: round8(minRoughness),
    maxRoughness: round8(maxRoughness),
    maxAdjacentTintDelta: round8(maxAdjacentTintDelta),
    maxAdjacentRoughnessDelta: round8(maxAdjacentRoughnessDelta),
    maxGuardBandTintDelta: round8(maxGuardBandTintDelta),
    maxGuardBandRoughnessDelta: round8(maxGuardBandRoughnessDelta),
    maxHeightDeltaMeters: round8(maxHeightDeltaMeters),
    maxControlDelta: round8(maxControlDelta),
    maxCanonicalWaterTintDelta: round8(maxCanonicalWaterTintDelta),
    maxCanonicalWaterRoughnessDelta: round8(maxCanonicalWaterRoughnessDelta),
    maxG00SharedSeamTintDelta: sharedG00Seam.maxTintDelta,
    maxG00SharedSeamRoughnessDelta: sharedG00Seam.maxRoughnessDelta,
    detailChecksum: checksum,
  });
}

export function buildG01NearDetailProbe() {
  const metrics = measureG01NearDetail();
  const bounds = G01_NEAR_DETAIL_POLICY.normalizedBounds;
  const size = G01_NEAR_DETAIL_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const sample = sampleG01NearDetail(nx, ny);
      row.push([
        Number(sample.rockWeight.toFixed(8)),
        Number(sample.snowWeight.toFixed(8)),
        Number(sample.heightMeters.toFixed(6)),
        Number(sample.waterConfidence.toFixed(8)),
        Number(sample.landFactor.toFixed(8)),
        Number(sample.tintR.toFixed(8)),
        Number(sample.tintG.toFixed(8)),
        Number(sample.tintB.toFixed(8)),
        Number(sample.roughness.toFixed(8)),
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    ...metrics,
    rockTextureId: G01_NEAR_DETAIL_POLICY.rockTextureId,
    snowTextureId: G01_NEAR_DETAIL_POLICY.snowTextureId,
    roadTextureId: G01_NEAR_DETAIL_POLICY.roadTextureId,
    pathTextureId: G01_NEAR_DETAIL_POLICY.pathTextureId,
    rows,
  });
}
