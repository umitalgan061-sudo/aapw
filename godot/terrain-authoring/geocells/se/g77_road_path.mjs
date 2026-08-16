/** Kızıl Ufuk / SE G77 Road/Path. GeoCell bounds are addressing only. */
import {
  normalizedReferenceToWorldXZ,
  worldXZToNormalizedReference,
} from '../../../../src/3d/world/worldReferenceAlignment.js';
import {
  G77_ROCK_SNOW_POLICY,
  buildG77RockSnowControlContract,
  measureG77RockSnow,
  sampleG77RockSnow,
} from './g77_rock_snow.mjs';

export const G77_ROAD_PATH_POLICY = Object.freeze({
  id: 'kizil-ufuk-g77-terrain3d-road-path-2026-08-16-v1',
  sourceMapSha256: G77_ROCK_SNOW_POLICY.sourceMapSha256,
  sourceMapVersion: G77_ROCK_SNOW_POLICY.sourceMapVersion,
  geoCell: 'G77', gx: 7, gy: 7, layer: 'Road/Path',
  normalizedBounds: G77_ROCK_SNOW_POLICY.normalizedBounds,
  maskBounds: G77_ROCK_SNOW_POLICY.maskBounds,
  sourceGridSize: 257,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  groundTextureId: G77_ROCK_SNOW_POLICY.groundTextureId,
  rockTextureId: G77_ROCK_SNOW_POLICY.rockTextureId,
  snowTextureId: G77_ROCK_SNOW_POLICY.snowTextureId,
  roadTextureId: 3,
  pathTextureId: 4,
  roadWidthMeters: 8,
  footpathWidthMeters: 2.5,
  roadFeatherMeters: 14,
  footpathFeatherMeters: 7,
  guardXNormalized: 1 / 1536,
  guardYNormalized: 1 / 1024,
  ownerMaxNormalized: 1,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (a, b, value) => {
  if (b <= a) return value >= b ? 1 : 0;
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function requireOwnerPoint(nx, ny) {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new TypeError('G77 Road/Path coordinates must be finite');
  if (nx < 0 || ny < 0 || nx > 1 || ny > 1) throw new RangeError(`G77 Road/Path escaped owner map: ${nx},${ny}`);
}

export function normalizedToWorld(nx, ny, runtimeNetwork) {
  requireOwnerPoint(nx, ny);
  return normalizedReferenceToWorldXZ(nx, ny, runtimeNetwork.mapBounds, runtimeNetwork.metersPerMapUnit);
}

export function worldToNormalized(x, z, runtimeNetwork) {
  return worldXZToNormalizedReference(x, z, runtimeNetwork.mapBounds, runtimeNetwork.metersPerMapUnit);
}

function pointSegmentDistanceMeters(point, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
  if (length2 <= 1e-12) return Math.hypot(point.x - a.x, point.z - a.z);
  const t = clamp01(((point.x - a.x) * dx + (point.z - a.z) * dz) / length2);
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

function polylineCoverage(point, edges, widthMeters, featherMeters) {
  let closest = Infinity;
  for (const edge of edges ?? []) {
    const points = edge.points ?? [];
    for (let i = 1; i < points.length; i += 1) closest = Math.min(closest, pointSegmentDistanceMeters(point, points[i - 1], points[i]));
  }
  if (!Number.isFinite(closest)) return 0;
  const halfWidth = widthMeters * 0.5;
  return 1 - smoothstep(halfWidth, halfWidth + featherMeters, closest);
}

function settlementLandSupport(point, runtimeNetwork) {
  let support = 0;
  for (const pad of runtimeNetwork.settlementPads ?? []) {
    if (!(pad.anchorHeightMeters > runtimeNetwork.waterLevelMeters)) continue;
    const d = Math.hypot(point.x - pad.x, point.z - pad.z);
    support = Math.max(support, 1 - smoothstep(pad.innerRadiusMeters, pad.outerRadiusMeters, d));
  }
  return clamp01(support);
}

function liangBarskyIntersects(a, b, bounds) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a.x - bounds.xMin], [dx, bounds.xMax - a.x], [-dy, a.y - bounds.yMin], [dy, bounds.yMax - a.y]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; t0 = Math.max(t0, r); }
    else { if (r < t0) return false; t1 = Math.min(t1, r); }
  }
  return t0 <= t1;
}

export function g77RoadGuardBounds() {
  const b = G77_ROAD_PATH_POLICY.normalizedBounds;
  return Object.freeze({
    xMin: b.xMin - G77_ROAD_PATH_POLICY.guardXNormalized,
    xMax: G77_ROAD_PATH_POLICY.ownerMaxNormalized,
    yMin: b.yMin - G77_ROAD_PATH_POLICY.guardYNormalized,
    yMax: G77_ROAD_PATH_POLICY.ownerMaxNormalized,
  });
}

export function findG77CrossingEdges(runtimeNetwork) {
  const bounds = g77RoadGuardBounds();
  const inspect = (edges, tier) => (edges ?? []).flatMap((edge) => {
    const points = (edge.points ?? []).map((p) => worldToNormalized(p.x, p.z, runtimeNetwork));
    for (let i = 1; i < points.length; i += 1) {
      if (liangBarskyIntersects(points[i - 1], points[i], bounds)) return [{ tier, fromId: edge.fromId, toId: edge.toId, pointCount: points.length }];
    }
    return [];
  });
  return Object.freeze([...inspect(runtimeNetwork.mainEdges, 'road'), ...inspect(runtimeNetwork.footpathEdges, 'path')]);
}

export function runtimeRoadReferenceEnvelope(runtimeNetwork) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, points = 0;
  for (const edge of [...(runtimeNetwork.mainEdges ?? []), ...(runtimeNetwork.footpathEdges ?? [])]) for (const point of edge.points ?? []) {
    const n = worldToNormalized(point.x, point.z, runtimeNetwork);
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); points += 1;
  }
  const finite = (v) => Number((Number.isFinite(v) ? v : 0).toFixed(8));
  return Object.freeze({ points, minX: finite(minX), maxX: finite(maxX), minY: finite(minY), maxY: finite(maxY) });
}

export function sampleG77RoadPath(nx, ny, runtimeNetwork) {
  requireOwnerPoint(nx, ny);
  const substrate = sampleG77RockSnow(nx, ny);
  const point = normalizedToWorld(nx, ny, runtimeNetwork);
  const roadRaw = polylineCoverage(point, runtimeNetwork.mainEdges, G77_ROAD_PATH_POLICY.roadWidthMeters, G77_ROAD_PATH_POLICY.roadFeatherMeters);
  const pathRaw = polylineCoverage(point, runtimeNetwork.footpathEdges, G77_ROAD_PATH_POLICY.footpathWidthMeters, G77_ROAD_PATH_POLICY.footpathFeatherMeters);
  const settlementSupport = settlementLandSupport(point, runtimeNetwork);
  const landFactor = Math.max(substrate.landFactor, settlementSupport);
  const roadCoverage = roadRaw * landFactor;
  const pathCoverage = pathRaw * landFactor * (1 - roadCoverage);
  const coverage = Math.max(roadCoverage, pathCoverage);
  const kind = roadCoverage >= pathCoverage && roadCoverage > 0 ? 1 : pathCoverage > 0 ? 2 : 0;
  return Object.freeze({ ...substrate, authoredHeight: substrate.height, settlementLandSupport: settlementSupport, roadCoverage, pathCoverage, coverage, kind });
}

export function buildG77RoadPathControlContract(surface) {
  if (surface.coverage <= 0.002) return buildG77RockSnowControlContract(surface);
  const candidates = [
    [surface.groundWeight, G77_ROAD_PATH_POLICY.groundTextureId],
    [surface.rockWeight, G77_ROAD_PATH_POLICY.rockTextureId],
    [surface.snowWeight, G77_ROAD_PATH_POLICY.snowTextureId],
  ].sort((a, b) => b[0] - a[0]);
  return Object.freeze({
    baseTextureId: candidates[0][1],
    overlayTextureId: surface.kind === 2 ? G77_ROAD_PATH_POLICY.pathTextureId : G77_ROAD_PATH_POLICY.roadTextureId,
    overlayBlend: clamp01(surface.coverage),
    overlayBlend8: Math.round(clamp01(surface.coverage) * 255),
  });
}

function fnv1a(sum, value) { return Math.imul((sum ^ (value & 0xff)) >>> 0, 16777619) >>> 0; }

export function measureG77RoadPath(runtimeNetwork) {
  const p = G77_ROAD_PATH_POLICY, b = p.normalizedBounds, size = p.sourceGridSize;
  const rockSnow = measureG77RockSnow();
  let activeRoadSamples = 0, activePathSamples = 0, checksum = 2166136261;
  let maxAdjacentCoverageStep = 0, maxNorthWestGuardDelta = 0, maxWaterLeak = 0, maxHeightDelta = 0, maxSubstrateDeltaOffRoute = 0;
  let previousRow = null;
  for (let y = 0; y < size; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (size - 1), row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (size - 1), base = sampleG77RockSnow(nx, ny), s = sampleG77RoadPath(nx, ny, runtimeNetwork);
      if (s.roadCoverage > 0.02) activeRoadSamples += 1;
      if (s.pathCoverage > 0.02) activePathSamples += 1;
      if (x) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(s.coverage - row[x - 1]));
      if (previousRow) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(s.coverage - previousRow[x]));
      maxHeightDelta = Math.max(maxHeightDelta, Math.abs(s.authoredHeight - base.height));
      if (s.coverage <= 0.002) maxSubstrateDeltaOffRoute = Math.max(maxSubstrateDeltaOffRoute, Math.abs(s.groundWeight - base.groundWeight), Math.abs(s.rockWeight - base.rockWeight), Math.abs(s.snowWeight - base.snowWeight));
      if (s.waterConfidence >= 0.5 && s.settlementLandSupport <= 0.001) maxWaterLeak = Math.max(maxWaterLeak, s.coverage);
      checksum = fnv1a(fnv1a(checksum, Math.round(s.roadCoverage * 255)), Math.round(s.pathCoverage * 255)); row.push(s.coverage);
    }
    previousRow = row;
  }
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1), nx = b.xMin + (b.xMax - b.xMin) * t, ny = b.yMin + (b.yMax - b.yMin) * t;
    maxNorthWestGuardDelta = Math.max(maxNorthWestGuardDelta,
      Math.abs(sampleG77RoadPath(b.xMin, ny, runtimeNetwork).coverage - sampleG77RoadPath(b.xMin - p.guardXNormalized, ny, runtimeNetwork).coverage),
      Math.abs(sampleG77RoadPath(nx, b.yMin, runtimeNetwork).coverage - sampleG77RoadPath(nx, b.yMin - p.guardYNormalized, runtimeNetwork).coverage));
  }
  return Object.freeze({
    policyId: p.id, sourceMapSha256: p.sourceMapSha256, sourceMapVersion: p.sourceMapVersion, geoCell: p.geoCell, layer: p.layer,
    sourceGridSize: size, sourceSamples: size * size, terrain3dImportSize: p.terrain3dImportSize, terrain3dRegionSize: p.terrain3dRegionSize,
    canonicalWaterCells: rockSnow.canonicalWaterCells, canonicalLandCells: rockSnow.canonicalLandCells,
    crossingEdges: findG77CrossingEdges(runtimeNetwork), runtimeRoadReferenceEnvelope: runtimeRoadReferenceEnvelope(runtimeNetwork),
    activeRoadSamples, activePathSamples, maxAdjacentCoverageStep: Number(maxAdjacentCoverageStep.toFixed(8)), maxNorthWestGuardDelta: Number(maxNorthWestGuardDelta.toFixed(8)),
    maxCanonicalWaterCoverageOutsideSettlement: Number(maxWaterLeak.toFixed(8)), maxHeightDeltaMeters: Number(maxHeightDelta.toFixed(8)), maxSubstrateDeltaOffRoute: Number(maxSubstrateDeltaOffRoute.toFixed(8)), coverageChecksum: checksum,
  });
}

export function buildG77RoadPathProbe(runtimeNetwork) {
  const p = G77_ROAD_PATH_POLICY, b = p.normalizedBounds, rows = [];
  for (let y = 0; y < p.sourceGridSize; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (p.sourceGridSize - 1), row = [];
    for (let x = 0; x < p.sourceGridSize; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (p.sourceGridSize - 1), s = sampleG77RoadPath(nx, ny, runtimeNetwork), c = buildG77RoadPathControlContract(s);
      row.push([Number(s.authoredHeight.toFixed(6)), Number(s.roadCoverage.toFixed(8)), Number(s.pathCoverage.toFixed(8)), s.kind, Number(s.groundWeight.toFixed(8)), Number(s.rockWeight.toFixed(8)), Number(s.snowWeight.toFixed(8)), Number(s.waterConfidence.toFixed(8)), Number(s.settlementLandSupport.toFixed(8)), c.baseTextureId, c.overlayTextureId, c.overlayBlend8]);
    }
    rows.push(row);
  }
  return Object.freeze({ schema: 'westeros-g77-terrain3d-road-path-probe-v1', ...measureG77RoadPath(runtimeNetwork),
    groundTextureId: p.groundTextureId, rockTextureId: p.rockTextureId, snowTextureId: p.snowTextureId, roadTextureId: p.roadTextureId, pathTextureId: p.pathTextureId,
    normalizedBounds: p.normalizedBounds, guardBounds: g77RoadGuardBounds(), rows });
}
