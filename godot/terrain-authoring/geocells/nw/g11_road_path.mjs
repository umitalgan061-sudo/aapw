/**
 * Buzul Muhafızı / NW GeoCell G11 Road/Path authoring field.
 *
 * This module does not invent roads from the 8x8 work grid. Callers supply the
 * real slope-aware runtime road network (`world/roads.js`). The field then
 * rasterizes those world-space polylines into a continuous anti-aliased
 * surface corridor while owner-map hydrology fades material coverage off sea.
 */

import { classifyReferenceBaseSurface } from '../../../../src/3d/world/worldReferenceSurfacePindexes.js';
import { G11_HYDROLOGY_POLICY, measureG11Hydrology } from './g11_hydrology.mjs';

export const G11_ROAD_PATH_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g11-terrain3d-road-path-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G11',
  gx: 1,
  gy: 1,
  layer: 'Road/Path',
  normalizedBounds: G11_HYDROLOGY_POLICY.normalizedBounds,
  sourceGridSize: 257,
  terrain3dRegionSize: 256,
  baseTextureId: 0,
  roadTextureId: 2,
  pathTextureId: 3,
  roadWidthMeters: 8,
  footpathWidthMeters: 2.5,
  roadFeatherMeters: 7,
  footpathFeatherMeters: 4,
  guardBandNormalized: 1 / 1536,
});

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

export function normalizedToWorld(normalizedX, normalizedY, mapBounds, metersPerMapUnit) {
  const width = mapBounds.maxX - mapBounds.minX;
  const height = mapBounds.maxY - mapBounds.minY;
  const mapX = mapBounds.minX + normalizedX * width;
  const mapY = mapBounds.minY + normalizedY * height;
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
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-12) return Math.hypot(point.x - a.x, point.z - a.z);
  const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared);
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

function samplePolylineCoverage(worldPoint, edges, widthMeters, featherMeters) {
  let closest = Infinity;
  for (const edge of edges) {
    const points = edge.points ?? [];
    for (let i = 1; i < points.length; i += 1) {
      closest = Math.min(closest, pointSegmentDistanceMeters(worldPoint, points[i - 1], points[i]));
    }
  }
  if (!Number.isFinite(closest)) return 0;
  const halfWidth = widthMeters * 0.5;
  return 1 - smoothstep(halfWidth, halfWidth + featherMeters, closest);
}

export function sampleG11RoadPath(normalizedX, normalizedY, runtimeNetwork) {
  const worldPoint = normalizedToWorld(
    normalizedX,
    normalizedY,
    runtimeNetwork.mapBounds,
    runtimeNetwork.metersPerMapUnit,
  );
  const roadRaw = samplePolylineCoverage(
    worldPoint,
    runtimeNetwork.mainEdges,
    G11_ROAD_PATH_POLICY.roadWidthMeters,
    G11_ROAD_PATH_POLICY.roadFeatherMeters,
  );
  const pathRaw = samplePolylineCoverage(
    worldPoint,
    runtimeNetwork.footpathEdges,
    G11_ROAD_PATH_POLICY.footpathWidthMeters,
    G11_ROAD_PATH_POLICY.footpathFeatherMeters,
  );
  const water = sampleGlobalWaterConfidence(normalizedX, normalizedY);
  const landFactor = 1 - smoothstep(0.42, 0.60, water);
  const roadCoverage = roadRaw * landFactor;
  const pathCoverage = pathRaw * landFactor * (1 - roadCoverage);
  const kind = roadCoverage >= pathCoverage && roadCoverage > 0 ? 1 : pathCoverage > 0 ? 2 : 0;
  const coverage = Math.max(roadCoverage, pathCoverage);
  return Object.freeze({
    roadCoverage,
    pathCoverage,
    coverage,
    kind,
    waterConfidence: water,
    landFactor,
  });
}

function segmentIntersectsBounds(a, b, bounds, paddingNormalized = 0) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return !(
    maxX < bounds.xMin - paddingNormalized ||
    minX > bounds.xMax + paddingNormalized ||
    maxY < bounds.yMin - paddingNormalized ||
    minY > bounds.yMax + paddingNormalized
  );
}

export function findG11CrossingEdges(runtimeNetwork) {
  const bounds = G11_ROAD_PATH_POLICY.normalizedBounds;
  const padding = 2 / 1536;
  const inspect = (edges, tier) => edges.flatMap((edge) => {
    const normalizedPoints = edge.points.map((point) => worldToNormalized(
      point.x,
      point.z,
      runtimeNetwork.mapBounds,
      runtimeNetwork.metersPerMapUnit,
    ));
    let crosses = false;
    for (let i = 1; i < normalizedPoints.length; i += 1) {
      if (segmentIntersectsBounds(normalizedPoints[i - 1], normalizedPoints[i], bounds, padding)) {
        crosses = true;
        break;
      }
    }
    return crosses ? [{ tier, fromId: edge.fromId, toId: edge.toId, pointCount: edge.points.length }] : [];
  });
  return Object.freeze([
    ...inspect(runtimeNetwork.mainEdges, 'road'),
    ...inspect(runtimeNetwork.footpathEdges, 'path'),
  ]);
}

function fnv1a(checksum, value) {
  checksum ^= value & 0xff;
  return Math.imul(checksum, 16777619) >>> 0;
}

export function measureG11RoadPath(runtimeNetwork) {
  const hydrology = measureG11Hydrology();
  const crossings = findG11CrossingEdges(runtimeNetwork);
  const { xMin, xMax, yMin, yMax } = G11_ROAD_PATH_POLICY.normalizedBounds;
  const size = G11_ROAD_PATH_POLICY.sourceGridSize;
  const guard = G11_ROAD_PATH_POLICY.guardBandNormalized;
  let activeRoadSamples = 0;
  let activePathSamples = 0;
  let maxAdjacentCoverageStep = 0;
  let maxGuardBandCoverageDelta = 0;
  let maxCanonicalWaterCoverage = 0;
  let checksum = 2166136261;
  let previousRow = null;

  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const sample = sampleG11RoadPath(nx, ny, runtimeNetwork);
      if (sample.roadCoverage > 0.02) activeRoadSamples += 1;
      if (sample.pathCoverage > 0.02) activePathSamples += 1;
      if (x > 0) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(sample.coverage - row[x - 1]));
      if (previousRow) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(sample.coverage - previousRow[x]));
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
      Math.abs(sampleG11RoadPath(nx, yMin, runtimeNetwork).coverage - sampleG11RoadPath(nx, yMin - guard, runtimeNetwork).coverage),
      Math.abs(sampleG11RoadPath(nx, yMax, runtimeNetwork).coverage - sampleG11RoadPath(nx, yMax + guard, runtimeNetwork).coverage),
      Math.abs(sampleG11RoadPath(xMin, ny, runtimeNetwork).coverage - sampleG11RoadPath(xMin - guard, ny, runtimeNetwork).coverage),
      Math.abs(sampleG11RoadPath(xMax, ny, runtimeNetwork).coverage - sampleG11RoadPath(xMax + guard, ny, runtimeNetwork).coverage),
    );
  }

  const mask = G11_HYDROLOGY_POLICY.maskBounds;
  for (let maskY = mask.yMin; maskY <= mask.yMax; maskY += 1) {
    for (let maskX = mask.xMin; maskX <= mask.xMax; maskX += 1) {
      if (!sampleWaterAtMaskCell(maskX, maskY)) continue;
      const nx = (maskX + 0.5) / 96;
      const ny = (maskY + 0.5) / 64;
      maxCanonicalWaterCoverage = Math.max(maxCanonicalWaterCoverage, sampleG11RoadPath(nx, ny, runtimeNetwork).coverage);
    }
  }

  return Object.freeze({
    policyId: G11_ROAD_PATH_POLICY.id,
    sourceMapSha256: G11_ROAD_PATH_POLICY.sourceMapSha256,
    geoCell: 'G11',
    layer: 'Road/Path',
    sourceGridSize: size,
    sourceSamples: size * size,
    terrain3dRegionSize: G11_ROAD_PATH_POLICY.terrain3dRegionSize,
    hydrologyFingerprint: Object.freeze({
      waterCells: hydrology.waterCells,
      landCells: hydrology.landCells,
      boundaryEdges: hydrology.boundaryEdges,
      centreMismatches: hydrology.centreMismatches,
    }),
    crossingEdges: crossings,
    activeRoadSamples,
    activePathSamples,
    maxAdjacentCoverageStep: Number(maxAdjacentCoverageStep.toFixed(8)),
    maxGuardBandCoverageDelta: Number(maxGuardBandCoverageDelta.toFixed(8)),
    maxCanonicalWaterCoverage: Number(maxCanonicalWaterCoverage.toFixed(8)),
    coverageChecksum: checksum,
  });
}

export function buildG11RoadPathProbe(runtimeNetwork) {
  const { xMin, xMax, yMin, yMax } = G11_ROAD_PATH_POLICY.normalizedBounds;
  const size = G11_ROAD_PATH_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const sample = sampleG11RoadPath(nx, ny, runtimeNetwork);
      row.push([
        Number(sample.roadCoverage.toFixed(8)),
        Number(sample.pathCoverage.toFixed(8)),
        sample.kind,
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    policyId: G11_ROAD_PATH_POLICY.id,
    sourceMapSha256: G11_ROAD_PATH_POLICY.sourceMapSha256,
    geoCell: 'G11',
    layer: 'Road/Path',
    sourceGridSize: size,
    terrain3dRegionSize: G11_ROAD_PATH_POLICY.terrain3dRegionSize,
    baseTextureId: G11_ROAD_PATH_POLICY.baseTextureId,
    roadTextureId: G11_ROAD_PATH_POLICY.roadTextureId,
    pathTextureId: G11_ROAD_PATH_POLICY.pathTextureId,
    crossingEdges: findG11CrossingEdges(runtimeNetwork),
    rows,
  });
}
