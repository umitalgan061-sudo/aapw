import type { RuntimeEnvelope, RuntimeEvent, RuntimeTick } from './types.ts';

export interface MigrationModuleRecord {
  readonly id: string;
  readonly legacyPath: string;
  readonly modernPath: string;
  readonly owner: 'runtime' | 'world' | 'rendering' | 'network' | 'persistence' | 'tooling' | 'ui';
  readonly status: 'planned' | 'facaded' | 'migrated' | 'retired';
  readonly risk: 'low' | 'medium' | 'high';
}

export interface MigrationLedgerSnapshot {
  readonly version: 3;
  readonly generatedAtTick: number;
  readonly modules: readonly MigrationModuleRecord[];
  readonly legacyCount: number;
  readonly migratedCount: number;
  readonly coveragePercent: number;
}

export const R3_MIGRATION_MODULES = [
  { id: 'scene', legacyPath: 'src/3d/sceneManager.js', modernPath: 'src/3d/modern/sceneRuntime.ts', owner: 'rendering', status: 'facaded', risk: 'high' },
  { id: 'game-loop', legacyPath: 'src/3d/game3d.js', modernPath: 'src/3d/modern/applicationRuntime.ts', owner: 'runtime', status: 'facaded', risk: 'high' },
  { id: 'physics', legacyPath: 'src/3d/physics.js', modernPath: 'src/3d/modern/physicsRuntime.ts', owner: 'world', status: 'facaded', risk: 'high' },
  { id: 'input', legacyPath: 'src/3d/input.js', modernPath: 'src/3d/modern/inputRuntime.ts', owner: 'runtime', status: 'facaded', risk: 'medium' },
  { id: 'assets', legacyPath: 'src/3d/assets.js', modernPath: 'src/3d/modern/assetRuntimeR3.ts', owner: 'rendering', status: 'facaded', risk: 'medium' },
  { id: 'world', legacyPath: 'src/3d/world/', modernPath: 'src/3d/modern/worldRuntimeR3.ts', owner: 'world', status: 'facaded', risk: 'high' },
  { id: 'save', legacyPath: 'src/3d/saveSystem.js', modernPath: 'src/3d/modern/saveRuntimeR3.ts', owner: 'persistence', status: 'facaded', risk: 'medium' },
  { id: 'audio', legacyPath: 'src/3d/audio.js', modernPath: 'src/3d/modern/audioRuntimeR3.ts', owner: 'runtime', status: 'facaded', risk: 'medium' },
  { id: 'network', legacyPath: 'src/3d/network/', modernPath: 'src/3d/modern/networkRuntimeR3.ts', owner: 'network', status: 'facaded', risk: 'high' },
  { id: 'editor', legacyPath: 'src/3d/editor/', modernPath: 'src/3d/modern/editorRuntimeR3.ts', owner: 'ui', status: 'planned', risk: 'high' },
  { id: 'tools', legacyPath: 'scripts/*.js', modernPath: 'scripts/*.ts', owner: 'tooling', status: 'facaded', risk: 'low' },
  { id: 'service-worker', legacyPath: 'service-worker.js', modernPath: 'service-worker.ts', owner: 'runtime', status: 'facaded', risk: 'medium' },
] as const satisfies readonly MigrationModuleRecord[];

export function createMigrationLedger(tick: RuntimeTick = 0): MigrationLedgerSnapshot {
  const legacyCount = R3_MIGRATION_MODULES.filter((module) => module.status !== 'retired').length;
  const migratedCount = R3_MIGRATION_MODULES.filter((module) => module.status === 'migrated' || module.status === 'retired').length;
  const coveragePercent = legacyCount === 0 ? 100 : Number(((migratedCount / legacyCount) * 100).toFixed(2));
  return {
    version: 3,
    generatedAtTick: tick,
    modules: [...R3_MIGRATION_MODULES],
    legacyCount,
    migratedCount,
    coveragePercent,
  };
}

export function createMigrationEvent(ledger: MigrationLedgerSnapshot, tick: number): RuntimeEvent {
  const payload: RuntimeEnvelope = {
    version: 3,
    kind: 'migration-ledger',
    tick,
    sequence: tick,
    payload: ledger,
  };
  return payload as RuntimeEvent;
}
