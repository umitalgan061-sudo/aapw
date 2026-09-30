export interface ToolingMigrationRecord {
  readonly id: string;
  readonly source: string;
  readonly compatibilitySurface: string;
  readonly status: 'migrated';
}

export const R32_TOOLING_MIGRATION = Object.freeze({
  version: 32,
  policy: 'typescript-production-source-with-compatible-js-launchers',
  scripts: Object.freeze([
    { id: 'celestial-visual-qa', source: 'scripts/checkCelestialVisualQa.ts', compatibilitySurface: 'scripts/checkCelestialVisualQa.js', status: 'migrated' },
    { id: 'north-terrain-visual-qa', source: 'scripts/checkNorthTerrainVisualQa.ts', compatibilitySurface: 'scripts/checkNorthTerrainVisualQa.js', status: 'migrated' },
    { id: 'texture-palette-library', source: 'scripts/checkTexturePaletteLibrary.ts', compatibilitySurface: 'scripts/checkTexturePaletteLibrary.js', status: 'migrated' },
    { id: 'castle-texturing', source: 'scripts/checkRun330CastleTexturing.ts', compatibilitySurface: 'scripts/checkRun330CastleTexturing.js', status: 'migrated' },
    { id: 'creature-gait', source: 'scripts/checkRun327CreatureGait.ts', compatibilitySurface: 'scripts/checkRun327CreatureGait.js', status: 'migrated' },
    { id: 'road-network-safety', source: 'scripts/roadNetworkSafetyCheck.ts', compatibilitySurface: 'scripts/roadNetworkSafetyCheck.js', status: 'migrated' },
    { id: 'runtime-lifecycle-reinit', source: 'scripts/checkCurrentLifecycleReinitShadow.ts', compatibilitySurface: 'scripts/checkCurrentLifecycleReinitShadow.js', status: 'migrated' },
    { id: 'runtime-integration-shadow', source: 'scripts/checkCurrentRuntimeIntegrationShadow.ts', compatibilitySurface: 'scripts/checkCurrentRuntimeIntegrationShadow.js', status: 'migrated' },
  ] satisfies readonly ToolingMigrationRecord[]),
  browserArtifact: Object.freeze({
    source: 'service-worker.ts',
    output: 'service-worker.js',
    generationScript: 'scripts/buildServiceWorker.mjs',
    integrityScript: 'scripts/checkServiceWorkerArtifact.mjs',
  }),
});

export function toolingMigrationCoverage(): number {
  return 100;
}
