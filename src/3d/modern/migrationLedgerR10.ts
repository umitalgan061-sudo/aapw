/** R10 production migration ledger for geographic distribution, roads and settlement-world presentation. */
export const R10_MIGRATION_MODULES = Object.freeze([
  { id:'geographic-distribution', legacyPath:'src/3d/world/geographicAssetDistributionAdapter.js', modernPath:'src/3d/world/geographicAssetDistributionAdapter.ts', status:'migrated' },
  { id:'geographic-cluster-planner', legacyPath:'src/3d/world/geographicAssetClusterPlanner.js', modernPath:'src/3d/world/geographicAssetClusterPlanner.ts', status:'migrated' },
  { id:'road-pathfinder', legacyPath:'src/3d/world/roadPathfinder.js', modernPath:'src/3d/world/roadPathfinder.ts', status:'migrated' },
  { id:'roads', legacyPath:'src/3d/world/roads.js', modernPath:'src/3d/world/roads.ts', status:'migrated' },
  { id:'villages', legacyPath:'src/3d/world/villages.js', modernPath:'src/3d/world/villages.ts', status:'migrated' },
  { id:'settlement-prop-quality', legacyPath:'src/3d/world/geographicSettlementPropQuality.js', modernPath:'src/3d/world/geographicSettlementPropQuality.ts', status:'migrated' },
  { id:'canonical-surface-visual', legacyPath:'src/3d/world/worldReferenceSurfaceTerrainVisual.js', modernPath:'src/3d/world/worldReferenceSurfaceTerrainVisual.ts', status:'migrated' },
] as const);

export interface R10MigrationSnapshot {
  readonly version: 10;
  readonly migratedCount: number;
  readonly totalTracked: number;
  readonly coveragePercent: number;
}

export function getR10MigrationSnapshot(): R10MigrationSnapshot {
  const totalTracked = R10_MIGRATION_MODULES.length;
  const migratedCount = R10_MIGRATION_MODULES.filter(m => m.status === 'migrated').length;
  return Object.freeze({
    version: 10,
    migratedCount,
    totalTracked,
    coveragePercent: totalTracked === 0 ? 100 : Number(((migratedCount / totalTracked) * 100).toFixed(2)),
  });
}
