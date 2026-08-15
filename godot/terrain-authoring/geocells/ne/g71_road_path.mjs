/**
 * Şafak Kartalı / NE GeoCell G71 — Road/Path through pinned Terrain3D.
 *
 * G71 is canonical 96/96 open sea. Road/Path may not invent a causeway,
 * bridge, footpath or GeoCell-shaped surface patch. The shipped deterministic
 * road graph is projected into owner-map coordinates and audited against the
 * west+north+south guard band. East is the exact owner-world boundary x=1.
 */
import { worldXZToNormalizedReference } from '../../../../src/3d/world/worldReferenceAlignment.js';
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import {
  G71_TERRAIN3D_ROCK_SNOW_POLICY,
  sampleG71RockSnow,
} from './g71_rock_snow.mjs';

export const G71_TERRAIN3D_ROAD_PATH_POLICY = Object.freeze({
  id: 'safak-kartali-g71-terrain3d-road-path-2026-08-16-v1',
  sourceMapSha256: G71_TERRAIN3D_ROCK_SNOW_POLICY.sourceMapSha256,
  rockSnowPolicyId: G71_TERRAIN3D_ROCK_SNOW_POLICY.id,
  geoCell: 'G71', gx: 7, gy: 1, layer: 'Road/Path',
  normalizedBounds: G71_TERRAIN3D_ROCK_SNOW_POLICY.normalizedBounds,
  guardNormalized: G71_TERRAIN3D_ROCK_SNOW_POLICY.guardNormalized,
  sourceGridSize: 65,
  qualificationGridSize: 257,
  denseGuardSize: 193,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  baseTextureId: G71_TERRAIN3D_ROCK_SNOW_POLICY.baseTextureId,
  substrateOverlayTextureId: G71_TERRAIN3D_ROCK_SNOW_POLICY.overlayTextureId,
  roadTextureId: 2,
  pathTextureId: 3,
  canonicalMaxSeatMapX: 6190,
  canonicalRouteCorridorPaddingMeters: 700,
  ownerMapWidthUnits: 9000,
  eastWorldBoundaryX: 1,
  eastGuardAllowed: false,
});

function normalizedRuntimePoint(point, runtimeNetwork) {
  return worldXZToNormalizedReference(
    point.x,
    point.z,
    runtimeNetwork.mapBounds,
    runtimeNetwork.metersPerMapUnit,
  );
}

function segmentIntersectsBounds(a, b, bounds) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, a.x - bounds.xMin],
    [dx, bounds.xMax - a.x],
    [-dy, a.y - bounds.yMin],
    [dy, bounds.yMax - a.y],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

export function g71RoadGuardBounds() {
  const p = G71_TERRAIN3D_ROAD_PATH_POLICY;
  const b = p.normalizedBounds;
  const g = p.guardNormalized;
  return Object.freeze({
    xMin: b.xMin - g,
    xMax: p.eastWorldBoundaryX,
    yMin: b.yMin - g,
    yMax: b.yMax + g,
  });
}

export function findG71CrossingEdges(runtimeNetwork) {
  const bounds = g71RoadGuardBounds();
  const inspect = (edges, tier) => (edges ?? []).flatMap((edge) => {
    const points = (edge.points ?? []).map((point) => normalizedRuntimePoint(point, runtimeNetwork));
    for (let i = 1; i < points.length; i += 1) {
      if (segmentIntersectsBounds(points[i - 1], points[i], bounds)) {
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
  const p = G71_TERRAIN3D_ROAD_PATH_POLICY;
  const paddingMapUnits = p.canonicalRouteCorridorPaddingMeters / FULL_REFERENCE_EXTENT_PLAN.metersPerMapUnit;
  return (p.canonicalMaxSeatMapX + paddingMapUnits) / p.ownerMapWidthUnits;
}

export function canonicalRoadGuardMarginMeters() {
  return Math.max(0, g71RoadGuardBounds().xMin - canonicalRoadNetworkMaxNormalizedX())
    * FULL_REFERENCE_EXTENT_PLAN.widthMeters;
}

export function sampleG71RoadPath(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('G71 Road/Path coordinates must be finite');
  }
  if (normalizedX > G71_TERRAIN3D_ROAD_PATH_POLICY.eastWorldBoundaryX + 1e-12) {
    throw new RangeError(`G71 Road/Path cannot sample east of owner world at x=${normalizedX}`);
  }
  const base = sampleG71RockSnow(normalizedX, normalizedY);
  if (!base.water || base.body !== 'sea') {
    throw new Error(`G71 Road/Path requires canonical sea at ${normalizedX},${normalizedY}`);
  }
  return Object.freeze({
    ...base,
    roadCoverage: 0,
    pathCoverage: 0,
    coverage: 0,
    roadGradeDeltaMeters: 0,
    authoredHeight: base.heightMeters,
    roadPathControlBlend: base.controlBlend,
    kind: 0,
  });
}

export function measureG71Terrain3DRoadPath(runtimeNetwork) {
  const p = G71_TERRAIN3D_ROAD_PATH_POLICY;
  const b = p.normalizedBounds;
  const size = p.qualificationGridSize;
  let canonicalWaterCells = 0, canonicalLandCells = 0;
  for (let y = 8; y < 16; y += 1) for (let x = 84; x < 96; x += 1) {
    sampleG71RoadPath((x + 0.5) / 96, (y + 0.5) / 64).water ? canonicalWaterCells++ : canonicalLandCells++;
  }
  let nonSeaSamples = 0, activeRoadSamples = 0, activePathSamples = 0;
  let maxCoverage = 0, maxHeightDelta = 0, maxSurfaceDelta = 0, maxAdjacentCoverageStep = 0;
  let previousRow = null;
  for (let y = 0; y < size; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (size - 1);
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (size - 1);
      const base = sampleG71RockSnow(nx, ny);
      const sample = sampleG71RoadPath(nx, ny);
      if (sample.body !== 'sea') nonSeaSamples += 1;
      if (sample.roadCoverage > 0) activeRoadSamples += 1;
      if (sample.pathCoverage > 0) activePathSamples += 1;
      maxCoverage = Math.max(maxCoverage, Math.abs(sample.coverage));
      maxHeightDelta = Math.max(maxHeightDelta, Math.abs(sample.authoredHeight - base.heightMeters));
      maxSurfaceDelta = Math.max(maxSurfaceDelta,
        Math.abs(sample.rockWeight - base.rockWeight), Math.abs(sample.snowWeight - base.snowWeight),
        Math.abs(sample.terrestrialSurfaceMass - base.terrestrialSurfaceMass),
        Math.abs(sample.controlBlend - base.controlBlend),
        ...sample.color.map((value, i) => Math.abs(value - base.color[i])),
        Math.abs(sample.roughness - base.roughness));
      if (x) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(sample.coverage - row[x - 1]));
      if (previousRow) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(sample.coverage - previousRow[x]));
      row.push(sample.coverage);
    }
    previousRow = row;
  }
  const crossings = findG71CrossingEdges(runtimeNetwork);
  return Object.freeze({
    policyId: p.id, sourceMapSha256: p.sourceMapSha256, rockSnowPolicyId: p.rockSnowPolicyId,
    geoCell: p.geoCell, layer: p.layer,
    canonicalWaterCells, canonicalLandCells, qualificationSamples: size * size, nonSeaSamples,
    activeRoadSamples, activePathSamples, maxCoverage, maxHeightDelta, maxSurfaceDelta,
    maxAdjacentCoverageStep, crossingEdges: crossings,
    runtimeRoadReferenceEnvelope: runtimeRoadReferenceEnvelope(runtimeNetwork),
    canonicalRoadNetworkMaxNormalizedX: Number(canonicalRoadNetworkMaxNormalizedX().toFixed(8)),
    canonicalRoadGuardMarginMeters: Number(canonicalRoadGuardMarginMeters().toFixed(3)),
    eastWorldBoundaryX: p.eastWorldBoundaryX, eastGuardAllowed: p.eastGuardAllowed,
    terrain3dImportSize: p.terrain3dImportSize, terrain3dRegionSize: p.terrain3dRegionSize,
  });
}

export function buildG71Terrain3DRoadPathProbe(runtimeNetwork) {
  const p = G71_TERRAIN3D_ROAD_PATH_POLICY;
  const b = p.normalizedBounds;
  const rows = [];
  for (let y = 0; y < p.sourceGridSize; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (p.sourceGridSize - 1);
    const row = [];
    for (let x = 0; x < p.sourceGridSize; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (p.sourceGridSize - 1);
      const s = sampleG71RoadPath(nx, ny);
      row.push([
        Number(s.authoredHeight.toFixed(6)), s.roadCoverage, s.pathCoverage,
        s.roadPathControlBlend, s.kind,
        Number(s.color[0].toFixed(6)), Number(s.color[1].toFixed(6)),
        Number(s.color[2].toFixed(6)), Number(s.roughness.toFixed(6)),
      ]);
    }
    rows.push(row);
  }
  const metrics = measureG71Terrain3DRoadPath(runtimeNetwork);
  return Object.freeze({
    schema: 'westeros-g71-terrain3d-road-path-probe-v1',
    policyId: p.id, sourceMapSha256: p.sourceMapSha256, rockSnowPolicyId: p.rockSnowPolicyId,
    geoCell: p.geoCell, layer: p.layer, normalizedBounds: p.normalizedBounds,
    guardBounds: g71RoadGuardBounds(), sourceGridSize: p.sourceGridSize,
    terrain3dImportSize: p.terrain3dImportSize, terrain3dRegionSize: p.terrain3dRegionSize,
    baseTextureId: p.baseTextureId, substrateOverlayTextureId: p.substrateOverlayTextureId,
    roadTextureId: p.roadTextureId, pathTextureId: p.pathTextureId,
    crossingEdges: metrics.crossingEdges,
    runtimeRoadReferenceEnvelope: metrics.runtimeRoadReferenceEnvelope,
    canonicalRoadGuardMarginMeters: metrics.canonicalRoadGuardMarginMeters,
    eastWorldBoundaryX: p.eastWorldBoundaryX, eastGuardAllowed: p.eastGuardAllowed,
    rows,
  });
}
