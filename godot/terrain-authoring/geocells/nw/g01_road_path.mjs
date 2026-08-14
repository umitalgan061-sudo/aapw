/**
 * Buzul Muhafızı / NW GeoCell G01 — Road/Path Terrain3D authoring field.
 *
 * GeoCell bounds are work addressing only. Road/path coverage comes only from
 * the live deterministic world/roads.js network in continuous owner-map/world
 * coordinates. Away from a live corridor the merged G01 Rock/Snow substrate is
 * preserved exactly; no grid edge or cell square is rendered into the surface.
 */
import {
  normalizedReferenceToWorldXZ,
  worldXZToNormalizedReference,
} from '../../../../src/3d/world/worldReferenceAlignment.js';
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import {
  G01_ROCK_SNOW_POLICY,
  measureG01RockSnow,
  sampleG01RockSnow,
} from './g01_rock_snow.mjs';
import { sampleG01CanonicalWaterConfidence } from './g01_relief.mjs';

export const G01_ROAD_PATH_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g01-terrain3d-road-path-2026-08-13-v1',
  sourceMapSha256: G01_ROCK_SNOW_POLICY.sourceMapSha256,
  geoCell: 'G01',
  gx: 0,
  gy: 1,
  layer: 'Road/Path',
  normalizedBounds: G01_ROCK_SNOW_POLICY.normalizedBounds,
  maskBounds: G01_ROCK_SNOW_POLICY.maskBounds,
  sourceGridSize: 257,
  terrain3dRegionSize: 256,
  rockTextureId: G01_ROCK_SNOW_POLICY.rockTextureId,
  snowTextureId: G01_ROCK_SNOW_POLICY.snowTextureId,
  roadTextureId: 2,
  pathTextureId: 3,
  roadWidthMeters: 8,
  footpathWidthMeters: 2.5,
  roadFeatherMeters: 14,
  footpathFeatherMeters: 7,
  guardBandNormalized: 1 / 1536,
});

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function normalizedToWorld(normalizedX, normalizedY, mapBounds, metersPerMapUnit) {
  return normalizedReferenceToWorldXZ(normalizedX, normalizedY, mapBounds, metersPerMapUnit);
}

export function worldToNormalized(worldX, worldZ, mapBounds, metersPerMapUnit) {
  return worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
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

export function sampleG01RoadPath(normalizedX, normalizedY, runtimeNetwork) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const nx = clamp(normalizedX);
  const ny = clamp(normalizedY);
  const worldPoint = normalizedToWorld(nx, ny, runtimeNetwork.mapBounds, runtimeNetwork.metersPerMapUnit);
  const roadRaw = samplePolylineCoverage(
    worldPoint,
    runtimeNetwork.mainEdges,
    G01_ROAD_PATH_POLICY.roadWidthMeters,
    G01_ROAD_PATH_POLICY.roadFeatherMeters,
  );
  const pathRaw = samplePolylineCoverage(
    worldPoint,
    runtimeNetwork.footpathEdges,
    G01_ROAD_PATH_POLICY.footpathWidthMeters,
    G01_ROAD_PATH_POLICY.footpathFeatherMeters,
  );
  const water = sampleG01CanonicalWaterConfidence(nx, ny);
  const canonicalLandFactor = 1 - water;
  const settlementLandSupport = sampleSettlementLandSupport(worldPoint, runtimeNetwork);
  const landFactor = Math.max(canonicalLandFactor, settlementLandSupport);
  const roadCoverage = roadRaw * landFactor;
  const pathCoverage = pathRaw * landFactor * (1 - roadCoverage);
  const coverage = Math.max(roadCoverage, pathCoverage);
  const kind = roadCoverage >= pathCoverage && roadCoverage > 0 ? 1 : pathCoverage > 0 ? 2 : 0;
  const substrate = sampleG01RockSnow(nx, ny);
  return Object.freeze({
    roadCoverage,
    pathCoverage,
    coverage,
    kind,
    waterConfidence: water,
    canonicalLandFactor,
    settlementLandSupport,
    landFactor,
    heightMeters: substrate.heightMeters,
    substrateRockWeight: substrate.rockWeight,
    substrateSnowWeight: substrate.snowWeight,
    substrateSnowBlend: substrate.snowBlend,
    substrateLandFactor: substrate.landFactor,
  });
}

function segmentIntersectsBounds(a, b, bounds, paddingX = 0, paddingY = paddingX) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return !(
    maxX < bounds.xMin - paddingX || minX > bounds.xMax + paddingX
    || maxY < bounds.yMin - paddingY || minY > bounds.yMax + paddingY
  );
}

function corridorPaddingNormalized(widthMeters, featherMeters) {
  const reachMeters = widthMeters * 0.5 + featherMeters;
  return Object.freeze({
    x: reachMeters / FULL_REFERENCE_EXTENT_PLAN.widthMeters,
    y: reachMeters / FULL_REFERENCE_EXTENT_PLAN.depthMeters,
  });
}

export function findG01InfluencingEdges(runtimeNetwork) {
  const bounds = G01_ROAD_PATH_POLICY.normalizedBounds;
  const inspect = (edges, tier, widthMeters, featherMeters) => {
    const padding = corridorPaddingNormalized(widthMeters, featherMeters);
    return (edges ?? []).flatMap((edge) => {
      const points = (edge.points ?? []).map((point) => worldToNormalized(
        point.x,
        point.z,
        runtimeNetwork.mapBounds,
        runtimeNetwork.metersPerMapUnit,
      ));
      for (let i = 1; i < points.length; i += 1) {
        if (segmentIntersectsBounds(points[i - 1], points[i], bounds, padding.x, padding.y)) {
          return [{ tier, fromId: edge.fromId, toId: edge.toId, pointCount: points.length }];
        }
      }
      return [];
    });
  };
  return Object.freeze([
    ...inspect(
      runtimeNetwork.mainEdges,
      'road',
      G01_ROAD_PATH_POLICY.roadWidthMeters,
      G01_ROAD_PATH_POLICY.roadFeatherMeters,
    ),
    ...inspect(
      runtimeNetwork.footpathEdges,
      'path',
      G01_ROAD_PATH_POLICY.footpathWidthMeters,
      G01_ROAD_PATH_POLICY.footpathFeatherMeters,
    ),
  ]);
}

function fnv1a(checksum, value) {
  checksum ^= value & 0xff;
  return Math.imul(checksum, 16777619) >>> 0;
}

export function measureG01RoadPath(runtimeNetwork) {
  const rockSnow = measureG01RockSnow();
  const influencingEdges = findG01InfluencingEdges(runtimeNetwork);
  const { xMin, xMax, yMin, yMax } = G01_ROAD_PATH_POLICY.normalizedBounds;
  const size = G01_ROAD_PATH_POLICY.sourceGridSize;
  const guard = G01_ROAD_PATH_POLICY.guardBandNormalized;
  let activeRoadSamples = 0;
  let activePathSamples = 0;
  let maxAdjacentCoverageStep = 0;
  let maxGuardBandCoverageDelta = 0;
  let maxCanonicalWaterCoverageOutsideSettlement = 0;
  let maxCanonicalWaterCoverageInsideSettlement = 0;
  let protectedCanonicalWaterSamples = 0;
  let maxNoRoadHeightDelta = 0;
  let maxNoRoadSubstrateDelta = 0;
  let checksum = 2166136261;
  let previousRow = null;

  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const sample = sampleG01RoadPath(nx, ny, runtimeNetwork);
      const substrate = sampleG01RockSnow(nx, ny);
      if (sample.roadCoverage > 0.02) activeRoadSamples += 1;
      if (sample.pathCoverage > 0.02) activePathSamples += 1;
      if (x > 0) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(sample.coverage - row[x - 1]));
      if (previousRow) maxAdjacentCoverageStep = Math.max(maxAdjacentCoverageStep, Math.abs(sample.coverage - previousRow[x]));
      if (sample.coverage <= 0.000001) {
        maxNoRoadHeightDelta = Math.max(maxNoRoadHeightDelta, Math.abs(sample.heightMeters - substrate.heightMeters));
        maxNoRoadSubstrateDelta = Math.max(
          maxNoRoadSubstrateDelta,
          Math.abs(sample.substrateRockWeight - substrate.rockWeight),
          Math.abs(sample.substrateSnowWeight - substrate.snowWeight),
          Math.abs(sample.substrateSnowBlend - substrate.snowBlend),
          Math.abs(sample.substrateLandFactor - substrate.landFactor),
        );
      }
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
      Math.abs(sampleG01RoadPath(nx, yMin, runtimeNetwork).coverage - sampleG01RoadPath(nx, yMin - guard, runtimeNetwork).coverage),
      Math.abs(sampleG01RoadPath(nx, yMax, runtimeNetwork).coverage - sampleG01RoadPath(nx, yMax + guard, runtimeNetwork).coverage),
      Math.abs(sampleG01RoadPath(xMin, ny, runtimeNetwork).coverage - sampleG01RoadPath(xMin - guard, ny, runtimeNetwork).coverage),
      Math.abs(sampleG01RoadPath(xMax, ny, runtimeNetwork).coverage - sampleG01RoadPath(xMax + guard, ny, runtimeNetwork).coverage),
    );
  }

  const mask = G01_ROAD_PATH_POLICY.maskBounds;
  for (let maskY = mask.yMin; maskY <= mask.yMax; maskY += 1) {
    for (let maskX = mask.xMin; maskX <= mask.xMax; maskX += 1) {
      const nx = (maskX + 0.5) / 96;
      const ny = (maskY + 0.5) / 64;
      if (sampleG01CanonicalWaterConfidence(nx, ny) < 0.999999) continue;
      const sample = sampleG01RoadPath(nx, ny, runtimeNetwork);
      if (sample.settlementLandSupport > 0.001) {
        protectedCanonicalWaterSamples += 1;
        maxCanonicalWaterCoverageInsideSettlement = Math.max(maxCanonicalWaterCoverageInsideSettlement, sample.coverage);
      } else {
        maxCanonicalWaterCoverageOutsideSettlement = Math.max(maxCanonicalWaterCoverageOutsideSettlement, sample.coverage);
      }
    }
  }

  return Object.freeze({
    policyId: G01_ROAD_PATH_POLICY.id,
    sourceMapSha256: G01_ROAD_PATH_POLICY.sourceMapSha256,
    geoCell: 'G01',
    layer: 'Road/Path',
    sourceGridSize: size,
    sourceSamples: size * size,
    terrain3dRegionSize: G01_ROAD_PATH_POLICY.terrain3dRegionSize,
    hydrologyFingerprint: rockSnow.hydrologyFingerprint,
    influencingEdges,
    activeRoadSamples,
    activePathSamples,
    maxAdjacentCoverageStep: Number(maxAdjacentCoverageStep.toFixed(8)),
    maxGuardBandCoverageDelta: Number(maxGuardBandCoverageDelta.toFixed(8)),
    protectedCanonicalWaterSamples,
    maxCanonicalWaterCoverageOutsideSettlement: Number(maxCanonicalWaterCoverageOutsideSettlement.toFixed(8)),
    maxCanonicalWaterCoverageInsideSettlement: Number(maxCanonicalWaterCoverageInsideSettlement.toFixed(8)),
    maxNoRoadHeightDelta: Number(maxNoRoadHeightDelta.toFixed(10)),
    maxNoRoadSubstrateDelta: Number(maxNoRoadSubstrateDelta.toFixed(10)),
    coverageChecksum: checksum,
  });
}

export function buildG01RoadPathProbe(runtimeNetwork) {
  const metrics = measureG01RoadPath(runtimeNetwork);
  const { xMin, xMax, yMin, yMax } = G01_ROAD_PATH_POLICY.normalizedBounds;
  const size = G01_ROAD_PATH_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const sample = sampleG01RoadPath(nx, ny, runtimeNetwork);
      row.push([
        Number(sample.roadCoverage.toFixed(8)),
        Number(sample.pathCoverage.toFixed(8)),
        sample.kind,
        Number(sample.heightMeters.toFixed(6)),
        Number(sample.substrateRockWeight.toFixed(8)),
        Number(sample.substrateSnowWeight.toFixed(8)),
        Number(sample.substrateSnowBlend.toFixed(8)),
        Number(sample.substrateLandFactor.toFixed(8)),
        Number(sample.waterConfidence.toFixed(8)),
        Number(sample.settlementLandSupport.toFixed(8)),
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    ...metrics,
    rockTextureId: G01_ROAD_PATH_POLICY.rockTextureId,
    snowTextureId: G01_ROAD_PATH_POLICY.snowTextureId,
    roadTextureId: G01_ROAD_PATH_POLICY.roadTextureId,
    pathTextureId: G01_ROAD_PATH_POLICY.pathTextureId,
    rows,
  });
}
