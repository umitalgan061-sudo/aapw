/**
 * Şafak Kartalı / NE G60 — Road/Path through pinned Terrain3D.
 * G60 is canonical 96/96 open sea. Road/Path must therefore prove the live
 * deterministic road graph stays outside the owner cell + guard band and must
 * preserve the merged Rock/Snow height/control/color substrate byte-for-byte in meaning.
 */
import { worldXZToNormalizedReference } from '../../../../src/3d/world/worldReferenceAlignment.js';
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import { G60_TERRAIN3D_ROCK_SNOW_POLICY, sampleG60RockSnow } from './g60_rock_snow.mjs';

export const G60_TERRAIN3D_ROAD_PATH_POLICY = Object.freeze({
  id: 'safak-kartali-g60-terrain3d-road-path-2026-08-15-v1',
  sourceMapSha256: G60_TERRAIN3D_ROCK_SNOW_POLICY.sourceMapSha256,
  rockSnowPolicyId: G60_TERRAIN3D_ROCK_SNOW_POLICY.id,
  geoCell: 'G60', gx: 6, gy: 0, layer: 'Road/Path',
  normalizedBounds: G60_TERRAIN3D_ROCK_SNOW_POLICY.normalizedBounds,
  guardNormalized: G60_TERRAIN3D_ROCK_SNOW_POLICY.guardNormalized,
  sourceGridSize: 65,
  qualificationGridSize: 257,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  baseTextureId: G60_TERRAIN3D_ROCK_SNOW_POLICY.baseTextureId,
  substrateOverlayTextureId: G60_TERRAIN3D_ROCK_SNOW_POLICY.overlayTextureId,
  roadTextureId: 2,
  pathTextureId: 3,
  canonicalMaxSeatMapX: 6190,
  canonicalRouteCorridorPaddingMeters: 700,
  ownerMapWidthUnits: 9000,
});

function normalizedRuntimePoint(point, runtimeNetwork) {
  return worldXZToNormalizedReference(point.x, point.z, runtimeNetwork.mapBounds, runtimeNetwork.metersPerMapUnit);
}

function segmentIntersectsBounds(a, b, bounds) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [
    [-dx, a.x - bounds.xMin], [dx, bounds.xMax - a.x],
    [-dy, a.y - bounds.yMin], [dy, bounds.yMax - a.y],
  ]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 <= t1;
}

export function g60RoadGuardBounds() {
  const b = G60_TERRAIN3D_ROAD_PATH_POLICY.normalizedBounds;
  const g = G60_TERRAIN3D_ROAD_PATH_POLICY.guardNormalized;
  return Object.freeze({ xMin: b.xMin - g, xMax: b.xMax + g, yMin: b.yMin, yMax: b.yMax + g });
}

export function findG60CrossingEdges(runtimeNetwork) {
  const bounds = g60RoadGuardBounds();
  const inspect = (edges, tier) => (edges ?? []).flatMap((edge) => {
    const points = (edge.points ?? []).map((point) => normalizedRuntimePoint(point, runtimeNetwork));
    for (let i = 1; i < points.length; i += 1) {
      if (segmentIntersectsBounds(points[i - 1], points[i], bounds)) {
        return [{ tier, fromId: edge.fromId, toId: edge.toId, pointCount: points.length }];
      }
    }
    return [];
  });
  return Object.freeze([...inspect(runtimeNetwork.mainEdges, 'road'), ...inspect(runtimeNetwork.footpathEdges, 'path')]);
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
  return Object.freeze({ points,
    minX: Number((Number.isFinite(minX) ? minX : 0).toFixed(8)), maxX: Number((Number.isFinite(maxX) ? maxX : 0).toFixed(8)),
    minY: Number((Number.isFinite(minY) ? minY : 0).toFixed(8)), maxY: Number((Number.isFinite(maxY) ? maxY : 0).toFixed(8)),
  });
}

export function canonicalRoadNetworkMaxNormalizedX() {
  const p = G60_TERRAIN3D_ROAD_PATH_POLICY;
  const paddingMapUnits = p.canonicalRouteCorridorPaddingMeters / FULL_REFERENCE_EXTENT_PLAN.metersPerMapUnit;
  return (p.canonicalMaxSeatMapX + paddingMapUnits) / p.ownerMapWidthUnits;
}

export function canonicalRoadGuardMarginMeters() {
  const p = G60_TERRAIN3D_ROAD_PATH_POLICY;
  return Math.max(0, p.normalizedBounds.xMin - p.guardNormalized - canonicalRoadNetworkMaxNormalizedX())
    * FULL_REFERENCE_EXTENT_PLAN.widthMeters;
}

export function sampleG60RoadPath(normalizedX, normalizedY) {
  const base = sampleG60RockSnow(normalizedX, normalizedY);
  if (!base.water || base.body !== 'sea') throw new Error(`G60 Road/Path requires canonical sea at ${normalizedX},${normalizedY}`);
  return Object.freeze({ ...base,
    roadCoverage: 0, pathCoverage: 0, coverage: 0, roadGradeDeltaMeters: 0,
    authoredHeight: base.heightMeters, roadPathControlBlend: base.controlBlend, kind: 0,
  });
}

export function measureG60Terrain3DRoadPath(runtimeNetwork) {
  const p = G60_TERRAIN3D_ROAD_PATH_POLICY, b = p.normalizedBounds, size = p.qualificationGridSize;
  let canonicalWaterCells = 0, canonicalLandCells = 0;
  for (let y = 0; y < 8; y += 1) for (let x = 72; x < 84; x += 1) {
    sampleG60RoadPath((x + 0.5) / 96, (y + 0.5) / 64).water ? canonicalWaterCells++ : canonicalLandCells++;
  }
  let nonSeaSamples = 0, activeRoadSamples = 0, activePathSamples = 0;
  let maxHeightDelta = 0, maxSurfaceDelta = 0, maxCoverage = 0, maxAdjacentCoverageStep = 0;
  let previousRow = null;
  for (let y = 0; y < size; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (size - 1), row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (size - 1);
      const base = sampleG60RockSnow(nx, ny), s = sampleG60RoadPath(nx, ny);
      if (s.body !== 'sea') nonSeaSamples += 1;
      if (s.roadCoverage > 0) activeRoadSamples += 1; if (s.pathCoverage > 0) activePathSamples += 1;
      maxCoverage = Math.max(maxCoverage, Math.abs(s.coverage));
      maxHeightDelta = Math.max(maxHeightDelta, Math.abs(s.authoredHeight - base.heightMeters));
      maxSurfaceDelta = Math.max(maxSurfaceDelta,
        Math.abs(s.rockWeight - base.rockWeight), Math.abs(s.snowWeight - base.snowWeight),
        Math.abs(s.terrestrialSurfaceMass - base.terrestrialSurfaceMass), Math.abs(s.controlBlend - base.controlBlend),
        ...s.color.map((value, i) => Math.abs(value - base.color[i])), Math.abs(s.roughness - base.roughness));
      if (x) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(s.coverage - row[x - 1]));
      if (previousRow) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(s.coverage - previousRow[x]));
      row.push(s.coverage);
    }
    previousRow = row;
  }
  const crossings = findG60CrossingEdges(runtimeNetwork), envelope = runtimeRoadReferenceEnvelope(runtimeNetwork);
  return Object.freeze({
    policyId: p.id, sourceMapSha256: p.sourceMapSha256, rockSnowPolicyId: p.rockSnowPolicyId,
    geoCell: p.geoCell, layer: p.layer, canonicalWaterCells, canonicalLandCells,
    qualificationSamples: size * size, nonSeaSamples, activeRoadSamples, activePathSamples,
    maxCoverage, maxHeightDelta, maxSurfaceDelta, maxAdjacentCoverageStep,
    crossingEdges: crossings, runtimeRoadReferenceEnvelope: envelope,
    canonicalRoadNetworkMaxNormalizedX: Number(canonicalRoadNetworkMaxNormalizedX().toFixed(8)),
    canonicalRoadGuardMarginMeters: Number(canonicalRoadGuardMarginMeters().toFixed(3)),
    terrain3dImportSize: p.terrain3dImportSize, terrain3dRegionSize: p.terrain3dRegionSize,
  });
}

export function buildG60Terrain3DRoadPathProbe(runtimeNetwork) {
  const p = G60_TERRAIN3D_ROAD_PATH_POLICY, b = p.normalizedBounds, rows = [];
  for (let y = 0; y < p.sourceGridSize; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (p.sourceGridSize - 1), row = [];
    for (let x = 0; x < p.sourceGridSize; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (p.sourceGridSize - 1), s = sampleG60RoadPath(nx, ny);
      row.push([Number(s.authoredHeight.toFixed(6)), s.roadCoverage, s.pathCoverage, s.roadPathControlBlend, s.kind,
        Number(s.color[0].toFixed(6)), Number(s.color[1].toFixed(6)), Number(s.color[2].toFixed(6)), Number(s.roughness.toFixed(6))]);
    }
    rows.push(row);
  }
  const metrics = measureG60Terrain3DRoadPath(runtimeNetwork);
  return Object.freeze({
    schema: 'westeros-g60-terrain3d-road-path-probe-v1', policyId: p.id, sourceMapSha256: p.sourceMapSha256,
    rockSnowPolicyId: p.rockSnowPolicyId, geoCell: p.geoCell, layer: p.layer, normalizedBounds: p.normalizedBounds,
    guardNormalized: p.guardNormalized, sourceGridSize: p.sourceGridSize, terrain3dImportSize: p.terrain3dImportSize,
    terrain3dRegionSize: p.terrain3dRegionSize, baseTextureId: p.baseTextureId,
    substrateOverlayTextureId: p.substrateOverlayTextureId, roadTextureId: p.roadTextureId, pathTextureId: p.pathTextureId,
    crossingEdges: metrics.crossingEdges, runtimeRoadReferenceEnvelope: metrics.runtimeRoadReferenceEnvelope,
    canonicalRoadGuardMarginMeters: metrics.canonicalRoadGuardMarginMeters, rows,
  });
}
