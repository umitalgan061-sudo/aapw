/**
 * Günbatımı Ustası / SW GeoCell G07 Road/Path authoring contract.
 *
 * G07 is canonical open sea. Road/Path authoring therefore proves that the live
 * deterministic road network does not cross this parcel and emits a continuous
 * zero-coverage Terrain3D control field rather than inventing a road, bridge,
 * path, island, or grid-shaped feature merely to make a visible change.
 */

export const G07_ROAD_PATH_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g07-terrain3d-road-path-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G07',
  gx: 0,
  gy: 7,
  layer: 'Road/Path',
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 1 / 8, yMin: 7 / 8, yMax: 1 }),
  sourceGridSize: 257,
  terrain3dRegionSize: 256,
  baseTextureId: 0,
  roadTextureId: 2,
  pathTextureId: 3,
  guardBandNormalized: 1 / 1536,
});

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

export function findG07CrossingEdges(runtimeNetwork) {
  const bounds = G07_ROAD_PATH_POLICY.normalizedBounds;
  const padding = G07_ROAD_PATH_POLICY.guardBandNormalized;
  const inspect = (edges, tier) => edges.flatMap((edge) => {
    const points = (edge.points ?? []).map((point) => worldToNormalized(
      point.x,
      point.z,
      runtimeNetwork.mapBounds,
      runtimeNetwork.metersPerMapUnit,
    ));
    for (let i = 1; i < points.length; i += 1) {
      if (segmentIntersectsBounds(points[i - 1], points[i], bounds, padding)) {
        return [{ tier, fromId: edge.fromId, toId: edge.toId, pointCount: points.length }];
      }
    }
    return [];
  });
  return Object.freeze([
    ...inspect(runtimeNetwork.mainEdges ?? [], 'road'),
    ...inspect(runtimeNetwork.footpathEdges ?? [], 'path'),
  ]);
}

export function sampleG07RoadPath(normalizedX, normalizedY) {
  const { xMin, xMax, yMin, yMax } = G07_ROAD_PATH_POLICY.normalizedBounds;
  const inside = normalizedX >= xMin && normalizedX <= xMax && normalizedY >= yMin && normalizedY <= yMax;
  return Object.freeze({ inside, roadCoverage: 0, pathCoverage: 0, coverage: 0, kind: 0 });
}

function fnv1a(checksum, value) {
  checksum ^= value & 0xff;
  return Math.imul(checksum, 16777619) >>> 0;
}

export function measureG07RoadPath(runtimeNetwork) {
  const crossings = findG07CrossingEdges(runtimeNetwork);
  const size = G07_ROAD_PATH_POLICY.sourceGridSize;
  let checksum = 2166136261;
  let activeRoadSamples = 0;
  let activePathSamples = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sample = sampleG07RoadPath(x / (size - 1), y / (size - 1));
      checksum = fnv1a(checksum, Math.round(sample.roadCoverage * 255));
      checksum = fnv1a(checksum, Math.round(sample.pathCoverage * 255));
      if (sample.roadCoverage > 0.02) activeRoadSamples += 1;
      if (sample.pathCoverage > 0.02) activePathSamples += 1;
    }
  }

  return Object.freeze({
    policyId: G07_ROAD_PATH_POLICY.id,
    sourceMapSha256: G07_ROAD_PATH_POLICY.sourceMapSha256,
    geoCell: G07_ROAD_PATH_POLICY.geoCell,
    layer: G07_ROAD_PATH_POLICY.layer,
    sourceGridSize: size,
    sourceSamples: size * size,
    terrain3dRegionSize: G07_ROAD_PATH_POLICY.terrain3dRegionSize,
    crossingEdges: crossings,
    activeRoadSamples,
    activePathSamples,
    maxAdjacentCoverageStep: 0,
    maxGuardBandCoverageDelta: 0,
    coverageChecksum: checksum,
  });
}

export function buildG07RoadPathProbe(runtimeNetwork) {
  const size = G07_ROAD_PATH_POLICY.sourceGridSize;
  const row = Array.from({ length: size }, () => [0, 0, 0]);
  const rows = Array.from({ length: size }, () => row.map((sample) => [...sample]));
  return Object.freeze({
    ...measureG07RoadPath(runtimeNetwork),
    baseTextureId: G07_ROAD_PATH_POLICY.baseTextureId,
    roadTextureId: G07_ROAD_PATH_POLICY.roadTextureId,
    pathTextureId: G07_ROAD_PATH_POLICY.pathTextureId,
    rows,
  });
}
