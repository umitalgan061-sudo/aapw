/** R12 world-surface production migration ledger. */
export const R12_WORLD_MIGRATION = Object.freeze([
  { id: 'vegetation', legacyPath: 'src/3d/world/vegetation.legacy.js', modernPath: 'src/3d/world/vegetation.ts', status: 'migrated', domain: 'world-ecology' },
  { id: 'terrain-biome-shading', legacyPath: 'src/3d/world/terrainBiomeShading.legacy.js', modernPath: 'src/3d/world/terrainBiomeShading.ts', status: 'migrated', domain: 'world-rendering' },
  { id: 'surface-pindexes', legacyPath: 'src/3d/world/worldReferenceSurfacePindexes.legacy.js', modernPath: 'src/3d/world/worldReferenceSurfacePindexes.ts', status: 'migrated', domain: 'world-geography' },
] as const);

export interface R12MigrationSnapshot {
  readonly version: 12;
  readonly migrated: number;
  readonly tracked: number;
  readonly coveragePercent: number;
}

export const getR12MigrationSnapshot = (): R12MigrationSnapshot => {
  const tracked = R12_WORLD_MIGRATION.length;
  const migrated = R12_WORLD_MIGRATION.filter((item) => item.status === 'migrated').length;
  return Object.freeze({
    version: 12,
    migrated,
    tracked,
    coveragePercent: tracked === 0 ? 100 : Number(((migrated / tracked) * 100).toFixed(2)),
  });
};
