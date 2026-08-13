/**
 * Kızıl Ufuk / SE GeoCell G65 — Near Detail authoring.
 *
 * Near Detail lives exclusively in Terrain3D's independent color/roughness map.
 * The merged G65 Road/Path height and Rock/Snow control field are preserved
 * exactly in meaning. Detail is evaluated from full owner-map physical metres;
 * GeoCell bounds participate only in deterministic QA traversal.
 */
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import {
  G65_ROAD_PATH_POLICY,
  sampleG65RoadPath,
} from './g65_road_path.mjs';

export const G65_NEAR_DETAIL_POLICY = Object.freeze({
  id: 'kizil-ufuk-g65-terrain3d-near-detail-2026-08-13-v1',
  sourceMapSha256: G65_ROAD_PATH_POLICY.sourceMapSha256,
  geoCell: 'G65',
  gx: 6,
  gy: 5,
  layer: 'Near Detail',
  normalizedBounds: G65_ROAD_PATH_POLICY.normalizedBounds,
  maskBounds: G65_ROAD_PATH_POLICY.maskBounds,
  sourceGridSize: 129,
  terrain3dRegionSize: 256,
  terrain3dImportSize: 257,
  groundTextureId: G65_ROAD_PATH_POLICY.groundTextureId,
  rockTextureId: G65_ROAD_PATH_POLICY.rockTextureId,
  roadTextureId: G65_ROAD_PATH_POLICY.roadTextureId,
  pathTextureId: G65_ROAD_PATH_POLICY.pathTextureId,
  guardBandNormalized: 1 / 65536,
  detailWavelengthMeters: Object.freeze([43, 67, 97, 61, 149]),
  tintFloor: 0.90,
  tintCeiling: 1.0,
  roughnessFloor: 0.62,
  roughnessCeiling: 0.96,
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
 * Continuous southeast dry-surface detiling signal. It contains no cell-edge,
 * Pindex, mask-index or QA-grid term; wavelengths are literal physical metres.
 */
export function g65NearDetailSignal(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const { xMeters, zMeters } = physicalCoordinates(normalizedX, normalizedY);
  const a = Math.sin(TAU * (xMeters / 43 + zMeters / 67) + 0.337);
  const b = Math.cos(TAU * (xMeters / 97 - zMeters / 61) + 1.419);
  const c = Math.sin(TAU * ((xMeters * 0.63 + zMeters) / 149) + 2.113);
  return 0.46 * a + 0.34 * b + 0.20 * c;
}

export function sampleG65NearDetail(normalizedX, normalizedY) {
  const base = sampleG65RoadPath(normalizedX, normalizedY);
  const micro = g65NearDetailSignal(normalizedX, normalizedY);
  const dry = clamp01(base.landFactor ?? (1 - base.waterConfidence));
  const rock = clamp01(base.rockBlend);
  const ground = clamp01(1 - rock);

  // Subtle warm, dusty Southeast tint. This is a multiplier-like color map,
  // not a replacement biome/albedo layer and never changes the control map.
  const tintAmplitude = dry * (0.012 + 0.011 * rock);
  const tintR = clamp01(0.974 + tintAmplitude * micro + 0.005 * ground);
  const tintG = clamp01(0.956 + tintAmplitude * micro + 0.002 * ground);
  const tintB = clamp01(0.938 + tintAmplitude * micro - 0.004 * rock);
  const roughness = clamp01(0.790 + 0.072 * ground - 0.024 * rock + 0.042 * micro * dry);

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

export function measureG65NearDetail() {
  const { xMin, xMax, yMin, yMax } = G65_NEAR_DETAIL_POLICY.normalizedBounds;
  const size = G65_NEAR_DETAIL_POLICY.sourceGridSize;
  const guard = G65_NEAR_DETAIL_POLICY.guardBandNormalized;
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
  let maxSnowWeight = 0;
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
      const before = sampleG65RoadPath(nx, ny);
      const sample = sampleG65NearDetail(nx, ny);
      minTint = Math.min(minTint, sample.tintR, sample.tintG, sample.tintB);
      maxTint = Math.max(maxTint, sample.tintR, sample.tintG, sample.tintB);
      minRoughness = Math.min(minRoughness, sample.roughness);
      maxRoughness = Math.max(maxRoughness, sample.roughness);
      maxSnowWeight = Math.max(maxSnowWeight, sample.snowWeight);
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
      [sampleG65NearDetail(nx, yMin), sampleG65NearDetail(nx, yMin - guard)],
      [sampleG65NearDetail(nx, yMax), sampleG65NearDetail(nx, yMax + guard)],
      [sampleG65NearDetail(xMin, ny), sampleG65NearDetail(xMin - guard, ny)],
      [sampleG65NearDetail(xMax, ny), sampleG65NearDetail(xMax + guard, ny)],
    ];
    for (const [a, b] of pairs) {
      maxGuardBandTintDelta = Math.max(maxGuardBandTintDelta, maxTintDelta(a, b));
      maxGuardBandRoughnessDelta = Math.max(maxGuardBandRoughnessDelta, Math.abs(a.roughness - b.roughness));
    }
  }

  const mask = G65_NEAR_DETAIL_POLICY.maskBounds;
  for (let y = mask.yMin; y <= mask.yMax; y += 1) {
    for (let x = mask.xMin; x <= mask.xMax; x += 1) {
      const sample = sampleG65NearDetail((x + 0.5) / 96, (y + 0.5) / 64);
      if (sample.waterConfidence >= 0.5) canonicalWaterCells += 1;
      else canonicalLandCells += 1;
    }
  }

  return Object.freeze({
    policyId: G65_NEAR_DETAIL_POLICY.id,
    sourceMapSha256: G65_NEAR_DETAIL_POLICY.sourceMapSha256,
    geoCell: G65_NEAR_DETAIL_POLICY.geoCell,
    layer: G65_NEAR_DETAIL_POLICY.layer,
    sourceGridSize: size,
    sourceSamples: size * size,
    terrain3dRegionSize: G65_NEAR_DETAIL_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G65_NEAR_DETAIL_POLICY.terrain3dImportSize,
    canonicalWaterCells,
    canonicalLandCells,
    activeRoadSamples,
    activePathSamples,
    maxSnowWeight: round8(maxSnowWeight),
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

export function buildG65NearDetailProbe() {
  const bounds = G65_NEAR_DETAIL_POLICY.normalizedBounds;
  const size = G65_NEAR_DETAIL_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const sample = sampleG65NearDetail(nx, ny);
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
    policyId: G65_NEAR_DETAIL_POLICY.id,
    sourceMapSha256: G65_NEAR_DETAIL_POLICY.sourceMapSha256,
    geoCell: G65_NEAR_DETAIL_POLICY.geoCell,
    layer: G65_NEAR_DETAIL_POLICY.layer,
    sourceGridSize: size,
    terrain3dRegionSize: G65_NEAR_DETAIL_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G65_NEAR_DETAIL_POLICY.terrain3dImportSize,
    groundTextureId: G65_NEAR_DETAIL_POLICY.groundTextureId,
    rockTextureId: G65_NEAR_DETAIL_POLICY.rockTextureId,
    roadTextureId: G65_NEAR_DETAIL_POLICY.roadTextureId,
    pathTextureId: G65_NEAR_DETAIL_POLICY.pathTextureId,
    rows,
  });
}
