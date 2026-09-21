/** R10 production migration ledger for frame helpers and 3D UI runtime surfaces. */
export const R10_MIGRATION_MODULES = Object.freeze([
  { id: 'game-loop-helpers', legacyPath: 'src/3d/gameLoopHelpers.js', modernPath: 'src/3d/gameLoopHelpers.ts', status: 'migrated' },
  { id: 'safe-mode', legacyPath: 'src/3d/safeMode.js', modernPath: 'src/3d/safeMode.ts', status: 'migrated' },
  { id: 'pause-menu', legacyPath: 'src/3d/ui/pauseMenu.js', modernPath: 'src/3d/ui/pauseMenu.ts', status: 'migrated' },
  { id: 'touch-joystick', legacyPath: 'src/3d/ui/touchJoystick.js', modernPath: 'src/3d/ui/touchJoystick.ts', status: 'migrated' },
] as const);

export interface R10MigrationSnapshot {
  readonly version: 10;
  readonly migratedCount: number;
  readonly totalTracked: number;
  readonly coveragePercent: number;
}

export function getR10MigrationSnapshot(): R10MigrationSnapshot {
  const totalTracked = R10_MIGRATION_MODULES.length;
  const migratedCount = R10_MIGRATION_MODULES.filter((module) => module.status === 'migrated').length;
  return Object.freeze({
    version: 10,
    migratedCount,
    totalTracked,
    coveragePercent: totalTracked === 0 ? 100 : Number(((migratedCount / totalTracked) * 100).toFixed(2)),
  });
}
