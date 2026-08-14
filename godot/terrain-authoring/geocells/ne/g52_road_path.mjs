/**
 * Şafak Kartalı / NE GeoCell G52 — Road/Path Terrain3D authoring field.
 *
 * GeoCell is work addressing only. The material corridor is rasterized from
 * the live deterministic slope-aware world/roads.js polylines in continuous
 * owner-map/world coordinates. No grid edge can create or steer a road.
 */
import {
  G52_ROCK_SNOW_POLICY,
  measureG52RockSnow,
  sampleG52WaterConfidence,
} from './g52_rock_snow.mjs';

export const G52_ROAD_PATH_POLICY = Object.freeze({
  id: 'safak-kartali-g52-terrain3d-road-path-2026-08-13-v1',
  sourceMapSha256: G52_ROCK_SNOW_POLICY.sourceMapSha256,
  geoCell: 'G52', gx: 5, gy: 2, layer: 'Road/Path',
  normalizedBounds: G52_ROCK_SNOW_POLICY.normalizedBounds,
  sourceGridSize: 257,
  terrain3dRegionSize: 256,
  baseTextureId: 0,
  roadTextureId: 2,
  pathTextureId: 3,
  roadWidthMeters: 8,
  footpathWidthMeters: 2.5,
  roadFeatherMeters: 14,
  footpathFeatherMeters: 7,
  guardBandNormalized: 1 / 1536,
});

function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function normalizedToWorld(normalizedX, normalizedY, mapBounds, metersPerMapUnit) {
  const mapX = mapBounds.minX + normalizedX * (mapBounds.maxX - mapBounds.minX);
  const mapY = mapBounds.minY + normalizedY * (mapBounds.maxY - mapBounds.minY);
  return Object.freeze({
    x: (mapX - (mapBounds.minX + mapBounds.maxX) * 0.5) * metersPerMapUnit,
    z: (mapY - (mapBounds.minY + mapBounds.maxY) * 0.5) * metersPerMapUnit,
  });
}

export function worldToNormalized(worldX, worldZ, mapBounds, metersPerMapUnit) {
  const centerX = (mapBounds.minX + mapBounds.maxX) * 0.5;
  const centerY = (mapBounds.minY + mapBounds.maxY) * 0.5;
  const mapX = worldX / metersPerMapUnit + centerX;
  const mapY = worldZ / metersPerMapUnit + centerY;
  return Object.freeze({
    x: (mapX - mapBounds.minX) / (mapBounds.maxX - mapBounds.minX),
    y: (mapY - mapBounds.minY) / (mapBounds.maxY - mapBounds.minY),
  });
}

function pointSegmentDistanceMeters(point, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length2 = dx * dx + dz * dz;
  if (length2 <= 1e-12) return Math.hypot(point.x - a.x, point.z - a.z);
  const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / length2);
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

function samplePolylineCoverage(worldPoint, edges, widthMeters, featherMeters) {
  let closest = Infinity;
  for (const edge of edges ?? []) {
    const points = edge.points ?? [];
    for (let i = 1; i < points.length; i += 1) {
      closest = Math.min(closest, pointSegmentDistanceMeters(worldPoint, points[i - 1], points[i]));
    }
  }
  if (!Number.isFinite(closest)) return 0;
  const halfWidth = widthMeters * 0.5;
  return 1 - smoothstep(halfWidth, halfWidth + featherMeters, closest);
}

export function sampleSettlementLandSupport(worldPoint, runtimeNetwork) {
  let support = 0;
  for (const pad of runtimeNetwork.settlementPads ?? []) {
    if (!(pad.anchorHeightMeters > runtimeNetwork.waterLevelMeters)) continue;
    const distance = Math.hypot(worldPoint.x - pad.x, worldPoint.z - pad.z);
    support = Math.max(support, 1 - smoothstep(pad.innerRadiusMeters, pad.outerRadiusMeters, distance));
  }
  return clamp(support);
}

export function sampleG52RoadPath(normalizedX, normalizedY, runtimeNetwork) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
  const worldPoint = normalizedToWorld(normalizedX, normalizedY, runtimeNetwork.mapBounds, runtimeNetwork.metersPerMapUnit);
  const roadRaw = samplePolylineCoverage(worldPoint, runtimeNetwork.mainEdges, G52_ROAD_PATH_POLICY.roadWidthMeters, G52_ROAD_PATH_POLICY.roadFeatherMeters);
  const pathRaw = samplePolylineCoverage(worldPoint, runtimeNetwork.footpathEdges, G52_ROAD_PATH_POLICY.footpathWidthMeters, G52_ROAD_PATH_POLICY.footpathFeatherMeters);
  const water = sampleG52WaterConfidence(normalizedX, normalizedY);
  const canonicalLandFactor = 1 - smoothstep(0.42, 0.60, water);
  const settlementLandSupport = sampleSettlementLandSupport(worldPoint, runtimeNetwork);
  const landFactor = Math.max(canonicalLandFactor, settlementLandSupport);
  const roadCoverage = roadRaw * landFactor;
  const pathCoverage = pathRaw * landFactor * (1 - roadCoverage);
  const kind = roadCoverage >= pathCoverage && roadCoverage > 0 ? 1 : pathCoverage > 0 ? 2 : 0;
  return Object.freeze({
    roadCoverage,
    pathCoverage,
    coverage: Math.max(roadCoverage, pathCoverage),
    kind,
    waterConfidence: water,
    canonicalLandFactor,
    settlementLandSupport,
    landFactor,
  });
}

function segmentIntersectsBounds(a, b, bounds, padding = 0) {
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  return !(maxX < bounds.xMin - padding || minX > bounds.xMax + padding || maxY < bounds.yMin - padding || minY > bounds.yMax + padding);
}

export function findG52CrossingEdges(runtimeNetwork) {
  const bounds = G52_ROAD_PATH_POLICY.normalizedBounds;
  const padding = G52_ROAD_PATH_POLICY.guardBandNormalized * 2;
  const inspect = (edges, tier) => (edges ?? []).flatMap((edge) => {
    const points = (edge.points ?? []).map((point) => worldToNormalized(point.x, point.z, runtimeNetwork.mapBounds, runtimeNetwork.metersPerMapUnit));
    for (let i = 1; i < points.length; i += 1) {
      if (segmentIntersectsBounds(points[i - 1], points[i], bounds, padding)) {
        return [{ tier, fromId: edge.fromId, toId: edge.toId, pointCount: points.length }];
      }
    }
    return [];
  });
  return Object.freeze([...inspect(runtimeNetwork.mainEdges, 'road'), ...inspect(runtimeNetwork.footpathEdges, 'path')]);
}

function fnv1a(checksum, value) { checksum ^= value & 0xff; return Math.imul(checksum, 16777619) >>> 0; }

export function measureG52RoadPath(runtimeNetwork) {
  const rockSnow = measureG52RockSnow();
  const crossings = findG52CrossingEdges(runtimeNetwork);
  const { xMin, xMax, yMin, yMax } = G52_ROAD_PATH_POLICY.normalizedBounds;
  const size = G52_ROAD_PATH_POLICY.sourceGridSize;
  const guard = G52_ROAD_PATH_POLICY.guardBandNormalized;
  let activeRoadSamples = 0, activePathSamples = 0;
  let maxAdjacentCoverageStep = 0, maxGuardBandCoverageDelta = 0;
  let maxCanonicalWaterCoverageOutsideSettlement = 0, maxCanonicalWaterCoverageInsideSettlement = 0;
  let protectedCanonicalWaterSamples = 0, checksum = 2166136261;
  let previousRow = null;

  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const sample = sampleG52RoadPath(nx, ny, runtimeNetwork);
      if (sample.roadCoverage > 0.02) activeRoadSamples += 1;
      if (sample.pathCoverage > 0.02) activePathSamples += 1;
      if (x > 0) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(sample.coverage - row[x - 1]));
      if (previousRow) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(sample.coverage - previousRow[x]));
      checksum = fnv1a(fnv1a(checksum, Math.round(sample.roadCoverage * 255)), Math.round(sample.pathCoverage * 255));
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
      Math.abs(sampleG52RoadPath(nx, yMin, runtimeNetwork).coverage - sampleG52RoadPath(nx, yMin - guard, runtimeNetwork).coverage),
      Math.abs(sampleG52RoadPath(nx, yMax, runtimeNetwork).coverage - sampleG52RoadPath(nx, yMax + guard, runtimeNetwork).coverage),
      Math.abs(sampleG52RoadPath(xMin, ny, runtimeNetwork).coverage - sampleG52RoadPath(xMin - guard, ny, runtimeNetwork).coverage),
      Math.abs(sampleG52RoadPath(xMax, ny, runtimeNetwork).coverage - sampleG52RoadPath(xMax + guard, ny, runtimeNetwork).coverage),
    );
  }

  const mask = G52_ROCK_SNOW_POLICY.maskBounds;
  for (let maskY = mask.yMin; maskY <= mask.yMax; maskY += 1) {
    for (let maskX = mask.xMin; maskX <= mask.xMax; maskX += 1) {
      const nx = (maskX + 0.5) / 96;
      const ny = (maskY + 0.5) / 64;
      if (sampleG52WaterConfidence(nx, ny) < 0.999999) continue;
      const sample = sampleG52RoadPath(nx, ny, runtimeNetwork);
      if (sample.settlementLandSupport > 0.001) {
        protectedCanonicalWaterSamples += 1;
        maxCanonicalWaterCoverageInsideSettlement = Math.max(maxCanonicalWaterCoverageInsideSettlement, sample.coverage);
      } else {
        maxCanonicalWaterCoverageOutsideSettlement = Math.max(maxCanonicalWaterCoverageOutsideSettlement, sample.coverage);
      }
    }
  }

  return Object.freeze({
    policyId: G52_ROAD_PATH_POLICY.id,
    sourceMapSha256: G52_ROAD_PATH_POLICY.sourceMapSha256,
    geoCell: 'G52', layer: 'Road/Path', sourceGridSize: size, sourceSamples: size * size,
    terrain3dRegionSize: G52_ROAD_PATH_POLICY.terrain3dRegionSize,
    hydrologyFingerprint: rockSnow.hydrologyFingerprint,
    crossingEdges: crossings,
    activeRoadSamples,
    activePathSamples,
    maxAdjacentCoverageStep: Number(maxAdjacentCoverageStep.toFixed(8)),
    maxGuardBandCoverageDelta: Number(maxGuardBandCoverageDelta.toFixed(8)),
    protectedCanonicalWaterSamples,
    maxCanonicalWaterCoverageOutsideSettlement: Number(maxCanonicalWaterCoverageOutsideSettlement.toFixed(8)),
    maxCanonicalWaterCoverageInsideSettlement: Number(maxCanonicalWaterCoverageInsideSettlement.toFixed(8)),
    coverageChecksum: checksum,
  });
}

export function buildG52RoadPathProbe(runtimeNetwork) {
  const { xMin, xMax, yMin, yMax } = G52_ROAD_PATH_POLICY.normalizedBounds;
  const size = G52_ROAD_PATH_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const sample = sampleG52RoadPath(nx, ny, runtimeNetwork);
      row.push([Number(sample.roadCoverage.toFixed(8)), Number(sample.pathCoverage.toFixed(8)), sample.kind]);
    }
    rows.push(row);
  }
  return Object.freeze({
    ...measureG52RoadPath(runtimeNetwork),
    baseTextureId: G52_ROAD_PATH_POLICY.baseTextureId,
    roadTextureId: G52_ROAD_PATH_POLICY.roadTextureId,
    pathTextureId: G52_ROAD_PATH_POLICY.pathTextureId,
    rows,
  });
}
