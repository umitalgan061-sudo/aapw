/** R11 living-world TypeScript migration ledger. */
import { R9_MIGRATION_MODULES } from './migrationLedgerR9.ts';

export const R11_LIVING_WORLD_MODULES = Object.freeze([
  { id: 'fauna-activity-budget', legacyPath: 'src/3d/gameplay/livingWorldFaunaActivityBudget.legacy.js', modernPath: 'src/3d/gameplay/livingWorldFaunaActivityBudget.ts', strict: true },
  { id: 'stimulus-work-budget', legacyPath: 'src/3d/gameplay/livingWorldStimulusWorkBudget.legacy.js', modernPath: 'src/3d/gameplay/livingWorldStimulusWorkBudget.ts', strict: true },
  { id: 'runtime-kernel', legacyPath: null, modernPath: 'src/3d/gameplay/livingWorldRuntimeKernel.ts', strict: true },
  { id: 'fauna-population-director', legacyPath: 'src/3d/gameplay/livingWorldFaunaPopulationDirector.legacy.js', modernPath: 'src/3d/gameplay/livingWorldFaunaPopulationDirector.ts', strict: false },
] as const);

export interface R11LivingWorldMigrationSnapshot {
  readonly version: 11;
  readonly previousCoreModules: number;
  readonly livingWorldModules: number;
  readonly strictLivingWorldModules: number;
  readonly strictCoveragePercent: number;
}

export function getR11LivingWorldMigrationSnapshot(): R11LivingWorldMigrationSnapshot {
  const strictLivingWorldModules = R11_LIVING_WORLD_MODULES.filter((module) => module.strict).length;
  return Object.freeze({
    version: 11,
    previousCoreModules: R9_MIGRATION_MODULES.length,
    livingWorldModules: R11_LIVING_WORLD_MODULES.length,
    strictLivingWorldModules,
    strictCoveragePercent: Number(((strictLivingWorldModules / R11_LIVING_WORLD_MODULES.length) * 100).toFixed(2)),
  });
}
