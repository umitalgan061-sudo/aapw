/**
 * Buzul Muhafızı / NW GeoCell G01 — Near Detail.
 *
 * Near Detail lives only in Terrain3D Color/Roughness. Merged Relief height and
 * Rock/Snow control weights stay unchanged. GeoCell coordinates are traversal
 * addresses only; the detail field is continuous in full owner-map metres.
 */
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
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
  detailWavelengthMeters: Object.freeze([71, 109, 157, 131, 223]),
  tintFloor: 0.90,
  tintCeiling: 1.0,
  roughnessFloor: 0.68,
  roughnessCeiling: 0.94,
});

const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const round8 = (value) => Number(value.toFixed(8));

function physicalCoordinates(normalizedX, normalizedY) {
  return {
    xMeters: normalizedX * FULL_REFERENCE_EXTENT_PLAN.widthMeters,
    zMeters: normalizedY * FULL_REFERENCE_EXTENT_PLAN.depthMeters,
  };
}

/** Continuous detiling signal with no GeoCell, Pindex, mask or source-grid term. */
export function g01NearDetailSignal(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const { xMeters, zMeters } = physicalCoordinates(normalizedX, normalizedY);
  const a = Math.sin(TAU * (xMeters / 71 + zMeters / 109) + 0.413);
  const b = Math.cos(TAU * (xMeters / 157 - zMeters / 131) + 1.173);
  const c = Math.sin(TAU * ((xMeters * 0.59 + zMeters) / 223) + 2.107);
  return 0.44 * a + 0.34 * b + 0.22 * c;
}

export function sampleG01NearDetail(normalizedX, normalizedY) {
  const base = sampleG01RockSnow(normalizedX, normalizedY);
  const micro = g01NearDetailSignal(normalizedX, normalizedY);
  const land = clamp01(base.landFactor);
  const mass = Math.max(1e-9, base.rockWeight + base.snowWeight);
  const rockRatio = land > 1e-9 ? clamp01(base.rockWeight / mass) : 0;
  const snowRatio = land > 1e-9 ? clamp01(base.snowWeight / mass) : 0;

  // Cold NW micro tint. It fades continuously to neutral over canonical water.
  const amplitude = land * (0.010 + 0.006 * rockRatio + 0.004 * snowRatio);
  const authoredR = clamp01(0.974 + amplitude * micro + 0.002 * rockRatio - 0.005 * snowRatio);
  const authoredG = clamp01(0.980 + amplitude * micro - 0.001 * rockRatio + 0.002 * snowRatio);
  const authoredB = clamp01(0.987 + amplitude * micro - 0.002 * rockRatio + 0.005 * snowRatio);
  const tintR = 1 - land * (1 - authoredR);
  const tintG = 1 - land * (1 - authoredG);
  const tintB = 1 - land * (1 - authoredB);
  const landRoughness = clamp01(0.830 + 0.035 * rockRatio - 0.055 * snowRatio + 0.025 * micro);
  const roughness = 0.90 + land * (landRoughness - 0.90);

  return Object.freeze({
    ...base,
    detailSignal: micro,
    tintR: clamp01(tintR),
    tintG: clamp01(tintG),
    tintB: clamp01(tintB),
    roughness: clamp01(roughness),
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
