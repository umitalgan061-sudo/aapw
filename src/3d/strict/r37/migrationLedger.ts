export interface TypeScriptMigrationSurfaceR37 {
  readonly version: 37;
  readonly owner: 'strict-runtime';
  readonly criticalProductionOwners: readonly string[];
  readonly compatibilityEntrypoints: readonly string[];
  readonly rules: readonly string[];
}

export const TYPESCRIPT_MIGRATION_SURFACE_R37: TypeScriptMigrationSurfaceR37 = Object.freeze({
  version: 37,
  owner: 'strict-runtime',
  criticalProductionOwners: Object.freeze([
    'src/3d/game3d.ts',
    'src/3d/sceneManager.ts',
    'src/3d/config.ts',
    'src/3d/camera.ts',
    'src/3d/physics.ts',
    'src/3d/renderQuality.ts',
    'src/3d/input.ts',
    'src/3d/gameplay/player.ts',
    'src/3d/gameplay/livingWorldSpawner.ts',
    'src/3d/gameplay/interaction.ts',
    'src/3d/world/water.ts',
    'src/3d/world/weather.ts',
    'src/3d/world/settlements.ts',
    'src/3d/world/roads.ts',
    'src/3d/audio/audioManager.ts',
  ]),
  compatibilityEntrypoints: Object.freeze([
    'src/3d/game3d.js',
    'src/3d/sceneManager.js',
    'src/3d/config.js',
    'src/3d/camera.js',
    'src/3d/physics.js',
    'src/3d/renderQuality.js',
    'src/3d/input.js',
  ]),
  rules: Object.freeze([
    'new production gameplay code must have a TypeScript owner',
    'legacy JavaScript is compatibility-only and must not become a second authority',
    'vendor JavaScript is never renamed into application TypeScript',
    'strict surfaces use allowJs=false and no implicit ambient runtime globals',
    'browser entrypoints may remain JavaScript only as Vite compatibility shims',
    'deterministic simulation does not consume Date.now or Math.random',
    'runtime snapshots use schema-versioned immutable envelopes',
    'network and asset boundaries enforce bounded input sizes',
  ]),
});

export function isCriticalTypeScriptOwner(path: string): boolean {
  return TYPESCRIPT_MIGRATION_SURFACE_R37.criticalProductionOwners.includes(path);
}

export function isCompatibilityEntrypoint(path: string): boolean {
  return TYPESCRIPT_MIGRATION_SURFACE_R37.compatibilityEntrypoints.includes(path);
}
