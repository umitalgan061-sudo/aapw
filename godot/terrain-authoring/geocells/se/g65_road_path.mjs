/**
 * Kızıl Ufuk / SE GeoCell G65 — Road/Path surface authoring.
 *
 * GeoCell bounds are addressing only. The live slope-aware road/footpath
 * polylines are projected through the canonical 9000x7000 owner-map alignment
 * before the G65 intersection test. The full-reference canonical road search
 * envelope is independently bounded from KINGDOM_SEATS + the shared A* corridor
 * contract. Both must remain outside G65; otherwise CI fails rather than
 * inventing a phantom eastern route. While road-free, merged Relief + Rock/Snow
 * are preserved exactly through Terrain3D.
 */
import { worldXZToNormalizedReference } from '../../../../src/3d/world/worldReferenceAlignment.js';
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import {
  G65_ROCK_SNOW_POLICY,
  sampleG65RockSnow,
} from './g65_rock_snow.mjs';

export const G65_ROAD_PATH_POLICY = Object.freeze({
  id: 'kizil-ufuk-g65-terrain3d-road-path-2026-08-13-v1',
  sourceMapSha256: G65_ROCK_SNOW_POLICY.sourceMapSha256,
  geoCell: 'G65',
  gx: 6,
  gy: 5,
  layer: 'Road/Path',
  normalizedBounds: G65_ROCK_SNOW_POLICY.normalizedBounds,
  maskBounds: G65_ROCK_SNOW_POLICY.maskBounds,
  sourceGridSize: 257,
  probeGridSize: 65,
  terrain3dRegionSize: 256,
  terrain3dImportSize: 257,
  groundTextureId: G65_ROCK_SNOW_POLICY.groundTextureId,
  rockTextureId: G65_ROCK_SNOW_POLICY.rockTextureId,
  roadTextureId: 2,
  pathTextureId: 3,
  canonicalMaxSeatMapX: 6190,
  canonicalRouteCorridorPaddingMeters: 700,
  ownerMapWidthUnits: 9000,
  guardBandNormalized: 1 / 1536,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));

function segmentIntersectsBounds(a, b, bounds, padding = 0) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return !(
    maxX < bounds.xMin - padding || minX > bounds.xMax + padding ||
    maxY < bounds.yMin - padding || minY > bounds.yMax + padding
  );
}

function normalizedRuntimePoint(point, runtimeNetwork) {
  return worldXZToNormalizedReference(
    point.x,
    point.z,
    runtimeNetwork.mapBounds,
    runtimeNetwork.metersPerMapUnit,
  );
}

export function findG65CrossingEdges(runtimeNetwork) {
  const bounds = G65_ROAD_PATH_POLICY.normalizedBounds;
  const padding = G65_ROAD_PATH_POLICY.guardBandNormalized;
  const inspect = (edges, tier) => (edges ?? []).flatMap((edge) => {
    const points = (edge.points ?? []).map((point) => normalizedRuntimePoint(point, runtimeNetwork));
    for (let i = 1; i < points.length; i += 1) {
      if (segmentIntersectsBounds(points[i - 1], points[i], bounds, padding)) {
        return [{ tier, fromId: edge.fromId, toId: edge.toId, pointCount: points.length }];
      }
    }
    return [];
  });
  return Object.freeze([
    ...inspect(runtimeNetwork.mainEdges, 'road'),
    ...inspect(runtimeNetwork.footpathEdges, 'path'),
  ]);
}

export function runtimeRoadReferenceEnvelope(runtimeNetwork) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let points = 0;
  for (const edge of [...(runtimeNetwork.mainEdges ?? []), ...(runtimeNetwork.footpathEdges ?? [])]) {
    for (const point of edge.points ?? []) {
      const normalized = normalizedRuntimePoint(point, runtimeNetwork);
      minX = Math.min(minX, normalized.x);
      maxX = Math.max(maxX, normalized.x);
      minY = Math.min(minY, normalized.y);
      maxY = Math.max(maxY, normalized.y);
      points += 1;
    }
  }
  return Object.freeze({
    points,
    minX: Number((Number.isFinite(minX) ? minX : 0).toFixed(8)),
    maxX: Number((Number.isFinite(maxX) ? maxX : 0).toFixed(8)),
    minY: Number((Number.isFinite(minY) ? minY : 0).toFixed(8)),
    maxY: Number((Number.isFinite(maxY) ? maxY : 0).toFixed(8)),
  });
}

export function canonicalRoadNetworkMaxNormalizedX() {
  const paddingMapUnits = G65_ROAD_PATH_POLICY.canonicalRouteCorridorPaddingMeters
    / FULL_REFERENCE_EXTENT_PLAN.metersPerMapUnit;
  return (G65_ROAD_PATH_POLICY.canonicalMaxSeatMapX + paddingMapUnits)
    / G65_ROAD_PATH_POLICY.ownerMapWidthUnits;
}

export function canonicalRoadExclusionMarginMeters() {
  return Math.max(0, G65_ROAD_PATH_POLICY.normalizedBounds.xMin - canonicalRoadNetworkMaxNormalizedX())
    * FULL_REFERENCE_EXTENT_PLAN.widthMeters;
}

export function sampleG65RoadPath(normalizedX, normalizedY) {
  const base = sampleG65RockSnow(normalizedX, normalizedY);
  return Object.freeze({
    ...base,
    roadCoverage: 0,
    pathCoverage: 0,
    coverage: 0,
    kind: 0,
    roadGradeDeltaMeters: 0,
    authoredHeight: base.height,
  });
}

function fnv1a(checksum, value) {
  checksum ^= value & 0xff;
  return Math.imul(checksum, 16777619) >>> 0;
}

export function measureG65RoadPath(runtimeNetwork) {
  const crossings = findG65CrossingEdges(runtimeNetwork);
  const envelope = runtimeRoadReferenceEnvelope(runtimeNetwork);
  const { xMin, xMax, yMin, yMax } = G65_ROAD_PATH_POLICY.normalizedBounds;
  const size = G65_ROAD_PATH_POLICY.sourceGridSize;
  const guard = G65_ROAD_PATH_POLICY.guardBandNormalized;
  let checksum = 2166136261;
  let activeRoadSamples = 0;
  let activePathSamples = 0;
  let maxAdjacentCoverageStep = 0;
  let maxGuardBandCoverageDelta = 0;
  let maxHeightDeltaMeters = 0;
  let maxSurfaceDelta = 0;
  let canonicalWaterCells = 0;
  let canonicalLandCells = 0;
  let previousRow = null;

  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const base = sampleG65RockSnow(nx, ny);
      const sample = sampleG65RoadPath(nx, ny);
      if (sample.roadCoverage > 0.02) activeRoadSamples += 1;
      if (sample.pathCoverage > 0.02) activePathSamples += 1;
      if (x > 0) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(sample.coverage - row[x - 1]));
      if (previousRow) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(sample.coverage - previousRow[x]));
      maxHeightDeltaMeters = Math.max(maxHeightDeltaMeters, Math.abs(sample.authoredHeight - base.height));
      maxSurfaceDelta = Math.max(
        maxSurfaceDelta,
        Math.abs(sample.groundWeight - base.groundWeight),
        Math.abs(sample.rockWeight - base.rockWeight),
        Math.abs(sample.snowWeight - base.snowWeight),
        Math.abs(sample.rockBlend - base.rockBlend),
      );
      checksum = fnv1a(checksum, Math.round(clamp01(sample.rockBlend) * 255));
      checksum = fnv1a(checksum, Math.round(sample.roadCoverage * 255));
      checksum = fnv1a(checksum, Math.round(sample.pathCoverage * 255));
      row.push(sample.coverage);
    }
    previousRow = row;
  }

  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const nx = xMin + (xMax - xMin) * t;
    const ny = yMin + (yMax - yMin) * t;
    maxGuardBandCoverageDelta = Math.max(
      maxGuardBandCoverageDelta,
      Math.abs(sampleG65RoadPath(nx, yMin).coverage - sampleG65RoadPath(nx, yMin - guard).coverage),
      Math.abs(sampleG65RoadPath(nx, yMax).coverage - sampleG65RoadPath(nx, yMax + guard).coverage),
      Math.abs(sampleG65RoadPath(xMin, ny).coverage - sampleG65RoadPath(xMin - guard, ny).coverage),
      Math.abs(sampleG65RoadPath(xMax, ny).coverage - sampleG65RoadPath(xMax + guard, ny).coverage),
    );
  }

  const mask = G65_ROAD_PATH_POLICY.maskBounds;
  for (let y = mask.yMin; y <= mask.yMax; y += 1) {
    for (let x = mask.xMin; x <= mask.xMax; x += 1) {
      const sample = sampleG65RoadPath((x + 0.5) / 96, (y + 0.5) / 64);
      if (sample.waterConfidence >= 0.5) canonicalWaterCells += 1;
      else canonicalLandCells += 1;
    }
  }

  return Object.freeze({
    policyId: G65_ROAD_PATH_POLICY.id,
    sourceMapSha256: G65_ROAD_PATH_POLICY.sourceMapSha256,
    geoCell: 'G65',
    layer: G65_ROAD_PATH_POLICY.layer,
    sourceGridSize: size,
    sourceSamples: size * size,
    probeGridSize: G65_ROAD_PATH_POLICY.probeGridSize,
    terrain3dRegionSize: G65_ROAD_PATH_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G65_ROAD_PATH_POLICY.terrain3dImportSize,
    canonicalWaterCells,
    canonicalLandCells,
    crossingEdges: crossings,
    runtimeRoadReferenceEnvelope: envelope,
    canonicalRoadNetworkMaxNormalizedX: Number(canonicalRoadNetworkMaxNormalizedX().toFixed(8)),
    canonicalRoadExclusionMarginMeters: Number(canonicalRoadExclusionMarginMeters().toFixed(3)),
    activeRoadSamples,
    activePathSamples,
    maxAdjacentCoverageStep: Number(maxAdjacentCoverageStep.toFixed(8)),
    maxGuardBandCoverageDelta: Number(maxGuardBandCoverageDelta.toFixed(8)),
    maxHeightDeltaMeters: Number(maxHeightDeltaMeters.toFixed(8)),
    maxSurfaceDelta: Number(maxSurfaceDelta.toFixed(8)),
    coverageChecksum: checksum,
  });
}

export function buildG65RoadPathProbe(runtimeNetwork) {
  const bounds = G65_ROAD_PATH_POLICY.normalizedBounds;
  const size = G65_ROAD_PATH_POLICY.probeGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const s = sampleG65RoadPath(nx, ny);
      row.push([
        Number(s.groundWeight.toFixed(8)),
        Number(s.rockWeight.toFixed(8)),
        Number(s.snowWeight.toFixed(8)),
        Number(s.rockBlend.toFixed(8)),
        Number(s.authoredHeight.toFixed(6)),
        s.roadCoverage,
        s.pathCoverage,
        s.kind,
      ]);
    }
    rows.push(row);
  }
  const metrics = measureG65RoadPath(runtimeNetwork);
  return Object.freeze({
    policyId: G65_ROAD_PATH_POLICY.id,
    sourceMapSha256: G65_ROAD_PATH_POLICY.sourceMapSha256,
    geoCell: 'G65',
    layer: G65_ROAD_PATH_POLICY.layer,
    sourceGridSize: size,
    terrain3dRegionSize: G65_ROAD_PATH_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G65_ROAD_PATH_POLICY.terrain3dImportSize,
    groundTextureId: G65_ROAD_PATH_POLICY.groundTextureId,
    rockTextureId: G65_ROAD_PATH_POLICY.rockTextureId,
    roadTextureId: G65_ROAD_PATH_POLICY.roadTextureId,
    pathTextureId: G65_ROAD_PATH_POLICY.pathTextureId,
    crossingEdges: metrics.crossingEdges,
    runtimeRoadReferenceEnvelope: metrics.runtimeRoadReferenceEnvelope,
    canonicalRoadNetworkMaxNormalizedX: metrics.canonicalRoadNetworkMaxNormalizedX,
    canonicalRoadExclusionMarginMeters: metrics.canonicalRoadExclusionMarginMeters,
    activeRoadSamples: metrics.activeRoadSamples,
    activePathSamples: metrics.activePathSamples,
    rows,
  });
}
