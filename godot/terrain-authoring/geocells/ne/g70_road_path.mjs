/**
 * Şafak Kartalı / NE GeoCell G70 — Road/Path through pinned Terrain3D.
 *
 * G70 is canonical 96/96 open sea. The real runtime road graph is projected
 * into owner-map coordinates and must remain outside this cell. Road/Path may
 * not turn an ocean work parcel into a bridge, causeway or square material
 * patch. Merged Rock/Snow height/control semantics are preserved exactly.
 */
import { worldXZToNormalizedReference } from '../../../../src/3d/world/worldReferenceAlignment.js';
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import {
  G70_TERRAIN3D_ROCK_SNOW_POLICY,
  sampleG70RockSnow,
} from './g70_rock_snow.mjs';

export const G70_TERRAIN3D_ROAD_PATH_POLICY = Object.freeze({
  id: 'safak-kartali-g70-terrain3d-road-path-2026-08-14-v1',
  sourceMapSha256: G70_TERRAIN3D_ROCK_SNOW_POLICY.sourceMapSha256,
  rockSnowPolicyId: G70_TERRAIN3D_ROCK_SNOW_POLICY.id,
  geoCell: 'G70', gx: 7, gy: 0, layer: 'Road/Path',
  normalizedBounds: G70_TERRAIN3D_ROCK_SNOW_POLICY.normalizedBounds,
  guardBandNormalized: G70_TERRAIN3D_ROCK_SNOW_POLICY.guardBandNormalized,
  qualificationGridSize: 257,
  probeGridSize: 65,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  baseTextureId: G70_TERRAIN3D_ROCK_SNOW_POLICY.baseTextureId,
  roadTextureId: 2,
  pathTextureId: 3,
  canonicalMaxSeatMapX: 6190,
  canonicalRouteCorridorPaddingMeters: 700,
  ownerMapWidthUnits: 9000,
});

function normalizedRuntimePoint(point, runtimeNetwork) {
  return worldXZToNormalizedReference(
    point.x,
    point.z,
    runtimeNetwork.mapBounds,
    runtimeNetwork.metersPerMapUnit,
  );
}

function segmentIntersectsBounds(a, b, bounds, padding = 0) {
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  return !(
    maxX < bounds.xMin - padding || minX > bounds.xMax + padding ||
    maxY < bounds.yMin - padding || minY > bounds.yMax + padding
  );
}

export function findG70CrossingEdges(runtimeNetwork) {
  const bounds = G70_TERRAIN3D_ROAD_PATH_POLICY.normalizedBounds;
  const padding = G70_TERRAIN3D_ROAD_PATH_POLICY.guardBandNormalized;
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
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, points = 0;
  for (const edge of [...(runtimeNetwork.mainEdges ?? []), ...(runtimeNetwork.footpathEdges ?? [])]) {
    for (const point of edge.points ?? []) {
      const n = normalizedRuntimePoint(point, runtimeNetwork);
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); points += 1;
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
  const paddingMapUnits = G70_TERRAIN3D_ROAD_PATH_POLICY.canonicalRouteCorridorPaddingMeters
    / FULL_REFERENCE_EXTENT_PLAN.metersPerMapUnit;
  return (G70_TERRAIN3D_ROAD_PATH_POLICY.canonicalMaxSeatMapX + paddingMapUnits)
    / G70_TERRAIN3D_ROAD_PATH_POLICY.ownerMapWidthUnits;
}

export function canonicalRoadExclusionMarginMeters() {
  return Math.max(
    0,
    G70_TERRAIN3D_ROAD_PATH_POLICY.normalizedBounds.xMin - canonicalRoadNetworkMaxNormalizedX(),
  ) * FULL_REFERENCE_EXTENT_PLAN.widthMeters;
}

export function sampleG70RoadPath(nx, ny) {
  const base = sampleG70RockSnow(nx, ny);
  if (!base.water || base.body !== 'sea') throw new Error(`G70 Road/Path requires canonical sea at ${nx},${ny}`);
  return Object.freeze({
    ...base,
    roadCoverage: 0,
    pathCoverage: 0,
    coverage: 0,
    roadGradeDeltaMeters: 0,
    authoredHeight: base.heightMeters,
    roadPathControlBlend: 0,
    kind: 0,
  });
}

export function measureG70Terrain3DRoadPath(runtimeNetwork) {
  const p = G70_TERRAIN3D_ROAD_PATH_POLICY;
  const b = p.normalizedBounds;
  const size = p.qualificationGridSize;
  let waterCells = 0, landCells = 0;
  for (let y = 0; y < 8; y += 1) for (let x = 84; x < 96; x += 1) {
    sampleG70RoadPath((x + 0.5) / 96, (y + 0.5) / 64).water ? waterCells++ : landCells++;
  }
  let activeRoadSamples = 0, activePathSamples = 0, nonSeaSamples = 0;
  let maxHeightDelta = 0, maxSurfaceDelta = 0, maxAdjacentCoverageStep = 0;
  let previousRow = null;
  for (let y = 0; y < size; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (size - 1);
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (size - 1);
      const base = sampleG70RockSnow(nx, ny);
      const s = sampleG70RoadPath(nx, ny);
      if (s.body !== 'sea') nonSeaSamples += 1;
      if (s.roadCoverage > 0) activeRoadSamples += 1;
      if (s.pathCoverage > 0) activePathSamples += 1;
      maxHeightDelta = Math.max(maxHeightDelta, Math.abs(s.authoredHeight - base.heightMeters));
      maxSurfaceDelta = Math.max(
        maxSurfaceDelta,
        Math.abs(s.rockWeight - base.rockWeight),
        Math.abs(s.snowWeight - base.snowWeight),
        Math.abs(s.terrestrialSurfaceMass - base.terrestrialSurfaceMass),
        Math.abs(s.controlBlend - base.controlBlend),
      );
      if (x) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(s.coverage - row[x - 1]));
      if (previousRow) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(s.coverage - previousRow[x]));
      row.push(s.coverage);
    }
    previousRow = row;
  }
  const crossings = findG70CrossingEdges(runtimeNetwork);
  return Object.freeze({
    policyId: p.id, sourceMapSha256: p.sourceMapSha256, rockSnowPolicyId: p.rockSnowPolicyId,
    geoCell: p.geoCell, layer: p.layer,
    canonicalWaterCells: waterCells, canonicalLandCells: landCells,
    qualificationSamples: size * size, nonSeaSamples,
    activeRoadSamples, activePathSamples,
    maxHeightDelta, maxSurfaceDelta, maxAdjacentCoverageStep,
    crossingEdges: crossings,
    runtimeRoadReferenceEnvelope: runtimeRoadReferenceEnvelope(runtimeNetwork),
    canonicalRoadNetworkMaxNormalizedX: Number(canonicalRoadNetworkMaxNormalizedX().toFixed(8)),
    canonicalRoadExclusionMarginMeters: Number(canonicalRoadExclusionMarginMeters().toFixed(3)),
    terrain3dImportSize: p.terrain3dImportSize, terrain3dRegionSize: p.terrain3dRegionSize,
  });
}

export function buildG70Terrain3DRoadPathProbe(runtimeNetwork) {
  const p = G70_TERRAIN3D_ROAD_PATH_POLICY;
  const b = p.normalizedBounds;
  const rows = [];
  for (let y = 0; y < p.probeGridSize; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (p.probeGridSize - 1);
    const row = [];
    for (let x = 0; x < p.probeGridSize; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (p.probeGridSize - 1);
      const s = sampleG70RoadPath(nx, ny);
      row.push([Number(s.authoredHeight.toFixed(6)), s.roadCoverage, s.pathCoverage, s.roadPathControlBlend, s.kind]);
    }
    rows.push(row);
  }
  const metrics = measureG70Terrain3DRoadPath(runtimeNetwork);
  return Object.freeze({
    schema: 'westeros-g70-terrain3d-road-path-probe-v1',
    policyId: p.id, sourceMapSha256: p.sourceMapSha256, rockSnowPolicyId: p.rockSnowPolicyId,
    geoCell: p.geoCell, layer: p.layer, probeGridSize: p.probeGridSize,
    terrain3dImportSize: p.terrain3dImportSize, terrain3dRegionSize: p.terrain3dRegionSize,
    baseTextureId: p.baseTextureId, roadTextureId: p.roadTextureId, pathTextureId: p.pathTextureId,
    crossingEdges: metrics.crossingEdges, runtimeRoadReferenceEnvelope: metrics.runtimeRoadReferenceEnvelope,
    canonicalRoadExclusionMarginMeters: metrics.canonicalRoadExclusionMarginMeters,
    rows,
  });
}
