/**
 * Kızıl Ufuk / SE GeoCell G75 — Near Detail authoring.
 *
 * Near detail is authored in Terrain3D's independent color map so the merged
 * Relief height and Rock/Snow control map survive byte-for-byte in meaning.
 * All variation is a continuous function of full owner-map coordinates in
 * physical metres. GeoCell bounds are used only by QA/probe traversal.
 */
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import {
  G75_ROAD_PATH_POLICY,
  sampleG75RoadPath,
} from './g75_road_path.mjs';

export const G75_NEAR_DETAIL_POLICY = Object.freeze({
  id: 'kizil-ufuk-g75-terrain3d-near-detail-2026-08-13-v1',
  sourceMapSha256: G75_ROAD_PATH_POLICY.sourceMapSha256,
  geoCell: 'G75',
  gx: 7,
  gy: 5,
  layer: 'Near Detail',
  normalizedBounds: G75_ROAD_PATH_POLICY.normalizedBounds,
  maskBounds: G75_ROAD_PATH_POLICY.maskBounds,
  sourceGridSize: 129,
  terrain3dRegionSize: 256,
  groundTextureId: G75_ROAD_PATH_POLICY.groundTextureId,
  rockTextureId: G75_ROAD_PATH_POLICY.rockTextureId,
  roadTextureId: G75_ROAD_PATH_POLICY.roadTextureId,
  pathTextureId: G75_ROAD_PATH_POLICY.pathTextureId,
  guardBandNormalized: 1 / 65536,
  detailWavelengthMeters: Object.freeze([47, 71, 83, 59, 131]),
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

/**
 * Continuous, cell-edge-independent detiling signal. Frequencies are expressed
 * in physical metres so the character does not change when QA grid density does.
 */
export function g75NearDetailSignal(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const { xMeters, zMeters } = physicalCoordinates(normalizedX, normalizedY);
  const a = Math.sin(TAU * (xMeters / 47 + zMeters / 71));
  const b = Math.cos(TAU * (xMeters / 83 - zMeters / 59) + 1.713);
  const c = Math.sin(TAU * ((xMeters + zMeters * 0.37) / 131) + 0.421);
  return 0.48 * a + 0.32 * b + 0.20 * c;
}

export function sampleG75NearDetail(normalizedX, normalizedY) {
  const base = sampleG75RoadPath(normalizedX, normalizedY);
  const micro = g75NearDetailSignal(normalizedX, normalizedY);
  const dry = clamp01(1 - base.waterConfidence);
  const rock = clamp01(base.rockBlend);
  const ground = clamp01(1 - rock);
  const tintAmplitude = dry * (0.013 + 0.010 * rock);
  const tintR = clamp01(0.972 + tintAmplitude * micro + 0.004 * ground);
  const tintG = clamp01(0.962 + tintAmplitude * micro);
  const tintB = clamp01(0.948 + tintAmplitude * micro - 0.004 * rock);
  const roughness = clamp01(0.785 + 0.065 * ground - 0.018 * rock + 0.035 * micro * dry);

  return Object.freeze({
    ...base,
    detailSignal: micro,
    tintR,
    tintG,
    tintB,
    roughness,
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

export function measureG75NearDetail() {
  const { xMin, xMax, yMin, yMax } = G75_NEAR_DETAIL_POLICY.normalizedBounds;
  const size = G75_NEAR_DETAIL_POLICY.sourceGridSize;
  const guard = G75_NEAR_DETAIL_POLICY.guardBandNormalized;
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
  let activeRoadSamples = 0;
  let activePathSamples = 0;
  let canonicalWaterCells = 0;
  let canonicalLandCells = 0;
  let checksum = 2166136261;
  let previousRow = null;

  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const before = sampleG75RoadPath(nx, ny);
      const sample = sampleG75NearDetail(nx, ny);
      minTint = Math.min(minTint, sample.tintR, sample.tintG, sample.tintB);
      maxTint = Math.max(maxTint, sample.tintR, sample.tintG, sample.tintB);
      minRoughness = Math.min(minRoughness, sample.roughness);
      maxRoughness = Math.max(maxRoughness, sample.roughness);
      maxHeightDeltaMeters = Math.max(maxHeightDeltaMeters, Math.abs(sample.authoredHeight - before.authoredHeight));
      maxControlDelta = Math.max(
        maxControlDelta,
        Math.abs(sample.rockBlend - before.rockBlend),
        Math.abs(sample.groundWeight - before.groundWeight),
        Math.abs(sample.rockWeight - before.rockWeight),
        Math.abs(sample.snowWeight - before.snowWeight),
        Math.abs(sample.roadCoverage - before.roadCoverage),
        Math.abs(sample.pathCoverage - before.pathCoverage),
      );
      if (sample.roadCoverage > 0.000001) activeRoadSamples += 1;
      if (sample.pathCoverage > 0.000001) activePathSamples += 1;
      if (x > 0) {
        maxAdjacentTintDelta = Math.max(maxAdjacentTintDelta, maxTintDelta(sample, row[x - 1]));
        maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(sample.roughness - row[x - 1].roughness));
      }
      if (previousRow) {
        maxAdjacentTintDelta = Math.max(maxAdjacentTintDelta, maxTintDelta(sample, previousRow[x]));
        maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(sample.roughness - previousRow[x].roughness));
      }
      checksum = fnv1a(checksum, Math.round(sample.tintR * 255));
      checksum = fnv1a(checksum, Math.round(sample.tintG * 255));
      checksum = fnv1a(checksum, Math.round(sample.tintB * 255));
      checksum = fnv1a(checksum, Math.round(sample.roughness * 255));
      row.push(sample);
    }
    previousRow = row;
  }

  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const nx = xMin + (xMax - xMin) * t;
    const ny = yMin + (yMax - yMin) * t;
    const pairs = [
      [sampleG75NearDetail(nx, yMin), sampleG75NearDetail(nx, yMin - guard)],
      [sampleG75NearDetail(nx, yMax), sampleG75NearDetail(nx, yMax + guard)],
      [sampleG75NearDetail(xMin, ny), sampleG75NearDetail(xMin - guard, ny)],
      [sampleG75NearDetail(xMax, ny), sampleG75NearDetail(xMax + guard, ny)],
    ];
    for (const [a, b] of pairs) {
      maxGuardBandTintDelta = Math.max(maxGuardBandTintDelta, maxTintDelta(a, b));
      maxGuardBandRoughnessDelta = Math.max(maxGuardBandRoughnessDelta, Math.abs(a.roughness - b.roughness));
    }
  }

  const mask = G75_NEAR_DETAIL_POLICY.maskBounds;
  for (let y = mask.yMin; y <= mask.yMax; y += 1) {
    for (let x = mask.xMin; x <= mask.xMax; x += 1) {
      const sample = sampleG75NearDetail((x + 0.5) / 96, (y + 0.5) / 64);
      if (sample.waterConfidence >= 0.5) canonicalWaterCells += 1;
      else canonicalLandCells += 1;
    }
  }

  return Object.freeze({
    policyId: G75_NEAR_DETAIL_POLICY.id,
    sourceMapSha256: G75_NEAR_DETAIL_POLICY.sourceMapSha256,
    geoCell: G75_NEAR_DETAIL_POLICY.geoCell,
    layer: G75_NEAR_DETAIL_POLICY.layer,
    sourceGridSize: size,
    sourceSamples: size * size,
    terrain3dRegionSize: G75_NEAR_DETAIL_POLICY.terrain3dRegionSize,
    canonicalWaterCells,
    canonicalLandCells,
    activeRoadSamples,
    activePathSamples,
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
    detailChecksum: checksum,
  });
}

export function buildG75NearDetailProbe() {
  const bounds = G75_NEAR_DETAIL_POLICY.normalizedBounds;
  const size = G75_NEAR_DETAIL_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const sample = sampleG75NearDetail(nx, ny);
      row.push([
        Number(sample.groundWeight.toFixed(8)),
        Number(sample.rockWeight.toFixed(8)),
        Number(sample.snowWeight.toFixed(8)),
        Number(sample.rockBlend.toFixed(8)),
        Number(sample.authoredHeight.toFixed(6)),
        Number(sample.roadCoverage.toFixed(8)),
        Number(sample.pathCoverage.toFixed(8)),
        Number(sample.tintR.toFixed(8)),
        Number(sample.tintG.toFixed(8)),
        Number(sample.tintB.toFixed(8)),
        Number(sample.roughness.toFixed(8)),
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    policyId: G75_NEAR_DETAIL_POLICY.id,
    sourceMapSha256: G75_NEAR_DETAIL_POLICY.sourceMapSha256,
    geoCell: G75_NEAR_DETAIL_POLICY.geoCell,
    layer: G75_NEAR_DETAIL_POLICY.layer,
    sourceGridSize: size,
    terrain3dRegionSize: G75_NEAR_DETAIL_POLICY.terrain3dRegionSize,
    groundTextureId: G75_NEAR_DETAIL_POLICY.groundTextureId,
    rockTextureId: G75_NEAR_DETAIL_POLICY.rockTextureId,
    roadTextureId: G75_NEAR_DETAIL_POLICY.roadTextureId,
    pathTextureId: G75_NEAR_DETAIL_POLICY.pathTextureId,
    rows,
  });
}
