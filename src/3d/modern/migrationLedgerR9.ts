/** R9 production migration ledger for the active 3D core/world runtime. */
export const R9_MIGRATION_MODULES = Object.freeze([
  { id: 'config', legacyPath: 'src/3d/config.js', modernPath: 'src/3d/config.ts', status: 'migrated' },
  { id: 'event-bus', legacyPath: 'src/3d/eventBus.js', modernPath: 'src/3d/eventBus.ts', status: 'migrated' },
  { id: 'state', legacyPath: 'src/3d/state.js', modernPath: 'src/3d/state.ts', status: 'migrated' },
  { id: 'physics', legacyPath: 'src/3d/physics.js', modernPath: 'src/3d/physics.ts', status: 'migrated' },
  { id: 'input', legacyPath: 'src/3d/input.js', modernPath: 'src/3d/input.ts', status: 'migrated' },
  { id: 'asset-loader', legacyPath: 'src/3d/assetLoader.js', modernPath: 'src/3d/assetLoader.ts', status: 'migrated' },
  { id: 'render-quality', legacyPath: 'src/3d/renderQuality.js', modernPath: 'src/3d/renderQuality.ts', status: 'migrated' },
  { id: 'camera', legacyPath: 'src/3d/camera.js', modernPath: 'src/3d/camera.ts', status: 'migrated' },
  { id: 'game3d', legacyPath: 'src/3d/game3d.js', modernPath: 'src/3d/game3d.ts', status: 'migrated' },
  { id: 'scene-manager', legacyPath: 'src/3d/sceneManager.js', modernPath: 'src/3d/sceneManager.ts', status: 'migrated' },
  { id: 'terrain', legacyPath: 'src/3d/world/terrain.js', modernPath: 'src/3d/world/terrain.ts', status: 'migrated' },
  { id: 'water', legacyPath: 'src/3d/world/water.js', modernPath: 'src/3d/world/water.ts', status: 'migrated' },
  { id: 'rivers', legacyPath: 'src/3d/world/rivers.js', modernPath: 'src/3d/world/rivers.ts', status: 'migrated' },
  { id: 'chunk-manager', legacyPath: 'src/3d/world/chunkManager.js', modernPath: 'src/3d/world/chunkManager.ts', status: 'migrated' },
  { id: 'materials', legacyPath: 'src/3d/world/materials.js', modernPath: 'src/3d/world/materials.ts', status: 'migrated' },
  { id: 'settlements', legacyPath: 'src/3d/world/settlements.js', modernPath: 'src/3d/world/settlements.ts', status: 'migrated' },
  { id: 'region-profiles', legacyPath: 'src/3d/world/geographicAssetRegionProfiles.js', modernPath: 'src/3d/world/geographicAssetRegionProfiles.ts', status: 'migrated' },
  { id: 'terrain-facies', legacyPath: 'src/3d/world/terrainSurfaceFacies.js', modernPath: 'src/3d/world/terrainSurfaceFacies.ts', status: 'migrated' },
  { id: 'asset-context', legacyPath: 'src/3d/world/geographicAssetContext.js', modernPath: 'src/3d/world/geographicAssetContext.ts', status: 'migrated' },
  { id: 'asset-orchestrator', legacyPath: 'src/3d/world/geographicAssetRuntimeOrchestrator.js', modernPath: 'src/3d/world/geographicAssetRuntimeOrchestrator.ts', status: 'migrated' },
] as const);

export interface R9MigrationSnapshot {
  readonly version: 9;
  readonly migratedCount: number;
  readonly totalTracked: number;
  readonly coveragePercent: number;
}

export function getR9MigrationSnapshot(): R9MigrationSnapshot {
  const totalTracked = R9_MIGRATION_MODULES.length;
  const migratedCount = R9_MIGRATION_MODULES.filter((module) => module.status === 'migrated').length;
  return Object.freeze({
    version: 9,
    migratedCount,
    totalTracked,
    coveragePercent: totalTracked === 0 ? 100 : Number(((migratedCount / totalTracked) * 100).toFixed(2)),
  });
}
