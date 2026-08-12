/** Buzul Muhafızı / NW G11 Near Detail — runtime vegetation → Terrain3D instancer probe. */

import { G11_HYDROLOGY_POLICY, measureG11Hydrology } from './g11_hydrology.mjs';

export const G11_NEAR_DETAIL_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g11-terrain3d-near-detail-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G11', gx: 1, gy: 1, layer: 'Near Detail',
  normalizedBounds: G11_HYDROLOGY_POLICY.normalizedBounds,
  guardBandNormalized: 1 / 1536,
  terrain3dRegionSize: 256,
  desktopVegetationRadiusMeters: 5500,
  species: Object.freeze(['pine', 'round']),
});

function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }

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

export function normalizedToTerrainLocal(nx, ny) {
  const b = G11_NEAR_DETAIL_POLICY.normalizedBounds;
  return Object.freeze({
    x: clamp((nx - b.xMin) / (b.xMax - b.xMin)) * 255,
    z: clamp((ny - b.yMin) / (b.yMax - b.yMin)) * 255,
  });
}

export function filterG11Instances(instances, mapBounds, metersPerMapUnit, includeGuard = false) {
  const b = G11_NEAR_DETAIL_POLICY.normalizedBounds;
  const g = includeGuard ? G11_NEAR_DETAIL_POLICY.guardBandNormalized : 0;
  return instances.flatMap((instance) => {
    const n = worldToNormalized(instance.x, instance.z, mapBounds, metersPerMapUnit);
    if (n.x < b.xMin - g || n.x > b.xMax + g || n.y < b.yMin - g || n.y > b.yMax + g) return [];
    const local = normalizedToTerrainLocal(n.x, n.y);
    return [{ ...instance, normalizedX: n.x, normalizedY: n.y, localX: local.x, localZ: local.z }];
  });
}

function fnv1a(checksum, value) {
  checksum ^= value & 0xff;
  return Math.imul(checksum, 16777619) >>> 0;
}

export function measureG11NearDetail(runtime) {
  const hydrology = measureG11Hydrology();
  const core = filterG11Instances(runtime.instances, runtime.mapBounds, runtime.metersPerMapUnit, false);
  const guarded = filterG11Instances(runtime.instances, runtime.mapBounds, runtime.metersPerMapUnit, true);
  const speciesCounts = Object.fromEntries(G11_NEAR_DETAIL_POLICY.species.map((id) => [id, 0]));
  let checksum = 2166136261;
  let minRoadDistance = Infinity;
  let minSeatDistance = Infinity;
  let minHeightAboveWater = Infinity;
  for (const tree of core) {
    speciesCounts[tree.species] = (speciesCounts[tree.species] ?? 0) + 1;
    minRoadDistance = Math.min(minRoadDistance, tree.roadDistanceMeters);
    minSeatDistance = Math.min(minSeatDistance, tree.seatDistanceMeters);
    minHeightAboveWater = Math.min(minHeightAboveWater, tree.y - runtime.waterLevelMeters);
    for (const v of [tree.localX, tree.localZ, tree.y, tree.scale, tree.yaw]) {
      const q = Math.round(v * 1000);
      checksum = fnv1a(checksum, q); checksum = fnv1a(checksum, q >>> 8); checksum = fnv1a(checksum, q >>> 16);
    }
    checksum = fnv1a(checksum, tree.species === 'pine' ? 1 : 2);
  }
  const guardOnlyCount = guarded.length - core.length;
  return Object.freeze({
    policyId: G11_NEAR_DETAIL_POLICY.id,
    sourceMapSha256: G11_NEAR_DETAIL_POLICY.sourceMapSha256,
    geoCell: 'G11', layer: 'Near Detail',
    hydrologyFingerprint: Object.freeze({
      waterCells: hydrology.waterCells, landCells: hydrology.landCells,
      boundaryEdges: hydrology.boundaryEdges, centreMismatches: hydrology.centreMismatches,
    }),
    runtimeTargetCount: runtime.targetCount,
    runtimePlacedCount: runtime.placedCount,
    runtimeClusterSeatCount: runtime.clusterSeatCount,
    coreInstanceCount: core.length,
    guardInstanceCount: guarded.length,
    guardOnlyCount,
    speciesCounts: Object.freeze(speciesCounts),
    minRoadDistanceMeters: Number((Number.isFinite(minRoadDistance) ? minRoadDistance : 0).toFixed(6)),
    minSeatDistanceMeters: Number((Number.isFinite(minSeatDistance) ? minSeatDistance : 0).toFixed(6)),
    minHeightAboveWaterMeters: Number((Number.isFinite(minHeightAboveWater) ? minHeightAboveWater : 0).toFixed(6)),
    instanceChecksum: checksum,
  });
}

export function buildG11NearDetailProbe(runtime) {
  const metrics = measureG11NearDetail(runtime);
  const instances = filterG11Instances(runtime.instances, runtime.mapBounds, runtime.metersPerMapUnit, true).map((tree) => ({
    species: tree.species,
    localX: Number(tree.localX.toFixed(6)), localZ: Number(tree.localZ.toFixed(6)),
    height: Number(tree.y.toFixed(6)), yaw: Number(tree.yaw.toFixed(8)), scale: Number(tree.scale.toFixed(8)),
    normalizedX: Number(tree.normalizedX.toFixed(9)), normalizedY: Number(tree.normalizedY.toFixed(9)),
  }));
  return Object.freeze({
    policyId: G11_NEAR_DETAIL_POLICY.id,
    sourceMapSha256: G11_NEAR_DETAIL_POLICY.sourceMapSha256,
    geoCell: 'G11', layer: 'Near Detail', terrain3dRegionSize: 256,
    species: G11_NEAR_DETAIL_POLICY.species,
    metrics,
    instances,
  });
}
