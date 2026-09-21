/** R13 migration ledger: gameplay simulation + world placement decision owners. */
export const R13_MIGRATION_MODULES = Object.freeze([
  { id: 'fauna-ecology-director', legacyPath: 'src/3d/gameplay/livingWorldFaunaEcologyDirector.js', modernPath: 'src/3d/gameplay/livingWorldFaunaEcologyDirector.ts', owner: 'gameplay', status: 'migrated' },
  { id: 'fauna-ecology-policy', legacyPath: 'src/3d/gameplay/livingWorldEcologyPolicy.js', modernPath: 'src/3d/gameplay/livingWorldEcologyPolicy.ts', owner: 'gameplay', status: 'migrated' },
  { id: 'reaction-runtime', legacyPath: 'src/3d/gameplay/livingWorldReactionRuntime.js', modernPath: 'src/3d/gameplay/livingWorldReactionRuntime.ts', owner: 'gameplay', status: 'migrated' },
  { id: 'reaction-policy', legacyPath: 'src/3d/gameplay/livingWorldReactionPolicy.js', modernPath: 'src/3d/gameplay/livingWorldReactionPolicy.ts', owner: 'gameplay', status: 'migrated' },
  { id: 'reaction-integration', legacyPath: 'src/3d/gameplay/livingWorldReactionIntegrationAdapter.js', modernPath: 'src/3d/gameplay/livingWorldReactionIntegrationAdapter.ts', owner: 'gameplay', status: 'migrated' },
  { id: 'equipment-profile', legacyPath: 'src/3d/gameplay/playerEquipmentCombatProfile.js', modernPath: 'src/3d/gameplay/playerEquipmentCombatProfile.ts', owner: 'gameplay', status: 'migrated' },
  { id: 'equipment-rules', legacyPath: 'src/3d/gameplay/playerEquipmentCombatRules.js', modernPath: 'src/3d/gameplay/playerEquipmentCombatRules.ts', owner: 'gameplay', status: 'migrated' },
  { id: 'equipment-runtime', legacyPath: 'src/3d/gameplay/playerEquipmentCombatRuntime.js', modernPath: 'src/3d/gameplay/playerEquipmentCombatRuntime.ts', owner: 'gameplay', status: 'migrated' },
  { id: 'world-placement', legacyPath: 'src/3d/world/WorldAssetPlacementPipeline.js', modernPath: 'src/3d/world/WorldAssetPlacementPipeline.ts', owner: 'world', status: 'migrated' },
  { id: 'world-surface-schema', legacyPath: 'src/3d/world/WorldSurfacePolicySchema.js', modernPath: 'src/3d/world/WorldSurfacePolicySchema.ts', owner: 'world', status: 'migrated' },
  { id: 'asset-footprint', legacyPath: 'src/3d/world/WorldAssetFootprintGeometry.js', modernPath: 'src/3d/world/WorldAssetFootprintGeometry.ts', owner: 'world', status: 'migrated' },
  { id: 'settlement-fringe-props', legacyPath: 'src/3d/world/geographicSettlementProps.js', modernPath: 'src/3d/world/geographicSettlementProps.ts', owner: 'world', status: 'migrated' },
] as const);

export interface R13MigrationSnapshot { readonly version: 13; readonly migratedCount: number; readonly totalTracked: number; readonly coveragePercent: number; }

export function getR13MigrationSnapshot(): R13MigrationSnapshot {
  const totalTracked = R13_MIGRATION_MODULES.length;
  const migratedCount = R13_MIGRATION_MODULES.filter((module) => module.status === 'migrated').length;
  return Object.freeze({ version: 13, migratedCount, totalTracked, coveragePercent: totalTracked === 0 ? 100 : Number(((migratedCount / totalTracked) * 100).toFixed(2)) });
}
