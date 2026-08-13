/**
 * Kızıl Ufuk / SE GeoCell G75 — Road/Path authoring.
 *
 * GeoCell bounds are addressing only. Runtime slope-aware road polylines are
 * projected through the canonical 9000x7000 owner-map alignment before the
 * G75 intersection test, so the work grid never becomes a road-placement term.
 */
import { worldXZToNormalizedReference } from '../../../../src/3d/world/worldReferenceAlignment.js';
import { G75_ROCK_SNOW_POLICY } from './g75_rock_snow.mjs';
import {
  G75_RELIEF_POLICY,
  sampleCanonicalWaterConfidence,
  sampleG75ReliefHeight,
} from './g75_relief.mjs';

export const G75_ROAD_PATH_POLICY = Object.freeze({
  id: 'kizil-ufuk-g75-terrain3d-road-path-2026-08-13-v1',
  sourceMapSha256: G75_RELIEF_POLICY.sourceMapSha256,
  geoCell: 'G75',
  gx: 7,
  gy: 5,
  layer: 'Road/Path',
  normalizedBounds: G75_ROCK_SNOW_POLICY.normalizedBounds,
  maskBounds: G75_RELIEF_POLICY.maskBounds,
  sourceGridSize: 257,
  heightGridSize: 65,
  terrain3dRegionSize: 256,
  baseTextureId: 0,
  roadTextureId: 2,
  pathTextureId: 3,
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

export function findG75CrossingEdges(runtimeNetwork) {
  const bounds = G75_ROAD_PATH_POLICY.normalizedBounds;
  const padding = G75_ROAD_PATH_POLICY.guardBandNormalized;
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

export function sampleG75RoadPath(normalizedX, normalizedY) {
  const waterConfidence = sampleCanonicalWaterConfidence(normalizedX, normalizedY);
  const landFactor = 1 - clamp01((waterConfidence - 0.38) / 0.24);
  return Object.freeze({
    waterConfidence,
    landFactor,
    roadCoverage: 0,
    pathCoverage: 0,
    coverage: 0,
    kind: 0,
  });
}

function fnv1a(checksum, value) {
  checksum ^= value & 0xff;
  return Math.imul(checksum, 16777619) >>> 0;
}

export function measureG75RoadPath(runtimeNetwork) {
  const crossings = findG75CrossingEdges(runtimeNetwork);
  const envelope = runtimeRoadReferenceEnvelope(runtimeNetwork);
  const { xMin, xMax, yMin, yMax } = G75_ROAD_PATH_POLICY.normalizedBounds;
  const size = G75_ROAD_PATH_POLICY.sourceGridSize;
  const guard = G75_ROAD_PATH_POLICY.guardBandNormalized;
  let checksum = 2166136261;
  let activeRoadSamples = 0;
  let activePathSamples = 0;
  let maxAdjacentCoverageStep = 0;
  let maxGuardBandCoverageDelta = 0;
  let canonicalWaterCells = 0;
  let canonicalLandCells = 0;
  let previousRow = null;

  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const sample = sampleG75RoadPath(nx, ny);
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
      Math.abs(sampleG75RoadPath(nx, yMin).coverage - sampleG75RoadPath(nx, yMin - guard).coverage),
      Math.abs(sampleG75RoadPath(nx, yMax).coverage - sampleG75RoadPath(nx, yMax + guard).coverage),
      Math.abs(sampleG75RoadPath(xMin, ny).coverage - sampleG75RoadPath(xMin - guard, ny).coverage),
      Math.abs(sampleG75RoadPath(xMax, ny).coverage - sampleG75RoadPath(xMax + guard, ny).coverage),
    );
  }

  const mask = G75_ROAD_PATH_POLICY.maskBounds;
  for (let y = mask.yMin; y <= mask.yMax; y += 1) {
    for (let x = mask.xMin; x <= mask.xMax; x += 1) {
      const sample = sampleG75RoadPath((x + 0.5) / 96, (y + 0.5) / 64);
      if (sample.waterConfidence >= 0.5) canonicalWaterCells += 1;
      else canonicalLandCells += 1;
    }
  }

  return Object.freeze({
    policyId: G75_ROAD_PATH_POLICY.id,
    sourceMapSha256: G75_ROAD_PATH_POLICY.sourceMapSha256,
    geoCell: 'G75',
    layer: G75_ROAD_PATH_POLICY.layer,
    sourceGridSize: size,
    sourceSamples: size * size,
    heightGridSize: G75_ROAD_PATH_POLICY.heightGridSize,
    terrain3dRegionSize: G75_ROAD_PATH_POLICY.terrain3dRegionSize,
    canonicalWaterCells,
    canonicalLandCells,
    crossingEdges: crossings,
    runtimeRoadReferenceEnvelope: envelope,
    activeRoadSamples,
    activePathSamples,
    maxAdjacentCoverageStep: Number(maxAdjacentCoverageStep.toFixed(8)),
    maxGuardBandCoverageDelta: Number(maxGuardBandCoverageDelta.toFixed(8)),
    coverageChecksum: checksum,
  });
}

export function buildG75RoadPathProbe(runtimeNetwork) {
  const bounds = G75_ROAD_PATH_POLICY.normalizedBounds;
  const heightSize = G75_ROAD_PATH_POLICY.heightGridSize;
  const heightRows = [];
  for (let y = 0; y < heightSize; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (heightSize - 1));
    const row = [];
    for (let x = 0; x < heightSize; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (heightSize - 1));
      row.push(Number(sampleG75ReliefHeight(nx, ny).toFixed(6)));
    }
    heightRows.push(row);
  }
  return Object.freeze({
    ...measureG75RoadPath(runtimeNetwork),
    baseTextureId: G75_ROAD_PATH_POLICY.baseTextureId,
    roadTextureId: G75_ROAD_PATH_POLICY.roadTextureId,
    pathTextureId: G75_ROAD_PATH_POLICY.pathTextureId,
    heightRows,
  });
}
