/** Kızıl Ufuk / SE G77 Near Detail. Color/roughness only; height/control stay owned by Road/Path. */
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import {
  G77_ROAD_PATH_POLICY,
  buildG77RoadPathControlContract,
  sampleG77RoadPath,
} from './g77_road_path.mjs';

export const G77_NEAR_DETAIL_POLICY = Object.freeze({
  id: 'kizil-ufuk-g77-terrain3d-near-detail-2026-08-16-v1',
  sourceMapSha256: G77_ROAD_PATH_POLICY.sourceMapSha256,
  sourceMapVersion: G77_ROAD_PATH_POLICY.sourceMapVersion,
  geoCell: 'G77', gx: 7, gy: 7, layer: 'Near Detail',
  normalizedBounds: G77_ROAD_PATH_POLICY.normalizedBounds,
  maskBounds: G77_ROAD_PATH_POLICY.maskBounds,
  sourceGridSize: 257,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  groundTextureId: G77_ROAD_PATH_POLICY.groundTextureId,
  rockTextureId: G77_ROAD_PATH_POLICY.rockTextureId,
  snowTextureId: G77_ROAD_PATH_POLICY.snowTextureId,
  roadTextureId: G77_ROAD_PATH_POLICY.roadTextureId,
  pathTextureId: G77_ROAD_PATH_POLICY.pathTextureId,
  guardXNormalized: G77_ROAD_PATH_POLICY.guardXNormalized,
  guardYNormalized: G77_ROAD_PATH_POLICY.guardYNormalized,
  detailWavelengthMeters: Object.freeze([37, 59, 83, 127, 173]),
  tintFloor: 0.86,
  tintCeiling: 1.0,
  roughnessFloor: 0.60,
  roughnessCeiling: 0.96,
  canonicalWaterRoughness: 0.90,
});

const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const round8 = (value) => Number(value.toFixed(8));
const fnv1a = (sum, value) => Math.imul((sum ^ (value & 0xff)) >>> 0, 16777619) >>> 0;

function physicalCoordinates(nx, ny) {
  return { xMeters: nx * FULL_REFERENCE_EXTENT_PLAN.widthMeters, zMeters: ny * FULL_REFERENCE_EXTENT_PLAN.depthMeters };
}

/** Continuous physical-metre signal. GeoCell/Pindex/grid coordinates never enter the texture function. */
export function g77NearDetailSignal(nx, ny) {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new TypeError('G77 Near Detail coordinates must be finite');
  const { xMeters, zMeters } = physicalCoordinates(nx, ny);
  const a = Math.sin(TAU * (xMeters / 37 + zMeters / 59) + 0.371);
  const b = Math.cos(TAU * (xMeters / 83 - zMeters / 127) + 1.207);
  const c = Math.sin(TAU * ((xMeters * 0.71 + zMeters) / 173) + 2.411);
  return 0.43 * a + 0.34 * b + 0.23 * c;
}

export function sampleG77NearDetail(nx, ny, runtimeNetwork) {
  const base = sampleG77RoadPath(nx, ny, runtimeNetwork);
  const detailSignal = g77NearDetailSignal(nx, ny);
  const dry = clamp01(Math.max(base.landFactor ?? 0, base.settlementLandSupport ?? 0));
  const canonicalOpenWater = base.waterConfidence >= 0.5 && (base.settlementLandSupport ?? 0) <= 0.001;
  const ground = clamp01(base.groundWeight), rock = clamp01(base.rockWeight), snow = clamp01(base.snowWeight);
  const road = clamp01(base.roadCoverage), path = clamp01(base.pathCoverage);

  let tintR = 1, tintG = 1, tintB = 1, roughness = G77_NEAR_DETAIL_POLICY.canonicalWaterRoughness;
  if (!canonicalOpenWater) {
    const micro = detailSignal * dry;
    tintR = clamp01(0.952 + 0.020 * micro + 0.020 * ground - 0.010 * rock + 0.016 * snow - 0.040 * road - 0.024 * path);
    tintG = clamp01(0.941 + 0.017 * micro + 0.011 * ground - 0.004 * rock + 0.018 * snow - 0.035 * road - 0.018 * path);
    tintB = clamp01(0.925 + 0.014 * micro - 0.003 * ground + 0.008 * rock + 0.027 * snow - 0.030 * road - 0.014 * path);
    roughness = clamp01(0.820 + 0.060 * ground - 0.060 * rock + 0.018 * snow + 0.032 * micro - 0.120 * road - 0.070 * path);
  }
  const control = buildG77RoadPathControlContract(base);
  return Object.freeze({ ...base, detailSignal, tintR, tintG, tintB, roughness, nearDetailControl: control });
}

function maxTintDelta(a, b) {
  return Math.max(Math.abs(a.tintR - b.tintR), Math.abs(a.tintG - b.tintG), Math.abs(a.tintB - b.tintB));
}

export function measureG77NearDetail(runtimeNetwork) {
  const p = G77_NEAR_DETAIL_POLICY, b = p.normalizedBounds, size = p.sourceGridSize;
  let minLandTint = 1, maxLandTint = 0, minLandRoughness = 1, maxLandRoughness = 0;
  let maxAdjacentTintDelta = 0, maxAdjacentRoughnessDelta = 0, maxNorthWestTintGuardDelta = 0, maxNorthWestRoughnessGuardDelta = 0;
  let maxHeightDeltaMeters = 0, maxRoadPathDelta = 0, maxControlContractMismatch = 0, maxCanonicalWaterTintDelta = 0, maxCanonicalWaterRoughnessDelta = 0;
  let detailedLandSamples = 0, canonicalWaterSamples = 0, activeRoadSamples = 0, activePathSamples = 0;
  let canonicalWaterCells = 0, canonicalLandCells = 0, predecessorCoverageChecksum = 2166136261;
  let checksum = 2166136261, previousRow = null;
  for (let y = 0; y < size; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (size - 1), row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (size - 1), before = sampleG77RoadPath(nx, ny, runtimeNetwork), s = sampleG77NearDetail(nx, ny, runtimeNetwork);
      const beforeControl = buildG77RoadPathControlContract(before), c = s.nearDetailControl;
      maxHeightDeltaMeters = Math.max(maxHeightDeltaMeters, Math.abs(s.authoredHeight - before.authoredHeight));
      maxRoadPathDelta = Math.max(maxRoadPathDelta, Math.abs(s.roadCoverage - before.roadCoverage), Math.abs(s.pathCoverage - before.pathCoverage));
      maxControlContractMismatch = Math.max(maxControlContractMismatch, c.baseTextureId === beforeControl.baseTextureId ? 0 : 1, c.overlayTextureId === beforeControl.overlayTextureId ? 0 : 1, Math.abs(c.overlayBlend8 - beforeControl.overlayBlend8));
      if (before.roadCoverage > 0.02) activeRoadSamples += 1;
      if (before.pathCoverage > 0.02) activePathSamples += 1;
      predecessorCoverageChecksum = fnv1a(fnv1a(predecessorCoverageChecksum, Math.round(before.roadCoverage * 255)), Math.round(before.pathCoverage * 255));
      const openWater = s.waterConfidence >= 0.5 && s.settlementLandSupport <= 0.001;
      if (openWater) {
        canonicalWaterSamples += 1;
        maxCanonicalWaterTintDelta = Math.max(maxCanonicalWaterTintDelta, Math.abs(1 - s.tintR), Math.abs(1 - s.tintG), Math.abs(1 - s.tintB));
        maxCanonicalWaterRoughnessDelta = Math.max(maxCanonicalWaterRoughnessDelta, Math.abs(p.canonicalWaterRoughness - s.roughness));
      } else {
        detailedLandSamples += 1;
        minLandTint = Math.min(minLandTint, s.tintR, s.tintG, s.tintB); maxLandTint = Math.max(maxLandTint, s.tintR, s.tintG, s.tintB);
        minLandRoughness = Math.min(minLandRoughness, s.roughness); maxLandRoughness = Math.max(maxLandRoughness, s.roughness);
      }
      if (x) { maxAdjacentTintDelta = Math.max(maxAdjacentTintDelta, maxTintDelta(s, row[x - 1])); maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(s.roughness - row[x - 1].roughness)); }
      if (previousRow) { maxAdjacentTintDelta = Math.max(maxAdjacentTintDelta, maxTintDelta(s, previousRow[x])); maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(s.roughness - previousRow[x].roughness)); }
      for (const value of [s.tintR, s.tintG, s.tintB, s.roughness]) checksum = fnv1a(checksum, Math.round(clamp01(value) * 255));
      row.push(s);
    }
    previousRow = row;
  }
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1), nx = b.xMin + (b.xMax - b.xMin) * t, ny = b.yMin + (b.yMax - b.yMin) * t;
    for (const [a, g] of [
      [sampleG77NearDetail(b.xMin, ny, runtimeNetwork), sampleG77NearDetail(b.xMin - p.guardXNormalized, ny, runtimeNetwork)],
      [sampleG77NearDetail(nx, b.yMin, runtimeNetwork), sampleG77NearDetail(nx, b.yMin - p.guardYNormalized, runtimeNetwork)],
    ]) {
      maxNorthWestTintGuardDelta = Math.max(maxNorthWestTintGuardDelta, maxTintDelta(a, g));
      maxNorthWestRoughnessGuardDelta = Math.max(maxNorthWestRoughnessGuardDelta, Math.abs(a.roughness - g.roughness));
    }
  }
  const mask = p.maskBounds;
  for (let y = mask.yMin; y <= mask.yMax; y += 1) for (let x = mask.xMin; x <= mask.xMax; x += 1) {
    const s = sampleG77RoadPath((x + 0.5) / 96, (y + 0.5) / 64, runtimeNetwork);
    if (s.waterConfidence >= 0.5) canonicalWaterCells += 1; else canonicalLandCells += 1;
  }
  return Object.freeze({
    policyId: p.id, sourceMapSha256: p.sourceMapSha256, sourceMapVersion: p.sourceMapVersion, geoCell: p.geoCell, layer: p.layer,
    sourceGridSize: size, sourceSamples: size * size, terrain3dImportSize: p.terrain3dImportSize, terrain3dRegionSize: p.terrain3dRegionSize,
    canonicalWaterCells, canonicalLandCells,
    activeRoadSamples, activePathSamples, predecessorCoverageChecksum,
    detailedLandSamples, canonicalWaterSamples, minLandTint: round8(minLandTint), maxLandTint: round8(maxLandTint), minLandRoughness: round8(minLandRoughness), maxLandRoughness: round8(maxLandRoughness),
    maxAdjacentTintDelta: round8(maxAdjacentTintDelta), maxAdjacentRoughnessDelta: round8(maxAdjacentRoughnessDelta), maxNorthWestTintGuardDelta: round8(maxNorthWestTintGuardDelta), maxNorthWestRoughnessGuardDelta: round8(maxNorthWestRoughnessGuardDelta),
    maxHeightDeltaMeters: round8(maxHeightDeltaMeters), maxRoadPathDelta: round8(maxRoadPathDelta), maxControlContractMismatch: round8(maxControlContractMismatch),
    maxCanonicalWaterTintDelta: round8(maxCanonicalWaterTintDelta), maxCanonicalWaterRoughnessDelta: round8(maxCanonicalWaterRoughnessDelta), detailChecksum: checksum,
  });
}

export function buildG77NearDetailProbe(runtimeNetwork, measured = null) {
  const p = G77_NEAR_DETAIL_POLICY, b = p.normalizedBounds, metrics = measured ?? measureG77NearDetail(runtimeNetwork), rows = [];
  for (let y = 0; y < p.sourceGridSize; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (p.sourceGridSize - 1), row = [];
    for (let x = 0; x < p.sourceGridSize; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (p.sourceGridSize - 1), s = sampleG77NearDetail(nx, ny, runtimeNetwork), c = s.nearDetailControl;
      row.push([Number(s.authoredHeight.toFixed(6)), Number(s.roadCoverage.toFixed(8)), Number(s.pathCoverage.toFixed(8)), Number(s.groundWeight.toFixed(8)), Number(s.rockWeight.toFixed(8)), Number(s.snowWeight.toFixed(8)), Number(s.waterConfidence.toFixed(8)), Number(s.settlementLandSupport.toFixed(8)), c.baseTextureId, c.overlayTextureId, c.overlayBlend8, Number(s.tintR.toFixed(8)), Number(s.tintG.toFixed(8)), Number(s.tintB.toFixed(8)), Number(s.roughness.toFixed(8)), Number(s.detailSignal.toFixed(8))]);
    }
    rows.push(row);
  }
  return Object.freeze({ schema: 'westeros-g77-terrain3d-near-detail-probe-v1', ...metrics,
    groundTextureId: p.groundTextureId, rockTextureId: p.rockTextureId, snowTextureId: p.snowTextureId, roadTextureId: p.roadTextureId, pathTextureId: p.pathTextureId,
    normalizedBounds: p.normalizedBounds, rows });
}
