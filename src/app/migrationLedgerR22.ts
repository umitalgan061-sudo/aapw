export interface TypeScriptMigrationRecord {
  readonly id: string;
  readonly source: string;
  readonly compatibilityArtifact?: string;
  readonly domain: 'application' | 'pwa' | 'automation' | 'runtime';
  readonly status: 'migrated';
}

export const R22_TYPESCRIPT_MIGRATION: readonly TypeScriptMigrationRecord[] = Object.freeze([
  { id: 'root-strategy-app', source: 'script.ts', compatibilityArtifact: 'script.js', domain: 'application', status: 'migrated' },
  { id: 'pwa-service-worker', source: 'service-worker.ts', compatibilityArtifact: 'service-worker.js', domain: 'pwa', status: 'migrated' },
  { id: 'smoke-core', source: 'scripts/game3dSmokeChecks.ts', compatibilityArtifact: 'scripts/game3dSmokeChecks.js', domain: 'automation', status: 'migrated' },
  { id: 'smoke-movement', source: 'scripts/game3dSmokeChecksMovement.ts', compatibilityArtifact: 'scripts/game3dSmokeChecksMovement.js', domain: 'automation', status: 'migrated' },
  { id: 'smoke-dragon-dive', source: 'scripts/game3dSmokeChecksDragonDive.ts', compatibilityArtifact: 'scripts/game3dSmokeChecksDragonDive.js', domain: 'automation', status: 'migrated' },
  { id: 'smoke-dragon-flight', source: 'scripts/game3dSmokeChecksDragonFlight.ts', compatibilityArtifact: 'scripts/game3dSmokeChecksDragonFlight.js', domain: 'automation', status: 'migrated' },
  { id: 'smoke-dragon-pursuit', source: 'scripts/game3dSmokeChecksDragonPursuit.ts', compatibilityArtifact: 'scripts/game3dSmokeChecksDragonPursuit.js', domain: 'automation', status: 'migrated' },
  { id: 'smoke-pause-menu', source: 'scripts/game3dSmokeChecksPauseMenu.ts', compatibilityArtifact: 'scripts/game3dSmokeChecksPauseMenu.js', domain: 'automation', status: 'migrated' },
  { id: 'smoke-scene', source: 'scripts/game3dSmokeChecksScene.ts', compatibilityArtifact: 'scripts/game3dSmokeChecksScene.js', domain: 'automation', status: 'migrated' },
  { id: 'root-lifecycle', source: 'src/app/rootApplicationRuntime.ts', domain: 'runtime', status: 'migrated' },
] as const);

export const R22_TYPESCRIPT_MIGRATION_VERSION = 22;

export function getR22MigrationCoverage(): number {
  const total = R22_TYPESCRIPT_MIGRATION.length;
  return total === 0 ? 100 : Number((R22_TYPESCRIPT_MIGRATION.filter((entry) => entry.status === 'migrated').length / total * 100).toFixed(2));
}
